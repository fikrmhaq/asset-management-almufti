import { createRequire } from 'node:module';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetAssetCoreData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { cycleDatabaseUrl, migrate, query, runCli, seed } from './helpers/db.js';

const require = createRequire(import.meta.url);
const { PIC_ALLOWED_PERMISSIONS } = require('../../src/auth/permissionCatalog.js');

/**
 * Registration against request items — Phase 40 (`CR-014` §7.1 – §7.3, §6.1),
 * REQ-REQUEST-010, BR-031, `06-api.md` §12.5; `IMPLEMENTATION_PLAN.md` §59
 * decisions D1 – D11.
 *
 *   SCHEMA        migration 054; one item per unit; no receipt column.
 *   REGISTER      new or existing asset; partial; the cap; automatic DONE.
 *   LINK          D3 eligibility — whenever the unit was created.
 *   UNLINK        only while REGISTER is ACTIVE (D5); actor or oversight.
 *   AUTHORITY     code AND current actor; oversight never registers.
 *   INDEPENDENCE  PROCURE untouched; the request stays APPROVED; no receipt.
 *   D4            registered = links; later deactivation changes nothing.
 *   CANCEL        refused once anything is linked (D9).
 *   D7            the unit detail names the request only to those who see it.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request:submit',
  'request:cancel',
  'request-item:create',
  'request-item:update',
  'request-item:delete',
  'request-item-unit:read',
];
const APPROVER = ['request:read', 'request-step:decide'];
const PROCURER = ['request:read', 'request-step:complete'];
const REGISTRAR = [
  'request:read',
  'request-item:register',
  'request-item-unit:read',
  'request-item-unit:create',
  'request-item-unit:delete',
  'asset:create',
  'asset:read',
  'asset-unit:create',
  'asset-unit:read',
  'asset-unit:deactivate',
];
const OVERSEER = [
  'request:read',
  'request:cancel',
  'request:oversee',
  'request-item-unit:read',
  'request-item-unit:delete',
];

/** DECIDE → PROCURE → REGISTER, each with its own actor. */
const FLOW = [
  ['DECIDE', 'KEPALA_SEKOLAH'],
  ['PROCURE', 'WAKASEK_SARPRAS'],
  ['REGISTER', 'WAKASEK_KESISWAAN'],
];

let admin;
let alpha;
let beta;
let tkj;
let rpl;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
  tkj = await models.Department.create({ code: 'TKJ', name: 'TKJ', institutionId: alpha.id });
  rpl = await models.Department.create({ code: 'RPL', name: 'RPL', institutionId: alpha.id });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

// --- helpers ----------------------------------------------------------------

const call = (method, url, body, caller) => {
  const request = api()
    [method](`${V1}${url}`)
    .set(...caller.auth);
  return body === undefined ? request : request.send(body);
};
const get = (url, caller) => call('get', url, undefined, caller);
const post = (url, body, caller) => call('post', url, body ?? {}, caller);
const del = (url, caller) => call('delete', url, undefined, caller);

async function person(permissions, positions = [], { institution = alpha, picScoped } = {}) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: institution.id,
    ...(picScoped ? { isPicScoped: true } : {}),
  });
  const assignments = [];
  for (const [position, department] of positions) {
    assignments.push(
      await models.PositionAssignment.create({
        institutionId: institution.id,
        userId: caller.user.id,
        positionCode: position,
        departmentId: department?.id ?? null,
      })
    );
  }
  return { ...caller, assignment: assignments[0] };
}

async function workflow(steps, { requester = 'COMMON_TEACHER', institution = alpha } = {}) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: institution.id,
    category: 'COMMON',
    requesterPositionCode: requester,
    version: 1,
    status: 'ACTIVE',
    publishedAt: new Date(),
  });
  for (const [index, [stepType, actor]] of steps.entries()) {
    await models.WorkflowDefinitionStep.create({
      definitionId: definition.id,
      sequence: index + 1,
      stepType,
      actorPositionCode: actor,
      procurementMode: stepType === 'PROCURE' ? 'INTERNAL' : null,
      skipIfRequesterIsActor: false,
    });
  }
}

/**
 * A submitted request with `quantities` items, and its cast. The Wakasek and
 * Kepala Sekolah posts have one current holder each, so a test wanting a
 * different permission set for one of them passes it here.
 */
async function submitted({
  quantities = [2],
  requester = ['COMMON_TEACHER'],
  flow = FLOW,
  perms = {},
} = {}) {
  await workflow(flow, { requester: requester[0] });
  const teacher = await person(perms.teacher ?? REQUESTER, [requester]);
  const kepala = await person(perms.kepala ?? APPROVER, [['KEPALA_SEKOLAH']]);
  const sarpras = await person(perms.sarpras ?? PROCURER, [['WAKASEK_SARPRAS']]);
  const registrar = await person(perms.registrar ?? REGISTRAR, [['WAKASEK_KESISWAAN']]);
  const overseer = await person(OVERSEER);

  const created = await post(
    '/requests',
    { requesterAssignmentId: teacher.assignment.id, category: 'COMMON', title: 'Kursi' },
    teacher
  );
  expect(created.status).toBe(201);
  for (const [index, quantity] of quantities.entries()) {
    const added = await post(
      `/requests/${created.body.data.id}/items`,
      { description: `Barang ${index + 1}`, quantityRequested: quantity },
      teacher
    );
    expect(added.status).toBe(201);
  }
  const response = await post(`/requests/${created.body.data.id}/submit`, {}, teacher);
  expect(response.status).toBe(200);
  return { teacher, kepala, sarpras, registrar, overseer, request: response.body.data };
}

/** Submitted and approved: PROCURE and REGISTER both ACTIVE. */
async function approved(options) {
  const cast = await submitted(options);
  const decided = await post(
    `/request-steps/${cast.request.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    cast.kepala
  );
  expect(decided.status).toBe(200);
  expect(decided.body.data.status).toBe('APPROVED');
  return { ...cast, request: decided.body.data };
}

const stepOf = (request, type) => request.steps.find((step) => step.stepType === type);
const register = (itemId, body, caller) => post(`/request-items/${itemId}/register`, body, caller);
const newAsset = (unitCount, extra = {}) => ({
  name: 'Kursi lipat',
  classificationId: LEAF,
  unitCount,
  ...extra,
});
const link = (itemId, assetUnitId, caller) =>
  post(`/request-items/${itemId}/units`, { assetUnitId }, caller);
const detail = async (requestId, caller = admin) =>
  (await get(`/requests/${requestId}`, caller)).body.data;
const stepState = async (requestId, type) =>
  (await models.RequestStep.findOne({ where: { requestId, stepType: type } })).state;

/** A unit registered directly — the existing path, untouched. */
async function directUnit({ institution = alpha } = {}) {
  const asset = await post(
    '/assets',
    { name: 'Meja', classificationId: LEAF, institutionId: institution.id },
    admin
  );
  expect(asset.status).toBe(201);
  const unit = await post(`/assets/${asset.body.data.id}/units`, {}, admin);
  expect(unit.status).toBe(201);
  return unit.body.data;
}

// ---------------------------------------------------------------------------

describe('the schema (migration 054)', () => {
  it('holds the approved columns only — no receipt column', async () => {
    const columns = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'request_item_units'
        ORDER BY ordinal_position`
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      'id',
      'request_item_id',
      'asset_unit_id',
      'linked_at',
      'linked_by',
    ]);
  });

  it('lets a unit fulfil one item only', async () => {
    const { registrar, request } = await approved({ quantities: [2, 2] });
    const unit = await directUnit();
    const insert = (itemId) =>
      query(
        `INSERT INTO public.request_item_units (request_item_id, asset_unit_id, linked_by)
         VALUES ($1, $2, $3)`,
        [itemId, unit.id, registrar.user.id]
      );

    await insert(request.items[0].id);
    await expect(insert(request.items[1].id)).rejects.toThrow(/uq_request_item_units_unit/);
  });
});

describe('register (REQ-REQUEST-010)', () => {
  it('creates a new asset and its units, links them, and completes REGISTER', async () => {
    const { registrar, request } = await approved({ quantities: [2] });
    const item = request.items[0];

    const response = await register(item.id, newAsset(2), registrar);

    expect(response.status).toBe(201);
    expect(response.body.data.units).toHaveLength(2);
    for (const unit of response.body.data.units) {
      // D1: nothing is placed — the unit is exactly as after direct registration.
      expect(unit).toMatchObject({
        lifecycleState: 'REGISTERED',
        currentLocationId: null,
        currentCondition: null,
        isActive: true,
      });
    }
    const after = response.body.data.request;
    expect(after.status).toBe('APPROVED');
    expect(after.items[0]).toMatchObject({
      quantityRegistered: 2,
      quantityNotYetRegistered: 0,
    });
    expect(stepOf(after, 'REGISTER')).toMatchObject({
      state: 'DONE',
      actedByUserId: registrar.user.id,
    });
    expect(stepOf(after, 'REGISTER').actedAs.id).toBe(registrar.assignment.id);

    const asset = await models.Asset.findByPk(response.body.data.units[0].assetId);
    expect(asset.institutionId).toBe(alpha.id);
    expect(
      await models.LongitudinalHistory.count({
        where: { assetUnitId: response.body.data.units.map((unit) => unit.id) },
      })
    ).toBe(0);
  });

  it('supports partial registration, and completes only when every item is registered', async () => {
    const { registrar, request } = await approved({ quantities: [3, 1] });
    const [first, second] = request.items;

    const partial = await register(first.id, newAsset(2), registrar);
    expect(partial.status).toBe(201);
    expect(partial.body.data.request.items[0]).toMatchObject({
      quantityRegistered: 2,
      quantityNotYetRegistered: 1,
    });
    expect(stepOf(partial.body.data.request, 'REGISTER').state).toBe('ACTIVE');

    await register(first.id, newAsset(1), registrar);
    expect(await stepState(request.id, 'REGISTER')).toBe('ACTIVE');

    const last = await register(second.id, newAsset(1), registrar);
    expect(stepOf(last.body.data.request, 'REGISTER').state).toBe('DONE');
  });

  it('adds units to an existing asset of the same institution', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    const asset = await post(
      '/assets',
      { name: 'Proyektor', classificationId: LEAF, institutionId: alpha.id },
      admin
    );

    const response = await register(
      request.items[0].id,
      { assetId: asset.body.data.id, unitCount: 1 },
      registrar
    );

    expect(response.status).toBe(201);
    expect(response.body.data.units[0].assetId).toBe(asset.body.data.id);
  });

  it('defaults the units to the request’s department', async () => {
    const { registrar, request } = await approved({
      quantities: [1],
      requester: ['JURUSAN_TEACHER', tkj],
    });

    const response = await register(request.items[0].id, newAsset(1), registrar);
    expect(response.body.data.units[0].departmentId).toBe(tkj.id);
  });

  it('refuses more units than remain (400), writing nothing', async () => {
    const { registrar, request } = await approved({ quantities: [2] });
    await register(request.items[0].id, newAsset(1), registrar);
    const before = await models.AssetUnit.count();

    const response = await register(request.items[0].id, newAsset(2), registrar);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('unitCount');
    expect(await models.AssetUnit.count()).toBe(before);
    expect(await models.Asset.count({ where: { name: 'Kursi lipat' } })).toBe(1);
  });

  it('refuses an asset of another institution', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    const foreign = await post(
      '/assets',
      { name: 'Lemari', classificationId: LEAF, institutionId: beta.id },
      admin
    );

    const response = await register(
      request.items[0].id,
      { assetId: foreign.body.data.id, unitCount: 1 },
      registrar
    );
    expect([403, 404]).toContain(response.status);
  });

  it('refuses assetId together with new-asset fields, and a new asset without them', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    const both = await register(
      request.items[0].id,
      { assetId: '00000000-0000-4000-8000-000000000000', name: 'X', unitCount: 1 },
      registrar
    );
    const neither = await register(request.items[0].id, { unitCount: 1 }, registrar);

    expect(both.status).toBe(400);
    expect(neither.status).toBe(400);
  });
});

describe('authority — the code AND the current actor (DEC-J, D2)', () => {
  it('requires asset:create for a new asset, and nothing is written without it', async () => {
    const { registrar: limited, request } = await approved({
      quantities: [1],
      perms: { registrar: REGISTRAR.filter((code) => code !== 'asset:create') },
    });

    const response = await register(request.items[0].id, newAsset(1), limited);

    expect(response.status).toBe(403);
    expect(await models.AssetUnit.count()).toBe(0);
  });

  it.each([['request-item:register'], ['asset-unit:create']])('requires %s', async (missing) => {
    const { registrar: limited, request } = await approved({
      quantities: [1],
      perms: { registrar: REGISTRAR.filter((code) => code !== missing) },
    });
    expect((await register(request.items[0].id, newAsset(1), limited)).status).toBe(403);
  });

  it('refuses a caller with every code who is not the actor — oversight included', async () => {
    const { request } = await approved({ quantities: [1] });
    const powerful = await person([...REGISTRAR, 'request:oversee']);

    const response = await register(request.items[0].id, newAsset(1), powerful);

    expect(response.status).toBe(403);
    expect(response.body.error.details[0].issue).toMatch(/not the actor of this step/);
  });

  it('refuses the former DECIDE actor and the PROCURE actor, even with the codes', async () => {
    const { kepala, sarpras, request } = await approved({
      quantities: [1],
      perms: { kepala: [...APPROVER, ...REGISTRAR], sarpras: [...PROCURER, ...REGISTRAR] },
    });

    // Both see the request — a former actor, an ACTIVE step's actor — and
    // neither is REGISTER's actor.
    expect((await register(request.items[0].id, newAsset(1), kepala)).status).toBe(403);
    expect((await register(request.items[0].id, newAsset(1), sarpras)).status).toBe(403);
  });

  it('keeps the holder of a still-PENDING REGISTER step out entirely', async () => {
    const { registrar, request } = await submitted({ quantities: [1] });
    expect((await register(request.items[0].id, newAsset(1), registrar)).status).toBe(404);
  });

  it('refuses registration before approval (409)', async () => {
    const { registrar: overseeingRegistrar, request } = await submitted({
      quantities: [1],
      perms: { registrar: [...REGISTRAR, 'request:oversee'] },
    });

    const response = await register(request.items[0].id, newAsset(1), overseeingRegistrar);
    expect(response.status).toBe(409);
  });

  it('follows a handover immediately', async () => {
    const { registrar, request } = await approved({ quantities: [2] });
    await register(request.items[0].id, newAsset(1), registrar);
    await registrar.assignment.update({ isCurrent: false, endedAt: new Date() });
    const successor = await person(REGISTRAR, [['WAKASEK_KESISWAAN']]);

    // The old holder never completed the step, so they no longer see it (D6).
    expect((await register(request.items[0].id, newAsset(1), registrar)).status).toBe(404);
    const done = await register(request.items[0].id, newAsset(1), successor);
    expect(done.status).toBe(201);
    expect(stepOf(done.body.data.request, 'REGISTER')).toMatchObject({
      state: 'DONE',
      actedByUserId: successor.user.id,
    });
  });

  it('resolves a department-bound REGISTER actor within the request’s department', async () => {
    const flow = [
      ['DECIDE', 'KEPALA_SEKOLAH'],
      ['REGISTER', 'TOOLMAN'],
    ];
    const { request } = await approved({
      quantities: [1],
      requester: ['JURUSAN_TEACHER', tkj],
      flow,
    });
    const toolmanRpl = await person(REGISTRAR, [['TOOLMAN', rpl]]);
    const toolmanTkj = await person(REGISTRAR, [['TOOLMAN', tkj]]);

    expect((await register(request.items[0].id, newAsset(1), toolmanRpl)).status).toBe(404);
    expect((await register(request.items[0].id, newAsset(1), toolmanTkj)).status).toBe(201);
  });

  it('refuses a PIC-scoped caller on every endpoint', async () => {
    const { request } = await approved({ quantities: [1] });
    // Refused before any actor check, so the post need not be held.
    const pic = await person([...REGISTRAR, 'request:oversee'], [], { picScoped: true });
    const unit = await directUnit();

    expect((await register(request.items[0].id, newAsset(1), pic)).status).toBe(403);
    expect((await link(request.items[0].id, unit.id, pic)).status).toBe(403);
    expect((await get(`/request-items/${request.items[0].id}/units`, pic)).status).toBe(403);
  });

  it('isolates institutions', async () => {
    const { request } = await approved({ quantities: [1] });
    const foreign = await person([...REGISTRAR, 'request:oversee'], [], { institution: beta });
    expect((await register(request.items[0].id, newAsset(1), foreign)).status).toBe(404);
  });
});

describe('link an existing unit (D3, D11)', () => {
  it('links a unit that existed before the request, and counts it', async () => {
    const unit = await directUnit();
    const { registrar, request } = await approved({ quantities: [2] });

    const response = await link(request.items[0].id, unit.id, registrar);

    expect(response.status).toBe(201);
    expect(response.body.data.link).toMatchObject({
      assetUnit: { id: unit.id },
      linkedBy: { id: registrar.user.id },
    });
    expect(response.body.data.request.items[0].quantityRegistered).toBe(1);
    expect(stepOf(response.body.data.request, 'REGISTER').state).toBe('ACTIVE');
  });

  it('completes REGISTER when the final required unit is linked', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    const unit = await directUnit();

    const response = await link(request.items[0].id, unit.id, registrar);
    expect(stepOf(response.body.data.request, 'REGISTER').state).toBe('DONE');
  });

  it.each([
    ['inactive', { isActive: false }],
    ['DISPOSED', { lifecycleState: 'DISPOSED' }],
    ['DEACTIVATED', { lifecycleState: 'DEACTIVATED' }],
  ])('refuses a %s unit (400)', async (_label, change) => {
    const { registrar, request } = await approved({ quantities: [1] });
    const unit = await directUnit();
    await models.AssetUnit.update(change, { where: { id: unit.id } });

    const response = await link(request.items[0].id, unit.id, registrar);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('assetUnitId');
    expect(await models.RequestItemUnit.count()).toBe(0);
  });

  it('accepts any other lifecycle state — e.g. BORROWED or IN_STORAGE', async () => {
    const { registrar, request } = await approved({ quantities: [2] });
    const borrowed = await directUnit();
    const stored = await directUnit();
    await models.AssetUnit.update({ lifecycleState: 'BORROWED' }, { where: { id: borrowed.id } });
    await models.AssetUnit.update({ lifecycleState: 'IN_STORAGE' }, { where: { id: stored.id } });

    expect((await link(request.items[0].id, borrowed.id, registrar)).status).toBe(201);
    expect((await link(request.items[0].id, stored.id, registrar)).status).toBe(201);
  });

  it('refuses a unit the caller cannot reach (another institution)', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    const foreign = await directUnit({ institution: beta });
    expect((await link(request.items[0].id, foreign.id, registrar)).status).toBe(404);
  });

  it('refuses, for a caller who can reach it, a unit of another institution (400)', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    await registrar.assignment.update({ isCurrent: false, endedAt: new Date() });
    // A system-wide registrar reaches both institutions.
    const systemWide = await createCaller({
      permissions: REGISTRAR,
      institutionId: null,
      isSystemWide: true,
    });
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: systemWide.user.id,
      positionCode: 'WAKASEK_KESISWAAN',
    });
    const foreign = await directUnit({ institution: beta });

    const response = await link(request.items[0].id, foreign.id, systemWide);
    expect(response.status).toBe(400);
  });

  it('refuses a unit already linked — to this item or another (409)', async () => {
    const { registrar, request } = await approved({ quantities: [2, 2] });
    const unit = await directUnit();
    await link(request.items[0].id, unit.id, registrar);

    expect((await link(request.items[0].id, unit.id, registrar)).status).toBe(409);
    expect((await link(request.items[1].id, unit.id, registrar)).status).toBe(409);
  });

  it('refuses a link beyond the item’s required quantity (409)', async () => {
    const { registrar, request } = await approved({ quantities: [1, 1] });
    await link(request.items[0].id, (await directUnit()).id, registrar);

    const response = await link(request.items[0].id, (await directUnit()).id, registrar);
    expect(response.status).toBe(409);
  });

  it.each([['asset-unit:read'], ['request-item-unit:create']])(
    'requires %s to link — the lookup capability never suffices alone',
    async (missing) => {
      const { registrar: limited, request } = await approved({
        quantities: [1],
        perms: { registrar: REGISTRAR.filter((code) => code !== missing) },
      });
      const unit = await directUnit();

      expect((await link(request.items[0].id, unit.id, limited)).status).toBe(403);
      expect(await models.RequestItemUnit.count()).toBe(0);
    }
  );

  it('never lets reaching the unit stand in for being the actor', async () => {
    const { request } = await approved({ quantities: [1] });
    const unit = await directUnit();
    const reader = await person([...REGISTRAR, 'request:oversee']);

    expect((await link(request.items[0].id, unit.id, reader)).status).toBe(403);
    expect(await models.RequestItemUnit.count()).toBe(0);
  });
});

describe('unlink (D5)', () => {
  it('lets the actor unlink while REGISTER is ACTIVE; the unit stays', async () => {
    const { registrar, request } = await approved({ quantities: [2] });
    const unit = await directUnit();
    const linked = (await link(request.items[0].id, unit.id, registrar)).body.data.link;

    expect((await del(`/request-item-units/${linked.id}`, registrar)).status).toBe(204);
    expect(await models.RequestItemUnit.count()).toBe(0);
    expect(await models.AssetUnit.findByPk(unit.id)).not.toBeNull();
    expect((await detail(request.id)).items[0].quantityRegistered).toBe(0);
  });

  it('lets oversight unlink without being the actor', async () => {
    const { registrar, overseer, request } = await approved({ quantities: [2] });
    const linked = (await link(request.items[0].id, (await directUnit()).id, registrar)).body.data
      .link;
    expect((await del(`/request-item-units/${linked.id}`, overseer)).status).toBe(204);
  });

  it('refuses anyone else who sees the request — the requester, the PROCURE actor (403)', async () => {
    const { registrar, teacher, sarpras, request } = await approved({
      quantities: [2],
      perms: {
        teacher: [...REQUESTER, 'request-item-unit:delete'],
        sarpras: [...PROCURER, 'request-item-unit:delete'],
      },
    });
    const linked = (await link(request.items[0].id, (await directUnit()).id, registrar)).body.data
      .link;

    expect((await del(`/request-item-units/${linked.id}`, teacher)).status).toBe(403);
    expect((await del(`/request-item-units/${linked.id}`, sarpras)).status).toBe(403);
    expect(await models.RequestItemUnit.count()).toBe(1);
  });

  it('refuses every unlink once REGISTER is DONE — it never reopens (409)', async () => {
    const { registrar, overseer, request } = await approved({ quantities: [1] });
    const linked = (await link(request.items[0].id, (await directUnit()).id, registrar)).body.data
      .link;
    expect(await stepState(request.id, 'REGISTER')).toBe('DONE');

    expect((await del(`/request-item-units/${linked.id}`, registrar)).status).toBe(409);
    expect((await del(`/request-item-units/${linked.id}`, overseer)).status).toBe(409);
    expect(await stepState(request.id, 'REGISTER')).toBe('DONE');
  });
});

describe('independence (G2, BR-031) and no receipt', () => {
  it('registers everything while PROCURE stays ACTIVE and untouched', async () => {
    const { registrar, request } = await approved({ quantities: [2] });
    const response = await register(request.items[0].id, newAsset(2), registrar);

    const procure = await models.RequestStep.findOne({
      where: { requestId: request.id, stepType: 'PROCURE' },
    });
    expect(procure.state).toBe('ACTIVE');
    expect(procure.actedByUserId).toBeNull();
    expect(response.body.data.request.status).toBe('APPROVED');
  });

  it('lets PROCURE be declared after registration, changing nothing else', async () => {
    const { registrar, sarpras, request } = await approved({ quantities: [1] });
    await register(request.items[0].id, newAsset(1), registrar);

    const done = await post(
      `/request-steps/${stepOf(request, 'PROCURE').id}/complete`,
      {},
      sarpras
    );

    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('APPROVED');
    expect(done.body.data.steps.map((step) => step.state)).toEqual(['APPROVED', 'DONE', 'DONE']);
  });

  it('registers after PROCURE was declared', async () => {
    const { registrar, sarpras, request } = await approved({ quantities: [1] });
    await post(`/request-steps/${stepOf(request, 'PROCURE').id}/complete`, {}, sarpras);

    const response = await register(request.items[0].id, newAsset(1), registrar);
    expect(response.status).toBe(201);
    expect(response.body.data.request.status).toBe('APPROVED');
  });

  it('records no receipt — registration is not receipt (BR-031)', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    await register(request.items[0].id, newAsset(1), registrar);
    const after = await detail(request.id);

    // Phase 41 added the receipt figures; registering writes none of them.
    expect(after.items[0]).toMatchObject({ quantityRegistered: 1, quantityReceived: 0 });
    expect(after.status).toBe('APPROVED');
    expect(await models.RequestItemUnitReceipt.count()).toBe(0);
  });
});

describe('registered = links (D4)', () => {
  it('keeps the count and REGISTER DONE after a linked unit is deactivated or disposed', async () => {
    const { registrar, request } = await approved({ quantities: [2] });
    const units = (await register(request.items[0].id, newAsset(2), registrar)).body.data.units;
    expect(await stepState(request.id, 'REGISTER')).toBe('DONE');

    expect((await post(`/asset-units/${units[0].id}/deactivate`, {}, registrar)).status).toBe(200);
    await models.AssetUnit.update({ lifecycleState: 'DISPOSED' }, { where: { id: units[1].id } });

    const after = await detail(request.id);
    expect(after.items[0]).toMatchObject({ quantityRegistered: 2, quantityNotYetRegistered: 0 });
    expect(stepOf(after, 'REGISTER').state).toBe('DONE');

    // The current state is shown beside the link, separately.
    const listed = (await get(`/request-items/${request.items[0].id}/units`, registrar)).body.data;
    expect(listed.map((row) => [row.assetUnit.isActive, row.assetUnit.lifecycleState])).toEqual(
      expect.arrayContaining([
        [false, 'REGISTERED'],
        [true, 'DISPOSED'],
      ])
    );
  });

  it('keeps counting a link whose unit was deactivated while REGISTER is still ACTIVE', async () => {
    const { registrar, request } = await approved({ quantities: [2] });
    const [unit] = (await register(request.items[0].id, newAsset(1), registrar)).body.data.units;
    await post(`/asset-units/${unit.id}/deactivate`, {}, registrar);

    const response = await register(request.items[0].id, newAsset(2), registrar);
    expect(response.status).toBe(400);
    expect((await detail(request.id)).items[0].quantityRegistered).toBe(1);
  });
});

describe('cancel after registration (scenario 6d, D9)', () => {
  it('refuses cancellation once any unit is linked, and says so in the actions', async () => {
    const { registrar, overseer, request } = await approved({ quantities: [2] });
    expect((await detail(request.id, overseer)).actions.cancel).toBe(true);

    await link(request.items[0].id, (await directUnit()).id, registrar);

    const refused = await post(`/requests/${request.id}/cancel`, { reason: 'Batal' }, overseer);
    expect(refused.status).toBe(409);
    expect((await detail(request.id, overseer)).actions.cancel).toBe(false);
    expect((await models.Request.findByPk(request.id)).status).toBe('APPROVED');
  });
});

describe('reading and the inbox', () => {
  it('lists an item’s units to anyone who sees the request, with unlink flags per caller', async () => {
    const { registrar, teacher, overseer, request } = await approved({ quantities: [2] });
    await link(request.items[0].id, (await directUnit()).id, registrar);
    const url = `/request-items/${request.items[0].id}/units`;

    expect((await get(url, teacher)).body.data[0].canUnlink).toBe(false);
    expect((await get(url, registrar)).body.data[0].canUnlink).toBe(true);
    expect((await get(url, overseer)).body.data[0].canUnlink).toBe(true);
  });

  it('requires request-item-unit:read and request visibility', async () => {
    const { request } = await approved({ quantities: [1] });
    const url = `/request-items/${request.items[0].id}/units`;
    const noCode = await person(['request:read', 'request:oversee']);
    const outsider = await person(['request:read', 'request-item-unit:read']);

    expect((await get(url, noCode)).status).toBe(403);
    expect((await get(url, outsider)).status).toBe(404);
  });

  it('puts an open REGISTER step in the registrar’s "awaiting my action" list until DONE', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    const awaiting = async () =>
      (await get('/requests?awaiting=me', registrar)).body.data.map((row) => row.id);

    expect(await awaiting()).toContain(request.id);
    await register(request.items[0].id, newAsset(1), registrar);
    expect(await awaiting()).not.toContain(request.id);
  });

  it('offers canAct on REGISTER to its actor only', async () => {
    const { registrar, overseer, request } = await approved({ quantities: [1] });
    expect(stepOf(await detail(request.id, registrar), 'REGISTER').canAct).toBe(true);
    expect(stepOf(await detail(request.id, overseer), 'REGISTER').canAct).toBe(false);
  });
});

describe('the unit detail’s requestItem (D7)', () => {
  it('names the request to a caller who can see it, and null to one who cannot', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    const [unit] = (await register(request.items[0].id, newAsset(1), registrar)).body.data.units;
    // Reaches the unit, holds request:read, but cannot see this request.
    const unitReader = await person(['asset-unit:read', 'request:read']);
    const byCode = `/asset-units/by-code?code=${encodeURIComponent(unit.inventoryCode)}`;
    const expected = {
      requestId: request.id,
      requestNumber: request.requestNumber,
      itemId: request.items[0].id,
      description: 'Barang 1',
    };

    expect((await get(`/asset-units/${unit.id}`, registrar)).body.data.requestItem).toEqual(
      expected
    );
    expect((await get(byCode, registrar)).body.data.requestItem).toEqual(expected);
    expect((await get(`/asset-units/${unit.id}`, unitReader)).body.data.requestItem).toBeNull();
    expect((await get(byCode, unitReader)).body.data.requestItem).toBeNull();
  });

  it('is null without request:read, even for a caller who could otherwise see the request', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    const [unit] = (await register(request.items[0].id, newAsset(1), registrar)).body.data.units;
    const overseerNoRead = await person(['asset-unit:read', 'request:oversee']);

    expect((await get(`/asset-units/${unit.id}`, overseerNoRead)).body.data.requestItem).toBeNull();
  });

  it('is null for a unit registered directly', async () => {
    const unit = await directUnit();
    expect((await get(`/asset-units/${unit.id}`, admin)).body.data.requestItem).toBeNull();
  });
});

describe('direct registration is unchanged', () => {
  it('still creates units with no link, while requests are being registered', async () => {
    const { registrar, request } = await approved({ quantities: [1] });
    await register(request.items[0].id, newAsset(1), registrar);
    const before = await models.RequestItemUnit.count();

    const unit = await directUnit();
    expect(unit.lifecycleState).toBe('REGISTERED');
    expect(await models.RequestItemUnit.count()).toBe(before);
  });
});

describe('audit and the PIC ceiling', () => {
  it('records every unit, every link and every unlink', async () => {
    const { registrar, request } = await approved({ quantities: [3] });
    const units = (await register(request.items[0].id, newAsset(2), registrar)).body.data.units;
    const extra = await directUnit();
    const linked = (await link(request.items[0].id, extra.id, registrar)).body.data;
    expect(stepOf(linked.request, 'REGISTER').state).toBe('DONE');

    const unitCreates = await models.AuditLog.count({
      where: { entityType: 'AssetUnit', action: 'CREATE', entityId: units.map((u) => u.id) },
    });
    const linkIds = (await models.RequestItemUnit.findAll()).map((row) => row.id);
    const linkRows = await models.AuditLog.findAll({
      where: { entityType: 'RequestItemUnit', action: 'CREATE', entityId: linkIds },
    });
    expect(unitCreates).toBe(2);
    expect(linkRows).toHaveLength(3);
    expect(linkRows.every((row) => row.actorId === registrar.user.id)).toBe(true);
  });

  it('records an unlink', async () => {
    const { registrar, request } = await approved({ quantities: [2] });
    const linked = (await link(request.items[0].id, (await directUnit()).id, registrar)).body.data
      .link;
    await del(`/request-item-units/${linked.id}`, registrar);

    const rows = await models.AuditLog.findAll({
      where: { entityType: 'RequestItemUnit', entityId: linked.id },
      order: [['timestamp', 'ASC']],
    });
    expect(rows.map((row) => row.action)).toEqual(['CREATE', 'DELETE']);
  });

  it('adds no registration code to the PIC ceiling', () => {
    expect(PIC_ALLOWED_PERMISSIONS.size).toBe(30);
    for (const code of [
      'request-item:register',
      'request-item-unit:read',
      'request-item-unit:create',
      'request-item-unit:delete',
    ]) {
      expect(PIC_ALLOWED_PERMISSIONS.has(code)).toBe(false);
    }
  });
});

/** Migration 054's `down()` refuses while links exist (cycle database). */
describe('rolling back migration 054', () => {
  const CYCLE = cycleDatabaseUrl();
  const NAME = '20260928010000-054-create-request-item-units.js';

  beforeAll(async () => {
    await migrate(CYCLE);
  });

  it('refuses while a link exists, then rolls back and re-applies when empty', async () => {
    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('Cycle L', 'CYCLEL', 'Jl. L') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-links', $1, 'Cycle', 'Links', $2) RETURNING id`,
      [`$2b$10$${'0'.repeat(53)}`, institution.id],
      CYCLE
    );
    const [assignment] = await query(
      `INSERT INTO public.position_assignments (institution_id, user_id, position_code)
       VALUES ($1, $2, 'COMMON_TEACHER') RETURNING id`,
      [institution.id, user.id],
      CYCLE
    );
    const [request] = await query(
      `INSERT INTO public.requests (institution_id, request_number, category, title,
         requester_user_id, requester_assignment_id, requester_position_code)
       VALUES ($1, 'REQ/2026/0001', 'COMMON', 'T', $2, $3, 'COMMON_TEACHER') RETURNING id`,
      [institution.id, user.id, assignment.id],
      CYCLE
    );
    const [item] = await query(
      `INSERT INTO public.request_items (request_id, line_no, description, quantity_requested)
       VALUES ($1, 1, 'Kursi', 1) RETURNING id`,
      [request.id],
      CYCLE
    );
    // The cycle database is migrated but not seeded: a throwaway classification.
    await query(
      `INSERT INTO ref.asset_classifications (id, name) VALUES ('999999999054', 'Cycle 054')`,
      [],
      CYCLE
    );
    const [asset] = await query(
      `INSERT INTO public.assets (name, classification_id, institution_id)
       VALUES ('Kursi', '999999999054', $1) RETURNING id`,
      [institution.id],
      CYCLE
    );
    const [unit] = await query(
      `INSERT INTO public.asset_units (asset_id) VALUES ($1) RETURNING id`,
      [asset.id],
      CYCLE
    );
    await query(
      `INSERT INTO public.request_item_units (request_item_id, asset_unit_id, linked_by)
       VALUES ($1, $2, $3)`,
      [item.id, unit.id, user.id],
      CYCLE
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', NAME], CYCLE)).rejects.toThrow(
        /Migration 054 rollback refused/
      );
    } finally {
      await query('DELETE FROM public.request_item_units', [], CYCLE);
      await query('DELETE FROM public.asset_units WHERE id = $1', [unit.id], CYCLE);
      await query('DELETE FROM public.assets WHERE id = $1', [asset.id], CYCLE);
      await query(`DELETE FROM ref.asset_classifications WHERE id = '999999999054'`, [], CYCLE);
      await query('DELETE FROM public.request_items', [], CYCLE);
      await query('DELETE FROM public.requests', [], CYCLE);
      await query('DELETE FROM public.position_assignments', [], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }

    // Migration 057: receipt confirmations reference requests, request documents
    // and receipts, so 057 comes off first (and is re-applied with the rest).
    // Migration 058 (P6): request views reference requests — off first.
    // Migration 062: confirmation photos name receipts of 055 / 057 — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261005010000-062-add-receipt-unit-photos.js'],
      CYCLE
    );
    await runCli(
      ['db:migrate:undo', '--name', '20261002010000-058-create-request-views.js'],
      CYCLE
    );
    await runCli(
      ['db:migrate:undo', '--name', '20261001010000-057-create-receipt-confirmations.js'],
      CYCLE
    );
    // Phase 41: receipts reference the links, so 055 comes off first.
    await runCli(
      ['db:migrate:undo', '--name', '20260929010000-055-create-receipts-and-close-events.js'],
      CYCLE
    );
    await runCli(['db:migrate:undo', '--name', NAME], CYCLE);
    const [gone] = await query(`SELECT to_regclass('public.request_item_units') AS t`, [], CYCLE);
    expect(gone.t).toBeNull();
    await migrate(CYCLE);
    const [back] = await query(
      `SELECT to_regclass('public.request_item_units')::text AS t`,
      [],
      CYCLE
    );
    expect(back.t).toBe('request_item_units');
  });
});
