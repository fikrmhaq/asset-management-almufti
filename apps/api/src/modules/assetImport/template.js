'use strict';

/**
 * The asset import template — an `.xlsx` the registrar fills in.
 *
 * Three sheets:
 *
 *   Aset        the header row the import reads, and nothing else — an example
 *               row here would be imported by a registrar who forgot to delete
 *               it, so the examples live on Petunjuk
 *   Petunjuk    what each column means, worked examples, and what THIS
 *               institution's inventory code format asks for
 *   Referensi   the institution's departments, funding sources, active
 *               locations and the conditions, so values can be copied rather
 *               than guessed; Lokasi and Kondisi on Aset are dropdowns over it
 */

const ExcelJS = require('exceljs');

const { getModels } = require('../../db/models');
const { registrationHint } = require('../../domain/inventoryCodeFormat');
const { COLUMNS, SHEET_NAME } = require('./parse');
const { LIMITS } = require('./service');

const CONDITION_LABELS = ['Baik', 'Cukup', 'Kurang baik', 'Rusak', 'Rusak berat'];
const DATA_ROWS = LIMITS.rows;

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

const WIDTHS = {
  name: 32,
  classification: 18,
  quantity: 12,
  numberComposition: 20,
  department: 12,
  fundingSource: 14,
  location: 28,
  condition: 14,
  description: 40,
};

/** Columns kept as text, so Excel never turns `001` into `1` or a code into `1.33E+11`. */
const TEXT_COLUMNS = new Set([
  'classification',
  'numberComposition',
  'department',
  'fundingSource',
]);

const columnLetter = (index) => String.fromCharCode(65 + index);

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle' };
  });
  row.height = 20;
}

function assetSheet(workbook, references) {
  const sheet = workbook.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map((column) => ({
    header: column.required ? `${column.label} *` : column.label,
    key: column.key,
    width: WIDTHS[column.key],
    style: TEXT_COLUMNS.has(column.key) ? { numFmt: '@' } : {},
  }));
  styleHeader(sheet.getRow(1));

  const letterOf = (key) => columnLetter(COLUMNS.findIndex((column) => column.key === key));
  const list = (formula) => ({
    type: 'list',
    allowBlank: true,
    showErrorMessage: false,
    formulae: [formula],
  });

  const conditionColumn = letterOf('condition');
  const locationColumn = letterOf('location');
  for (let row = 2; row <= DATA_ROWS + 1; row += 1) {
    sheet.getCell(`${conditionColumn}${row}`).dataValidation = list(
      `Referensi!$J$2:$J$${CONDITION_LABELS.length + 1}`
    );
    if (references.locations.length > 0) {
      sheet.getCell(`${locationColumn}${row}`).dataValidation = list(
        `Referensi!$G$2:$G$${references.locations.length + 1}`
      );
    }
  }
  return sheet;
}

function instructionSheet(workbook, { institution, hint }) {
  const sheet = workbook.addWorksheet('Petunjuk');
  sheet.columns = [{ width: 24 }, { width: 100 }];

  const lines = [
    ['Impor aset', institution ? `Instansi: ${institution.name} (${institution.code})` : ''],
    [],
    [
      'Cara pakai',
      `Isi sheet "${SHEET_NAME}" mulai baris 2, satu baris untuk sekelompok unit. Simpan sebagai .xlsx (atau .csv), lalu unggah di halaman Impor aset. Pratinjau menunjukkan setiap masalah per baris; tidak ada yang disimpan sebelum Anda menekan Impor, dan bila satu baris salah, tidak ada yang disimpan.`,
    ],
    [
      'Satu aset, banyak baris',
      'Baris dengan Nama aset dan Klasifikasi yang sama menjadi SATU aset. Contoh: "Kursi siswa" 36 unit di Kelas X-1 dan 36 unit di Kelas X-2 ditulis dua baris, dan menjadi satu aset dengan 72 unit.',
    ],
    [
      'Selalu aset baru',
      'Impor selalu membuat aset baru. Untuk menambah unit ke aset yang sudah ada, gunakan halaman aset tersebut.',
    ],
    [],
    ['Kolom', 'Arti'],
    ['Nama aset *', 'Nama aset, maksimal 255 karakter.'],
    [
      'Klasifikasi *',
      'Kode klasifikasi 12 digit (lihat pemilih klasifikasi di aplikasi), atau nama klasifikasi paling rinci persis seperti di aplikasi. Bila nama yang sama dipakai beberapa klasifikasi, gunakan kodenya.',
    ],
    [
      'Jumlah unit',
      `Jumlah unit pada baris ini, 1 sampai ${LIMITS.unitsPerRow}. Kosong berarti 1.`,
    ],
    ['Komposisi nomor', compositionNote(hint)],
    [
      'Jurusan',
      'Kode atau nama jurusan pemilik unit (lihat sheet Referensi). Kosong berarti tanpa jurusan.',
    ],
    ['Sumber dana', fundingNote(hint)],
    [
      'Lokasi',
      'Nama lokasi aktif tempat unit berada (lihat sheet Referensi). Bila diisi, Kondisi wajib diisi; keduanya dicatat sebagai riwayat pertama unit. Kosongkan keduanya untuk menempatkan unit nanti.',
    ],
    ['Kondisi', 'Baik, Cukup, Kurang baik, Rusak, atau Rusak berat. Wajib bila Lokasi diisi.'],
    ['Keterangan', 'Keterangan untuk setiap unit pada baris ini (opsional).'],
    [],
    [
      'Batas',
      `Paling banyak ${LIMITS.rows} baris dan ${LIMITS.units} unit sekali impor. Kode inventaris dibuat otomatis menurut format instansi.`,
    ],
    [],
    ['Contoh', 'Nama aset | Klasifikasi | Jumlah unit | Lokasi | Kondisi'],
    ['', 'Kursi siswa | 133010110001 | 36 | Kelas X-1 | Baik'],
    ['', 'Kursi siswa | 133010110001 | 36 | Kelas X-2 | Baik'],
    ['', 'Laptop guru | Lap Top | 1 | Ruang Guru | Baik'],
  ];

  lines.forEach((values, index) => {
    const row = sheet.getRow(index + 1);
    row.values = values;
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(1).alignment = { vertical: 'top' };
    if ([1, 7].includes(index + 1)) row.font = { bold: true };
  });
  sheet.getRow(1).font = { bold: true, size: 14 };
  return sheet;
}

function compositionNote(hint) {
  const composition = hint.numberComposition;
  if (!composition.required) {
    return 'Tidak dipakai oleh format kode inventaris instansi ini — biarkan kosong.';
  }
  const max = composition.maxLength ? ` Maksimal ${composition.maxLength} karakter.` : '';
  return composition.perUnit
    ? `WAJIB, satu nilai per unit (format instansi ini tidak memakai nomor urut). Untuk beberapa unit dalam satu baris, pisahkan dengan titik koma, misalnya "001;002;003" — atau tulis satu baris per unit.${max}`
    : `WAJIB, satu nilai untuk semua unit pada baris itu; nomor urut membedakan unitnya.${max}`;
}

function fundingNote(hint) {
  return hint.fundingSource.inCode
    ? 'WAJIB: kode inventaris instansi ini memuat kode sumber dana. Tulis kode atau nama sumber dana (lihat sheet Referensi); sumber dana harus memiliki kode.'
    : 'Kode atau nama sumber dana (lihat sheet Referensi). Opsional.';
}

function referenceSheet(workbook, references) {
  const sheet = workbook.addWorksheet('Referensi');
  sheet.columns = [
    { header: 'Kode jurusan', width: 14 },
    { header: 'Nama jurusan', width: 32 },
    {},
    { header: 'Kode sumber dana', width: 18 },
    { header: 'Nama sumber dana', width: 32 },
    {},
    { header: 'Lokasi', width: 36 },
    {},
    {},
    { header: 'Kondisi', width: 16 },
  ];
  styleHeader(sheet.getRow(1));

  const put = (column, values) =>
    values.forEach((value, index) => {
      sheet.getCell(`${column}${index + 2}`).value = value;
    });

  put(
    'A',
    references.departments.map((d) => d.code)
  );
  put(
    'B',
    references.departments.map((d) => d.name)
  );
  put(
    'D',
    references.fundingSources.map((f) => f.code ?? '')
  );
  put(
    'E',
    references.fundingSources.map((f) => f.name)
  );
  put(
    'G',
    references.locations.map((l) => l.name)
  );
  put('J', CONDITION_LABELS);
  return sheet;
}

/**
 * @param {object|null} institution the caller's institution; `null` gives a
 *   template with no reference lists (a system-wide caller with none chosen)
 * @returns {Promise<Buffer>}
 */
async function buildTemplate(institution, { models = getModels() } = {}) {
  const references = institution
    ? {
        departments: await models.Department.findAll({
          where: { institutionId: institution.id, isActive: true },
          order: [['code', 'ASC']],
        }),
        fundingSources: await models.FundingSource.findAll({ order: [['name', 'ASC']] }),
        locations: await models.Location.findAll({
          where: { institutionId: institution.id, isActive: true },
          order: [['name', 'ASC']],
        }),
      }
    : { departments: [], fundingSources: [], locations: [] };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Asset Management System';
  workbook.created = new Date();

  assetSheet(workbook, references);
  instructionSheet(workbook, { institution, hint: registrationHint(institution) });
  referenceSheet(workbook, references);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { buildTemplate, CONDITION_LABELS };
