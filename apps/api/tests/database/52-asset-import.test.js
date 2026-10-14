import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetAssetCoreData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

/**
 * Asset import from Excel / CSV — an ADDITION beside manual registration.
 *
 *   TEMPLATE   the .xlsx carries the header, the instructions and the
 *              institution's own reference values
 *   PREVIEW    reports every problem per row and column, and writes nothing —
 *              not even an audit row — while showing the codes it would issue
 *   IMPORT     rows sharing name + classification are ONE asset; units get
 *              codes, department, funding source and a MANUAL first history
 *              entry when placed; all or nothing
 *   FORMATS    per-unit number compositions, a funding source in the code
 *   AUTHZ      the manual path's permissions, and the institution boundary
 *   UNCHANGED  the manual path still works as before
 */

const V1 = '/api/v1';
const LEAF = '117010101001'; // Aspal — a most specific classification
const BRANCH = '117010101000'; // its parent, which is not
const OWN_LEAF = '117010101990'; // added below, owned by alpha

const REGISTRAR = ['asset:create', 'asset:read', 'asset-unit:create', 'asset-unit:read'];
const PLACER = [...REGISTRAR, 'asset-unit:record-history'];

let admin;
let alpha;
let beta;
let sarpras;
let tkj;
let bos;
let classroom;
let lab;

const HEADER =
  'Nama aset,Klasifikasi,Jumlah unit,Komposisi nomor,Jurusan,Sumber dana,Lokasi,Kondisi,Keterangan';
const csv = (...lines) => [HEADER, ...lines].join('\n');

const upload = (path, content, caller, { filename = 'aset.csv', institutionId } = {}) => {
  const request = api()
    .post(`${V1}/assets/import${path}`)
    .set(...caller.auth)
    .attach('file', Buffer.from(content), filename);
  return institutionId ? request.field('institutionId', institutionId) : request;
};
const preview = (content, caller = sarpras, options) =>
  upload('/preview', content, caller, options);
const importFile = (content, caller = sarpras, options) => upload('', content, caller, options);

const assetCount = () => models.Asset.count();
const auditCount = () => models.AuditLog.count();

async function xlsx(rows, { sheetName = 'Aset' } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(HEADER.split(','));
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await models.AssetClassification.destroy({ where: { id: OWN_LEAF } });
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
  tkj = await models.Department.create({
    code: 'TKJ',
    name: 'Teknik Komputer',
    institutionId: alpha.id,
  });
  [bos] = await models.FundingSource.findOrCreate({
    where: { code: 'BOSIMP' },
    defaults: { name: 'BOS Impor Uji' },
  });
  classroom = await models.Location.create({
    name: 'Kelas X-1',
    classificationId: LEAF,
    institutionId: alpha.id,
  });
  lab = await models.Location.create({
    name: 'Lab Komputer',
    classificationId: LEAF,
    institutionId: alpha.id,
  });
  await models.Location.create({
    name: 'Ruang Beta',
    classificationId: LEAF,
    institutionId: beta.id,
  });
  sarpras = await createCaller({ permissions: PLACER, institutionId: alpha.id });
});

afterAll(async () => {
  await resetAssetCoreData();
  await models.AssetClassification.destroy({ where: { id: OWN_LEAF } });
  await resetOrganizationData();
});

// ---------------------------------------------------------------------------

describe('template', () => {
  it('is a workbook with the import header, the instructions and the institution references', async () => {
    const response = await api()
      .get(`${V1}/assets/import/template`)
      .set(...sarpras.auth)
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('templat-impor-aset-ALPHA.xlsx');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Aset',
      'Petunjuk',
      'Referensi',
    ]);

    const header = workbook.getWorksheet('Aset').getRow(1).values.slice(1);
    expect(header).toEqual([
      'Nama aset *',
      'Klasifikasi *',
      'Jumlah unit',
      'Komposisi nomor',
      'Jurusan',
      'Sumber dana',
      'Lokasi',
      'Kondisi',
      'Keterangan',
    ]);
    // No example row on the sheet that is imported.
    expect(workbook.getWorksheet('Aset').getRow(2).getCell(1).value).toBeNull();

    const references = workbook.getWorksheet('Referensi');
    const column = (letter) => references.getColumn(letter).values.slice(2).filter(Boolean);
    expect(column('A')).toEqual(['TKJ']);
    expect(column('G')).toEqual(['Kelas X-1', 'Lab Komputer']); // not Beta's room
    expect(column('J')).toEqual(['Baik', 'Cukup', 'Kurang baik', 'Rusak', 'Rusak berat']);
  });

  it('the template, filled in, imports', async () => {
    const response = await api()
      .get(`${V1}/assets/import/template`)
      .set(...sarpras.auth)
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    workbook.getWorksheet('Aset').getRow(2).values = [
      'Meja guru',
      LEAF,
      2,
      '',
      'TKJ',
      '',
      'Kelas X-1',
      'Baik',
      '',
    ];
    const filled = Buffer.from(await workbook.xlsx.writeBuffer());

    const imported = await importFile(filled, sarpras, { filename: 'templat.xlsx' });
    expect(imported.status).toBe(201);
    expect(imported.body.data.summary).toEqual({ rows: 1, assets: 1, units: 2 });
  });
});

describe('preview', () => {
  it('shows the assets, units and codes it would create, and writes nothing', async () => {
    const audits = await auditCount();

    const response = await preview(
      csv(
        `Kursi siswa,${LEAF},3,,TKJ,BOSIMP,Kelas X-1,Baik,`,
        `kursi  SISWA,${LEAF},2,,,,Lab Komputer,Rusak,`,
        `Proyektor,${LEAF},1,,,,,,Merk Epson`
      )
    );

    expect(response.status).toBe(200);
    const report = response.body.data;
    expect(report).toMatchObject({
      dryRun: true,
      imported: false,
      valid: true,
      issues: [],
      fileIssues: [],
    });
    expect(report.summary).toEqual({ rows: 3, assets: 2, units: 6 });

    const [chairs, projector] = report.assets;
    expect(chairs).toMatchObject({
      name: 'Kursi siswa',
      classificationId: LEAF,
      unitCount: 5,
      existing: false,
    });
    expect(chairs.rows.map((row) => [row.row, row.quantity, row.location, row.condition])).toEqual([
      [2, 3, 'Kelas X-1', 'GOOD'],
      [3, 2, 'Lab Komputer', 'DAMAGED'],
    ]);
    const year = new Date().getFullYear();
    expect(chairs.rows.flatMap((row) => row.inventoryCodes)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `ALPHA-${year}-${String(n).padStart(5, '0')}`)
    );
    expect(projector.rows[0].inventoryCodes).toHaveLength(1);

    // Rolled back: no asset, no unit, no history, no audit row.
    expect(await assetCount()).toBe(0);
    expect(await models.AssetUnit.count()).toBe(0);
    expect(await models.LongitudinalHistory.count()).toBe(0);
    expect(await auditCount()).toBe(audits);
  });

  it('reports every problem with its row and column, not just the first', async () => {
    const response = await preview(
      csv(
        `,${LEAF},1,,,,,,`,
        `Meja,999999999999,1,,,,,,`,
        `Meja,${BRANCH},1,,,,,,`,
        `Meja,${LEAF},0,,,,,,`,
        `Meja,${LEAF},1,,XYZ,,,,`,
        `Meja,${LEAF},1,,,,Ruang Beta,Baik,`,
        `Meja,${LEAF},1,,,,Kelas X-1,,`,
        `Meja,${LEAF},1,,,,,Baik,`,
        `Meja,${LEAF},1,,,,Kelas X-1,Hancur,`,
        `Meja,${LEAF},1,,,TIDAKADA,,,`
      )
    );

    const report = response.body.data;
    expect(report.valid).toBe(false);
    const found = report.issues.map((problem) => [problem.row, problem.column, problem.code]);
    expect(found).toEqual(
      expect.arrayContaining([
        [2, 'Nama aset', 'REQUIRED'],
        [3, 'Klasifikasi', 'RULE'],
        [4, 'Klasifikasi', 'RULE'],
        [5, 'Jumlah unit', 'QUANTITY_INVALID'],
        [6, 'Jurusan', 'DEPARTMENT_NOT_FOUND'],
        [7, 'Lokasi', 'LOCATION_NOT_FOUND'], // Beta's room is not Alpha's
        [8, 'Kondisi', 'CONDITION_REQUIRED'],
        [9, 'Lokasi', 'LOCATION_REQUIRED'],
        [10, 'Kondisi', 'CONDITION_INVALID'],
        [11, 'Sumber dana', 'FUNDING_SOURCE_NOT_FOUND'],
      ])
    );
    expect(await assetCount()).toBe(0);
  });

  it('refuses a file with no name or classification column, and an unknown type', async () => {
    const missing = await preview('Nama aset,Jumlah\nMeja,1');
    expect(missing.body.data.fileIssues[0]).toMatchObject({ code: 'MISSING_COLUMNS' });

    const wrongType = await preview('hello', sarpras, { filename: 'aset.txt' });
    expect(wrongType.body.data.fileIssues[0]).toMatchObject({ code: 'FILE_TYPE' });

    const empty = await preview(HEADER);
    expect(empty.body.data.fileIssues[0]).toMatchObject({ code: 'NO_ROWS' });
  });

  it('warns, without refusing, when an asset of that name and classification exists', async () => {
    await models.Asset.create({
      name: 'Proyektor',
      classificationId: LEAF,
      institutionId: alpha.id,
    });

    const report = (await preview(csv(`proyektor,${LEAF},1,,,,,,`))).body.data;

    expect(report.valid).toBe(true);
    expect(report.warnings).toEqual([expect.objectContaining({ row: 2, code: 'ASSET_EXISTS' })]);
    expect(report.assets[0].existing).toBe(true);
  });

  it('ignores, with a warning, a column it does not know', async () => {
    const report = (await preview(`Nama aset,Klasifikasi,Harga\nMeja,${LEAF},100000`)).body.data;

    expect(report.valid).toBe(true);
    expect(report.warnings).toEqual([expect.objectContaining({ code: 'UNKNOWN_COLUMN' })]);
  });
});

describe('import', () => {
  it('creates one asset per name and classification, with units, departments, funding and a first history entry', async () => {
    const response = await importFile(
      csv(
        `Kursi siswa,${LEAF},3,,TKJ,BOSIMP,Kelas X-1,Baik,Kayu jati`,
        `Kursi siswa,${LEAF},2,,,,,,`
      )
    );

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ imported: true, dryRun: false, valid: true });

    const assets = await models.Asset.findAll();
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      name: 'Kursi siswa',
      institutionId: alpha.id,
      createdBy: sarpras.user.id,
    });
    expect(response.body.data.assets[0].id).toBe(assets[0].id);

    const units = await models.AssetUnit.findAll({ order: [['inventoryCode', 'ASC']] });
    expect(units).toHaveLength(5);

    const placed = units.slice(0, 3);
    for (const unit of placed) {
      expect(unit).toMatchObject({
        departmentId: tkj.id,
        fundingSourceId: bos.id,
        currentLocationId: classroom.id,
        currentCondition: 'GOOD',
        lifecycleState: 'REGISTERED',
        description: 'Kayu jati',
      });
      const history = await models.LongitudinalHistory.findAll({ where: { assetUnitId: unit.id } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        entryType: 'MANUAL',
        condition: 'GOOD',
        locationId: classroom.id,
      });
    }

    // Unplaced units have no history, exactly like a unit added by hand.
    for (const unit of units.slice(3)) {
      expect(unit.currentLocationId).toBeNull();
      expect(await models.LongitudinalHistory.count({ where: { assetUnitId: unit.id } })).toBe(0);
    }

    // Audited like the manual path.
    expect(
      await models.AuditLog.count({
        where: { entityType: 'Asset', entityId: assets[0].id, action: 'CREATE' },
      })
    ).toBe(1);
  });

  it('reads an Excel workbook, and an Indonesian ";" CSV with a BOM and condition labels', async () => {
    const workbook = await xlsx([
      ['Laptop', Number(LEAF), 2, '', '', '', 'Lab Komputer', 'Kurang baik', ''],
    ]);
    const fromExcel = await importFile(workbook, sarpras, { filename: 'aset.xlsx' });
    expect(fromExcel.status).toBe(201);

    const semicolons = `${String.fromCharCode(0xfeff)}${HEADER.replaceAll(',', ';')}\nPapan tulis;${LEAF};1;;;;Kelas X-1;Rusak berat;`;
    const fromCsv = await importFile(semicolons);
    expect(fromCsv.status).toBe(201);

    const units = await models.AssetUnit.findAll({ include: ['asset'] });
    const conditionOf = (name) => units.find((unit) => unit.asset.name === name).currentCondition;
    expect(conditionOf('Laptop')).toBe('POOR');
    expect(units.find((unit) => unit.asset.name === 'Laptop').currentLocationId).toBe(lab.id);
    expect(conditionOf('Papan tulis')).toBe('UNSERVICEABLE');
  });

  it('accepts a most specific classification by its exact name', async () => {
    await models.AssetClassification.create({
      id: OWN_LEAF,
      parentId: BRANCH,
      name: 'ZZ Impor Uji Meja',
      institutionId: alpha.id,
    });

    const response = await importFile(csv('Meja,zz impor uji meja,1,,,,,,'));

    expect(response.status).toBe(201);
    expect(response.body.data.assets[0].classificationId).toBe(OWN_LEAF);
  });

  it('writes nothing when any row is invalid, and names each row', async () => {
    const response = await importFile(
      csv(`Kursi,${LEAF},2,,,,,,`, `Meja,${LEAF},1,,,,Gudang,Baik,`)
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ field: 'row 3 · Lokasi' }),
    ]);
    expect(await assetCount()).toBe(0);
    expect(await models.AssetUnit.count()).toBe(0);
  });
});

describe('inventory code formats', () => {
  const setFormat = (format) =>
    api()
      .put(`${V1}/institutions/${alpha.id}/inventory-code-format`)
      .set(...admin.auth)
      .send({ format });

  it('takes one number composition per unit when the format has no sequence', async () => {
    expect(
      (await setFormat('{NUMBER_COMPOSITION}/{INSTITUTION_CODE}/{REGISTRATION_YEAR}')).status
    ).toBe(200);
    const year = new Date().getFullYear();

    const single = (await preview(csv(`Meja,${LEAF},2,A1,,,,,`))).body.data;
    expect(single.issues[0]).toMatchObject({ row: 2, column: 'Komposisi nomor' });

    const missing = (await preview(csv(`Meja,${LEAF},1,,,,,,`))).body.data;
    expect(missing.issues[0]).toMatchObject({ column: 'Komposisi nomor' });

    const response = await importFile(csv(`Meja,${LEAF},2,A1;A2,,,,,`, `Meja,${LEAF},1,A3,,,,,`));
    expect(response.status).toBe(201);
    expect(response.body.data.assets[0].rows.flatMap((row) => row.inventoryCodes)).toEqual([
      `A1/ALPHA/${year}`,
      `A2/ALPHA/${year}`,
      `A3/ALPHA/${year}`,
    ]);

    // A composition already issued is refused on its row, and nothing is written.
    const repeated = await importFile(csv(`Kursi,${LEAF},1,B1,,,,,`, `Kursi,${LEAF},1,A2,,,,,`));
    expect(repeated.status).toBe(400);
    expect(repeated.body.error.details[0].field).toBe('row 3 · Komposisi nomor');
    expect(await models.AssetUnit.count()).toBe(3);
  });

  it('requires a coded funding source when the format includes it', async () => {
    expect(
      (await setFormat('{INSTITUTION_CODE}-{FUNDING_SOURCE_CODE}-{REGISTRATION_YEAR}-{SEQUENCE}'))
        .status
    ).toBe(200);
    await models.FundingSource.findOrCreate({ where: { name: 'Hibah Tanpa Kode Impor' } });

    const report = (
      await preview(csv(`Meja,${LEAF},1,,,,,,`, `Kursi,${LEAF},1,,,Hibah Tanpa Kode Impor,,,`))
    ).body.data;
    expect(report.issues.map((problem) => [problem.row, problem.code])).toEqual([
      [2, 'FUNDING_SOURCE_REQUIRED'],
      [3, 'FUNDING_SOURCE_NO_CODE'],
    ]);

    const response = await importFile(csv(`Meja,${LEAF},1,,,BOS Impor Uji,,,`));
    expect(response.status).toBe(201);
    expect(response.body.data.assets[0].rows[0].inventoryCodes[0]).toMatch(
      /^ALPHA-BOSIMP-\d{4}-00001$/
    );
  });
});

describe('authorization', () => {
  it('needs the permissions the manual path needs', async () => {
    const assetOnly = await createCaller({
      permissions: ['asset:create'],
      institutionId: alpha.id,
    });
    expect((await preview(csv(`Meja,${LEAF},1,,,,,,`), assetOnly)).status).toBe(403);
    expect(
      (
        await api()
          .get(`${V1}/assets/import/template`)
          .set(...assetOnly.auth)
      ).status
    ).toBe(403);
  });

  it('placing units needs asset-unit:record-history; registering alone does not', async () => {
    const registrar = await createCaller({ permissions: REGISTRAR, institutionId: alpha.id });

    const placed = (await preview(csv(`Meja,${LEAF},1,,,,Kelas X-1,Baik,`), registrar)).body.data;
    expect(placed.fileIssues[0]).toMatchObject({ code: 'NO_HISTORY_PERMISSION' });

    expect((await importFile(csv(`Meja,${LEAF},1,,,,,,`), registrar)).status).toBe(201);
  });

  it('registers into the caller’s own institution only', async () => {
    const response = await importFile(csv(`Meja,${LEAF},1,,,,,,`), sarpras, {
      institutionId: beta.id,
    });
    // The same refusal as creating an asset by hand for another institution.
    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('institutionId');
    expect(await assetCount()).toBe(0);
  });

  it('asks a system-wide caller to choose the institution', async () => {
    const report = (await preview(csv(`Meja,${LEAF},1,,,,,,`), admin)).body.data;
    expect(report.fileIssues[0]).toMatchObject({ code: 'NO_INSTITUTION' });

    const chosen = await importFile(csv(`Meja,${LEAF},1,,,,Lab Komputer,Baik,`), admin, {
      institutionId: alpha.id,
    });
    expect(chosen.status).toBe(201);
    expect((await models.Asset.findOne()).institutionId).toBe(alpha.id);
  });
});

describe('the manual path is unchanged', () => {
  it('still creates an asset and adds a unit by hand', async () => {
    const asset = await api()
      .post(`${V1}/assets`)
      .set(...sarpras.auth)
      .send({ name: 'Meja manual', classificationId: LEAF });
    expect(asset.status).toBe(201);

    const unit = await api()
      .post(`${V1}/assets/${asset.body.data.id}/units`)
      .set(...sarpras.auth)
      .send({});
    expect(unit.status).toBe(201);
  });
});
