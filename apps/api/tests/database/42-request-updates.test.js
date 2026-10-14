import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  resetAssetCoreData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { cycleDatabaseUrl, migrate, query, runCli, seed } from './helpers/db.js';

const require = createRequire(import.meta.url);
const { businessDate } = require('../../src/domain/requestFulfilmentRules.js');
const storage = require('../../src/services/storage.js');

/**
 * Request Updates — P6 (`IMPLEMENTATION_PLAN.md` §64.6), REQ-REQUEST-017,
 * migration 058 (`request_views`).
 *
 *   INVOLVED    requester, current step actor, past step actor — and nobody
 *               merely able to see the request (oversight)
 *   EVENTS      decided, acquisition, registration completed, units registered,
 *               receipt recorded / reversed, document added (not confirmation
 *               photos), remainder closed, request ended; own events excluded
 *   UNSEEN      after the last view and the baseline; no backfill
 *   VIEW        marks one request for one user; reading the detail marks nothing
 *   SEPARATE    Action Needed and Updates are independent
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
  'request-document:read',
];
const APPROVER = ['request:read', 'request-step:decide', 'request-document:read'];
const PROCURER = ['request:read', 'request-step:complete', 'request-document:create'];
const REGISTRAR = [
  'request:read',
  'request-item:register',
  'request-item-unit:read',
  'request-item-unit:create',
  'request-item-unit:delete',
  'request-document:create',
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-1.4\n%âã\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

let alpha;
let cast;
const touchedRequests = new Set();

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
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
  for (const id of touchedRequests) {
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
const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

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

async function submitted({ quantities = [2] } = {}) {
  const created = await post(
    '/requests',
    { requesterAssignmentId: cast.teacher.assignment.id, category: 'COMMON', title: 'Kursi' },
    cast.teacher
  );
  touchedRequests.add(created.body.data.id);
  for (const [index, quantity] of quantities.entries()) {
    await post(
      `/requests/${created.body.data.id}/items`,
      { description: `Barang ${index + 1}`, quantityRequested: quantity },
      cast.teacher
    );
  }
  const response = await post(`/requests/${created.body.data.id}/submit`, {}, cast.teacher);
  expect(response.status).toBe(200);
  return response.body.data;
}

async function decide(request, decision = 'APPROVE') {
  const response = await post(
    `/request-steps/${request.steps[0].id}/decide`,
    { decision, ...(decision === 'REJECT' ? { comment: 'Tidak ada anggaran' } : {}) },
    cast.kepala
  );
  expect(response.status).toBe(200);
  return response.body.data;
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

function receive(requestId, body, caller = cast.teacher) {
  const fields = { receivedOn: businessDate(), description: 'Diterima', ...body };
  const pending = api()
    .post(`${V1}/requests/${requestId}/receive`)
    .set(...caller.auth);
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of [value].flat()) pending.field(key, String(entry));
  }
  return pending.attach('photos', PNG, { filename: 'bukti.png', contentType: 'image/png' });
}

function upload(requestId, caller, type = 'INVOICE') {
  return api()
    .post(`${V1}/requests/${requestId}/documents`)
    .set(...caller.auth)
    .field('documentType', type)
    .attach('file', PDF, { filename: 'faktur.pdf', contentType: 'application/pdf' });
}

const view = (requestId, caller) => post(`/requests/${requestId}/view`, {}, caller);
const attention = async (caller) => (await get('/requests/attention', caller)).body.data;
/** `updated=me`: request id → the unseen event kinds of its row. */
async function updated(caller) {
  const response = await get('/requests?updated=me&pageSize=100', caller);
  expect(response.status).toBe(200);
  return Object.fromEntries(
    response.body.data.map((row) => [row.id, row.updates.events.map((event) => event.kind)])
  );
}
const unseen = async (requestId, caller) =>
  (await get(`/requests/${requestId}`, caller)).body.data.unseenUpdates;
const kinds = (events) => events.map((event) => event.kind);

// ---------------------------------------------------------------------------

describe('the schema (migration 058)', () => {
  it('creates request_views with the composite key and no audit', async () => {
    const columns = await query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'request_views' ORDER BY ordinal_position`
    );
    expect(columns.map((column) => column.column_name)).toEqual([
      'user_id',
      'request_id',
      'last_seen_at',
    ]);
    const [pk] = await query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'pk_request_views'`
    );
    expect(pk.def).toBe('PRIMARY KEY (user_id, request_id)');
  });

  it('rolls back and re-applies cleanly', async () => {
    const CYCLE = cycleDatabaseUrl();
    await migrate(CYCLE);
    const NAME = '20261002010000-058-create-request-views.js';
    await runCli(['db:migrate:undo', '--name', NAME], CYCLE);
    const [gone] = await query(`SELECT to_regclass('public.request_views') AS relation`, [], CYCLE);
    expect(gone.relation).toBeNull();
    await migrate(CYCLE);
    const [back] = await query(`SELECT to_regclass('public.request_views') AS relation`, [], CYCLE);
    expect(back.relation).toBe('request_views');
  });
});

describe('who is told (P6)', () => {
  it('tells the requester of a decision, and not the decider of their own act', async () => {
    const request = await submitted();
    await decide(request);

    const events = (await unseen(request.id, cast.teacher)).events;
    expect(kinds(events)).toEqual(['STEP_DECIDED']);
    expect(events[0]).toMatchObject({
      detail: 'APPROVED',
      extra: 'KEPALA_SEKOLAH',
      count: 1,
      by: { id: cast.kepala.user.id },
    });
    expect(await updated(cast.teacher)).toEqual({ [request.id]: ['STEP_DECIDED'] });
    expect((await unseen(request.id, cast.kepala)).events).toEqual([]);
  });

  it('tells a current step actor, and a past one', async () => {
    const request = await decide(await submitted());
    await upload(request.id, cast.teacher, 'INVOICE');

    // The registrar is the current REGISTER actor; the Kepala acted on DECIDE.
    // The registrar also learns of the approval that opened their step.
    expect((await updated(cast.registrar))[request.id].sort()).toEqual([
      'DOCUMENT_ADDED',
      'STEP_DECIDED',
    ]);
    expect(await updated(cast.kepala)).toEqual({ [request.id]: ['DOCUMENT_ADDED'] });
    const [document] = (await unseen(request.id, cast.kepala)).events;
    expect(document).toMatchObject({ kind: 'DOCUMENT_ADDED', detail: 'INVOICE' });
  });

  it('tells no one merely able to see the request', async () => {
    const request = await decide(await submitted());
    await upload(request.id, cast.teacher);
    const bystander = await person(['request:read'], []);
    const adminOverseer = await person([...OVERSEER, 'request-document:read']);

    expect(await attention(cast.overseer)).toEqual({ actionNeeded: 0, updated: 0 });
    expect(await updated(adminOverseer)).toEqual({});
    expect((await unseen(request.id, adminOverseer)).events).toEqual([]);
    expect(await updated(bystander)).toEqual({});
    // The unit PIC-scoped caller stays refused altogether.
    const pic = await createCaller({
      permissions: ['request:read'],
      institutionId: alpha.id,
      isPicScoped: true,
    });
    expect((await get('/requests/attention', pic)).status).toBe(403);
    expect((await get('/requests?updated=me', pic)).status).toBe(403);
    expect((await view(request.id, pic)).status).toBe(403);
  });
});

describe('the events (P6)', () => {
  it('lists several events on one request, grouped, newest first', async () => {
    const request = await decide(await submitted({ quantities: [2] }));
    await pause();
    const procure = request.steps.find((step) => step.stepType === 'PROCURE');
    await post(`/request-steps/${procure.id}/complete`, {}, cast.sarpras);
    await pause();
    await register(request.items[0].id, 1);
    await register(request.items[0].id, 1);

    const events = (await unseen(request.id, cast.teacher)).events;
    // The last registration and the step it completes share one transaction,
    // so their order between themselves is not asserted.
    expect(kinds(events).slice(0, 2).sort()).toEqual([
      'REGISTRATION_COMPLETED',
      'UNITS_REGISTERED',
    ]);
    expect(kinds(events).slice(2)).toEqual(['ACQUISITION_DECLARED', 'STEP_DECIDED']);
    expect(events.find((event) => event.kind === 'UNITS_REGISTERED').count).toBe(2);
    // The list row carries the three newest and the total.
    const row = (await get('/requests?updated=me', cast.teacher)).body.data[0];
    expect(row.updates.total).toBe(4);
    expect(row.updates.events).toHaveLength(3);
    expect(kinds(row.updates.events)).not.toContain('STEP_DECIDED');
  });

  it('reports receipts recorded and reversed — the confirmation photo is not a document', async () => {
    // Three required, two received: the request stays open (no REQUEST_ENDED).
    const request = await decide(await submitted({ quantities: [3] }));
    const [a, b] = await register(request.items[0].id, 2);
    await view(request.id, cast.registrar);
    await pause();

    expect((await receive(request.id, { assetUnitIds: [a, b] })).status).toBe(200);
    const recorded = (await unseen(request.id, cast.registrar)).events;
    expect(kinds(recorded)).toEqual(['RECEIPT_RECORDED']);
    expect(recorded[0]).toMatchObject({ count: 2, by: { id: cast.teacher.user.id } });

    await view(request.id, cast.teacher);
    await pause();
    const receipt = await models.RequestItemUnitReceipt.findOne({
      where: { reversedAt: null },
      include: [{ association: 'link', where: { assetUnitId: a }, required: true }],
    });
    const reversed = await post(
      `/request-receipts/${receipt.id}/reverse`,
      { reason: 'Salah unit' },
      cast.overseer
    );
    expect(reversed.status).toBe(200);
    expect(kinds((await unseen(request.id, cast.teacher)).events)).toEqual(['RECEIPT_REVERSED']);
  });

  it('reports a closed remainder and the request ending', async () => {
    const request = await decide(await submitted({ quantities: [2] }));
    const [a, b] = await register(request.items[0].id, 2);
    await receive(request.id, { assetUnitIds: [b] });
    await view(request.id, cast.teacher);
    await pause();
    await models.AssetUnit.update({ lifecycleState: 'DISPOSED' }, { where: { id: a } });

    const closed = await post(`/requests/${request.id}/close`, { reason: 'Rusak' }, cast.overseer);
    expect(closed.body.data.status).toBe('CLOSED');
    const events = (await unseen(request.id, cast.teacher)).events;
    expect(kinds(events).sort()).toEqual(['REMAINDER_CLOSED', 'REQUEST_ENDED']);
    expect(events.find((event) => event.kind === 'REQUEST_ENDED').detail).toBe('CLOSED');
    expect(events.find((event) => event.kind === 'REMAINDER_CLOSED').extra).toBe('Rusak');
  });

  it('reports a rejection as a decision and the request ending', async () => {
    const request = await submitted();
    await decide(request, 'REJECT');
    const events = (await unseen(request.id, cast.teacher)).events;
    expect(kinds(events).sort()).toEqual(['REQUEST_ENDED', 'STEP_DECIDED']);
    expect(events.find((event) => event.kind === 'STEP_DECIDED').detail).toBe('REJECTED');
  });
});

describe('seen and unseen (P6)', () => {
  it('backfills nothing: activity before the baseline is never an update', async () => {
    const request = await decide(await submitted());
    await upload(request.id, cast.teacher);
    const old = '2020-01-01T00:00:00Z';
    await query('UPDATE public.request_steps SET completed_at = $1 WHERE request_id = $2', [
      old,
      request.id,
    ]);
    await query('UPDATE public.request_documents SET created_at = $1 WHERE request_id = $2', [
      old,
      request.id,
    ]);

    expect(await updated(cast.teacher)).toEqual({});
    expect(await updated(cast.kepala)).toEqual({});
    const since = (await unseen(request.id, cast.teacher)).since;
    expect(new Date(since).getTime()).toBeGreaterThan(new Date(old).getTime());
  });

  it('marks only that request, for only that user; reading the detail marks nothing', async () => {
    const first = await decide(await submitted());
    const second = await decide(await submitted());

    await get(`/requests/${first.id}`, cast.teacher);
    expect((await attention(cast.teacher)).updated).toBe(2);

    expect((await view(first.id, cast.teacher)).status).toBe(204);
    expect((await attention(cast.teacher)).updated).toBe(1);
    expect(Object.keys(await updated(cast.teacher))).toEqual([second.id]);

    // The Kepala's own decisions were never updates for them; a document by the
    // teacher is, on both — and the teacher's view marked nothing for them.
    await upload(first.id, cast.teacher);
    await upload(second.id, cast.teacher);
    expect((await attention(cast.kepala)).updated).toBe(2);

    const rows = await query('SELECT user_id, request_id FROM public.request_views');
    expect(rows).toEqual([{ user_id: cast.teacher.user.id, request_id: first.id }]);
  });

  it('shows what happens after the view again', async () => {
    const request = await decide(await submitted());
    await view(request.id, cast.teacher);
    expect(await updated(cast.teacher)).toEqual({});
    await pause();
    await upload(request.id, cast.registrar);
    expect(await updated(cast.teacher)).toEqual({ [request.id]: ['DOCUMENT_ADDED'] });
  });

  it('is not audited, and cannot mark a request the caller cannot see', async () => {
    const request = await decide(await submitted());
    const [{ count: before }] = await query('SELECT count(*)::int AS count FROM audit.audit_logs');
    await view(request.id, cast.teacher);
    const [{ count: after }] = await query('SELECT count(*)::int AS count FROM audit.audit_logs');
    expect(after).toBe(before);

    const stranger = await person(['request:read']);
    expect((await view(request.id, stranger)).status).toBe(404);
    const draft = await post(
      '/requests',
      { requesterAssignmentId: cast.teacher.assignment.id, category: 'COMMON', title: 'Draf' },
      cast.teacher
    );
    expect((await view(draft.body.data.id, cast.overseer)).status).toBe(404);
  });
});

describe('Action Needed and Updates stay independent (P6)', () => {
  it('can need action with nothing new, and be new with no action needed', async () => {
    const request = await submitted();
    // Submitting is not an update; deciding is the Kepala's action.
    expect(await attention(cast.kepala)).toEqual({ actionNeeded: 1, updated: 0 });
    expect(await attention(cast.teacher)).toEqual({ actionNeeded: 0, updated: 0 });

    await decide(request);
    // The teacher has an update and nothing to do; the Kepala neither.
    expect(await attention(cast.teacher)).toEqual({ actionNeeded: 0, updated: 1 });
    expect(await attention(cast.kepala)).toEqual({ actionNeeded: 0, updated: 0 });

    // Units arrive: the teacher now has both; viewing clears only the update.
    await register(request.items[0].id, 2);
    expect(await attention(cast.teacher)).toEqual({ actionNeeded: 1, updated: 1 });
    await view(request.id, cast.teacher);
    expect(await attention(cast.teacher)).toEqual({ actionNeeded: 1, updated: 0 });
    const row = (await get('/requests?mine=true', cast.teacher)).body.data[0];
    expect(row.actionsNeeded).toEqual([{ kind: 'RECEIVE' }]);
    expect(row.updates).toEqual({ total: 0, events: [] });
  });

  it('keeps the attention counts equal to the two lists', async () => {
    const one = await decide(await submitted());
    await submitted();
    await register(one.items[0].id, 1);

    for (const caller of [cast.teacher, cast.kepala, cast.registrar, cast.overseer]) {
      const counts = await attention(caller);
      const awaiting = await get('/requests?awaiting=me&pageSize=1', caller);
      const changed = await get('/requests?updated=me&pageSize=1', caller);
      expect(counts).toEqual({
        actionNeeded: awaiting.body.meta.total,
        updated: changed.body.meta.total,
      });
    }
  });
});
