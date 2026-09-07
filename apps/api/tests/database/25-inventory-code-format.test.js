import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetAssetCoreData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Institution-configurable inventory code formats — Phase 25 (`CR-006`),
 * REQ-ORG-007, REQ-UNIT-007/008, `BR-020`, `BR-026`.
 *
 * The grammar and the registry are unit-tested in `tests/inventory-code-format.test.js`.
 * What can only be tested against a real database is here: the endpoints, the
 * authorization, real concurrent allocation, and — most importantly — that
 * codes already issued are untouched by anything an institution does afterwards.
 */

const V1 = '/api/v1';
const LEAF = '117010101001'; // Aspal — a real seeded leaf
const LEAF_2 = '117010101002'; // Semen

const DEFAULT_FORMAT = '{INSTITUTION_CODE}-{REGISTRATION_YEAR}-{SEQUENCE}';
const YEAR = new Date().getFullYear();

let admin;
let institution;

const post = (path, body, caller = admin) =>
  api()
    .post(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const get = (path, caller = admin) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

const put = (path, body, caller = admin) =>
  api()
    .put(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const setFormat = (format, caller = admin, target = institution) =>
  put(`/institutions/${target.id}/inventory-code-format`, { format }, caller);

async function createAsset(overrides = {}) {
  const response = await post('/assets', {
    name: 'Test Asset',
    classificationId: LEAF,
    institutionId: institution.id,
    ...overrides,
  });
  return response.body.data;
}

async function createUnit(assetId, overrides = {}, caller = admin) {
  return post(`/assets/${assetId}/units`, overrides, caller);
}

/** Registers one unit against a fresh asset and returns its code. */
async function registerUnit(overrides = {}) {
  const asset = await createAsset(overrides.asset ?? {});
  const response = await createUnit(asset.id, overrides.unit ?? {});
  return { response, unit: response.body.data, asset };
}

async function createDepartment(code, target = institution) {
  return models.Department.create({
    institutionId: target.id,
    code,
    name: `Department ${code}`,
  });
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();

  admin = await createAdminCaller();
  institution = await models.Institution.create({
    name: 'Format Institution',
    code: 'FMT',
    address: 'Somewhere',
  });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

describe('reading the format (§3.1, REQ-ORG-007)', () => {
  it('reports the default, and says it is the default', async () => {
    const response = await get(`/institutions/${institution.id}/inventory-code-format`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      format: DEFAULT_FORMAT,
      isDefault: true,
      preview: `FMT-${YEAR}-00001`,
      maxLength: 64,
      unresolved: [],
    });
  });

  it('publishes the whole token registry, with no resolver on it', async () => {
    const { body } = await get(`/institutions/${institution.id}/inventory-code-format`);

    // Nine since `CR-007` added the classification label, the funding source
    // code and the manually supplied composition.
    expect(body.data.tokens.map((token) => token.id)).toEqual([
      'INSTITUTION_CODE',
      'REGISTRATION_YEAR',
      'REGISTRATION_YEAR_SHORT',
      'CLASSIFICATION_CODE',
      'CLASSIFICATION_LEAF_LABEL',
      'DEPARTMENT_CODE',
      'FUNDING_SOURCE_CODE',
      'NUMBER_COMPOSITION',
      'SEQUENCE',
    ]);

    for (const token of body.data.tokens) {
      expect(token).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        source: expect.any(String),
        alwaysAvailable: expect.any(Boolean),
        maxLength: expect.any(Number),
      });
      expect(token.resolve).toBeUndefined();
    }
  });

  it("samples the institution's real code rather than an invented one", async () => {
    const { body } = await get(`/institutions/${institution.id}/inventory-code-format`);
    const token = body.data.tokens.find((entry) => entry.id === 'INSTITUTION_CODE');

    expect(token.sample).toBe('FMT');
    expect(token.resolvable).toBe(true);
  });

  it('marks the department unresolvable when the institution has none', async () => {
    const { body } = await get(`/institutions/${institution.id}/inventory-code-format`);
    const token = body.data.tokens.find((entry) => entry.id === 'DEPARTMENT_CODE');

    expect(token.resolvable).toBe(false);
  });

  it('samples a real department code once the institution has one', async () => {
    await createDepartment('TKJ');

    const { body } = await get(`/institutions/${institution.id}/inventory-code-format`);
    const token = body.data.tokens.find((entry) => entry.id === 'DEPARTMENT_CODE');

    expect(token).toMatchObject({ sample: 'TKJ', resolvable: true });
  });

  it('names an unresolvable token in the preview instead of inventing a value', async () => {
    await setFormat('{DEPARTMENT_CODE}-{SEQUENCE}');

    const { body } = await get(`/institutions/${institution.id}/inventory-code-format`);

    expect(body.data.preview).toBe('{DEPARTMENT_CODE}-00001');
    expect(body.data.unresolved).toEqual(['DEPARTMENT_CODE']);
  });

  it('consumes no sequence number to produce a preview', async () => {
    const asset = await createAsset();
    await createUnit(asset.id);

    // Several previews between two registrations. If any of them allocated, the
    // second unit would skip numbers.
    await get(`/institutions/${institution.id}/inventory-code-format`);
    await get(`/institutions/${institution.id}/inventory-code-format`);
    await get(`/institutions/${institution.id}/inventory-code-format`);

    const second = await createUnit(asset.id);

    expect(second.body.data.inventoryCode).toBe(`FMT-${YEAR}-00002`);
  });
});

describe('writing the format (§3.1, REQ-ORG-007)', () => {
  it('stores a format and reports it as no longer the default', async () => {
    const response = await setFormat('INV-{INSTITUTION_CODE}-{SEQUENCE}');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      format: 'INV-{INSTITUTION_CODE}-{SEQUENCE}',
      isDefault: false,
      preview: 'INV-FMT-00001',
    });
  });

  it('clears the format with null, returning the institution to the default', async () => {
    await setFormat('INV-{INSTITUTION_CODE}-{SEQUENCE}');

    const response = await setFormat(null);

    expect(response.body.data).toMatchObject({ format: DEFAULT_FORMAT, isDefault: true });
    await institution.reload();
    expect(institution.inventoryCodeFormat).toBeNull();
  });

  /**
   * `CR-008`. The slash was refused here until the scanned-label address moved
   * off a URL path segment; it is now a supported separator, end to end —
   * through the schema, the grammar and the check constraint.
   */
  it('stores a slashed format, which is the shape CR-008 exists for', async () => {
    const format = '{NUMBER_COMPOSITION}/{CLASSIFICATION_CODE}/{REGISTRATION_YEAR}';

    const response = await setFormat(format);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ format, isDefault: false });

    await institution.reload();
    expect(institution.inventoryCodeFormat).toBe(format);
  });

  it.each([
    ['{INSTITUTION_CODE} {SEQUENCE}', 'a space needs encoding'],
    ['{ASSET_NAME}-{SEQUENCE}', 'not a token the registry defines'],
    ['{INSTITUTION_CODE}-{REGISTRATION_YEAR}', 'no sequence'],
    ['{SEQUENCE}-{SEQUENCE}', 'two sequences'],
    ['{SEQUENCE}-{INSTITUTION_CODE}', 'the sequence is not last'],
    ['{SEQUENCE}', 'nothing but a sequence'],
    ['{INSTITUTION_CODE-{SEQUENCE}', 'unterminated token'],
  ])('rejects %s — %s', async (format) => {
    const response = await setFormat(format);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('format');
  });

  it('rejects a format whose worst case would not fit the column', async () => {
    const response = await setFormat(
      'X{INSTITUTION_CODE}-{CLASSIFICATION_CODE}-{DEPARTMENT_CODE}-' +
        '{REGISTRATION_YEAR}-{REGISTRATION_YEAR_SHORT}-{SEQUENCE}'
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/could produce a code of 65/);
  });

  it('rejects an unknown field in the body', async () => {
    const response = await put(`/institutions/${institution.id}/inventory-code-format`, {
      format: DEFAULT_FORMAT,
      sequenceWidth: 8,
    });

    expect(response.status).toBe(400);
  });

  it('never writes an invalid format to the column', async () => {
    await setFormat('{ASSET_NAME}-{SEQUENCE}');

    await institution.reload();
    expect(institution.inventoryCodeFormat).toBeNull();
  });
});

describe('generation under a configured format (REQ-UNIT-007)', () => {
  it('uses the default when nothing is configured — byte for byte', async () => {
    const { unit } = await registerUnit();

    expect(unit.inventoryCode).toBe(`FMT-${YEAR}-00001`);
  });

  it('uses a configured format for units registered afterwards', async () => {
    await setFormat('INV-{INSTITUTION_CODE}.{SEQUENCE}');

    const { unit } = await registerUnit();

    expect(unit.inventoryCode).toBe('INV-FMT.00001');
  });

  it('resolves the classification of the unit\'s own asset', async () => {
    await setFormat('{CLASSIFICATION_CODE}-{SEQUENCE}');

    const first = await registerUnit({ asset: { classificationId: LEAF } });
    const second = await registerUnit({ asset: { classificationId: LEAF_2 } });

    expect(first.unit.inventoryCode).toBe(`${LEAF}-00001`);
    // A different classification is a different pool, so it starts at one.
    expect(second.unit.inventoryCode).toBe(`${LEAF_2}-00001`);
  });

  it('resolves the department the unit is being registered into', async () => {
    const department = await createDepartment('TKJ');
    await setFormat('{DEPARTMENT_CODE}-{REGISTRATION_YEAR}-{SEQUENCE}');

    const { unit } = await registerUnit({ unit: { departmentId: department.id } });

    expect(unit.inventoryCode).toBe(`TKJ-${YEAR}-00001`);
  });

  it('numbers a batch registered through procurement contiguously', async () => {
    await setFormat('{INSTITUTION_CODE}-{SEQUENCE}');

    const supplier = await models.Supplier.create({ name: 'S', address: 'a', phone: '1' });
    const contract = await models.Contract.create({
      contractNumber: `C-${Math.random().toString(36).slice(2, 8)}`,
      contractDate: '2026-01-01',
      supplierId: supplier.id,
      institutionId: institution.id,
    });
    const item = await models.ContractItem.create({
      contractId: contract.id,
      assetName: 'Batch Asset',
      quantity: 3,
    });

    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 3,
      institutionId: institution.id,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.units.map((unit) => unit.inventoryCode)).toEqual([
      'FMT-00001',
      'FMT-00002',
      'FMT-00003',
    ]);
  });
});

describe('missing values reject the registration (REQ-UNIT-007)', () => {
  beforeEach(async () => {
    await setFormat('{INSTITUTION_CODE}-{DEPARTMENT_CODE}-{SEQUENCE}');
  });

  it('refuses a unit with no department, naming the field', async () => {
    const { response } = await registerUnit();

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('departmentId');
  });

  it('writes no unit at all when it refuses', async () => {
    const asset = await createAsset();
    await createUnit(asset.id);

    expect(await models.AssetUnit.count({ where: { assetId: asset.id } })).toBe(0);
  });

  it('accepts the same registration once a department is supplied', async () => {
    const department = await createDepartment('TKJ');

    const { response, unit } = await registerUnit({ unit: { departmentId: department.id } });

    expect(response.status).toBe(201);
    expect(unit.inventoryCode).toBe('FMT-TKJ-00001');
  });

  it('never produces a code with a collapsed separator', async () => {
    const department = await createDepartment('TKJ');
    await registerUnit({ unit: { departmentId: department.id } });

    const codes = (await models.AssetUnit.findAll()).map((unit) => unit.inventoryCode);

    expect(codes).not.toContain('FMT--00001');
    for (const code of codes) expect(code).not.toMatch(/--/);
  });

  it('refuses a department code that could not survive the scanned-label URL', async () => {
    // `departments.code` has no character constraint in the database, so this is
    // the only thing standing between a slash and a printed label.
    const department = await models.Department.create({
      institutionId: institution.id,
      code: 'TK/J',
      name: 'Slashed',
    });

    const { response } = await registerUnit({ unit: { departmentId: department.id } });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/unsafe in a web address/);
  });
});

describe('an asset with no institution is the other absence (REQ-UNIT-007)', () => {
  it('registers with no code rather than being refused', async () => {
    const systemWide = await createAdminCaller();
    const asset = (
      await post('/assets', { name: 'Orphan', classificationId: LEAF, institutionId: null },
        systemWide)
    ).body.data;

    const response = await createUnit(asset.id, {}, systemWide);

    expect(response.status).toBe(201);
    expect(response.body.data.inventoryCode).toBeNull();
  });
});

describe('existing codes are immutable (REQ-UNIT-008, `BR-020`)', () => {
  it('leaves an issued code alone when the format changes', async () => {
    const { unit } = await registerUnit();
    expect(unit.inventoryCode).toBe(`FMT-${YEAR}-00001`);

    await setFormat('NEW-{INSTITUTION_CODE}-{SEQUENCE}');

    const reread = await get(`/asset-units/${unit.id}`);
    expect(reread.body.data.inventoryCode).toBe(`FMT-${YEAR}-00001`);
  });

  it('applies the new format only to units registered afterwards', async () => {
    const first = await registerUnit();
    await setFormat('NEW-{INSTITUTION_CODE}-{SEQUENCE}');
    const second = await registerUnit();

    expect(first.unit.inventoryCode).toBe(`FMT-${YEAR}-00001`);
    expect(second.unit.inventoryCode).toBe('NEW-FMT-00001');
  });

  it('leaves an issued code alone when the institution code changes', async () => {
    const { unit } = await registerUnit();

    await api()
      .patch(`${V1}/institutions/${institution.id}`)
      .set(...admin.auth)
      .send({ code: 'RENAMED' });

    const reread = await get(`/asset-units/${unit.id}`);
    expect(reread.body.data.inventoryCode).toBe(`FMT-${YEAR}-00001`);

    // ...and the next registration uses the new code.
    const next = await registerUnit();
    expect(next.unit.inventoryCode).toBe(`RENAMED-${YEAR}-00001`);
  });

  it('leaves an issued code alone when the unit changes department', async () => {
    const first = await createDepartment('TKJ');
    const second = await createDepartment('RPL');
    await setFormat('{DEPARTMENT_CODE}-{SEQUENCE}');

    const { unit } = await registerUnit({ unit: { departmentId: first.id } });
    expect(unit.inventoryCode).toBe('TKJ-00001');

    await api()
      .patch(`${V1}/asset-units/${unit.id}`)
      .set(...admin.auth)
      .send({ departmentId: second.id });

    const reread = await get(`/asset-units/${unit.id}`);
    expect(reread.body.data).toMatchObject({
      inventoryCode: 'TKJ-00001',
      departmentId: second.id,
    });
  });

  it('leaves an issued code alone when the asset is reclassified', async () => {
    await setFormat('{CLASSIFICATION_CODE}-{SEQUENCE}');
    const { unit, asset } = await registerUnit();

    await api()
      .patch(`${V1}/assets/${asset.id}`)
      .set(...admin.auth)
      .send({ classificationId: LEAF_2 });

    const reread = await get(`/asset-units/${unit.id}`);
    expect(reread.body.data.inventoryCode).toBe(`${LEAF}-00001`);
  });

  it('is not accepted as an input on registration or update', async () => {
    const asset = await createAsset();

    const created = await createUnit(asset.id, { inventoryCode: 'CHOSEN-BY-ME' });
    expect(created.status).toBe(400);

    const { unit } = await registerUnit();
    const patched = await api()
      .patch(`${V1}/asset-units/${unit.id}`)
      .set(...admin.auth)
      .send({ inventoryCode: 'CHOSEN-BY-ME' });

    expect(patched.status).toBe(400);
  });
});

describe('uniqueness survives a format change (`BR-020`)', () => {
  it('continues past codes issued under an earlier format with the same shape', async () => {
    // Register under the default, switch away, then switch back to a format
    // that renders the same leading text. The scan reads the real rows, so the
    // next code continues past them rather than restarting onto them.
    const first = await registerUnit();
    expect(first.unit.inventoryCode).toBe(`FMT-${YEAR}-00001`);

    await setFormat('OTHER-{SEQUENCE}');
    const middle = await registerUnit();
    expect(middle.unit.inventoryCode).toBe('OTHER-00001');

    await setFormat(`{INSTITUTION_CODE}-${YEAR}-{SEQUENCE}`);
    const back = await registerUnit();

    expect(back.unit.inventoryCode).toBe(`FMT-${YEAR}-00002`);
  });

  it('keeps every code in the table distinct across several formats', async () => {
    await registerUnit();
    await setFormat('A-{SEQUENCE}');
    await registerUnit();
    await setFormat('B-{INSTITUTION_CODE}-{SEQUENCE}');
    await registerUnit();
    await setFormat(null);
    await registerUnit();

    const codes = (await models.AssetUnit.findAll()).map((unit) => unit.inventoryCode);

    expect(codes).toHaveLength(4);
    expect(new Set(codes).size).toBe(4);
  });

  it('refuses a duplicate at the database, whatever the application believed', async () => {
    const { unit } = await registerUnit();

    const asset = await createAsset();

    // Written through the model, bypassing allocation entirely — the point is
    // that the index refuses it even when nothing in the application checked.
    const rejection = await models.AssetUnit.create({
      assetId: asset.id,
      inventoryCode: unit.inventoryCode,
    }).catch((error) => error);

    expect(rejection.name).toBe('SequelizeUniqueConstraintError');
    expect(rejection.parent.constraint).toBe('uq_asset_units_inventory_code');
  });
});

describe('concurrent registration (REQ-UNIT-007)', () => {
  it('gives eight simultaneous registrations eight distinct codes', async () => {
    await setFormat('{INSTITUTION_CODE}-{SEQUENCE}');
    const asset = await createAsset();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => createUnit(asset.id))
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);

    const codes = responses.map((response) => response.body.data.inventoryCode);
    expect(new Set(codes).size).toBe(8);
    expect([...codes].sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `FMT-${String(index + 1).padStart(5, '0')}`)
    );
  });

  it('keeps two institutions in separate pools when the format names the institution', async () => {
    const other = await models.Institution.create({
      name: 'Other Institution',
      code: 'OTH',
      address: 'Elsewhere',
    });
    await setFormat('{INSTITUTION_CODE}-{SEQUENCE}');
    await setFormat('{INSTITUTION_CODE}-{SEQUENCE}', admin, other);

    const mine = await registerUnit();
    const theirs = await registerUnit({ asset: { institutionId: other.id } });

    expect(mine.unit.inventoryCode).toBe('FMT-00001');
    expect(theirs.unit.inventoryCode).toBe('OTH-00001');
  });
});

describe('authorization (REQ-ORG-007, `BR-007`)', () => {
  let scoped;

  beforeEach(async () => {
    scoped = await createCaller({
      permissions: ['inventory-code-format:read', 'inventory-code-format:update'],
      institutionId: institution.id,
    });
  });

  it('lets an institution-scoped administrator configure their own institution', async () => {
    const read = await get(`/institutions/${institution.id}/inventory-code-format`, scoped);
    expect(read.status).toBe(200);

    const written = await setFormat('MY-{INSTITUTION_CODE}-{SEQUENCE}', scoped);
    expect(written.status).toBe(200);
  });

  it('does so without institution:update, which they could never hold', async () => {
    // `institution:*` is system-wide-only (`BR-015`), which is the whole reason
    // the format is its own resource. They configure the format and still
    // cannot rename the institution.
    const renamed = await api()
      .patch(`${V1}/institutions/${institution.id}`)
      .set(...scoped.auth)
      .send({ name: 'Renamed' });

    expect(renamed.status).toBe(403);
  });

  it("answers 404 for another institution, not 403", async () => {
    const other = await models.Institution.create({
      name: 'Other Institution',
      code: 'OTH',
      address: 'Elsewhere',
    });

    const read = await get(`/institutions/${other.id}/inventory-code-format`, scoped);
    const written = await setFormat(DEFAULT_FORMAT, scoped, other);

    expect(read.status).toBe(404);
    expect(written.status).toBe(404);
    await other.reload();
    expect(other.inventoryCodeFormat).toBeNull();
  });

  it('refuses a caller holding only the read permission', async () => {
    const reader = await createCaller({
      permissions: ['inventory-code-format:read'],
      institutionId: institution.id,
    });

    expect((await get(`/institutions/${institution.id}/inventory-code-format`, reader)).status).toBe(
      200
    );
    expect((await setFormat(DEFAULT_FORMAT, reader)).status).toBe(403);
  });

  it('refuses a caller holding neither permission', async () => {
    const nobody = await createCaller({ permissions: [], institutionId: institution.id });

    expect((await get(`/institutions/${institution.id}/inventory-code-format`, nobody)).status).toBe(
      403
    );
    expect((await setFormat(DEFAULT_FORMAT, nobody)).status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await api().get(
      `${V1}/institutions/${institution.id}/inventory-code-format`
    );

    expect(response.status).toBe(401);
  });

  it('gives a PIC-scoped role nothing, even when the codes are granted', async () => {
    // The ceiling (`CR-004`, REQ-AUTHZ-008): outside `PIC_ALLOWED_PERMISSIONS`,
    // so the grant is inert rather than refused at assignment time.
    const pic = await createCaller({
      permissions: ['inventory-code-format:read', 'inventory-code-format:update'],
      isPicScoped: true,
      institutionId: institution.id,
    });

    expect((await get(`/institutions/${institution.id}/inventory-code-format`, pic)).status).toBe(
      403
    );
    expect((await setFormat(DEFAULT_FORMAT, pic)).status).toBe(403);
  });

  it('lets a system-wide caller configure any institution', async () => {
    const other = await models.Institution.create({
      name: 'Other Institution',
      code: 'OTH',
      address: 'Elsewhere',
    });

    const response = await setFormat('SYS-{INSTITUTION_CODE}-{SEQUENCE}', admin, other);

    expect(response.status).toBe(200);
    expect(response.body.data.preview).toBe('SYS-OTH-00001');
  });
});
