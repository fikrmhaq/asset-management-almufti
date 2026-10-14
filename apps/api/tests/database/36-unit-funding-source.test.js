import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetAssetCoreData,
  resetOrganizationData,
  resetProcurementData,
} from './helpers/apiClient.js';
import { cycleDatabaseUrl, migrate, query, runCli, seed } from './helpers/db.js';

/**
 * Unit acquisition facts: the funding source — `CR-014` (`DEC-S`), REQ-UNIT-012,
 * migration 056; supersedes `CR-007` `DEC-131`.
 *
 * Contract is optional (F8). A unit may record the funding source it was
 * acquired with, and that value — not only the asset's Contract's — is what
 * `{FUNDING_SOURCE_CODE}` renders. So a format carrying the funding source can
 * register a contractless asset, provided the funding source is given, and
 * refuses clearly (on `fundingSourceId`) when it is not.
 *
 *   SCHEMA     056: two nullable columns, FK, partial index; nothing back-filled.
 *   REQUEST    `POST /request-items/:id/register` — the five approved cases.
 *   DIRECT     `POST /assets/:id/units` — the same rule on the existing path.
 *   CONTRACT   a supplied value must match the Contract's; the contract-item
 *              path is unchanged.
 *   GUARDS     unknown id; a funding source with no code; a format without the
 *              token still records the fact; a referenced source is not deleted.
 *   ROLLBACK   056 refuses while a unit records a fact, then cycles when empty.
 */

const V1 = '/api/v1';
const LEAF = '117010101001'; // Aspal
const YEAR = new Date().getFullYear();

/** ALM-1's format, with hyphens so the code stays one path segment in tests. */
const FUNDED_FORMAT =
  '{NUMBER_COMPOSITION}-{CLASSIFICATION_LEAF_LABEL}-{FUNDING_SOURCE_CODE}-{REGISTRATION_YEAR}';

const REQUESTER = [
  'request:read',
  'request:create',
  'request:submit',
  'request-item:create',
  'request-item-unit:read',
];
const APPROVER = ['request:read', 'request-step:decide'];
const REGISTRAR = [
  'request:read',
  'request-item:register',
  'request-item-unit:read',
  'request-item-unit:create',
  'asset:create',
  'asset:read',
  'asset-unit:create',
  'asset-unit:read',
];

let admin;
let alpha;

const call = (method, url, body, caller) => {
  const request = api()
    [method](`${V1}${url}`)
    .set(...caller.auth);
  return body === undefined ? request : request.send(body);
};
const post = (url, body, caller = admin) => call('post', url, body ?? {}, caller);
const get = (url, caller = admin) => call('get', url, undefined, caller);

const setFormat = (format, institution = alpha) =>
  call('put', `/institutions/${institution.id}/inventory-code-format`, { format }, admin);

async function fundingSource(code, name = `Dana ${code ?? 'tanpa kode'}`) {
  return models.FundingSource.create({ name, code });
}

async function contract(source) {
  const suffix = Math.random().toString(36).slice(2, 7);
  return models.Contract.create({
    contractNumber: `C-${suffix}`,
    contractDate: '2026-01-01',
    institutionId: alpha.id,
    fundingSourceId: source?.id ?? null,
  });
}

async function contractItem(forContract) {
  return models.ContractItem.create({ contractId: forContract.id, assetName: 'Kursi' });
}

async function asset({ contractId = null } = {}) {
  const response = await post('/assets', {
    name: 'Meja',
    classificationId: LEAF,
    institutionId: alpha.id,
    ...(contractId ? { contractId } : {}),
  });
  expect(response.status).toBe(201);
  return response.body.data;
}

async function person(permissions, positions = []) {
  const caller = await createCaller({ permissions, institutionId: alpha.id });
  for (const [positionCode] of positions) {
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: caller.user.id,
      positionCode,
    });
  }
  const assignment = await models.PositionAssignment.findOne({
    where: { userId: caller.user.id },
  });
  return { ...caller, assignment };
}

/** An APPROVED request with one item of `quantity`; its REGISTER step is ACTIVE. */
async function approved(quantity = 4) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: alpha.id,
    category: 'COMMON',
    requesterPositionCode: 'COMMON_TEACHER',
    version: 1,
    status: 'ACTIVE',
    publishedAt: new Date(),
  });
  for (const [index, [stepType, actor]] of [
    ['DECIDE', 'KEPALA_SEKOLAH'],
    ['REGISTER', 'WAKASEK_SARPRAS'],
  ].entries()) {
    await models.WorkflowDefinitionStep.create({
      definitionId: definition.id,
      sequence: index + 1,
      stepType,
      actorPositionCode: actor,
      procurementMode: null,
      skipIfRequesterIsActor: false,
    });
  }
  const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
  const kepala = await person(APPROVER, [['KEPALA_SEKOLAH']]);
  const registrar = await person(REGISTRAR, [['WAKASEK_SARPRAS']]);

  const created = await post(
    '/requests',
    { requesterAssignmentId: teacher.assignment.id, category: 'COMMON', title: 'Laptop' },
    teacher
  );
  expect(created.status).toBe(201);
  const item = await post(
    `/requests/${created.body.data.id}/items`,
    { description: 'Laptop', quantityRequested: quantity },
    teacher
  );
  expect(item.status).toBe(201);
  const submitted = await post(`/requests/${created.body.data.id}/submit`, {}, teacher);
  expect(submitted.status).toBe(200);
  const decided = await post(
    `/request-steps/${submitted.body.data.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    kepala
  );
  expect(decided.body.data.status).toBe('APPROVED');
  return { registrar, request: decided.body.data, itemId: item.body.data.id };
}

const register = (itemId, body, caller) => post(`/request-items/${itemId}/register`, body, caller);

const unitsOf = (where = {}) =>
  models.AssetUnit.findAll({ where, order: [['inventoryCode', 'ASC']], raw: true });

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
});

// ---------------------------------------------------------------------------

describe('the schema (migration 056)', () => {
  it('adds the two nullable acquisition facts to asset_units', async () => {
    const columns = await query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'asset_units'
          AND column_name IN ('funding_source_id', 'acquisition_date')
        ORDER BY column_name`
    );
    expect(columns).toEqual([
      { column_name: 'acquisition_date', data_type: 'date', is_nullable: 'YES', column_default: null },
      { column_name: 'funding_source_id', data_type: 'integer', is_nullable: 'YES', column_default: null },
    ]);
  });

  it('refuses a funding source that does not exist, at the database', async () => {
    const created = await asset();
    const unit = await post(`/assets/${created.id}/units`, {});
    await expect(
      query('UPDATE public.asset_units SET funding_source_id = 999999 WHERE id = $1', [
        unit.body.data.id,
      ])
    ).rejects.toThrow(/fk_asset_units_funding_source/);
  });
});

describe('Register units against a request — the approved cases', () => {
  beforeEach(async () => {
    expect((await setFormat(FUNDED_FORMAT)).status).toBe(200);
  });

  it('1. a new asset under a contract registers with the contract’s funding source', async () => {
    const bos = await fundingSource('BOS');
    const item = await contractItem(await contract(bos));
    const { registrar, itemId } = await approved();

    const response = await register(
      itemId,
      {
        name: 'Laptop',
        classificationId: LEAF,
        unitCount: 1,
        contractItemId: item.id,
        numberCompositions: ['A1'],
      },
      registrar
    );

    expect(response.status).toBe(201);
    const [unit] = await unitsOf();
    expect(unit.inventory_code ?? unit.inventoryCode).toBe(`A1-ASPAL-BOS-${YEAR}`);
    // The Contract's value is read through the Contract, never copied.
    expect(unit.fundingSourceId).toBeNull();
  });

  it('2. a new asset with no contract registers when a funding source is given', async () => {
    const komite = await fundingSource('KMT');
    const { registrar, itemId } = await approved();

    const response = await register(
      itemId,
      {
        name: 'Laptop',
        classificationId: LEAF,
        unitCount: 2,
        numberCompositions: ['B1', 'B2'],
        fundingSourceId: komite.id,
      },
      registrar
    );

    expect(response.status).toBe(201);
    const units = await unitsOf();
    expect(units.map((unit) => unit.inventoryCode)).toEqual([
      `B1-ASPAL-KMT-${YEAR}`,
      `B2-ASPAL-KMT-${YEAR}`,
    ]);
    expect(units.every((unit) => unit.fundingSourceId === komite.id)).toBe(true);
    const created = await models.Asset.findByPk(units[0].assetId);
    expect(created.contractId).toBeNull();
  });

  it('3. an existing asset with a contract registers with the contract’s funding source', async () => {
    const bos = await fundingSource('BOS');
    const procured = await asset({ contractId: (await contract(bos)).id });
    const { registrar, itemId } = await approved();

    const response = await register(
      itemId,
      { assetId: procured.id, unitCount: 1, numberCompositions: ['C1'] },
      registrar
    );

    expect(response.status).toBe(201);
    const [unit] = await unitsOf();
    expect(unit.inventoryCode).toBe(`C1-ASPAL-BOS-${YEAR}`);
    expect(unit.fundingSourceId).toBeNull();
  });

  it('4. an existing asset with no contract registers when a funding source is given', async () => {
    const hibah = await fundingSource('HIBAH');
    const donated = await asset();
    const { registrar, itemId } = await approved();

    const response = await register(
      itemId,
      { assetId: donated.id, unitCount: 1, numberCompositions: ['D1'], fundingSourceId: hibah.id },
      registrar
    );

    expect(response.status).toBe(201);
    const [unit] = await unitsOf();
    expect(unit.inventoryCode).toBe(`D1-ASPAL-HIBAH-${YEAR}`);
    expect(unit.fundingSourceId).toBe(hibah.id);
  });

  it('5. no funding source anywhere is a clear validation error, and nothing is written', async () => {
    const { registrar, request, itemId } = await approved();

    const response = await register(
      itemId,
      { name: 'Laptop', classificationId: LEAF, unitCount: 1, numberCompositions: ['E1'] },
      registrar
    );

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('A funding source is required for this inventory code');
    expect(response.body.error.message).not.toMatch(/cannot be generated/);
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ field: 'fundingSourceId' }),
    ]);
    // No asset, no unit, no link, and REGISTER still open.
    expect(await models.Asset.count()).toBe(0);
    expect(await models.AssetUnit.count()).toBe(0);
    expect(await models.RequestItemUnit.count()).toBe(0);
    const step = await models.RequestStep.findOne({
      where: { requestId: request.id, stepType: 'REGISTER' },
    });
    expect(step.state).toBe('ACTIVE');
  });

  it('refuses a funding source that differs from the contract item’s contract', async () => {
    const bos = await fundingSource('BOS');
    const komite = await fundingSource('KMT');
    const item = await contractItem(await contract(bos));
    const { registrar, itemId } = await approved();

    const response = await register(
      itemId,
      {
        name: 'Laptop',
        classificationId: LEAF,
        unitCount: 1,
        contractItemId: item.id,
        numberCompositions: ['F1'],
        fundingSourceId: komite.id,
      },
      registrar
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('fundingSourceId');
    expect(await models.AssetUnit.count()).toBe(0);
  });
});

describe('Add unit on an asset — the same rule on the direct path', () => {
  beforeEach(async () => {
    expect((await setFormat(FUNDED_FORMAT)).status).toBe(200);
  });

  it('registers a contractless unit with a funding source, and reports it', async () => {
    const hibah = await fundingSource('HIBAH', 'Hibah DUDI');
    const donated = await asset();

    const response = await post(`/assets/${donated.id}/units`, {
      numberComposition: 'G1',
      fundingSourceId: hibah.id,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.inventoryCode).toBe(`G1-ASPAL-HIBAH-${YEAR}`);
    expect(response.body.data.fundingSource).toEqual({
      id: hibah.id,
      code: 'HIBAH',
      name: 'Hibah DUDI',
    });
    const read = await get(`/asset-units/${response.body.data.id}`);
    expect(read.body.data.fundingSourceId).toBe(hibah.id);
  });

  it('accepts the contract’s own funding source, and refuses another', async () => {
    const bos = await fundingSource('BOS');
    const komite = await fundingSource('KMT');
    const procured = await asset({ contractId: (await contract(bos)).id });

    const same = await post(`/assets/${procured.id}/units`, {
      numberComposition: 'H1',
      fundingSourceId: bos.id,
    });
    expect(same.status).toBe(201);
    expect(same.body.data.inventoryCode).toBe(`H1-ASPAL-BOS-${YEAR}`);

    const other = await post(`/assets/${procured.id}/units`, {
      numberComposition: 'H2',
      fundingSourceId: komite.id,
    });
    expect(other.status).toBe(400);
    expect(other.body.error.details[0].field).toBe('fundingSourceId');
    expect(other.body.error.details[0].issue).toMatch(/Dana BOS/);
  });

  it('refuses an unknown funding source', async () => {
    const donated = await asset();

    const response = await post(`/assets/${donated.id}/units`, {
      numberComposition: 'I1',
      fundingSourceId: 999999,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0]).toEqual(
      expect.objectContaining({ field: 'fundingSourceId' })
    );
  });

  it('refuses a funding source with no code, saying so, when the code needs one', async () => {
    const uncoded = await fundingSource(null, 'Swadaya');
    const donated = await asset();

    const response = await post(`/assets/${donated.id}/units`, {
      numberComposition: 'J1',
      fundingSourceId: uncoded.id,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('The funding source has no code for the inventory code');
    expect(response.body.error.details[0].issue).toMatch(/Swadaya/);
    expect(await models.AssetUnit.count()).toBe(0);
  });
});

describe('what stays as it was', () => {
  it('records the fact under a format without the token, leaving the code alone', async () => {
    // The default format: no funding source segment.
    const hibah = await fundingSource('HIBAH');
    const donated = await asset();

    const response = await post(`/assets/${donated.id}/units`, { fundingSourceId: hibah.id });

    expect(response.status).toBe(201);
    expect(response.body.data.inventoryCode).not.toContain('HIBAH');
    expect(response.body.data.fundingSourceId).toBe(hibah.id);
  });

  it('keeps the contract-item path working from the contract alone', async () => {
    await setFormat(FUNDED_FORMAT);
    const bos = await fundingSource('BOS');
    const item = await contractItem(await contract(bos));

    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      institutionId: alpha.id,
      unitCount: 1,
      numberCompositions: ['K1'],
    });

    expect(response.status).toBe(201);
    const [unit] = await unitsOf();
    expect(unit.inventoryCode).toBe(`K1-ASPAL-BOS-${YEAR}`);
    expect(unit.fundingSourceId).toBeNull();
  });

  it('does not delete a funding source a unit records', async () => {
    const hibah = await fundingSource('HIBAH');
    const donated = await asset();
    await post(`/assets/${donated.id}/units`, { fundingSourceId: hibah.id });

    const response = await call('delete', `/funding-sources/${hibah.id}`, undefined, admin);

    expect(response.status).toBe(409);
    expect(await models.FundingSource.findByPk(hibah.id)).not.toBeNull();
  });

  it('says in the registration hint whether the code carries the funding source', async () => {
    const donated = await asset();
    expect((await get(`/assets/${donated.id}`)).body.data.unitRegistration.fundingSource).toEqual({
      inCode: false,
    });

    await setFormat(FUNDED_FORMAT);
    expect((await get(`/assets/${donated.id}`)).body.data.unitRegistration.fundingSource).toEqual({
      inCode: true,
    });
  });
});

describe('rolling back migration 056', () => {
  const CYCLE = cycleDatabaseUrl();
  const NAME = '20260930010000-056-add-unit-acquisition-facts.js';

  beforeAll(async () => {
    await migrate(CYCLE);
    // The unit's asset needs a real classification; the cycle database is
    // migrated but not otherwise seeded. The seeders are idempotent.
    await seed(CYCLE);
  });

  it('refuses while a unit records a fact, then rolls back and re-applies when none does', async () => {
    const [asset_] = await query(
      `INSERT INTO public.assets (name, classification_id) VALUES ('Cycle', $1) RETURNING id`,
      [LEAF],
      CYCLE
    );
    const [unit] = await query(
      `INSERT INTO public.asset_units (asset_id, acquisition_date) VALUES ($1, CURRENT_DATE)
       RETURNING id`,
      [asset_.id],
      CYCLE
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', NAME], CYCLE)).rejects.toThrow(
        /Migration 056 rollback refused/
      );
    } finally {
      await query('DELETE FROM public.asset_units WHERE id = $1', [unit.id], CYCLE);
      await query('DELETE FROM public.assets WHERE id = $1', [asset_.id], CYCLE);
    }

    await runCli(['db:migrate:undo', '--name', NAME], CYCLE);
    const gone = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'asset_units'
          AND column_name IN ('funding_source_id', 'acquisition_date')`,
      [],
      CYCLE
    );
    expect(gone).toEqual([]);

    await migrate(CYCLE);
    const back = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'asset_units'
          AND column_name IN ('funding_source_id', 'acquisition_date')`,
      [],
      CYCLE
    );
    expect(back).toHaveLength(2);
  });
});
