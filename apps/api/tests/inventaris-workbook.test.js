import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const {
  buildInventarisWorkbook,
  CONDITION_COLUMN,
  acquisition,
  FIRST_DATA_ROW,
} = require('../src/modules/reports/inventarisWorkbook');

/**
 * The `INVENTARIS` sheet — `CR-009` `DEC-A`, `DEC-B`, `DEC-F`.
 *
 * The workbook is inspected as the ZIP of XML it actually is, rather than
 * re-read through a spreadsheet library: what matters is that the bytes handed
 * to the browser carry the merges, the values and the images, and a library
 * that normalises on read could hide a file Excel would not open.
 */

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const row = (overrides = {}) => ({
  no: 1,
  unitId: 'unit-1',
  assetId: 'asset-1',
  assetName: 'LAPTOP ACER',
  description: 'Acer One 14 Z476',
  classificationId: '117010101001',
  classificationName: 'Komputer',
  institutionName: 'SMK AL-MUFTI',
  departmentCode: 'TKJ',
  departmentName: 'Teknik Komputer',
  fundingSourceName: 'Dana Bos',
  contractDate: '2026-08-15',
  inventoryCode: 'ALM-1-2026-00042',
  condition: 'GOOD',
  lifecycleState: 'ACTIVE',
  locationName: 'RPS 5',
  isActive: true,
  ...overrides,
});

const META = { institutionName: 'SMK AL-MUFTI SUBANG', scopeLabel: 'TKJ', year: 2026 };

const noPhoto = async () => null;

/** The workbook, opened as the archive it is. */
async function open(rows, meta = META, loadPhoto = noPhoto) {
  const buffer = await buildInventarisWorkbook(rows, meta, loadPhoto);
  const zip = await JSZip.loadAsync(Buffer.from(buffer));

  return {
    zip,
    sheet: await zip.file('xl/worksheets/sheet1.xml').async('string'),
    strings: (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '',
    names: Object.keys(zip.files),
  };
}

describe('layout (CR-009)', () => {
  /**
   * The load-bearing assertion of the whole feature: these ranges are read off
   * the client's own `RPS 5.xlsx`, and reproducing them is what makes the export
   * recognisable as their sheet rather than a generic table.
   */
  it('reproduces the source workbook’s merge ranges exactly', async () => {
    const { sheet } = await open([row()]);

    for (const range of [
      'A2:S2',
      'A3:S3',
      'A6:A7',
      'B6:B7',
      'K6:L6',
      'M6:M7',
      'N6:P6',
      'Q6:Q7',
      'R6:R7',
      'S6:S7',
    ]) {
      expect(sheet).toContain(`ref="${range}"`);
    }
  });

  it('carries the two-row header the source uses', async () => {
    const { strings } = await open([row()]);

    for (const header of [
      'No',
      'Nama',
      'Alias',
      'Distribusi',
      'Jenis',
      'Spesifikasi',
      'Jumlah',
      'Nomor Urut',
      'Satuan',
      'Sumber Dana',
      'Bulan',
      'Tahun',
      'Kondisi',
      'Baik',
      'Rusak',
      'Hilang',
      'Tempat Penyimpanan',
      'Kode Inventaris',
      'FOTO',
    ]) {
      expect(strings).toContain(`<t>${header}</t>`);
    }
  });

  it('titles the sheet from the institution and the scope', async () => {
    const { strings } = await open([row()]);

    expect(strings).toContain('DAFTAR INVENTARIS ALAT/BARANG TKJ');
    expect(strings).toContain('SMK AL-MUFTI SUBANG TAHUN 2026');
  });

  /**
   * The department a departmental sheet belongs to, named on the title line.
   * Upper-cased to match the rest of it — the source workbook's title is all
   * capitals, and a mixed-case name dropped into it reads as a different
   * sentence.
   */
  it('upper-cases a department name and code into the title', async () => {
    const { strings } = await open([row()], {
      institutionName: 'SMK Al-Mufti',
      scopeLabel: 'Teknik Komputer dan Jaringan (TKJ)',
      year: 2026,
    });

    expect(strings).toContain(
      'DAFTAR INVENTARIS ALAT/BARANG TEKNIK KOMPUTER DAN JARINGAN (TKJ)'
    );
  });

  it('leaves the title unadorned when the sheet covers no single department', async () => {
    const { strings } = await open([row()], {
      institutionName: 'SMK Al-Mufti',
      scopeLabel: '',
      year: 2026,
    });

    // Trailing space trimmed rather than left dangling after "BARANG".
    expect(strings).toContain('<t>DAFTAR INVENTARIS ALAT/BARANG</t>');
  });
});

describe('one row per physical unit (DEC-C)', () => {
  it('writes Jumlah as 1 on every row, however many share an asset', async () => {
    const rows = [row({ no: 1 }), row({ no: 2, unitId: 'unit-2', inventoryCode: 'ALM-1-2026-00043' })];
    const { sheet } = await open(rows);

    // Column G on both data rows. `Jumlah` is what the asset-level report
    // collapses into `unitCount`; here the row IS the item.
    expect(sheet).toContain(`<c r="G${FIRST_DATA_ROW}"`);
    expect(sheet).toMatch(/<c r="G8"[^>]*><v>1<\/v>/);
    expect(sheet).toMatch(/<c r="G9"[^>]*><v>1<\/v>/);
  });
});

describe('the condition mapping (DEC-B)', () => {
  it.each([
    ['GOOD', 'baik'],
    ['FAIR', 'baik'],
    ['POOR', 'rusak'],
    ['DAMAGED', 'rusak'],
    ['UNSERVICEABLE', 'rusak'],
  ])('maps %s to %s', (condition, column) => {
    expect(CONDITION_COLUMN[condition]).toBe(column);
  });

  /**
   * The application does not record "lost" as a condition. `UNSERVICEABLE`
   * means present and beyond use, and ticking `Hilang` for it would assert
   * something about the physical world the system has no evidence for.
   */
  it('never maps anything to Hilang', () => {
    expect(Object.values(CONDITION_COLUMN)).not.toContain('hilang');
  });

  it('ticks neither column when no condition is recorded', async () => {
    const { sheet } = await open([row({ condition: null })]);

    expect(sheet).not.toMatch(/<c r="[NOP]8"[^>]*>[^<]*<v>/);
  });
});

describe('the acquisition date (DEC-A)', () => {
  it('splits a contract date into its month name and year', () => {
    expect(acquisition('2026-08-15')).toEqual({ bulan: 'Agustus', tahun: 2026 });
  });

  /**
   * Deliberately NOT falling back to the registration date. An acquisition date
   * and a registration date are different facts, and a sheet that quietly
   * substitutes one for the other is worse than one with a visible gap.
   */
  it('leaves both empty for an asset with no contract', () => {
    expect(acquisition(null)).toEqual({ bulan: null, tahun: null });
  });

  it('leaves both empty rather than propagating an unparseable date', () => {
    expect(acquisition('not-a-date')).toEqual({ bulan: null, tahun: null });
  });
});

describe('photographs (DEC-F)', () => {
  it('embeds the image when a row has one', async () => {
    const { names } = await open([row()], META, async () => ({
      id: 'photo-1',
      buffer: PNG_1X1,
      extension: 'png',
    }));

    expect(names).toContain('xl/media/image1.png');
    expect(names.some((name) => name.startsWith('xl/drawings/drawing'))).toBe(true);
  });

  /**
   * A photograph attached to the ASSET describes every one of its units, so a
   * forty-unit asset would otherwise embed the same file forty times and
   * produce a workbook nobody can open.
   */
  it('embeds one copy of a photograph shared by many rows', async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      row({ no: index + 1, unitId: `unit-${index}`, inventoryCode: `CODE-${index}` })
    );

    const { names } = await open(rows, META, async () => ({
      id: 'shared',
      buffer: PNG_1X1,
      extension: 'png',
    }));

    const media = names.filter((name) => name.startsWith('xl/media/') && name.endsWith('.png'));
    expect(media).toHaveLength(1);
  });

  it('writes a workbook with no media at all when nothing has a photograph', async () => {
    const { names } = await open([row()]);

    expect(names.some((name) => name.startsWith('xl/media/') && name.endsWith('.png'))).toBe(false);
  });
});

describe('empty and partial data', () => {
  it('writes a header-only workbook for an empty report', async () => {
    const { sheet, strings } = await open([]);

    expect(strings).toContain('<t>Kode Inventaris</t>');
    expect(sheet).toContain('ref="N6:P6"');
  });

  it('leaves a cell empty rather than writing null into it', async () => {
    const { sheet, strings } = await open([
      row({ inventoryCode: null, locationName: null, fundingSourceName: null }),
    ]);

    expect(sheet).not.toContain('>null<');
    expect(strings).not.toContain('<t>null</t>');
  });
});
