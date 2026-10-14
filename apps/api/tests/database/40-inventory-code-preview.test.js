import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetAssetCoreData,
  resetOperationsData,
  resetOrganizationData,
  resetProcurementData,
} from './helpers/apiClient.js';
import { query, seed } from './helpers/db.js';

/**
 * Inventory-code preview and recently used unit numbers — P4
 * (`IMPLEMENTATION_PLAN.md` §64.4), `POST /inventory-codes/preview`.
 *
 *   READ-ONLY   no unit, asset or audit row; nothing reserved
 *   PARITY      the previewed code is the code registration then issues, for
 *               every token of the registry
 *   STATUSES    OK, EMPTY, INVALID, DUPLICATE_IN_BATCH, ALREADY_ISSUED,
 *               INCOMPLETE; free-form values (`1.9`, `1.10`) never treated as
 *               a numeric sequence
 *   FUNDING     the unit's own → the contract's → refused when required; the
 *               contract mismatch refusal (migration 056)
 *   RECENT      the five most recently REGISTERED for the same fixed parts —
 *               by time, not by value — and only units the caller can reach
 *   SCOPE       a Kajur (P3): own department only, `404` on another's asset,
 *               nothing of another department's numbers
 */

const V1 = '/api/v1';
const LEAF = '117010101001'; // Aspal
const OTHER_LEAF = '117010101002';
const YEAR = new Date().getFullYear();

/** ALM-1's format, with hyphens so the code stays one path segment in tests. */
const FUNDED =
  '{NUMBER_COMPOSITION}-{CLASSIFICATION_LEAF_LABEL}-{FUNDING_SOURCE_CODE}-{REGISTRATION_YEAR}';
/** Every other derived token; 64 characters at worst. */
const DERIVED = '{INSTITUTION_CODE}.{CLASSIFICATION_CODE}.{DEPARTMENT_CODE}.{NUMBER_COMPOSITION}';
const SHORT_YEAR = '{NUMBER_COMPOSITION}-{REGISTRATION_YEAR_SHORT}';
const SEQUENCED = '{INSTITUTION_CODE}-{NUMBER_COMPOSITION}-{SEQUENCE}';

const OPS = ['asset:read', 'asset:create', 'asset-unit:read', 'asset-unit:create'];

let admin;
let alpha;
let tkj;
let tkr;
let bos;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  tkj = await models.Department.create({ code: 'TKJ', name: 'TKJ', institutionId: alpha.id });
  tkr = await models.Department.create({ code: 'TKR', name: 'TKR', institutionId: alpha.id });
  bos = await fundingSource('BOS_REG', 'Dana Bos');
  await setFormat(FUNDED);
});

afterAll(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
});

// --- helpers ----------------------------------------------------------------

const call = (method, url, body, caller) => {
  const request = api()
    [method](`${V1}${url}`)
    .set(...caller.auth);
  return body === undefined ? request : request.send(body);
};
const post = (url, body, caller = admin) => call('post', url, body ?? {}, caller);
const get = (url, caller = admin) => call('get', url, undefined, caller);

const setFormat = async (format) => {
  const response = await call(
    'put',
    `/institutions/${alpha.id}/inventory-code-format`,
    { format },
    admin
  );
  expect(response.status).toBe(200);
};

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

async function asset({ contractId = null, classificationId = LEAF } = {}) {
  const response = await post('/assets', {
    name: 'Laptop',
    classificationId,
    institutionId: alpha.id,
    ...(contractId ? { contractId } : {}),
  });
  expect(response.status).toBe(201);
  return response.body.data;
}

/** Registers one unit, one call at a time, so each has its own `created_at`. */
async function register(assetId, body, caller = admin) {
  const response = await post(`/assets/${assetId}/units`, body, caller);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data;
}

const preview = (body, caller = admin) => post('/inventory-codes/preview', body, caller);

async function person(permissions, positions = []) {
  const caller = await createCaller({ permissions, institutionId: alpha.id });
  for (const [positionCode, department] of positions) {
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: caller.user.id,
      positionCode,
      departmentId: department?.id ?? null,
    });
  }
  return caller;
}

const statuses = (response) => response.body.data.units.map((unit) => unit.status);
const recent = (response) => response.body.data.recentUnitNumbers.map((entry) => entry.unitNumber);

// ---------------------------------------------------------------------------

describe('read-only (P4)', () => {
  it('writes, reserves and audits nothing', async () => {
    const target = await asset();
    const count = async () =>
      (
        await query(
          `SELECT (SELECT count(*) FROM public.asset_units) AS units,
                  (SELECT count(*) FROM public.assets) AS assets,
                  (SELECT count(*) FROM audit.audit_logs) AS audits`
        )
      )[0];

    const before = await count();
    const response = await preview({
      assetId: target.id,
      fundingSourceId: bos.id,
      unitNumbers: ['1.6', '1.7'],
    });
    expect(response.status).toBe(200);
    expect(await count()).toEqual(before);

    // Previewing a code does not hold it: registering it still succeeds.
    await register(target.id, { numberComposition: '1.6', fundingSourceId: bos.id });
  });

  it('needs asset-unit:create, and either an asset or a classification', async () => {
    const target = await asset();
    const reader = await person(['asset:read', 'asset-unit:read']);
    expect((await preview({ assetId: target.id, unitNumbers: ['1'] }, reader)).status).toBe(403);

    const neither = await preview({ unitNumbers: ['1'] });
    expect(neither.status).toBe(400);
    const both = await preview({ assetId: target.id, classificationId: LEAF, unitNumbers: [] });
    expect(both.status).toBe(400);
  });
});

describe('parity with registration (P4)', () => {
  it('previews exactly the code the funded format then issues', async () => {
    const target = await asset();
    const response = await preview({
      assetId: target.id,
      fundingSourceId: bos.id,
      unitNumbers: ['1.6'],
    });
    const [unit] = response.body.data.units;
    expect(unit).toMatchObject({ status: 'OK', inventoryCode: `1.6-ASPAL-BOS_REG-${YEAR}` });

    const issued = await register(target.id, { numberComposition: '1.6', fundingSourceId: bos.id });
    expect(issued.inventoryCode).toBe(unit.inventoryCode);
  });

  it('labels every part and says which one the registrar typed', async () => {
    const target = await asset();
    const response = await preview({
      assetId: target.id,
      fundingSourceId: bos.id,
      unitNumbers: ['1.6'],
    });
    expect(response.body.data.units[0].parts).toEqual([
      { source: 'UNIT_NUMBER', tokenId: 'NUMBER_COMPOSITION', label: 'Unit number', text: '1.6' },
      { source: 'SEPARATOR', text: '-' },
      {
        source: 'GENERATED',
        tokenId: 'CLASSIFICATION_LEAF_LABEL',
        label: 'Classification label',
        text: 'ASPAL',
      },
      { source: 'SEPARATOR', text: '-' },
      {
        source: 'GENERATED',
        tokenId: 'FUNDING_SOURCE_CODE',
        label: 'Funding source code',
        text: 'BOS_REG',
      },
      { source: 'SEPARATOR', text: '-' },
      {
        source: 'GENERATED',
        tokenId: 'REGISTRATION_YEAR',
        label: 'Registration year',
        text: String(YEAR),
      },
    ]);
    expect(response.body.data.unitNumber).toEqual({ required: true, perUnit: true, maxLength: 16 });
  });

  it('matches for institution, classification code and department', async () => {
    await setFormat(DERIVED);
    const target = await asset();
    const response = await preview({
      assetId: target.id,
      departmentId: tkj.id,
      unitNumbers: ['A-1'],
    });
    const [unit] = response.body.data.units;
    expect(unit.inventoryCode).toBe(`ALPHA.${LEAF}.TKJ.A-1`);

    const issued = await register(target.id, { numberComposition: 'A-1', departmentId: tkj.id });
    expect(issued.inventoryCode).toBe(unit.inventoryCode);
  });

  it('matches for the two-digit year', async () => {
    await setFormat(SHORT_YEAR);
    const target = await asset();
    const [unit] = (await preview({ assetId: target.id, unitNumbers: ['7'] })).body.data.units;
    expect(unit.inventoryCode).toBe(`7-${String(YEAR).slice(-2)}`);
    expect((await register(target.id, { numberComposition: '7' })).inventoryCode).toBe(
      unit.inventoryCode
    );
  });

  it('leaves the sequence to registration — one value for the batch', async () => {
    await setFormat(SEQUENCED);
    const target = await asset();
    const response = await preview({ assetId: target.id, unitNumbers: ['LAB'] });
    const [unit] = response.body.data.units;
    expect(response.body.data.unitNumber).toMatchObject({ required: true, perUnit: false });
    expect(unit.status).toBe('OK');
    expect(unit.inventoryCode).toBeNull();
    expect(unit.parts.at(-1)).toEqual({
      source: 'ALLOCATED',
      tokenId: 'SEQUENCE',
      label: 'Sequence',
      text: null,
    });
    expect((await register(target.id, { numberComposition: 'LAB' })).inventoryCode).toBe(
      'ALPHA-LAB-00001'
    );
  });

  it('previews a new asset from its classification, as registration would create it', async () => {
    const response = await preview({
      classificationId: LEAF,
      institutionId: alpha.id,
      fundingSourceId: bos.id,
      unitNumbers: ['2.1'],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.units[0].inventoryCode).toBe(`2.1-ASPAL-BOS_REG-${YEAR}`);
  });

  it('asks for nothing when the format has no unit number', async () => {
    await setFormat('{INSTITUTION_CODE}-{SEQUENCE}');
    const target = await asset();
    const response = await preview({ assetId: target.id, unitNumbers: ['1'] });
    expect(response.body.data.unitNumber.required).toBe(false);
    expect(response.body.data.units).toEqual([]);
    expect(response.body.data.recentUnitNumbers).toEqual([]);
  });
});

describe('unit-number statuses (P4)', () => {
  it('reports empty, invalid and duplicate values the way registration refuses them', async () => {
    const target = await asset();
    const response = await preview({
      assetId: target.id,
      fundingSourceId: bos.id,
      unitNumbers: ['', '  ', '1/6', 'a b', '12345678901234567', '1.9', '1.9', '1.10'],
    });
    expect(statuses(response)).toEqual([
      'EMPTY',
      'EMPTY',
      'INVALID',
      'INVALID',
      'INVALID',
      'DUPLICATE_IN_BATCH',
      'DUPLICATE_IN_BATCH',
      'OK',
    ]);
    const units = response.body.data.units;
    expect(units[2].issue).toMatch(/unsafe/);
    expect(units[4].issue).toMatch(/17 characters/);
    expect(units.every((unit) => unit.status === 'OK' || unit.inventoryCode === null)).toBe(true);

    // Registration refuses the same values.
    const slash = await post(`/assets/${target.id}/units`, {
      numberComposition: '1/6',
      fundingSourceId: bos.id,
    });
    expect(slash.status).toBe(400);
  });

  it('treats free-form numbers as text: 1.9, 1.10 and 1.1 are three different values', async () => {
    const target = await asset();
    await register(target.id, { numberComposition: '1.1', fundingSourceId: bos.id });
    const response = await preview({
      assetId: target.id,
      fundingSourceId: bos.id,
      unitNumbers: ['1.9', '1.10', '1.1', '01.1'],
    });
    expect(statuses(response)).toEqual(['OK', 'OK', 'ALREADY_ISSUED', 'OK']);
    expect(response.body.data.units[1].inventoryCode).toBe(`1.10-ASPAL-BOS_REG-${YEAR}`);
  });

  it('reports a value already issued, and registration then refuses it', async () => {
    const target = await asset();
    await register(target.id, { numberComposition: '1.6', fundingSourceId: bos.id });
    const response = await preview({
      assetId: target.id,
      fundingSourceId: bos.id,
      unitNumbers: ['1.6', '1.7'],
    });
    expect(statuses(response)).toEqual(['ALREADY_ISSUED', 'OK']);
    // The fact only — no unit or asset of the holder.
    expect(Object.keys(response.body.data.units[0]).sort()).toEqual(
      ['index', 'inventoryCode', 'parts', 'status', 'unitNumber'].sort()
    );

    const again = await post(`/assets/${target.id}/units`, {
      numberComposition: '1.6',
      fundingSourceId: bos.id,
    });
    expect(again.status).toBe(409);
  });

  it('is issued per institution-wide code, so the same number under another funding source is free', async () => {
    const target = await asset();
    const other = await fundingSource('DAK');
    await register(target.id, { numberComposition: '1.6', fundingSourceId: bos.id });
    const response = await preview({
      assetId: target.id,
      fundingSourceId: other.id,
      unitNumbers: ['1.6'],
    });
    expect(statuses(response)).toEqual(['OK']);
  });
});

describe('funding source (P4 — the Phase 56 rules)', () => {
  it('uses the unit’s own funding source first', async () => {
    const target = await asset({ contractId: (await contract(bos)).id });
    const response = await preview({
      assetId: target.id,
      fundingSourceId: bos.id,
      unitNumbers: ['1'],
    });
    expect(response.body.data.units[0].inventoryCode).toBe(`1-ASPAL-BOS_REG-${YEAR}`);
  });

  it('falls back to the asset’s contract when none is given', async () => {
    const dak = await fundingSource('DAK');
    const target = await asset({ contractId: (await contract(dak)).id });
    const response = await preview({ assetId: target.id, unitNumbers: ['1'] });
    expect(response.body.data.problems).toEqual([]);
    expect(response.body.data.units[0].inventoryCode).toBe(`1-ASPAL-DAK-${YEAR}`);
    expect((await register(target.id, { numberComposition: '1' })).inventoryCode).toBe(
      `1-ASPAL-DAK-${YEAR}`
    );
  });

  it('reports a funding source that contradicts the contract, as registration refuses it', async () => {
    const dak = await fundingSource('DAK');
    const target = await asset({ contractId: (await contract(dak)).id });
    const response = await preview({
      assetId: target.id,
      fundingSourceId: bos.id,
      unitNumbers: ['1'],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.problems).toEqual([
      expect.objectContaining({
        field: 'fundingSourceId',
        issue: expect.stringMatching(/contract/),
      }),
    ]);
    expect(statuses(response)).toEqual(['INCOMPLETE']);
    const part = response.body.data.parts.find((entry) => entry.tokenId === 'FUNDING_SOURCE_CODE');
    expect(part.text).toBeNull();

    const refused = await post(`/assets/${target.id}/units`, {
      numberComposition: '1',
      fundingSourceId: bos.id,
    });
    expect(refused.status).toBe(400);
  });

  it('reports a missing funding source on a contractless asset, naming fundingSourceId', async () => {
    const target = await asset();
    const response = await preview({ assetId: target.id, unitNumbers: ['1'] });
    expect(response.body.data.problems).toEqual([
      expect.objectContaining({
        field: 'fundingSourceId',
        issue: expect.stringMatching(/REQ-UNIT-012/),
      }),
    ]);
    expect(statuses(response)).toEqual(['INCOMPLETE']);
    // An empty field is still empty, whatever else is missing.
    expect(statuses(await preview({ assetId: target.id, unitNumbers: [''] }))).toEqual(['EMPTY']);
  });

  it('reports a department the format needs and the registration lacks', async () => {
    await setFormat(DERIVED);
    const target = await asset();
    const response = await preview({ assetId: target.id, unitNumbers: ['1'] });
    expect(response.body.data.problems).toEqual([
      expect.objectContaining({ field: 'departmentId' }),
    ]);
    expect(statuses(response)).toEqual(['INCOMPLETE']);
  });
});

describe('recently used unit numbers (P4)', () => {
  it('lists the five most recently registered, newest first — by time, not by value', async () => {
    const target = await asset();
    for (const value of ['1.2', '1.10', '1.9', '2', '1.11', '1.3', '10']) {
      await register(target.id, { numberComposition: value, fundingSourceId: bos.id });
    }
    const response = await preview({
      assetId: target.id,
      fundingSourceId: bos.id,
      unitNumbers: [''],
    });
    expect(recent(response)).toEqual(['10', '1.3', '1.11', '2', '1.9']);
    expect(response.body.data.recentUnitNumbers[0]).toMatchObject({
      inventoryCode: `10-ASPAL-BOS_REG-${YEAR}`,
      registeredAt: expect.any(String),
    });
  });

  it('keeps to codes of the same fixed parts — not another classification', async () => {
    const laptop = await asset();
    const other = await asset({ classificationId: OTHER_LEAF });
    await register(laptop.id, { numberComposition: '1.1', fundingSourceId: bos.id });
    await register(other.id, { numberComposition: '9.9', fundingSourceId: bos.id });

    const response = await preview({
      assetId: laptop.id,
      fundingSourceId: bos.id,
      unitNumbers: [],
    });
    expect(recent(response)).toEqual(['1.1']);
  });

  it('leaves a part not chosen yet open, rather than showing nothing', async () => {
    const target = await asset();
    const dak = await fundingSource('DAK');
    await register(target.id, { numberComposition: '1.1', fundingSourceId: bos.id });
    await register(target.id, { numberComposition: '5.1', fundingSourceId: dak.id });

    const response = await preview({ assetId: target.id, unitNumbers: ['1'] });
    expect(recent(response)).toEqual(['5.1', '1.1']);
  });
});

describe('department scope (P3 + P4)', () => {
  let target;
  let kajur;
  let sarpras;

  beforeEach(async () => {
    target = await asset();
    await register(target.id, {
      numberComposition: '1.1',
      fundingSourceId: bos.id,
      departmentId: tkj.id,
    });
    await register(target.id, {
      numberComposition: '7.7',
      fundingSourceId: bos.id,
      departmentId: tkr.id,
    });
    await register(target.id, {
      numberComposition: '1.2',
      fundingSourceId: bos.id,
      departmentId: tkj.id,
    });
    kajur = await person(OPS, [['KAJUR', tkj]]);
    sarpras = await person(OPS, [['WAKASEK_SARPRAS', null]]);
  });

  it('shows a Kajur only their own department’s recent numbers', async () => {
    const body = {
      assetId: target.id,
      departmentId: tkj.id,
      fundingSourceId: bos.id,
      unitNumbers: ['1.3'],
    };
    expect(recent(await preview(body, kajur))).toEqual(['1.2', '1.1']);
    expect(recent(await preview(body, sarpras))).toEqual(['1.2', '7.7', '1.1']);
  });

  it('refuses a Kajur another department, or none', async () => {
    const base = { assetId: target.id, fundingSourceId: bos.id, unitNumbers: ['1'] };
    expect((await preview({ ...base, departmentId: tkr.id }, kajur)).status).toBe(400);
    expect((await preview({ ...base, departmentId: null }, kajur)).status).toBe(400);
    expect((await preview({ ...base, departmentId: tkr.id }, sarpras)).status).toBe(200);
  });

  it('answers 404 for an asset outside the Kajur’s reach', async () => {
    const tkrOnly = await asset();
    await register(tkrOnly.id, {
      numberComposition: '3.3',
      fundingSourceId: bos.id,
      departmentId: tkr.id,
    });
    const response = await preview(
      { assetId: tkrOnly.id, departmentId: tkj.id, fundingSourceId: bos.id, unitNumbers: ['1'] },
      kajur
    );
    expect(response.status).toBe(404);
  });

  it('still reports another department’s code as issued — the fact registration would refuse on', async () => {
    const response = await preview(
      { assetId: target.id, departmentId: tkj.id, fundingSourceId: bos.id, unitNumbers: ['7.7'] },
      kajur
    );
    expect(statuses(response)).toEqual(['ALREADY_ISSUED']);
    expect(recent(response)).not.toContain('7.7');
    // The unit itself stays out of reach.
    const [tkrUnit] = (await get(`/assets/${target.id}/units`)).body.data.filter(
      (unit) => unit.numberComposition === '7.7'
    );
    expect((await get(`/asset-units/${tkrUnit.id}`, kajur)).status).toBe(404);
  });
});
