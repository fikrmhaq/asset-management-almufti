'use strict';

/**
 * The `PERAWATAN` sheet — `CR-011`.
 *
 * The client's maintenance tracker: the same items as `INVENTARIS`, in the same
 * order, followed by one block per month recording the item's condition, whether
 * it moved, and a note.
 *
 * LAYOUT ONLY, like its sibling. It is handed plain rows and a per-unit history
 * map by `service.inventoryUnitsExport` and knows nothing about Sequelize, so
 * the derivation and the drawing can change independently.
 *
 * WHY THIS SHEET IS BETTER SERVED THAN `INVENTARIS`. There the five stored
 * conditions had to collapse into two tick columns and `Hilang` was left empty
 * for a human to mark. Here the sheet's own vocabulary is three — Baik, Rusak
 * Ringan, Rusak Berat — which recovers the distinction the two-column form lost:
 * `UNSERVICEABLE` stops being indistinguishable from `POOR`.
 */

const { MONTHS } = require('./inventarisWorkbook');

/** The fixed left-hand block, before the months begin. */
const LEAD_COLUMNS = Object.freeze([
  { key: 'no', header: 'No', width: 5 },
  { key: 'nama', header: 'Nama', width: 28 },
  { key: 'spesifikasi', header: 'Spesifikasi', width: 34 },
  { key: 'jumlah', header: 'Jumlah', width: 8 },
  { key: 'baik', header: 'B', width: 5 },
  { key: 'rusakRingan', header: 'RR', width: 5 },
  { key: 'rusakBerat', header: 'RB', width: 5 },
  { key: 'tempat', header: 'Tempat Penyimpanan', width: 20 },
  { key: 'kodeInventaris', header: 'Kode Inventaris', width: 24 },
]);

/** Where the fixed block's `Kondisi` spans, 1-based. */
const CONDITION_FIRST = 5;
const CONDITION_LAST = 7;

/** Each month occupies four tick columns plus a note. */
const MONTH_TICKS = Object.freeze(['B', 'RR', 'RB', 'Pindah']);
const MONTH_WIDTH = MONTH_TICKS.length + 1;

const TITLE_ROW = 2;
const SUBTITLE_ROW = 3;
const HEADER_ROW = 6;
const SUBHEADER_ROW = 7;
const FIRST_DATA_ROW = 8;

/**
 * Five stored conditions into the sheet's three — `CR-011` `DEC-B`.
 *
 * Consistent with `CR-009` `DEC-B`, which collapsed the same five into two for
 * `INVENTARIS`. Nothing maps to nothing: every condition the application can
 * record has a column here, which is why this mapping is not lossy and that one
 * was.
 */
const CONDITION_TICK = Object.freeze({
  GOOD: 'B',
  FAIR: 'B',
  POOR: 'RR',
  DAMAGED: 'RR',
  UNSERVICEABLE: 'RB',
});

const TICK = '✔';

const thin = { style: 'thin', color: { argb: 'FF9CA3AF' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

/** `Agustus` — or `Agustus 2025` where the window crosses a year (`DEC-C`). */
function monthLabel({ year, month }, months) {
  const spansYears = new Set(months.map((entry) => entry.year)).size > 1;
  return spansYears ? `${MONTHS[month]} ${year}` : MONTHS[month];
}

function writeHeader(sheet, { institutionName, scopeLabel, year }, months) {
  const lastColumn = LEAD_COLUMNS.length + months.length * MONTH_WIDTH;
  const scope = scopeLabel ? scopeLabel.toLocaleUpperCase('id-ID') : '';

  sheet.getCell(TITLE_ROW, 1).value = `DAFTAR PERAWATAN ALAT/BARANG ${scope}`.trim();
  sheet.getCell(SUBTITLE_ROW, 1).value = `${institutionName ?? ''} TAHUN ${year}`.trim();

  for (const rowNumber of [TITLE_ROW, SUBTITLE_ROW]) {
    sheet.mergeCells(rowNumber, 1, rowNumber, lastColumn);
    const cell = sheet.getCell(rowNumber, 1);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = {
      name: 'Arial',
      bold: rowNumber === TITLE_ROW,
      size: rowNumber === TITLE_ROW ? 14 : 11,
    };
  }

  LEAD_COLUMNS.forEach((column, index) => {
    const columnNumber = index + 1;

    // `Kondisi` spans its three ticks; everything else spans both header rows.
    if (columnNumber === CONDITION_FIRST) {
      sheet.mergeCells(HEADER_ROW, CONDITION_FIRST, HEADER_ROW, CONDITION_LAST);
      sheet.getCell(HEADER_ROW, CONDITION_FIRST).value = 'Kondisi';
      ['B', 'RR', 'RB'].forEach((label, offset) => {
        sheet.getCell(SUBHEADER_ROW, CONDITION_FIRST + offset).value = label;
      });
      return;
    }

    if (columnNumber > CONDITION_FIRST && columnNumber <= CONDITION_LAST) return;

    sheet.mergeCells(HEADER_ROW, columnNumber, SUBHEADER_ROW, columnNumber);
    sheet.getCell(HEADER_ROW, columnNumber).value = column.header;
  });

  months.forEach((entry, index) => {
    const first = LEAD_COLUMNS.length + index * MONTH_WIDTH + 1;
    const noteColumn = first + MONTH_TICKS.length;

    sheet.mergeCells(HEADER_ROW, first, HEADER_ROW, first + MONTH_TICKS.length - 1);
    sheet.getCell(HEADER_ROW, first).value = monthLabel(entry, months);

    MONTH_TICKS.forEach((label, offset) => {
      sheet.getCell(SUBHEADER_ROW, first + offset).value = label;
      sheet.getColumn(first + offset).width = label === 'Pindah' ? 8 : 5;
    });

    sheet.mergeCells(HEADER_ROW, noteColumn, SUBHEADER_ROW, noteColumn);
    sheet.getCell(HEADER_ROW, noteColumn).value = 'keterangan';
    sheet.getColumn(noteColumn).width = 22;
  });

  for (const rowNumber of [HEADER_ROW, SUBHEADER_ROW]) {
    for (let columnNumber = 1; columnNumber <= lastColumn; columnNumber += 1) {
      const cell = sheet.getCell(rowNumber, columnNumber);
      cell.font = { name: 'Arial', bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BORDER;
      cell.fill = HEADER_FILL;
    }
  }

  // The item's identity stays on screen while the months scroll sideways.
  sheet.views = [{ state: 'frozen', xSplit: LEAD_COLUMNS.length, ySplit: SUBHEADER_ROW }];

  return lastColumn;
}

/**
 * Adds the sheet to an existing workbook.
 *
 * @param {import('exceljs').Workbook} workbook
 * @param {object[]} rows      the same rows, in the same order, as `INVENTARIS`
 * @param {object}   meta      `{ institutionName, scopeLabel, year }`
 * @param {{months: {year:number, month:number}[], history: Map<string, object[]>}} maintenance
 */
function addPerawatanSheet(workbook, rows, meta, { months, history }) {
  const sheet = workbook.addWorksheet('PERAWATAN', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  LEAD_COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  const lastColumn = writeHeader(sheet, meta, months);

  rows.forEach((row, index) => {
    const excelRow = sheet.getRow(FIRST_DATA_ROW + index);
    const currentTick = CONDITION_TICK[row.condition];

    const values = {
      no: row.no,
      nama: row.assetName,
      spesifikasi: row.description,
      // One row per physical item, so the count is always one — the same
      // expansion `INVENTARIS` makes of the source sheet's quantity column.
      jumlah: 1,
      baik: currentTick === 'B' ? TICK : null,
      rusakRingan: currentTick === 'RR' ? TICK : null,
      rusakBerat: currentTick === 'RB' ? TICK : null,
      tempat: row.locationName,
      // Empty in every row of the client's own sheet, which is the one column
      // that would have tied a maintenance line to a specific item.
      kodeInventaris: row.inventoryCode,
    };

    LEAD_COLUMNS.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      cell.value = values[column.key] ?? null;
      cell.font = { name: 'Arial', size: 10 };
      cell.border = BORDER;
      cell.alignment = {
        vertical: 'middle',
        wrapText: column.key === 'spesifikasi' || column.key === 'nama',
        horizontal: columnIndex + 1 >= CONDITION_FIRST ? 'center' : 'left',
      };
    });

    const monthly = history.get(row.unitId) ?? [];

    months.forEach((_, monthIndex) => {
      const first = LEAD_COLUMNS.length + monthIndex * MONTH_WIDTH + 1;
      const entry = monthly[monthIndex] ?? {};
      const tick = CONDITION_TICK[entry.condition];

      /**
       * A month with no covering period leaves every tick blank — the third
       * state (`DEC-A`), distinct from a recorded `B` and visible as such. A
       * unit registered mid-window is blank before it existed rather than
       * back-filled.
       */
      const ticks = [
        tick === 'B' ? TICK : null,
        tick === 'RR' ? TICK : null,
        tick === 'RB' ? TICK : null,
        entry.moved ? TICK : null,
      ];

      ticks.forEach((value, offset) => {
        const cell = excelRow.getCell(first + offset);
        cell.value = value;
        cell.font = { name: 'Arial', size: 10 };
        cell.border = BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const note = excelRow.getCell(first + MONTH_TICKS.length);
      note.value = entry.note || null;
      note.font = { name: 'Arial', size: 9 };
      note.border = BORDER;
      note.alignment = { vertical: 'middle', wrapText: true };
    });

    excelRow.commit();
  });

  return { sheet, lastColumn };
}

module.exports = {
  addPerawatanSheet,
  CONDITION_TICK,
  LEAD_COLUMNS,
  MONTH_TICKS,
  FIRST_DATA_ROW,
  HEADER_ROW,
};
