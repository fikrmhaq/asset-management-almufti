'use strict';

/**
 * The `INVENTARIS` sheet — `CR-009` `DEC-D`, `DEC-F`, `DEC-G`.
 *
 * Reproduces the layout of the workbook the client already keeps by hand, so the
 * exported file can be printed beside — or in place of — the one they have:
 * two title rows, a merged two-row header, and a photograph anchored in the last
 * column.
 *
 * LAYOUT ONLY. It is handed plain row objects by `service.inventoryUnits` and
 * knows nothing about Sequelize, scope or filters, so the sheet can be
 * redesigned — or `exceljs` replaced — without touching the query. That
 * separation is the reason this is its own module rather than a branch inside
 * the service.
 *
 * WHY A SPREADSHEET AND NOT A CSV. The `FOTO` column carries an image. CSV is
 * plain text and can hold none, and a URL in a cell would not resolve either:
 * `GET /attachments/:id?download=true` authenticates with `Authorization:
 * Bearer`, so a link followed from Excel sends no credential and answers `401`.
 * A cell holding a link that always fails is worse than an empty cell.
 */

const ExcelJS = require('exceljs');

/**
 * The columns, in the source workbook's order. `width` is in Excel's character
 * units and comes from reading the original, not from taste.
 */
const COLUMNS = Object.freeze([
  { key: 'no', header: 'No', width: 5 },
  { key: 'nama', header: 'Nama', width: 28 },
  { key: 'alias', header: 'Alias', width: 14 },
  { key: 'distribusi', header: 'Distribusi', width: 12 },
  { key: 'jenis', header: 'Jenis', width: 14 },
  { key: 'spesifikasi', header: 'Spesifikasi', width: 38 },
  { key: 'jumlah', header: 'Jumlah', width: 8 },
  { key: 'nomorUrut', header: 'Nomor Urut', width: 11 },
  { key: 'satuan', header: 'Satuan', width: 9 },
  { key: 'sumberDana', header: 'Sumber Dana', width: 16 },
  { key: 'bulan', header: 'Bulan', width: 10 },
  { key: 'bulanSpill', header: null, width: 6 },
  { key: 'tahun', header: 'Tahun', width: 8 },
  { key: 'baik', header: 'Baik', width: 6 },
  { key: 'rusak', header: 'Rusak', width: 7 },
  { key: 'hilang', header: 'Hilang', width: 7 },
  { key: 'tempat', header: 'Tempat Penyimpanan', width: 20 },
  { key: 'kodeInventaris', header: 'Kode Inventaris', width: 24 },
  { key: 'foto', header: 'FOTO', width: 18 },
]);

/** 1-based column numbers for the ones addressed by name below. */
const COL = Object.freeze({
  BULAN: 11,
  TAHUN: 13,
  BAIK: 14,
  HILANG: 16,
  FOTO: 19,
  LAST: COLUMNS.length,
});

const TITLE_ROW = 2;
const SUBTITLE_ROW = 3;
const HEADER_ROW = 6;
const SUBHEADER_ROW = 7;
const FIRST_DATA_ROW = 8;

/**
 * Tall enough for a recognisable thumbnail. Excel row height is in points; 60
 * is roughly 80 pixels, which is what `FOTO_SIZE` draws into.
 */
const PHOTO_ROW_HEIGHT = 60;
const PHOTO_BOX = Object.freeze({ width: 76, height: 76 });

/**
 * The condition mapping — `DEC-B`. Five stored values into two tick columns.
 *
 * `Hilang` is deliberately absent: the application does not record "lost" as a
 * condition. `UNSERVICEABLE` means present and beyond use, and reporting it as
 * missing would assert something about the physical world the system has no
 * evidence for. The column is still drawn, for someone to tick by hand during a
 * stock-take.
 */
const CONDITION_COLUMN = Object.freeze({
  GOOD: 'baik',
  FAIR: 'baik',
  POOR: 'rusak',
  DAMAGED: 'rusak',
  UNSERVICEABLE: 'rusak',
});

const TICK = '✔';

/** The month names the source sheet uses. */
const MONTHS = Object.freeze([
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
]);

const thin = { style: 'thin', color: { argb: 'FF9CA3AF' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

/**
 * The acquisition date, split — `DEC-A`.
 *
 * Only a contract carries one. An asset with none leaves both cells EMPTY rather
 * than falling back to the registration date: an acquisition date and a
 * registration date are different facts, and a sheet that silently substitutes
 * one for the other is worse than one with a visible gap.
 */
function acquisition(contractDate) {
  if (!contractDate) return { bulan: null, tahun: null };

  const date = contractDate instanceof Date ? contractDate : new Date(contractDate);
  if (Number.isNaN(date.getTime())) return { bulan: null, tahun: null };

  return { bulan: MONTHS[date.getUTCMonth()], tahun: date.getUTCFullYear() };
}

/** `Name (CODE)`, matching the unit detail screen and the organization report. */
function department(row) {
  if (!row.departmentName && !row.departmentCode) return null;
  return row.departmentCode ? `${row.departmentName} (${row.departmentCode})` : row.departmentName;
}

/**
 * Writes the two title rows and the merged two-row header.
 *
 * The merges are what make this recognisable as the client's sheet rather than
 * a generic table: `Bulan` spans two columns and `Kondisi` spans three, exactly
 * as the source does.
 */
function writeHeader(sheet, { institutionName, scopeLabel, year }) {
  /**
   * The department, upper-cased to match the rest of the line.
   *
   * The source workbook's title reads `DAFTAR INVENTARIS ALAT/BARANG TKJ` — all
   * capitals — and a mixed-case department name dropped into it reads as a
   * different sentence. `toLocaleUpperCase('id-ID')` rather than the default:
   * Indonesian is the language these names are written in.
   */
  const scope = scopeLabel ? scopeLabel.toLocaleUpperCase('id-ID') : '';

  sheet.getCell(TITLE_ROW, 1).value = `DAFTAR INVENTARIS ALAT/BARANG ${scope}`.trim();
  sheet.getCell(SUBTITLE_ROW, 1).value = `${institutionName ?? ''} TAHUN ${year}`.trim();

  for (const rowNumber of [TITLE_ROW, SUBTITLE_ROW]) {
    sheet.mergeCells(rowNumber, 1, rowNumber, COL.LAST);
    const cell = sheet.getCell(rowNumber, 1);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = {
      name: 'Arial',
      bold: rowNumber === TITLE_ROW,
      size: rowNumber === TITLE_ROW ? 14 : 11,
    };
  }

  COLUMNS.forEach((column, index) => {
    const columnNumber = index + 1;
    if (!column.header) return;

    // `Bulan` over two columns, `Kondisi` over three, everything else over both
    // header rows — the source workbook's own arrangement.
    if (columnNumber === COL.BULAN) {
      sheet.mergeCells(HEADER_ROW, COL.BULAN, HEADER_ROW, COL.BULAN + 1);
    } else if (columnNumber === COL.BAIK) {
      sheet.mergeCells(HEADER_ROW, COL.BAIK, HEADER_ROW, COL.HILANG);
      sheet.getCell(HEADER_ROW, COL.BAIK).value = 'Kondisi';
      ['Baik', 'Rusak', 'Hilang'].forEach((label, offset) => {
        sheet.getCell(SUBHEADER_ROW, COL.BAIK + offset).value = label;
      });
      return;
    } else if (columnNumber > COL.BAIK && columnNumber <= COL.HILANG) {
      return;
    } else {
      sheet.mergeCells(HEADER_ROW, columnNumber, SUBHEADER_ROW, columnNumber);
    }

    sheet.getCell(HEADER_ROW, columnNumber).value = column.header;
  });

  for (const rowNumber of [HEADER_ROW, SUBHEADER_ROW]) {
    for (let columnNumber = 1; columnNumber <= COL.LAST; columnNumber += 1) {
      const cell = sheet.getCell(rowNumber, columnNumber);
      cell.font = { name: 'Arial', bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BORDER;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: SUBHEADER_ROW }];
}

/**
 * Builds the workbook.
 *
 * @param {object[]} rows        from `service.inventoryUnits`
 * @param {object}   meta        `{ institutionName, scopeLabel, year }`
 * @param {(row: object) => Promise<{buffer: Buffer, extension: string}|null>} loadPhoto
 *        Resolves a row's photograph, or `null`. Injected rather than imported
 *        so this module stays layout-only and the test can render a sheet
 *        without touching disk.
 * @param {{months: object[], history: Map<string, object[]>}} [maintenance]
 *        When given, a second `PERAWATAN` worksheet is added over the SAME rows
 *        in the SAME order (`CR-011` `DEC-F`), so the numbering cannot drift
 *        between the two sheets. Omitted, the workbook is `INVENTARIS` alone.
 * @returns {Promise<Buffer>}
 */
async function buildInventarisWorkbook(rows, meta, loadPhoto, maintenance) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Asset Management';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('INVENTARIS', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  writeHeader(sheet, meta);

  /**
   * One decode per attachment, not per row. A photograph attached to the ASSET
   * describes every one of its units, so a 40-unit asset would otherwise read
   * and embed the same file forty times.
   */
  const imageIds = new Map();

  for (const [index, row] of rows.entries()) {
    const rowNumber = FIRST_DATA_ROW + index;
    const excelRow = sheet.getRow(rowNumber);
    const { bulan, tahun } = acquisition(row.contractDate);

    const values = {
      no: row.no,
      nama: row.assetName,
      alias: row.classificationName,
      distribusi: department(row),
      jenis: row.classificationId,
      spesifikasi: row.description,
      // Always 1: the row IS the item. This is the column the asset-level
      // report collapses into `unitCount`, expanded back out.
      jumlah: 1,
      nomorUrut: row.no,
      satuan: 'Unit',
      sumberDana: row.fundingSourceName,
      bulan,
      bulanSpill: null,
      tahun,
      baik: null,
      rusak: null,
      hilang: null,
      tempat: row.locationName,
      kodeInventaris: row.inventoryCode,
      foto: null,
    };

    const tickColumn = CONDITION_COLUMN[row.condition];
    if (tickColumn) values[tickColumn] = TICK;

    COLUMNS.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      cell.value = values[column.key] ?? null;
      cell.font = { name: 'Arial', size: 10 };
      cell.border = BORDER;
      cell.alignment = {
        vertical: 'middle',
        wrapText: column.key === 'spesifikasi' || column.key === 'nama',
        horizontal: column.key === 'no' || columnIndex + 1 >= COL.BAIK - 1 ? 'center' : 'left',
      };
    });

    const photo = await loadPhoto(row);

    if (photo) {
      if (!imageIds.has(photo.id)) {
        imageIds.set(
          photo.id,
          workbook.addImage({ buffer: photo.buffer, extension: photo.extension })
        );
      }

      excelRow.height = PHOTO_ROW_HEIGHT;

      /**
       * Anchored with an explicit extent rather than `tl`/`br`: a two-cell
       * anchor stretches the picture to the cell and distorts it, and these are
       * photographs of real objects.
       */
      sheet.addImage(imageIds.get(photo.id), {
        tl: { col: COL.FOTO - 1 + 0.1, row: rowNumber - 1 + 0.1 },
        ext: PHOTO_BOX,
        editAs: 'oneCell',
      });
    }

    excelRow.commit();
  }

  /**
   * The maintenance tab (`CR-011`). Required late so the two modules can name
   * each other's constants — `perawatanSheet` reads `MONTHS` from here — without
   * a cycle at load time.
   */
  if (maintenance) {
    const { addPerawatanSheet } = require('./perawatanSheet');
    addPerawatanSheet(workbook, rows, meta, maintenance);
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = {
  buildInventarisWorkbook,
  COLUMNS,
  CONDITION_COLUMN,
  MONTHS,
  FIRST_DATA_ROW,
  HEADER_ROW,
  acquisition,
};
