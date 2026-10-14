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
import { cycleDatabaseUrl, migrate, query, runCli, seed } from './helpers/db.js';

const require = createRequire(import.meta.url);
const { PIC_ALLOWED_PERMISSIONS } = require('../../src/auth/permissionCatalog.js');
const { businessDate } = require('../../src/domain/requestFulfilmentRules.js');
const storage = require('../../src/services/storage.js');

/**
 * Receipt, reversal and closing the remainder — Phase 41 (`CR-014` §5.5, §7.4),
 * REQ-REQUEST-011 – REQ-REQUEST-013, BR-031; `IMPLEMENTATION_PLAN.md` §60.
 *
 *   SCHEMA     migration 055: receipts (append-only, one active per link) and
 *              close events.
 *   RECEIVE    the requester only; per unit; all or nothing; received_on bounds;
 *              blocked units refused; nothing moves.
 *   REVERSE    oversight + code, never the recorder, only before the end; the
 *              row is kept.
 *   CLOSE      cancelled′ = requested − received − pending; D41-3, D41-4, D41-8;
 *              one close event per close; the first reason kept.
 *   STATUS     follows received only.
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
  'request:oversee',
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
let beta;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  // Migration 057: every receipt stores a confirmation photo, and the storage
  // directory is shared with the development API — leave no files behind.
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
const del = (url, caller) => call('delete', url, undefined, caller);

async function person(permissions, positions = [], { institution = alpha, picScoped } = {}) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: institution.id,
    ...(picScoped ? { isPicScoped: true } : {}),
  });
  for (const [position] of positions) {
    await models.PositionAssignment.create({
      institutionId: institution.id,
      userId: caller.user.id,
      positionCode: position,
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

/** An APPROVED request with `quantities` items, and its cast. */
async function approved({ quantities = [2], perms = {} } = {}) {
  await workflow(FLOW);
  const teacher = await person(perms.teacher ?? REQUESTER, [['COMMON_TEACHER']]);
  const kepala = await person(APPROVER, [['KEPALA_SEKOLAH']]);
  const sarpras = await person(PROCURER, [['WAKASEK_SARPRAS']]);
  const registrar = await person(perms.registrar ?? REGISTRAR, [['WAKASEK_KESISWAAN']]);
  const overseer = await person(perms.overseer ?? OVERSEER);

  const created = await post(
    '/requests',
    { requesterAssignmentId: teacher.assignment.id, category: 'COMMON', title: 'Kursi' },
    teacher
  );
  for (const [index, quantity] of quantities.entries()) {
    await post(
      `/requests/${created.body.data.id}/items`,
      { description: `Barang ${index + 1}`, quantityRequested: quantity },
      teacher
    );
  }
  const submitted = (await post(`/requests/${created.body.data.id}/submit`, {}, teacher)).body.data;
  const decided = await post(
    `/request-steps/${submitted.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    kepala
  );
  expect(decided.body.data.status).toBe('APPROVED');
  return { teacher, kepala, sarpras, registrar, overseer, request: decided.body.data };
}

/** Registers `count` new units against an item; returns their ids. */
async function registered(itemId, count, registrar) {
  const response = await post(
    `/request-items/${itemId}/register`,
    { name: 'Kursi lipat', classificationId: LEAF, unitCount: count },
    registrar
  );
  expect(response.status).toBe(201);
  return response.body.data.units.map((unit) => unit.id);
}

const today = () => businessDate();
/** A minimal PNG signature — the storage checks type and extension, not pixels. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const receivedRequests = new Set();
/**
 * Migration 057: multipart, with the receipt confirmation — a description and
 * one photo by default. These requests have no destination, so no placement.
 */
function receive(requestId, body, caller) {
  receivedRequests.add(requestId);
  const fields = { receivedOn: today(), description: 'Diterima', ...body };
  const pending = api()
    .post(`${V1}/requests/${requestId}/receive`)
    .set(...caller.auth);
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of [value].flat()) pending.field(key, String(entry));
  }
  return pending.attach('photos', PNG, { filename: 'bukti.png', contentType: 'image/png' });
}
const closeRequest = (requestId, caller, reason = 'Sisa tidak diadakan') =>
  post(`/requests/${requestId}/close`, { reason }, caller);
const detail = async (requestId, caller = admin) =>
  (await get(`/requests/${requestId}`, caller)).body.data;
const stepOf = (request, type) => request.steps.find((step) => step.stepType === type);
const activeReceiptOf = (unitId) =>
  models.RequestItemUnitReceipt.findOne({
    where: { reversedAt: null },
    include: [{ association: 'link', where: { assetUnitId: unitId }, required: true }],
  });
const dispose = (unitId) =>
  models.AssetUnit.update({ lifecycleState: 'DISPOSED' }, { where: { id: unitId } });

// ---------------------------------------------------------------------------

describe('the schema (migration 055)', () => {
  it('creates the two tables with the approved columns', async () => {
    const columns = async (table) =>
      (
        await query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          [table]
        )
      ).map((row) => row.column_name);

    expect(await columns('request_item_unit_receipts')).toEqual([
      'id',
      'request_item_unit_id',
      'received_on',
      'recorded_at',
      'recorded_by',
      'note',
      'reversed_at',
      'reversed_by',
      'reversal_reason',
      // Migration 057.
      'receipt_confirmation_id',
    ]);
    expect(await columns('request_close_events')).toEqual([
      'id',
      'request_id',
      'reason',
      'closed_at',
      'closed_by',
    ]);
  });

  it('allows one active receipt per link, and a reversal only as a whole', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [1] });
    const [unitId] = await registered(request.items[0].id, 1, registrar);
    const linkRow = await models.RequestItemUnit.findOne({ where: { assetUnitId: unitId } });
    const insert = (extra = '') =>
      query(
        `INSERT INTO public.request_item_unit_receipts
           (request_item_unit_id, received_on, recorded_by${extra ? ', ' + extra.split('|')[0] : ''})
         VALUES ($1, CURRENT_DATE, $2${extra ? ', ' + extra.split('|')[1] : ''})`,
        [linkRow.id, teacher.user.id]
      );

    await insert();
    await expect(insert()).rejects.toThrow(/uq_riu_receipts_active/);
    await expect(insert('reversed_at|now()')).rejects.toThrow(/chk_riu_receipts_reversal/);
    await expect(
      query(
        `INSERT INTO public.request_close_events (request_id, reason, closed_by) VALUES ($1, '  ', $2)`,
        [request.id, teacher.user.id]
      )
    ).rejects.toThrow(/chk_request_close_events_reason/);
  });
});

describe('receive (REQ-REQUEST-011)', () => {
  it('records per unit; the request becomes PARTIALLY_FULFILLED, then FULFILLED', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [2] });
    const [a, b] = await registered(request.items[0].id, 2, registrar);

    const first = await receive(request.id, { assetUnitIds: [a] }, teacher);
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('PARTIALLY_FULFILLED');
    expect(first.body.data.items[0]).toMatchObject({
      quantityRegistered: 2,
      quantityReceived: 1,
      quantityPending: 1,
      quantityNotYetReceived: 1,
    });
    const receipt = await activeReceiptOf(a);
    expect(receipt).toMatchObject({
      receivedOn: today(),
      recordedBy: teacher.user.id,
      // Migration 057: the description is the confirmation's; note stays empty.
      note: null,
    });
    expect(receipt.receiptConfirmationId).not.toBeNull();

    const second = await receive(request.id, { assetUnitIds: [b] }, teacher);
    expect(second.body.data.status).toBe('FULFILLED');
    expect(second.body.data.closedAt).not.toBeNull();
    // D41-4: the undeclared PROCURE is closed, never DONE; REGISTER stays DONE.
    expect(stepOf(second.body.data, 'PROCURE').state).toBe('CLOSED');
    expect(stepOf(second.body.data, 'REGISTER').state).toBe('DONE');
  });

  it('never moves a unit or changes its lifecycle', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [1] });
    const [unitId] = await registered(request.items[0].id, 1, registrar);
    const before = await models.AssetUnit.findByPk(unitId, { raw: true });

    await receive(request.id, { assetUnitIds: [unitId] }, teacher);

    const after = await models.AssetUnit.findByPk(unitId, { raw: true });
    expect(after).toMatchObject({
      lifecycleState: before.lifecycleState,
      currentLocationId: before.currentLocationId,
      isActive: before.isActive,
    });
    expect(await models.LongitudinalHistory.count({ where: { assetUnitId: unitId } })).toBe(0);
  });

  it('receives every pending unit with all: true, skipping blocked ones (O8)', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [3] });
    const [a, , c] = await registered(request.items[0].id, 3, registrar);
    await dispose(c);

    const response = await receive(request.id, { all: true }, teacher);
    expect(response.body.data.items[0]).toMatchObject({
      quantityReceived: 2,
      quantityBlocked: 1,
      quantityCancellableBlocked: 1,
    });
    expect(await activeReceiptOf(a)).not.toBeNull();
    expect(await activeReceiptOf(c)).toBeNull();

    expect((await receive(request.id, { all: true }, teacher)).status).toBe(409);
  });

  it('is all or nothing, naming every offending unit', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [3] });
    const [a, b, c] = await registered(request.items[0].id, 3, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    await dispose(c);

    const response = await receive(request.id, { assetUnitIds: [a, b, c] }, teacher);

    expect(response.status).toBe(409);
    expect(response.body.error.details.map((d) => d.issue).join(' ')).toMatch(
      /receipt already recorded.*DISPOSED/
    );
    expect(await activeReceiptOf(b)).toBeNull();
  });

  it.each([
    ['inactive', { isActive: false }],
    ['DEACTIVATED', { lifecycleState: 'DEACTIVATED' }],
  ])('refuses a %s unit (D41-1 b)', async (_label, change) => {
    const { teacher, registrar, request } = await approved({ quantities: [1] });
    const [unitId] = await registered(request.items[0].id, 1, registrar);
    await models.AssetUnit.update(change, { where: { id: unitId } });

    expect((await receive(request.id, { assetUnitIds: [unitId] }, teacher)).status).toBe(409);
  });

  it('refuses a unit not registered against the request, and a unit named twice', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [1] });
    const [unitId] = await registered(request.items[0].id, 1, registrar);
    const stranger = '00000000-0000-4000-8000-000000000000';

    expect((await receive(request.id, { assetUnitIds: [stranger] }, teacher)).status).toBe(409);
    expect((await receive(request.id, { assetUnitIds: [unitId, unitId] }, teacher)).status).toBe(
      400
    );
  });

  it('bounds received_on by business dates: not future, not before the request (Q2b)', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [1] });
    const [unitId] = await registered(request.items[0].id, 1, registrar);
    const shift = (days) => {
      const d = new Date(`${today()}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    const future = await receive(
      request.id,
      { assetUnitIds: [unitId], receivedOn: shift(1) },
      teacher
    );
    expect(future.status).toBe(400);
    expect(future.body.error.details[0].field).toBe('receivedOn');
    const early = await receive(
      request.id,
      { assetUnitIds: [unitId], receivedOn: shift(-1) },
      teacher
    );
    expect(early.status).toBe(400);

    // A request created two days ago accepts yesterday.
    await models.Request.update(
      { createdAt: new Date(Date.now() - 2 * 86400000) },
      { where: { id: request.id }, silent: true }
    );
    expect(
      (await receive(request.id, { assetUnitIds: [unitId], receivedOn: shift(-1) }, teacher)).status
    ).toBe(200);
  });

  it('is the requester’s only — oversight never substitutes (Q2a)', async () => {
    const { overseer, registrar, request } = await approved({ quantities: [1] });
    const [unitId] = await registered(request.items[0].id, 1, registrar);
    const registrarWithCode = await person([...REGISTRAR, 'request:receive']);

    const byOverseer = await receive(request.id, { assetUnitIds: [unitId] }, overseer);
    expect(byOverseer.status).toBe(403);
    expect(byOverseer.body.error.code).toBe('FORBIDDEN');
    // Holds the code but cannot see the request.
    expect((await receive(request.id, { all: true }, registrarWithCode)).status).toBe(404);
    expect(await activeReceiptOf(unitId)).toBeNull();
  });

  it('requires request:receive, and refuses PIC-scoped and foreign callers', async () => {
    const { teacher, registrar, request } = await approved({
      quantities: [1],
      perms: { teacher: REQUESTER.filter((code) => code !== 'request:receive') },
    });
    await registered(request.items[0].id, 1, registrar);
    const pic = await person(OVERSEER, [], { picScoped: true });
    const foreign = await person(OVERSEER, [], { institution: beta });

    expect((await receive(request.id, { all: true }, teacher)).status).toBe(403);
    expect((await receive(request.id, { all: true }, pic)).status).toBe(403);
    expect((await receive(request.id, { all: true }, foreign)).status).toBe(404);
  });

  it('refuses receipt before approval (409)', async () => {
    await workflow(FLOW);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const created = await post(
      '/requests',
      { requesterAssignmentId: teacher.assignment.id, category: 'COMMON', title: 'X' },
      teacher
    );
    expect((await receive(created.body.data.id, { all: true }, teacher)).status).toBe(409);
  });

  it('is never written by registration or by the acquisition declaration (BR-031)', async () => {
    const { registrar, sarpras, request } = await approved({ quantities: [1] });
    await registered(request.items[0].id, 1, registrar);
    await post(`/request-steps/${stepOf(request, 'PROCURE').id}/complete`, {}, sarpras);

    expect(await models.RequestItemUnitReceipt.count()).toBe(0);
    expect((await detail(request.id)).status).toBe('APPROVED');
  });

  it('keeps a receipt after the unit is later disposed (D41-7)', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [2] });
    const [a] = await registered(request.items[0].id, 2, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    await dispose(a);

    const after = await detail(request.id);
    expect(after.items[0].quantityReceived).toBe(1);
    expect(after.status).toBe('PARTIALLY_FULFILLED');
  });
});

describe('reverse (Q2c)', () => {
  it('keeps the row, marks it reversed, recomputes the status, and allows a new receipt', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [2] });
    const [a] = await registered(request.items[0].id, 2, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    const receipt = await activeReceiptOf(a);

    const reversed = await post(
      `/request-receipts/${receipt.id}/reverse`,
      { reason: 'Salah unit' },
      overseer
    );
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.status).toBe('APPROVED');
    const row = await models.RequestItemUnitReceipt.findByPk(receipt.id);
    expect(row).toMatchObject({ reversedBy: overseer.user.id, reversalReason: 'Salah unit' });
    expect(row.reversedAt).not.toBeNull();

    expect((await receive(request.id, { assetUnitIds: [a] }, teacher)).status).toBe(200);
    expect(
      await models.RequestItemUnitReceipt.count({
        where: { requestItemUnitId: receipt.requestItemUnitId },
      })
    ).toBe(2);
  });

  it('never lets the recorder reverse their own receipt, even with oversight', async () => {
    const { teacher, registrar, request } = await approved({
      quantities: [2],
      perms: { teacher: [...REQUESTER, 'request:oversee', 'request-receipt:reverse'] },
    });
    const [a] = await registered(request.items[0].id, 2, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    const receipt = await activeReceiptOf(a);

    const response = await post(
      `/request-receipts/${receipt.id}/reverse`,
      { reason: 'X' },
      teacher
    );
    expect(response.status).toBe(403);
    expect((await models.RequestItemUnitReceipt.findByPk(receipt.id)).reversedAt).toBeNull();
  });

  it('needs request-receipt:reverse AND request:oversee', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [2] });
    const [a] = await registered(request.items[0].id, 2, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    const receipt = await activeReceiptOf(a);
    const codeOnly = await person(['request:read', 'request-receipt:reverse']);
    const overseeOnly = await person(['request:read', 'request:oversee']);

    // codeOnly cannot see the request at all.
    expect(
      (await post(`/request-receipts/${receipt.id}/reverse`, { reason: 'X' }, codeOnly)).status
    ).toBe(404);
    expect(
      (await post(`/request-receipts/${receipt.id}/reverse`, { reason: 'X' }, overseeOnly)).status
    ).toBe(403);
  });

  it('refuses a reversed receipt, a missing reason, and an ended request', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [1] });
    const [a] = await registered(request.items[0].id, 1, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    const receipt = await activeReceiptOf(a);

    expect((await detail(request.id)).status).toBe('FULFILLED');
    expect(
      (await post(`/request-receipts/${receipt.id}/reverse`, { reason: 'X' }, overseer)).status
    ).toBe(409);
    expect((await post(`/request-receipts/${receipt.id}/reverse`, {}, overseer)).status).toBe(400);
  });

  it('refuses reversing twice', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [2] });
    const [a] = await registered(request.items[0].id, 2, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    const receipt = await activeReceiptOf(a);
    await post(`/request-receipts/${receipt.id}/reverse`, { reason: 'X' }, overseer);

    expect(
      (await post(`/request-receipts/${receipt.id}/reverse`, { reason: 'Y' }, overseer)).status
    ).toBe(409);
  });

  it('never reopens a step', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [2] });
    const [a] = await registered(request.items[0].id, 2, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    const receipt = await activeReceiptOf(a);
    const reversed = await post(
      `/request-receipts/${receipt.id}/reverse`,
      { reason: 'X' },
      overseer
    );

    expect(stepOf(reversed.body.data, 'REGISTER').state).toBe('DONE');
    expect(stepOf(reversed.body.data, 'PROCURE').state).toBe('ACTIVE');
  });
});

describe('close the remainder (REQ-REQUEST-013)', () => {
  it('cancels a blocked unit: 5 requested, 5 registered, 4 received → CLOSED', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [5] });
    const units = await registered(request.items[0].id, 5, registrar);
    await receive(request.id, { assetUnitIds: units.slice(0, 4) }, teacher);
    await dispose(units[4]);

    const closed = await closeRequest(request.id, overseer, 'Unit rusak');

    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('CLOSED');
    expect(closed.body.data.items[0]).toMatchObject({
      quantityCancelled: 1,
      quantityRequired: 4,
      quantityReceived: 4,
      quantityRegistered: 5,
    });
    expect(closed.body.data.closeReason).toBe('Unit rusak');
    expect(closed.body.data.closedAt).not.toBeNull();
    expect(closed.body.data.closeEvents).toHaveLength(1);
    expect(stepOf(closed.body.data, 'PROCURE').state).toBe('CLOSED');
    expect(stepOf(closed.body.data, 'REGISTER').state).toBe('DONE');
  });

  it('keeps pending units: 10 requested, 6 registered, 4 received → open, then CLOSED', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [10] });
    const units = await registered(request.items[0].id, 6, registrar);
    await receive(request.id, { assetUnitIds: units.slice(0, 4) }, teacher);

    const closed = await closeRequest(request.id, overseer);
    expect(closed.body.data.status).toBe('PARTIALLY_FULFILLED');
    expect(closed.body.data.items[0]).toMatchObject({
      quantityCancelled: 4,
      quantityRequired: 6,
      quantityPending: 2,
    });
    // D41-3: nothing remains to register — CLOSED, never DONE.
    expect(stepOf(closed.body.data, 'REGISTER').state).toBe('CLOSED');
    expect(closed.body.data.closedAt).toBeNull();

    const done = await receive(request.id, { assetUnitIds: units.slice(4) }, teacher);
    expect(done.body.data.status).toBe('CLOSED');
    expect(done.body.data.closedAt).not.toBeNull();
  });

  it('cancels everything before any registration → CANCELLED', async () => {
    const { overseer, request } = await approved({ quantities: [2, 1] });

    const closed = await closeRequest(request.id, overseer);

    expect(closed.body.data.status).toBe('CANCELLED');
    expect(closed.body.data.items.map((item) => item.quantityCancelled)).toEqual([2, 1]);
    expect(closed.body.data.steps.map((step) => step.state)).toEqual([
      'APPROVED',
      'CLOSED',
      'CLOSED',
    ]);
  });

  it('refuses a close that would cancel nothing (D41-8), writing no event', async () => {
    const { overseer, registrar, request } = await approved({ quantities: [2] });
    await registered(request.items[0].id, 2, registrar);

    const refused = await closeRequest(request.id, overseer);

    expect(refused.status).toBe(409);
    expect(await models.RequestCloseEvent.count()).toBe(0);
    expect((await models.RequestItem.findByPk(request.items[0].id)).quantityCancelled).toBe(0);
  });

  it('closes again after a pending unit is disposed; the first reason stays', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [4] });
    const units = await registered(request.items[0].id, 3, registrar);
    await receive(request.id, { assetUnitIds: [units[0]] }, teacher);
    await closeRequest(request.id, overseer, 'Pertama');
    await dispose(units[2]);

    const second = await closeRequest(request.id, overseer, 'Kedua');

    expect(second.status).toBe(200);
    expect(second.body.data.items[0]).toMatchObject({ quantityCancelled: 2, quantityRequired: 2 });
    expect(second.body.data.closeReason).toBe('Pertama');
    expect(second.body.data.closeEvents.map((event) => event.reason)).toEqual(['Pertama', 'Kedua']);
  });

  it('then refuses registering more — REGISTER is CLOSED', async () => {
    const { overseer, registrar, request } = await approved({
      quantities: [3],
      perms: { overseer: [...OVERSEER, ...REGISTRAR] },
    });
    await registered(request.items[0].id, 1, registrar);
    await closeRequest(request.id, overseer);
    const body = { name: 'X', classificationId: LEAF, unitCount: 1 };

    // A caller who still sees the request meets the CLOSED step (409).
    expect(
      (await post(`/request-items/${request.items[0].id}/register`, body, overseer)).status
    ).toBe(409);
    // The registrar no longer resolves as an ACTIVE step's actor and never
    // completed the step, so the request is no longer theirs to see (D6).
    expect(
      (await post(`/request-items/${request.items[0].id}/register`, body, registrar)).status
    ).toBe(404);
  });

  it('needs request:close and visibility — no actor rule (D41-2)', async () => {
    const { teacher, request } = await approved({
      quantities: [1],
      perms: { teacher: [...REQUESTER, 'request:close'] },
    });
    const outsider = await person(['request:read', 'request:close']);
    const noCode = await person(['request:read', 'request:oversee']);

    expect((await closeRequest(request.id, outsider)).status).toBe(404);
    expect((await closeRequest(request.id, noCode)).status).toBe(403);
    // The requester holding the code may close their own.
    expect((await closeRequest(request.id, teacher)).status).toBe(200);
  });

  it('requires a reason, and refuses PIC-scoped callers', async () => {
    const { overseer, request } = await approved({ quantities: [1] });
    const pic = await person(OVERSEER, [], { picScoped: true });

    expect((await post(`/requests/${request.id}/close`, {}, overseer)).status).toBe(400);
    expect((await closeRequest(request.id, pic)).status).toBe(403);
  });
});

describe('links, reads and the list', () => {
  it('refuses to unlink a unit whose receipt is recorded', async () => {
    const { teacher, registrar, request } = await approved({ quantities: [3] });
    const [a] = await registered(request.items[0].id, 1, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    const linkRow = await models.RequestItemUnit.findOne({ where: { assetUnitId: a } });

    // REGISTER is still ACTIVE (1 of 3); the receipt alone refuses the unlink.
    const refused = await del(`/request-item-units/${linkRow.id}`, registrar);
    expect(refused.status).toBe(409);
    expect(await models.RequestItemUnit.count({ where: { id: linkRow.id } })).toBe(1);
  });

  it('lists each link’s receipt, history, receivability and reversal flag per caller', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [3] });
    const [a, , c] = await registered(request.items[0].id, 3, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    await dispose(c);
    const url = `/request-items/${request.items[0].id}/units`;

    const asOverseer = (await get(url, overseer)).body.data;
    const byUnit = (rows, id) => rows.find((row) => row.assetUnit.id === id);
    expect(byUnit(asOverseer, a)).toMatchObject({ receivable: false, canReverse: true });
    expect(byUnit(asOverseer, a).receipt).toMatchObject({ recordedBy: { id: teacher.user.id } });
    expect(byUnit(asOverseer, a).receipts).toHaveLength(1);
    expect(byUnit(asOverseer, c)).toMatchObject({ receivable: false, receipt: null });

    const asTeacher = (await get(url, teacher)).body.data;
    expect(byUnit(asTeacher, a).canReverse).toBe(false);
  });

  it('shows received / required on the list, and the actions on the detail', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [2, 1] });
    const [a] = await registered(request.items[0].id, 2, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);

    const row = (await get('/requests', overseer)).body.data.find((r) => r.id === request.id);
    expect(row).toMatchObject({ quantityRequired: 3, quantityReceived: 1 });

    expect((await detail(request.id, teacher)).actions.receive).toBe(true);
    expect((await detail(request.id, overseer)).actions).toMatchObject({
      receive: false,
      close: true,
    });
  });
});

describe('audit and the ceiling', () => {
  it('records receipts, reversals, close events and status changes', async () => {
    const { teacher, overseer, registrar, request } = await approved({ quantities: [3] });
    const [a] = await registered(request.items[0].id, 2, registrar);
    await receive(request.id, { assetUnitIds: [a] }, teacher);
    const receipt = await activeReceiptOf(a);
    await post(`/request-receipts/${receipt.id}/reverse`, { reason: 'X' }, overseer);
    await closeRequest(request.id, overseer);

    const event = await models.RequestCloseEvent.findOne({ where: { requestId: request.id } });
    const actions = async (entityType, entityId) =>
      (
        await models.AuditLog.findAll({
          where: { entityType, entityId },
          order: [['timestamp', 'ASC']],
        })
      ).map((row) => row.action);
    expect(await actions('RequestItemUnitReceipt', receipt.id)).toEqual(['CREATE', 'UPDATE']);
    expect(await actions('RequestCloseEvent', event.id)).toEqual(['CREATE']);
    expect(
      await models.AuditLog.count({
        where: { entityType: 'Request', entityId: request.id, action: 'STATUS_CHANGE' },
      })
    ).toBeGreaterThan(0);
  });

  it('adds no Phase 41 code to the PIC ceiling', () => {
    expect(PIC_ALLOWED_PERMISSIONS.size).toBe(30);
    for (const code of ['request:receive', 'request:close', 'request-receipt:reverse']) {
      expect(PIC_ALLOWED_PERMISSIONS.has(code)).toBe(false);
    }
  });
});

/** Migration 055's `down()` refuses while history exists (cycle database). */
describe('rolling back migration 055', () => {
  const CYCLE = cycleDatabaseUrl();
  const NAME = '20260929010000-055-create-receipts-and-close-events.js';

  beforeAll(async () => {
    await migrate(CYCLE);
  });

  it('refuses while a close event exists, then rolls back and re-applies when empty', async () => {
    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('Cycle F', 'CYCLEF', 'Jl. F') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-fulfil', $1, 'Cycle', 'Fulfil', $2) RETURNING id`,
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
    await query(
      `INSERT INTO public.request_close_events (request_id, reason, closed_by) VALUES ($1, 'x', $2)`,
      [request.id, user.id],
      CYCLE
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', NAME], CYCLE)).rejects.toThrow(
        /Migration 055 rollback refused/
      );
    } finally {
      await query('DELETE FROM public.request_close_events', [], CYCLE);
      await query('DELETE FROM public.requests', [], CYCLE);
      await query('DELETE FROM public.position_assignments', [], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }

    // Migration 057: receipt confirmations reference requests, request documents
    // and receipts, so 057 comes off first (and is re-applied with the rest).
    // Migration 062: confirmation photos name receipts of 055 / 057 — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261005010000-062-add-receipt-unit-photos.js'],
      CYCLE
    );
    // Migration 058 (P6): request views reference requests — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261002010000-058-create-request-views.js'],
      CYCLE
    );
    await runCli(
      ['db:migrate:undo', '--name', '20261001010000-057-create-receipt-confirmations.js'],
      CYCLE
    );
    await runCli(['db:migrate:undo', '--name', NAME], CYCLE);
    const [gone] = await query(
      `SELECT to_regclass('public.request_item_unit_receipts') AS r,
              to_regclass('public.request_close_events') AS c`,
      [],
      CYCLE
    );
    expect(gone).toEqual({ r: null, c: null });
    await migrate(CYCLE);
    const [back] = await query(
      `SELECT to_regclass('public.request_close_events')::text AS c`,
      [],
      CYCLE
    );
    expect(back.c).toBe('request_close_events');
  });
});
