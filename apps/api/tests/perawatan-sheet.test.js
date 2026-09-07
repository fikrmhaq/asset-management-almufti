import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const { buildInventarisWorkbook } = require('../src/modules/reports/inventarisWorkbook');
const { CONDITION_TICK } = require('../src/modules/reports/perawatanSheet');

/**
 * The `PERAWATAN` maintenance sheet — `CR-011`.
 *
 * Inspected as the ZIP of XML it is, for the same reason its sibling is: what
 * matters is the bytes Excel opens, and a library that normalises on read could
 * hide a file it would not.
 */

const META = { institutionName: 'SMK Al-Mufti', scopeLabel: 'Teknik Komputer (TKJ)', year: 2026 };

/** Twelve months ending in the given one, matching `service.monthWindow`. */
function months(at = new Date(Date.UTC(2026, 7, 15)), count = 12) {
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - (count - 1 - index), 1)
    );
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { year: start.getUTCFullYear(), month: start.getUTCMonth(), start, end };
  });
}

const row = (overrides = {}) => ({
  no: 1,
  unitId: 'unit-1',
  assetId: 'asset-1',
  assetName: 'LAPTOP ACER',
  description: 'Acer One 14 Z476',
  classificationId: '117010101001',
  classificationName: 'Komputer',
  institutionName: 'SMK Al-Mufti',
  departmentCode: 'TKJ',
  departmentName: 'Teknik Komputer',
  fundingSourceName: 'Dana Bos',
  contractDate: null,
  inventoryCode: 'ALM-1-2026-00042',
  condition: 'GOOD',
  lifecycleState: 'ACTIVE',
  locationName: 'RPS 5',
  isActive: true,
  ...overrides,
});

/** A twelve-entry history where `overrides` names the months that differ. */
const history = (overrides = {}) =>
  Array.from({ length: 12 }, (_, index) => ({
    condition: null,
    moved: false,
    note: '',
    ...(overrides[index] ?? {}),
  }));

async function open(rows, unitHistory, window = months()) {
  const buffer = await buildInventarisWorkbook(rows, META, async () => null, {
    months: window,
    history: unitHistory,
  });
  const zip = await JSZip.loadAsync(Buffer.from(buffer));

  return {
    names: Object.keys(zip.files),
    // sheet2 is PERAWATAN — INVENTARIS is added first.
    sheet: await zip.file('xl/worksheets/sheet2.xml').async('string'),
    strings: (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '',
  };
}

describe('the workbook carries both sheets (DEC-F)', () => {
  it('adds PERAWATAN beside INVENTARIS', async () => {
    const { names, strings } = await open([row()], new Map([['unit-1', history()]]));

    expect(names).toContain('xl/worksheets/sheet2.xml');
    expect(strings).toContain('INVENTARIS');
    expect(strings).toContain('PERAWATAN');
  });

  it('omits the sheet entirely when no maintenance data is passed', async () => {
    const buffer = await buildInventarisWorkbook([row()], META, async () => null);
    const zip = await JSZip.loadAsync(Buffer.from(buffer));

    expect(Object.keys(zip.files)).not.toContain('xl/worksheets/sheet2.xml');
  });

  it('reproduces the source sheet’s monthly merge shape', async () => {
    const { sheet } = await open([row()], new Map([['unit-1', history()]]));

    // Four tick columns spanned by the month name, with `keterangan` beside it —
    // the arrangement `RPS 5.xlsx` uses (`AD6:AG6`, `AH6:AH7`).
    expect(sheet).toContain('ref="A6:A7"');
    expect(sheet).toContain('ref="E6:G6"');
    expect(sheet).toMatch(/ref="[A-Z]+6:[A-Z]+6"/);
  });

  it('carries the sheet’s own headers', async () => {
    const { strings } = await open([row()], new Map([['unit-1', history()]]));

    for (const header of [
      'No',
      'Nama',
      'Spesifikasi',
      'Jumlah',
      'Kondisi',
      'B',
      'RR',
      'RB',
      'Pindah',
      'keterangan',
    ]) {
      expect(strings).toContain(`<t>${header}</t>`);
    }
    expect(strings).toContain('DAFTAR PERAWATAN ALAT/BARANG TEKNIK KOMPUTER (TKJ)');
  });
});

describe('the condition mapping (DEC-B)', () => {
  it.each([
    ['GOOD', 'B'],
    ['FAIR', 'B'],
    ['POOR', 'RR'],
    ['DAMAGED', 'RR'],
    ['UNSERVICEABLE', 'RB'],
  ])('maps %s to %s', (condition, tick) => {
    expect(CONDITION_TICK[condition]).toBe(tick);
  });

  /**
   * The distinction `CR-009` `DEC-B` had to discard. Two tick columns forced
   * `UNSERVICEABLE` and `POOR` into one; three recover it, which is the whole
   * reason this sheet is better served than the inventory one.
   */
  it('separates UNSERVICEABLE from POOR, which the inventory sheet cannot', () => {
    expect(CONDITION_TICK.UNSERVICEABLE).not.toBe(CONDITION_TICK.POOR);
  });

  it('leaves every condition column blank for a month never assessed', async () => {
    const { sheet } = await open([row({ condition: null })], new Map([['unit-1', history()]]));

    const rowXml = /<row r="8"[^>]*>(.*?)<\/row>/s.exec(sheet)?.[1] ?? '';
    const filled = [...rowXml.matchAll(/<c r="([A-Z]+)8"[^>]*>\s*<v>/g)].map((match) => match[1]);

    /**
     * `A`–`I` are the fixed left-hand block — No, Nama, Spesifikasi, Jumlah,
     * the three current-condition ticks, Tempat and Kode Inventaris — and carry
     * the item's identity whatever its history. What must be empty is the
     * three condition ticks and everything past the block, which is the months.
     */
    expect(filled).not.toContain('E');
    expect(filled).not.toContain('F');
    expect(filled).not.toContain('G');

    const monthly = filled.filter((column) => column.length > 1 || column > 'I');
    expect(monthly).toEqual([]);
  });
});

describe('what each month renders', () => {
  it('ticks the condition the unit was in at month end', async () => {
    const { sheet, strings } = await open(
      [row()],
      new Map([
        ['unit-1', history({ 11: { condition: 'DAMAGED', moved: false, note: 'Layar retak' } })],
      ])
    );

    expect(strings).toContain('<t>Layar retak</t>');
    // Something is written in the final month's block.
    expect(sheet).toMatch(/<row r="8"/);
  });

  it('ticks Pindah independently of the condition', async () => {
    const { strings } = await open(
      [row()],
      new Map([
        ['unit-1', history({ 5: { condition: 'GOOD', moved: true, note: 'Pindah ke RPS 5' } })],
      ])
    );

    expect(strings).toContain('<t>Pindah ke RPS 5</t>');
  });

  it('labels months with the year when the window crosses one', async () => {
    const { strings } = await open([row()], new Map([['unit-1', history()]]));

    // A twelve-month window ending in August 2026 begins in September 2025.
    expect(strings).toContain('<t>September 2025</t>');
    expect(strings).toContain('<t>Agustus 2026</t>');
  });

  it('labels months bare when the window sits inside one year', async () => {
    const window = months(new Date(Date.UTC(2026, 11, 15)), 5);
    const { strings } = await open([row()], new Map([['unit-1', history()]]), window);

    expect(strings).toContain('<t>Desember</t>');
    expect(strings).not.toContain('<t>Desember 2026</t>');
  });
});

describe('rows without history', () => {
  it('still lists a unit that has never been assessed', async () => {
    const { strings } = await open([row({ condition: null })], new Map());

    // Present in the sheet, with its identity, and no ticks — the third state.
    expect(strings).toContain('<t>ALM-1-2026-00042</t>');
  });

  it('keeps both sheets in the same row order', async () => {
    const rows = [
      row({ no: 1, unitId: 'unit-1', inventoryCode: 'CODE-1' }),
      row({ no: 2, unitId: 'unit-2', inventoryCode: 'CODE-2' }),
      row({ no: 3, unitId: 'unit-3', inventoryCode: 'CODE-3' }),
    ];

    const buffer = await buildInventarisWorkbook(rows, META, async () => null, {
      months: months(),
      history: new Map(rows.map((entry) => [entry.unitId, history()])),
    });
    const zip = await JSZip.loadAsync(Buffer.from(buffer));

    const inventaris = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const perawatan = await zip.file('xl/worksheets/sheet2.xml').async('string');

    // Same number of data rows, so a reader comparing the tabs line by line is
    // looking at the same item on both (`DEC-F`).
    const dataRows = (xml) => [...xml.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
    expect(dataRows(perawatan).filter((n) => n >= 8)).toEqual(
      dataRows(inventaris).filter((n) => n >= 8)
    );
  });
});
