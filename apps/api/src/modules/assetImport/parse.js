'use strict';

/**
 * Reading an asset import file — `.xlsx` or `.csv` — into plain rows.
 *
 * Only the SHAPE of the file is judged here: which columns are present, and
 * the text in each cell. Whether a value means anything (a classification that
 * exists, a location in this institution) is the service's business.
 *
 * Rows are numbered as the spreadsheet numbers them, header included, so a
 * reported "row 7" is the row the registrar sees in Excel.
 */

const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');

/** The sheet the template writes; any other workbook falls back to its first sheet. */
const SHEET_NAME = 'Aset';

/**
 * The columns, in template order. `aliases` are matched after normalising the
 * header (lower case, no `*`, no parenthetical note), so `Nama aset *` and
 * `Klasifikasi (kode 12 digit)` both match.
 */
const COLUMNS = Object.freeze([
  {
    key: 'name',
    label: 'Nama aset',
    required: true,
    aliases: ['nama aset', 'nama', 'nama barang', 'name', 'asset name'],
  },
  {
    key: 'classification',
    label: 'Klasifikasi',
    required: true,
    aliases: ['klasifikasi', 'kode klasifikasi', 'classification', 'classification code'],
  },
  {
    key: 'quantity',
    label: 'Jumlah unit',
    aliases: ['jumlah unit', 'jumlah', 'qty', 'quantity', 'units'],
  },
  {
    key: 'numberComposition',
    label: 'Komposisi nomor',
    aliases: ['komposisi nomor', 'komposisi', 'number composition'],
  },
  { key: 'department', label: 'Jurusan', aliases: ['jurusan', 'kode jurusan', 'department'] },
  {
    key: 'fundingSource',
    label: 'Sumber dana',
    aliases: ['sumber dana', 'kode sumber dana', 'funding source'],
  },
  { key: 'location', label: 'Lokasi', aliases: ['lokasi', 'ruang', 'ruangan', 'location'] },
  { key: 'condition', label: 'Kondisi', aliases: ['kondisi', 'condition'] },
  {
    key: 'description',
    label: 'Keterangan',
    aliases: ['keterangan', 'deskripsi', 'description'],
  },
]);

const LABELS = Object.freeze(
  Object.fromEntries(COLUMNS.map((column) => [column.key, column.label]))
);

class ImportFileError extends Error {
  /** @param {string} code @param {string} message @param {object} [params] */
  constructor(code, message, params = {}) {
    super(message);
    this.name = 'ImportFileError';
    this.code = code;
    this.params = params;
  }
}

const normalizeHeader = (value) =>
  String(value ?? '')
    .replace(/\(.*?\)/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function columnFor(header) {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  return COLUMNS.find((column) => column.aliases.includes(normalized)) ?? null;
}

/**
 * Whether the upload is a workbook or a CSV, by extension first and content
 * second: browsers report CSV under several MIME types, and an `.xlsx` is a ZIP
 * whatever it is called.
 */
function kindOf(file) {
  const name = String(file.originalname ?? '').toLowerCase();
  if (name.endsWith('.xlsx')) return 'xlsx';
  if (name.endsWith('.csv')) return 'csv';
  if (file.buffer?.length >= 2 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b) {
    return 'xlsx';
  }
  return null;
}

/** The cell's text as the registrar sees it — formulas by result, dates as typed. */
function cellText(cell) {
  const { value } = cell;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
  return String(cell.text ?? '').trim();
}

async function readWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ImportFileError('FILE_UNREADABLE', 'The file could not be read as an Excel workbook');
  }

  const sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.worksheets[0];
  if (!sheet) throw new ImportFileError('NO_ROWS', 'The workbook has no sheet');

  const table = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells = [];
    for (let index = 1; index <= sheet.columnCount; index += 1) {
      cells.push(cellText(row.getCell(index)));
    }
    table[rowNumber - 1] = cells;
  });
  return table;
}

/**
 * A CSV saved by Excel in an Indonesian locale is separated by `;`, not `,`
 * (the comma is the decimal separator there), so the delimiter is read off the
 * header line rather than assumed.
 */
function readCsv(buffer) {
  const decoded = buffer.toString('utf8');
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  try {
    return parseCsv(text, {
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
    }).map((cells) => cells.map((cell) => String(cell ?? '').trim()));
  } catch {
    throw new ImportFileError('FILE_UNREADABLE', 'The file could not be read as CSV');
  }
}

/**
 * @param {{originalname?: string, buffer: Buffer}} file
 * @returns {Promise<{rows: Array<{row: number} & Record<string, string>>, ignoredColumns: string[]}>}
 * @throws {ImportFileError}
 */
async function parseImportFile(file) {
  const kind = kindOf(file);
  if (!kind) {
    throw new ImportFileError('FILE_TYPE', 'The file must be an Excel workbook (.xlsx) or a CSV');
  }

  const table = kind === 'xlsx' ? await readWorkbook(file.buffer) : readCsv(file.buffer);
  const header = table[0] ?? [];

  const positions = new Map();
  const ignoredColumns = [];
  header.forEach((title, index) => {
    if (!String(title ?? '').trim()) return;
    const column = columnFor(title);
    if (!column) {
      ignoredColumns.push(String(title).trim());
    } else if (!positions.has(column.key)) {
      positions.set(column.key, index);
    }
  });

  const missing = COLUMNS.filter((column) => column.required && !positions.has(column.key));
  if (missing.length > 0) {
    throw new ImportFileError(
      'MISSING_COLUMNS',
      `The file has no ${missing.map((column) => `"${column.label}"`).join(' or ')} column`,
      { columns: missing.map((column) => column.label).join(', ') }
    );
  }

  const rows = [];
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index] ?? [];
    const row = { row: index + 1 };
    for (const column of COLUMNS) {
      const position = positions.get(column.key);
      row[column.key] = position === undefined ? '' : String(cells[position] ?? '').trim();
    }
    if (COLUMNS.some((column) => row[column.key] !== '')) rows.push(row);
  }

  return { rows, ignoredColumns };
}

module.exports = { parseImportFile, ImportFileError, COLUMNS, LABELS, SHEET_NAME };
