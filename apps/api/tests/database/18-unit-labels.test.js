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
 * Asset unit inventory codes and labels — Phase 18 (`CR-001`), `06-api.md` §5.2.
 *
 * REQ-UNIT-003/007/008/009/010/011, `BR-020`, `BR-021`.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

let admin;
let institutionA;
let institutionB;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();

  admin = await createAdminCaller();
  institutionA = await models.Institution.create({
    name: 'Institution A',
    code: 'INST-A',
    address: 'A',
  });
  institutionB = await models.Institution.create({
    name: 'Institution B',
    code: 'INST-B',
    address: 'B',
  });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

const YEAR = new Date().getFullYear();

/** An asset, optionally owned by an institution. */
async function createAsset({ institutionId = institutionA.id, name = 'ASUS ROG' } = {}) {
  const response = await api()
    .post(`${V1}/assets`)
    .set(...admin.auth)
    .send({ name, classificationId: LEAF, institutionId });

  expect(response.status).toBe(201);
  return response.body.data;
}

async function createUnit(assetId, body = {}) {
  const response = await api()
    .post(`${V1}/assets/${assetId}/units`)
    .set(...admin.auth)
    .send(body);

  expect(response.status).toBe(201);
  return response.body.data;
}

describe('allocation (REQ-UNIT-007)', () => {
  it('assigns a code on registration, built from institution, year and sequence', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    expect(unit.inventoryCode).toBe(`INST-A-${YEAR}-00001`);
  });

  it('increments within an institution and year', async () => {
    const asset = await createAsset();

    const first = await createUnit(asset.id);
    const second = await createUnit(asset.id);

    expect(first.inventoryCode).toBe(`INST-A-${YEAR}-00001`);
    expect(second.inventoryCode).toBe(`INST-A-${YEAR}-00002`);
  });

  it('counts per institution, not globally', async () => {
    const assetA = await createAsset({ institutionId: institutionA.id });
    const assetB = await createAsset({ institutionId: institutionB.id });

    await createUnit(assetA.id);
    const unitB = await createUnit(assetB.id);

    // B's first unit is its own number one, whatever A has registered.
    expect(unitB.inventoryCode).toBe(`INST-B-${YEAR}-00001`);
  });

  it('continues across assets within one institution', async () => {
    const first = await createAsset({ name: 'First' });
    const second = await createAsset({ name: 'Second' });

    await createUnit(first.id);
    const unit = await createUnit(second.id);

    expect(unit.inventoryCode).toBe(`INST-A-${YEAR}-00002`);
  });

  it('allocates a contiguous run for a procurement batch', async () => {
    const supplier = await models.Supplier.create({ name: 'Supplier', address: 'x' });
    const contractType = await models.ContractType.create({ name: 'Type' });
    const contract = await models.Contract.create({
      contractNumber: 'C-1',
      contractDate: '2026-01-01',
      supplierId: supplier.id,
      contractTypeId: contractType.id,
      institutionId: institutionA.id,
    });
    const item = await models.ContractItem.create({
      contractId: contract.id,
      assetName: 'Laptop',
      quantity: 3,
      unitPrice: 1000,
    });

    const response = await api()
      .post(`${V1}/contract-items/${item.id}/assets`)
      .set(...admin.auth)
      .send({ classificationId: LEAF, unitCount: 3, institutionId: institutionA.id });

    expect(response.status).toBe(201);
    expect(response.body.data.units.map((unit) => unit.inventoryCode).sort()).toEqual([
      `INST-A-${YEAR}-00001`,
      `INST-A-${YEAR}-00002`,
      `INST-A-${YEAR}-00003`,
    ]);
  });

  it('never issues the same code twice under concurrent registration', async () => {
    const asset = await createAsset();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        api()
          .post(`${V1}/assets/${asset.id}/units`)
          .set(...admin.auth)
          .send({})
      )
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);

    const codes = responses.map((response) => response.body.data.inventoryCode);
    expect(new Set(codes).size).toBe(8);
  });

  it('refuses a code the caller tries to supply', async () => {
    const asset = await createAsset();

    const response = await api()
      .post(`${V1}/assets/${asset.id}/units`)
      .set(...admin.auth)
      .send({ inventoryCode: 'MINE-2026-00001' });

    // Every write body in this API is strict: an unrecognised field is a mistake
    // worth reporting, not something to discard silently and leave the caller
    // believing it took effect.
    expect(response.status).toBe(400);
  });

  it('leaves the code null when the asset has no institution', async () => {
    const asset = await createAsset({ institutionId: null });
    const unit = await createUnit(asset.id);

    // Nothing to build a code from, and a placeholder would be frozen onto a
    // printed label the moment one was produced.
    expect(unit.inventoryCode).toBeNull();
  });
});

describe('immutability (REQ-UNIT-008, BR-020)', () => {
  it('does not change when the unit is edited', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    const response = await api()
      .patch(`${V1}/asset-units/${unit.id}`)
      .set(...admin.auth)
      .send({ description: 'Edited' });

    expect(response.body.data.inventoryCode).toBe(unit.inventoryCode);
  });

  it('does not change when the asset moves to another institution', async () => {
    const asset = await createAsset({ institutionId: institutionA.id });
    const unit = await createUnit(asset.id);

    await api()
      .patch(`${V1}/assets/${asset.id}`)
      .set(...admin.auth)
      .send({ institutionId: institutionB.id });

    const reread = await api()
      .get(`${V1}/asset-units/${unit.id}`)
      .set(...admin.auth);

    // The label is already on the item and cannot be recalled.
    expect(reread.body.data.inventoryCode).toBe(`INST-A-${YEAR}-00001`);
  });

  it('does not change when the institution itself is renamed', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    await api()
      .patch(`${V1}/institutions/${institutionA.id}`)
      .set(...admin.auth)
      .send({ code: 'RENAMED' });

    const reread = await api()
      .get(`${V1}/asset-units/${unit.id}`)
      .set(...admin.auth);

    expect(reread.body.data.inventoryCode).toBe(`INST-A-${YEAR}-00001`);
  });

  it('gives units registered after a rename the new prefix', async () => {
    const asset = await createAsset();
    await createUnit(asset.id);

    await api()
      .patch(`${V1}/institutions/${institutionA.id}`)
      .set(...admin.auth)
      .send({ code: 'RENAMED' });

    const later = await createUnit(asset.id);
    expect(later.inventoryCode).toBe(`RENAMED-${YEAR}-00001`);
  });
});

describe('institution code safety (REQ-ORG-002)', () => {
  it.each([['SMK N/1'], ['SMK 1'], ['SMK#1']])(
    'refuses %s as an institution code',
    async (code) => {
      const response = await api()
        .post(`${V1}/institutions`)
        .set(...admin.auth)
        .send({ name: 'Bad', code, address: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('body.code');
    }
  );

  it('accepts a code that survives a URL path', async () => {
    const response = await api()
      .post(`${V1}/institutions`)
      .set(...admin.auth)
      .send({ name: 'Good', code: 'dinas.pendidikan-1', address: 'x' });

    expect(response.status).toBe(201);
  });
});

describe('the label payload (REQ-UNIT-009, BR-021)', () => {
  it('carries the identity a printed label needs', async () => {
    const department = await models.Department.create({
      code: 'TKJ',
      name: 'Teknik Komputer',
      institutionId: institutionA.id,
    });
    const asset = await createAsset();
    const unit = await createUnit(asset.id, { departmentId: department.id });

    const response = await api()
      .get(`${V1}/asset-units/${unit.id}/label`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      assetUnitId: unit.id,
      inventoryCode: `INST-A-${YEAR}-00001`,
      assetName: 'ASUS ROG',
      institution: { name: 'Institution A', code: 'INST-A' },
      classification: { id: LEAF, name: 'Aspal' },
      // Code and name both, since Phase 20 (`CR-003`) made `id` a surrogate
      // UUID — meaningless on a sticker, where the code is what people read.
      department: { id: department.id, code: 'TKJ', name: 'Teknik Komputer' },
    });
  });

  it('gives the classification as code AND name, so a rename cannot orphan it', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    const response = await api()
      .get(`${V1}/asset-units/${unit.id}/label`)
      .set(...admin.auth);

    expect(response.body.data.classification.id).toBe(LEAF);
    expect(response.body.data.classification.name).toBeTruthy();
  });

  it.each(['currentLocationId', 'currentLocation', 'currentCondition', 'lifecycleState'])(
    'omits %s — a label outlives it (BR-021)',
    async (field) => {
      const asset = await createAsset();
      const unit = await createUnit(asset.id);

      const response = await api()
        .get(`${V1}/asset-units/${unit.id}/label`)
        .set(...admin.auth);

      expect(response.body.data).not.toHaveProperty(field);
    }
  );

  it('refuses to label a unit with no inventory code, and says why', async () => {
    const asset = await createAsset({ institutionId: null });
    const unit = await createUnit(asset.id);

    const response = await api()
      .get(`${V1}/asset-units/${unit.id}/label`)
      .set(...admin.auth);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/institution/i);
  });
});

describe('batch labels (REQ-UNIT-010)', () => {
  it('returns one label per unit of the asset', async () => {
    const asset = await createAsset();
    await createUnit(asset.id);
    await createUnit(asset.id);
    await createUnit(asset.id);

    const response = await api()
      .get(`${V1}/assets/${asset.id}/units/labels`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.data.map((row) => row.inventoryCode)).toEqual([
      `INST-A-${YEAR}-00001`,
      `INST-A-${YEAR}-00002`,
      `INST-A-${YEAR}-00003`,
    ]);
  });

  it('answers in the complete-collection envelope, not a page', async () => {
    const asset = await createAsset();
    await createUnit(asset.id);

    const response = await api()
      .get(`${V1}/assets/${asset.id}/units/labels`)
      .set(...admin.auth);

    expect(response.body.meta).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
  });

  it('skips an unlabellable unit rather than failing the whole sheet', async () => {
    const asset = await createAsset({ institutionId: null });
    await createUnit(asset.id);

    const response = await api()
      .get(`${V1}/assets/${asset.id}/units/labels`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });
});

describe('labels for selected units (§73)', () => {
  const labels = (ids, caller = admin) =>
    api()
      .get(`${V1}/asset-units/labels`)
      .query({ ids: ids.join(',') })
      .set(...caller.auth);
  const single = (id) =>
    api()
      .get(`${V1}/asset-units/${id}/label`)
      .set(...admin.auth);

  it('returns, in the order selected, exactly the label each unit has on its own', async () => {
    const laptop = await createAsset();
    const printer = await createAsset({ name: 'Epson L3210' });
    const one = await createUnit(laptop.id);
    const two = await createUnit(laptop.id);
    const three = await createUnit(printer.id);

    const response = await labels([three.id, one.id, two.id]);

    expect(response.status).toBe(200);
    expect(response.body.data.map((row) => row.assetUnitId)).toEqual([three.id, one.id, two.id]);
    // The batch builds no payload of its own: each entry IS the single label.
    for (const unit of [one, two, three]) {
      const own = (await single(unit.id)).body.data;
      expect(response.body.data.find((row) => row.assetUnitId === unit.id)).toEqual(own);
    }
  });

  it('prints one selected unit', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    const response = await labels([unit.id]);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].inventoryCode).toBe(unit.inventoryCode);
  });

  it('refuses an empty selection, a malformed id, a repeat and more than 200', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    expect((await labels([])).status).toBe(400);
    expect((await labels(['not-a-uuid'])).status).toBe(400);
    expect((await labels([unit.id, unit.id])).status).toBe(400);
    const many = Array.from({ length: 201 }, () => crypto.randomUUID());
    expect((await labels(many)).status).toBe(400);
  });

  it('is 404 for the whole batch when any unit is another institution’s', async () => {
    const own = await createUnit((await createAsset()).id);
    const foreign = await createUnit((await createAsset({ institutionId: institutionB.id })).id);
    const scoped = await createCaller({
      permissions: ['asset-unit:read'],
      institutionId: institutionA.id,
    });

    expect((await labels([own.id], scoped)).status).toBe(200);
    const response = await labels([own.id, foreign.id], scoped);
    expect(response.status).toBe(404);
    expect(response.body.data).toBeUndefined();
  });

  it('needs asset-unit:read', async () => {
    const unit = await createUnit((await createAsset()).id);
    const nobody = await createCaller({ permissions: [], institutionId: institutionA.id });

    expect((await labels([unit.id], nobody)).status).toBe(403);
  });

  it('leaves out a unit with no inventory code, as the per-asset sheet does', async () => {
    const coded = await createUnit((await createAsset()).id);
    const uncoded = await createUnit((await createAsset({ institutionId: null })).id);

    const response = await labels([coded.id, uncoded.id]);

    expect(response.status).toBe(200);
    expect(response.body.data.map((row) => row.assetUnitId)).toEqual([coded.id]);
  });
});

describe('resolution (REQ-UNIT-011)', () => {
  it('resolves a scanned code to its unit', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    const response = await api()
      .get(`${V1}/asset-units/by-code/${unit.inventoryCode}`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(unit.id);
  });

  it('answers 404 for a code that was never issued', async () => {
    const response = await api()
      .get(`${V1}/asset-units/by-code/INST-A-1999-00001`)
      .set(...admin.auth);

    expect(response.status).toBe(404);
  });

  it('answers 404 for another institution’s code, not 403', async () => {
    const assetB = await createAsset({ institutionId: institutionB.id });
    const unitB = await createUnit(assetB.id);

    const callerA = await createCaller({
      permissions: ['asset-unit:read'],
      institutionId: institutionA.id,
    });

    const response = await api()
      .get(`${V1}/asset-units/by-code/${unitB.inventoryCode}`)
      .set(...callerA.auth);

    // Anyone can hold a phone up to a label. Distinguishing "not yours" from
    // "does not exist" would confirm the unit exists to someone who scanned it.
    expect(response.status).toBe(404);
  });

  it('rejects a malformed code without going to the database', async () => {
    const response = await api()
      .get(`${V1}/asset-units/by-code/${encodeURIComponent('not a code!')}`)
      .set(...admin.auth);

    expect(response.status).toBe(400);
  });

  it('requires authentication', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    const response = await api().get(`${V1}/asset-units/by-code/${unit.inventoryCode}`);

    expect(response.status).toBe(401);
  });

  it('requires asset-unit:read', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    const caller = await createCaller({ permissions: [], institutionId: institutionA.id });

    const response = await api()
      .get(`${V1}/asset-units/by-code/${unit.inventoryCode}`)
      .set(...caller.auth);

    expect(response.status).toBe(403);
  });

  /**
   * The query form — `CR-008`. Every label minted since carries this shape,
   * because a code may contain a slash and no encoding makes one safe inside a
   * path segment across the proxies that will sit in front of this.
   *
   * The path form above is kept, and tested, permanently: the labels printed
   * under it are on physical items.
   */
  describe('the query form (CR-008)', () => {
    it('resolves a scanned code carried as a query parameter', async () => {
      const asset = await createAsset();
      const unit = await createUnit(asset.id);

      const response = await api()
        .get(`${V1}/asset-units/by-code`)
        .query({ code: unit.inventoryCode })
        .set(...admin.auth);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(unit.id);
    });

    it('accepts a slash in the code, which the path form cannot carry', async () => {
      const asset = await createAsset();
      const unit = await createUnit(asset.id);

      // Written directly: the institution's format decides the shape, and this
      // asserts the ROUTE accepts a slashed code rather than re-testing
      // generation, which `25-inventory-code-format` already covers.
      const code = '027/1234/BID.1/2026';
      await models.AssetUnit.update({ inventoryCode: code }, { where: { id: unit.id } });

      const response = await api()
        .get(`${V1}/asset-units/by-code`)
        .query({ code })
        .set(...admin.auth);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(unit.id);
    });

    it('answers 404 for a code that was never issued', async () => {
      const response = await api()
        .get(`${V1}/asset-units/by-code`)
        .query({ code: '027/9999/BID.1/2026' })
        .set(...admin.auth);

      expect(response.status).toBe(404);
    });

    it('rejects a malformed code without going to the database', async () => {
      const response = await api()
        .get(`${V1}/asset-units/by-code`)
        .query({ code: 'not a code!' })
        .set(...admin.auth);

      expect(response.status).toBe(400);
    });

    it('rejects a request with no code at all', async () => {
      const response = await api()
        .get(`${V1}/asset-units/by-code`)
        .set(...admin.auth);

      expect(response.status).toBe(400);
    });

    it('requires asset-unit:read, like the path form', async () => {
      const asset = await createAsset();
      const unit = await createUnit(asset.id);

      const caller = await createCaller({ permissions: [], institutionId: institutionA.id });

      const response = await api()
        .get(`${V1}/asset-units/by-code`)
        .query({ code: unit.inventoryCode })
        .set(...caller.auth);

      expect(response.status).toBe(403);
    });
  });
});
