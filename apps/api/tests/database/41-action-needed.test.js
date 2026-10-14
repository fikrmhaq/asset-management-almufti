import fs from 'node:fs';
import path from 'node:path';
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
import { seed } from './helpers/db.js';

const require = createRequire(import.meta.url);
const { businessDate } = require('../../src/domain/requestFulfilmentRules.js');
const storage = require('../../src/services/storage.js');

/**
 * Action Needed — P5 (`IMPLEMENTATION_PLAN.md` §64.5), REQ-REQUEST-016.
 *
 * Derived, never stored: a request needs the caller's action exactly when the
 * matching action is offered to them. Each kind true and false; permission
 * gating; CLOSE only for a stranded remainder; SUBMIT listed while blocked;
 * the list (`awaiting=me`, per-row `actionsNeeded`) equal to the detail; the
 * Phase 38 `awaiting=me` behaviour for steps unchanged.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request:submit',
  'request:cancel',
  'request:receive',
  'request-item:create',
  'request-item:update',
  'request-item:delete',
  'request-item-unit:read',
  'request-document:create',
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
];
const OVERSEER = [
  'request:read',
  'request:oversee',
  'request:update',
  'request:cancel',
  'request:close',
  'request:receive',
  'request-receipt:reverse',
  'request-item-unit:read',
];

const FLOW = [
  ['DECIDE', 'KEPALA_SEKOLAH'],
  ['PROCURE', 'WAKASEK_SARPRAS'],
  ['REGISTER', 'WAKASEK_KESISWAAN'],
];

let admin;
let alpha;
let cast;
const receivedRequests = new Set();

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  await workflow(FLOW);
  cast = {
    teacher: await person(REQUESTER, ['COMMON_TEACHER']),
    kepala: await person(APPROVER, ['KEPALA_SEKOLAH']),
    sarpras: await person(PROCURER, ['WAKASEK_SARPRAS']),
    registrar: await person(REGISTRAR, ['WAKASEK_KESISWAAN']),
    overseer: await person(OVERSEER),
  };
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  for (const id of receivedRequests) {
    fs.rmSync(path.join(storage.storageRoot(), 'requests', id), { recursive: true, force: true });
  }
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

async function person(permissions, positions = []) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: alpha.id,
  });
  for (const positionCode of positions) {
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: caller.user.id,
      positionCode,
    });
  }
  const assignment = await models.PositionAssignment.findOne({ where: { userId: caller.user.id } });
  return { ...caller, assignment };
}

async function workflow(steps) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: alpha.id,
    category: 'COMMON',
    requesterPositionCode: 'COMMON_TEACHER',
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

async function draft({ quantities = [2], teacher = cast.teacher } = {}) {
  const created = await post(
    '/requests',
    { requesterAssignmentId: teacher.assignment.id, category: 'COMMON', title: 'Kursi' },
    teacher
  );
  expect(created.status).toBe(201);
  for (const [index, quantity] of quantities.entries()) {
    await post(
      `/requests/${created.body.data.id}/items`,
      { description: `Barang ${index + 1}`, quantityRequested: quantity },
      teacher
    );
  }
  return created.body.data;
}

async function submitted(options) {
  const request = await draft(options);
  const response = await post(`/requests/${request.id}/submit`, {}, cast.teacher);
  expect(response.status).toBe(200);
  return response.body.data;
}

async function approved(options) {
  const request = await submitted(options);
  const decided = await post(
    `/request-steps/${request.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    cast.kepala
  );
  expect(decided.body.data.status).toBe('APPROVED');
  return decided.body.data;
}

async function register(itemId, count) {
  const response = await post(
    `/request-items/${itemId}/register`,
    { name: 'Kursi lipat', classificationId: LEAF, unitCount: count },
    cast.registrar
  );
  expect(response.status).toBe(201);
  return response.body.data.units.map((unit) => unit.id);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function receive(requestId, body, caller = cast.teacher) {
  receivedRequests.add(requestId);
  const fields = { receivedOn: businessDate(), description: 'Diterima', ...body };
  const pending = api()
    .post(`${V1}/requests/${requestId}/receive`)
    .set(...caller.auth);
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of [value].flat()) pending.field(key, String(entry));
  }
  return pending.attach('photos', PNG, { filename: 'bukti.png', contentType: 'image/png' });
}

const dispose = (unitId) =>
  models.AssetUnit.update({ lifecycleState: 'DISPOSED' }, { where: { id: unitId } });

/** "Needs my action": request id → the kinds, from `GET /requests?awaiting=me`. */
async function needs(caller) {
  const response = await get('/requests?awaiting=me&pageSize=100', caller);
  expect(response.status).toBe(200);
  return Object.fromEntries(
    response.body.data.map((row) => [row.id, row.actionsNeeded.map((entry) => entry.kind)])
  );
}

/**
 * THE LIST AND THE DETAIL AGREE, for every request the caller can see: the
 * SQL form (`awaiting=me`, the row's `actionsNeeded`) and the detail's form,
 * which reads the same values as the request page's buttons.
 */
async function assertConsistent(caller) {
  const all = (await get('/requests?pageSize=100', caller)).body.data;
  const awaiting = await needs(caller);
  for (const row of all) {
    const fromDetail = (await get(`/requests/${row.id}`, caller)).body.data.actionsNeeded;
    expect(row.actionsNeeded, `list vs detail for ${row.requestNumber}`).toEqual(fromDetail);
    expect(Boolean(awaiting[row.id]), `awaiting=me for ${row.requestNumber}`).toBe(
      fromDetail.length > 0
    );
  }
}

// ---------------------------------------------------------------------------

describe('SUBMIT (P5)', () => {
  it('asks the requester to submit their own draft, and says when it is blocked', async () => {
    const empty = await draft({ quantities: [] });
    let row = (await get('/requests?awaiting=me', cast.teacher)).body.data.find(
      (entry) => entry.id === empty.id
    );
    expect(row.actionsNeeded).toEqual([{ kind: 'SUBMIT', blocked: true }]);

    await post(
      `/requests/${empty.id}/items`,
      { description: 'Kursi', quantityRequested: 1 },
      cast.teacher
    );
    row = (await get('/requests?awaiting=me', cast.teacher)).body.data.find(
      (entry) => entry.id === empty.id
    );
    expect(row.actionsNeeded).toEqual([{ kind: 'SUBMIT', blocked: false }]);

    const detail = (await get(`/requests/${empty.id}`, cast.teacher)).body.data;
    expect(detail.actionsNeeded).toEqual([{ kind: 'SUBMIT', blocked: false }]);
    await assertConsistent(cast.teacher);
  });

  it('is not asked without request:submit, of anyone else, or once submitted', async () => {
    const readOnly = await person(
      REQUESTER.filter((code) => code !== 'request:submit'),
      ['COMMON_TEACHER']
    );
    const own = await draft({ teacher: readOnly });
    expect(await needs(readOnly)).toEqual({});
    expect((await get(`/requests/${own.id}`, readOnly)).body.data.actionsNeeded).toEqual([]);

    const request = await submitted();
    expect((await needs(cast.teacher))[request.id]).toBeUndefined();
    expect(await needs(cast.overseer)).toEqual({});
  });
});

describe('DECIDE, PROCURE, REGISTER — the Phase 38 rule (P5)', () => {
  it('asks the current decider, with the step, and nobody holding only oversight or no code', async () => {
    const request = await submitted();
    // The one current Kepala holds the code; someone with only request:read
    // (no position, no code) is asked nothing — 32 covers the position holder.
    const holderWithoutCode = await person(['request:read']);
    const overseerWithCode = await person([...OVERSEER, ...APPROVER]);

    const row = (await get('/requests?awaiting=me', cast.kepala)).body.data;
    expect(row.map((entry) => entry.id)).toEqual([request.id]);
    expect(row[0].actionsNeeded).toEqual([{ kind: 'DECIDE', stepId: request.steps[0].id }]);
    expect(await needs(holderWithoutCode)).toEqual({});
    expect(await needs(overseerWithCode)).toEqual({});
    expect(await needs(cast.sarpras)).toEqual({});
    await assertConsistent(cast.kepala);
    await assertConsistent(overseerWithCode);
  });

  it('asks the procurer and the registrar once approved, each until their step is done', async () => {
    const request = await approved({ quantities: [1] });
    const procure = request.steps.find((step) => step.stepType === 'PROCURE');
    const registerStep = request.steps.find((step) => step.stepType === 'REGISTER');

    expect(await needs(cast.kepala)).toEqual({});
    expect(await needs(cast.sarpras)).toEqual({ [request.id]: ['PROCURE'] });
    expect(await needs(cast.registrar)).toEqual({ [request.id]: ['REGISTER'] });
    expect((await get(`/requests/${request.id}`, cast.registrar)).body.data.actionsNeeded).toEqual([
      { kind: 'REGISTER', stepId: registerStep.id },
    ]);

    await post(`/request-steps/${procure.id}/complete`, {}, cast.sarpras);
    expect(await needs(cast.sarpras)).toEqual({});

    await register(request.items[0].id, 1);
    expect(await needs(cast.registrar)).toEqual({});
    await assertConsistent(cast.sarpras);
    await assertConsistent(cast.registrar);
  });
});

describe('RECEIVE (P5)', () => {
  it('asks the requester while a registered unit can be received, and no longer once it is', async () => {
    const request = await approved({ quantities: [2] });
    expect(await needs(cast.teacher)).toEqual({});

    const [a, b] = await register(request.items[0].id, 2);
    expect(await needs(cast.teacher)).toEqual({ [request.id]: ['RECEIVE'] });
    await assertConsistent(cast.teacher);

    expect((await receive(request.id, { assetUnitIds: [a] })).status).toBe(200);
    expect(await needs(cast.teacher)).toEqual({ [request.id]: ['RECEIVE'] });

    expect((await receive(request.id, { assetUnitIds: [b] })).status).toBe(200);
    expect(await needs(cast.teacher)).toEqual({});
    await assertConsistent(cast.teacher);
  });

  it('is not asked of an overseer holding request:receive, nor of a requester without it', async () => {
    const withoutReceive = await person(
      REQUESTER.filter((code) => code !== 'request:receive'),
      ['COMMON_TEACHER']
    );
    const request = await approved({ quantities: [1] });
    await register(request.items[0].id, 1);
    expect(await needs(cast.overseer)).toEqual({});

    const theirs = await draft({ teacher: withoutReceive, quantities: [1] });
    await post(`/requests/${theirs.id}/submit`, {}, withoutReceive);
    const submittedTheirs = (await get(`/requests/${theirs.id}`, admin)).body.data;
    await post(
      `/request-steps/${submittedTheirs.steps[0].id}/decide`,
      { decision: 'APPROVE' },
      cast.kepala
    );
    await register(submittedTheirs.items[0].id, 1);
    expect(await needs(withoutReceive)).toEqual({});
  });

  it('is not asked when the only unreceived unit can no longer be received', async () => {
    const request = await approved({ quantities: [1] });
    const [unit] = await register(request.items[0].id, 1);
    await dispose(unit);
    expect(await needs(cast.teacher)).toEqual({});
  });
});

describe('CLOSE — only a stranded remainder (P5)', () => {
  it('is not asked for an unregistered remainder alone', async () => {
    const request = await approved({ quantities: [2] });
    await register(request.items[0].id, 1);
    expect(await needs(cast.overseer)).toEqual({});
    // Closing is possible — it is simply not needed.
    expect((await get(`/requests/${request.id}`, cast.overseer)).body.data.actions.close).toBe(
      true
    );
    await assertConsistent(cast.overseer);
  });

  it('is asked once a registered, unreceived unit can no longer be received, until closed', async () => {
    const request = await approved({ quantities: [2] });
    const [a] = await register(request.items[0].id, 2);
    expect(await needs(cast.overseer)).toEqual({});

    await dispose(a);
    expect(await needs(cast.overseer)).toEqual({ [request.id]: ['CLOSE'] });
    // The requester still has the other unit to receive; closing is not theirs.
    expect(await needs(cast.teacher)).toEqual({ [request.id]: ['RECEIVE'] });
    await assertConsistent(cast.overseer);
    await assertConsistent(cast.teacher);

    const closed = await post(`/requests/${request.id}/close`, { reason: 'Rusak' }, cast.overseer);
    expect(closed.status).toBe(200);
    expect(await needs(cast.overseer)).toEqual({});
    await assertConsistent(cast.overseer);
  });

  it('is not asked for a unit disposed after it was received, nor without request:close', async () => {
    const withoutClose = await person(OVERSEER.filter((code) => code !== 'request:close'));
    const request = await approved({ quantities: [2] });
    const [a, b] = await register(request.items[0].id, 2);
    await receive(request.id, { assetUnitIds: [a] });
    await dispose(a);
    expect(await needs(cast.overseer)).toEqual({});

    await dispose(b);
    expect(await needs(cast.overseer)).toEqual({ [request.id]: ['CLOSE'] });
    expect(await needs(withoutClose)).toEqual({});
  });
});

describe('the list (P5)', () => {
  it('counts the requests needing action, and carries actionsNeeded on every list', async () => {
    await draft();
    const request = await approved({ quantities: [1] });
    await register(request.items[0].id, 1);

    const awaiting = await get('/requests?awaiting=me&pageSize=1', cast.teacher);
    expect(awaiting.body.meta.total).toBe(2);

    const mine = (await get('/requests?mine=true', cast.teacher)).body.data;
    expect(mine.map((row) => row.actionsNeeded.map((entry) => entry.kind)).sort()).toEqual([
      ['RECEIVE'],
      ['SUBMIT'],
    ]);
  });

  it('offers none of the possible-but-not-needed actions', async () => {
    const request = await approved({ quantities: [2] });
    const [unit] = await register(request.items[0].id, 1);
    await receive(request.id, { assetUnitIds: [unit] });

    // The overseer may change the destination, reverse the receipt and close
    // the unregistered remainder; none of it is needed.
    const detail = (await get(`/requests/${request.id}`, cast.overseer)).body.data;
    expect(detail.actions.changeDestination).toBe(true);
    expect(detail.actions.close).toBe(true);
    expect(detail.actionsNeeded).toEqual([]);
    expect(await needs(cast.overseer)).toEqual({});
  });

  it('refuses a PIC-scoped caller, as before', async () => {
    const pic = await createCaller({
      permissions: ['request:read'],
      institutionId: alpha.id,
      isPicScoped: true,
    });
    expect((await get('/requests?awaiting=me', pic)).status).toBe(403);
  });
});
