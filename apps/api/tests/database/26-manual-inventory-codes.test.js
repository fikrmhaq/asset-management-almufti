import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createAdminCaller,
  resetAssetCoreData,
  resetOrganizationData,
  resetProcurementData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Manual and derived inventory code tokens — Phase 26 (`CR-007`),
 * REQ-UNIT-007, REQ-ORG-007, `BR-020`, `BR-027`.
 *
 * The grammar, the normalization and the budgets are unit-tested. What only a
 * real database can show is here: both generation paths end to end, the
 * registration hint, batch behaviour, and that a duplicate is caught by the
 * index and reported against the field the caller wrote.
 */

const V1 = '/api/v1';
const LEAF = '117010101001'; // Aspal
const YEAR = new Date().getFullYear();

/** The client's target format, and the reason this change request exists. */
const CLIENT_FORMAT =
  '{NUMBER_COMPOSITION}-{CLASSIFICATION_LEAF_LABEL}-{FUNDING_SOURCE_CODE}-{REGISTRATION_YEAR}';

let admin;
let institution;

const post = (path, body) =>
  api()
    .post(`${V1}${path}`)
    .set(...admin.auth)
    .send(body);

const get = (path) =>
  api()
    .get(`${V1}${path}`)
    .set(...admin.auth);

const setFormat = (format) =>
  api()
    .put(`${V1}/institutions/${institution.id}/inventory-code-format`)
    .set(...admin.auth)
    .send({ format });

/** An asset with a contract, so `FUNDING_SOURCE_CODE` can resolve. */
async function createProcuredAsset({ fundingCode = 'BOS' } = {}) {
  const suffix = Math.random().toString(36).slice(2, 7);

  const supplier = await models.Supplier.create({ name: `S-${suffix}`, address: 'a', phone: '1' });
  const fundingSource = await models.FundingSource.create({
    name: `Dana ${suffix}`,
    code: fundingCode,
  });
  const contract = await models.Contract.create({
    contractNumber: `C-${suffix}`,
    contractDate: '2026-01-01',
    supplierId: supplier.id,
    institutionId: institution.id,
    fundingSourceId: fundingSource.id,
  });

  const asset = (
    await post('/assets', {
      name: 'Procured Asset',
      classificationId: LEAF,
      institutionId: institution.id,
      contractId: contract.id,
    })
  ).body.data;

  return { asset, contract, fundingSource };
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();

  admin = await createAdminCaller();
  institution = await models.Institution.create({
    name: 'Manual Codes Institution',
    code: 'MCI',
    address: 'Somewhere',
  });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
});

describe("the client's target format, end to end", () => {
  it('renders every new token into one stored code', async () => {
    await setFormat(CLIENT_FORMAT);
    const { asset } = await createProcuredAsset();

    const response = await post(`/assets/${asset.id}/units`, { numberComposition: '001-02-03' });

    expect(response.status).toBe(201);
    // `Aspal` is the seeded leaf name; the funding source code is the business
    // abbreviation, never the display name.
    expect(response.body.data.inventoryCode).toBe(`001-02-03-ASPAL-BOS-${YEAR}`);
    expect(response.body.data.numberComposition).toBe('001-02-03');
  });

  it('allocates nothing — a second unit does not gain a sequence', async () => {
    await setFormat(CLIENT_FORMAT);
    const { asset } = await createProcuredAsset();

    await post(`/assets/${asset.id}/units`, { numberComposition: '001-02-03' });
    const second = await post(`/assets/${asset.id}/units`, { numberComposition: '001-02-04' });

    expect(second.body.data.inventoryCode).toBe(`001-02-04-ASPAL-BOS-${YEAR}`);
  });

  it('refuses a duplicate against numberComposition, not the generated column', async () => {
    await setFormat(CLIENT_FORMAT);
    const { asset } = await createProcuredAsset();

    await post(`/assets/${asset.id}/units`, { numberComposition: '001-02-03' });
    const duplicate = await post(`/assets/${asset.id}/units`, { numberComposition: '001-02-03' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.details[0].field).toBe('numberComposition');
    expect(await models.AssetUnit.count()).toBe(1);
  });

  /**
   * `DEC-131` superseded (REQ-UNIT-012, migration 056): an asset with no
   * contract is refused only while the unit records no funding source either —
   * and the refusal names the field the registrar can fill, not `contractId`.
   */
  it('refuses a contractless asset with no funding source, naming fundingSourceId', async () => {
    await setFormat(CLIENT_FORMAT);
    const asset = (
      await post('/assets', {
        name: 'Donated',
        classificationId: LEAF,
        institutionId: institution.id,
      })
    ).body.data;

    const response = await post(`/assets/${asset.id}/units`, { numberComposition: '001' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('A funding source is required for this inventory code');
    expect(response.body.error.details[0].field).toBe('fundingSourceId');
    expect(await models.AssetUnit.count()).toBe(0);
  });
});

describe('the manually supplied component (REQ-UNIT-007)', () => {
  it('is required when the format uses it', async () => {
    await setFormat('{NUMBER_COMPOSITION}-{INSTITUTION_CODE}');
    const { asset } = await createProcuredAsset();

    const response = await post(`/assets/${asset.id}/units`, {});

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('numberComposition');
  });

  it('is refused when the format does not use it', async () => {
    // The default format. Storing a value nothing renders would leave it on the
    // row meaning nothing.
    const { asset } = await createProcuredAsset();

    const response = await post(`/assets/${asset.id}/units`, { numberComposition: '001' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('numberComposition');
  });

  it('is validated, never rewritten (`BR-027`)', async () => {
    await setFormat('{NUMBER_COMPOSITION}-{INSTITUTION_CODE}');
    const { asset } = await createProcuredAsset();

    const response = await post(`/assets/${asset.id}/units`, { numberComposition: '001/02' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/unsafe in a web address/);
    expect(await models.AssetUnit.count()).toBe(0);
  });

  it('cannot be changed after registration (REQ-UNIT-008, `DEC-132`)', async () => {
    await setFormat('{NUMBER_COMPOSITION}-{INSTITUTION_CODE}');
    const { asset } = await createProcuredAsset();
    const unit = (await post(`/assets/${asset.id}/units`, { numberComposition: '001' })).body.data;

    const patched = await api()
      .patch(`${V1}/asset-units/${unit.id}`)
      .set(...admin.auth)
      .send({ numberComposition: '002' });

    expect(patched.status).toBe(400);
  });
});

describe('the registration hint (`DEC-133`)', () => {
  it('says nothing is needed under a format without the token', async () => {
    const { asset } = await createProcuredAsset();

    const { body } = await get(`/assets/${asset.id}`);

    expect(body.data.unitRegistration).toEqual({
      numberComposition: { required: false },
      // REQ-UNIT-012: whether the code carries the funding source, flag only.
      fundingSource: { inCode: false },
    });
  });

  it('asks for one value per unit when no sequence separates them', async () => {
    await setFormat(CLIENT_FORMAT);
    const { asset } = await createProcuredAsset();

    const { body } = await get(`/assets/${asset.id}`);

    expect(body.data.unitRegistration.numberComposition).toEqual({
      required: true,
      perUnit: true,
      maxLength: 16,
    });
  });

  it('asks for one value for the batch when a sequence separates them', async () => {
    await setFormat('{NUMBER_COMPOSITION}-{INSTITUTION_CODE}-{SEQUENCE}');
    const { asset } = await createProcuredAsset();

    const { body } = await get(`/assets/${asset.id}`);

    expect(body.data.unitRegistration.numberComposition.perUnit).toBe(false);
  });

  it('discloses no format string, and needs no format permission', async () => {
    await setFormat(CLIENT_FORMAT);
    const { asset } = await createProcuredAsset();

    const { body } = await get(`/assets/${asset.id}`);

    expect(JSON.stringify(body.data)).not.toContain('CLASSIFICATION_LEAF_LABEL');
    expect(body.data.unitRegistration.numberComposition.format).toBeUndefined();
  });
});

describe('batch registration through procurement (`DEC-130`)', () => {
  async function contractItem(contract) {
    return models.ContractItem.create({
      contractId: contract.id,
      assetName: 'Batch Asset',
      quantity: 3,
    });
  }

  it('takes one composition for the batch when a sequence distinguishes the units', async () => {
    await setFormat('{NUMBER_COMPOSITION}-{INSTITUTION_CODE}-{SEQUENCE}');
    const { contract } = await createProcuredAsset();
    const item = await contractItem(contract);

    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 3,
      institutionId: institution.id,
      numberComposition: '001-02-03',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.units.map((u) => u.inventoryCode)).toEqual([
      '001-02-03-MCI-00001',
      '001-02-03-MCI-00002',
      '001-02-03-MCI-00003',
    ]);
  });

  it('takes one value per unit when nothing else distinguishes them', async () => {
    await setFormat(CLIENT_FORMAT);
    const { contract } = await createProcuredAsset();
    const item = await contractItem(contract);

    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 3,
      institutionId: institution.id,
      numberCompositions: ['001-02-03', '001-02-04', '001-02-05'],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.units.map((u) => u.inventoryCode)).toEqual([
      `001-02-03-ASPAL-BOS-${YEAR}`,
      `001-02-04-ASPAL-BOS-${YEAR}`,
      `001-02-05-ASPAL-BOS-${YEAR}`,
    ]);
  });

  it('refuses a list whose length does not match unitCount', async () => {
    await setFormat(CLIENT_FORMAT);
    const { contract } = await createProcuredAsset();
    const item = await contractItem(contract);

    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 3,
      institutionId: institution.id,
      numberCompositions: ['001-02-03', '001-02-04'],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('numberCompositions');
  });

  it('refuses duplicates within the request before writing anything', async () => {
    await setFormat(CLIENT_FORMAT);
    const { contract } = await createProcuredAsset();
    const item = await contractItem(contract);

    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 2,
      institutionId: institution.id,
      numberCompositions: ['001-02-03', '001-02-03'],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/appears more than once/);
    // Nothing partially written — not the asset, not one of the two units.
    expect(await models.AssetUnit.count()).toBe(0);
  });

  it('refuses a single value where each unit needs its own', async () => {
    await setFormat(CLIENT_FORMAT);
    const { contract } = await createProcuredAsset();
    const item = await contractItem(contract);

    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 3,
      institutionId: institution.id,
      numberComposition: '001-02-03',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('numberCompositions');
  });
});

describe('the classification label token (`BR-027`)', () => {
  it('normalizes a multi-word label', async () => {
    await setFormat('{CLASSIFICATION_LEAF_LABEL}-{SEQUENCE}');
    const { asset } = await createProcuredAsset();

    const response = await post(`/assets/${asset.id}/units`, {});

    // The seeded name is `Aspal`; a multi-word one joins with underscores.
    expect(response.body.data.inventoryCode).toBe('ASPAL-00001');
  });

  it('uses the label at registration time, and a later rename does not reach it', async () => {
    await setFormat('{CLASSIFICATION_LEAF_LABEL}-{SEQUENCE}');
    const { asset } = await createProcuredAsset();
    const unit = (await post(`/assets/${asset.id}/units`, {})).body.data;

    // Government nodes cannot be renamed, so this reaches past the API on
    // purpose — the point is that the STORED code is never re-derived.
    await models.AssetClassification.update({ name: 'Renamed Entirely' }, { where: { id: LEAF } });

    const reread = await get(`/asset-units/${unit.id}`);
    expect(reread.body.data.inventoryCode).toBe('ASPAL-00001');

    await models.AssetClassification.update({ name: 'Aspal' }, { where: { id: LEAF } });
  });
});

describe('the format endpoint reports what a format costs (REQ-ORG-007)', () => {
  it('publishes the elastic budget and the catalog coverage', async () => {
    await setFormat(CLIENT_FORMAT);

    const { body } = await get(`/institutions/${institution.id}/inventory-code-format`);
    const label = body.data.tokens.find((t) => t.id === 'CLASSIFICATION_LEAF_LABEL');

    expect(label.elastic).toBe(true);
    expect(label.maxLength).toBe(33);
    expect(label.coverage.representable + label.coverage.exceeding + label.coverage.unrepresentable)
      .toBe(label.coverage.total);
    expect(label.coverage.representable).toBeGreaterThan(0);
  });

  it('omits coverage for a format that does not use the label', async () => {
    const { body } = await get(`/institutions/${institution.id}/inventory-code-format`);
    const label = body.data.tokens.find((t) => t.id === 'CLASSIFICATION_LEAF_LABEL');

    expect(label.coverage).toBeUndefined();
  });
});
