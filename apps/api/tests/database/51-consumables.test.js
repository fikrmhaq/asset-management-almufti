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

/**
 * Consumables — quantity-based stock (`IMPLEMENTATION_PLAN.md` §73, migration 067).
 *
 *   MASTER     create / read / update / deactivate, institution-scoped; the unit
 *              is fixed once stock has moved; never an Asset
 *   STOCK      RECEIPT / ADJUSTMENT (with a reason); never below zero; one
 *              movement and one balance per change, atomically, under a lock
 *   REQUESTS   a request line may name a consumable — the EXISTING request,
 *              workflow, revision and resubmission; stock never moves on
 *              submission or approval; ISSUE against an approved line only, at
 *              most what it still needs and what stock holds; partial issue,
 *              close of the remainder; REGISTER is closed when nothing is an
 *              asset line
 *   AUTHZ      permissions, institution isolation, the PIC ceiling
 *   SCHEMA     the CHECKs and the guarded rollback of 067
 */

const V1 = '/api/v1';
const MIGRATION = '20261010010000-067-create-consumables.js';
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
];
const STOCK = [
  'consumable:read',
  'consumable:create',
  'consumable:update',
  'consumable:deactivate',
  'consumable:manage-stock',
];
const SARPRAS = [
  'request:read',
  'request:close',
  'request-step:decide',
  'request-step:complete',
  'request-item:register',
  'request-item-unit:read',
  'asset:create',
  'asset:read',
  'asset-unit:create',
  'asset-unit:read',
  ...STOCK,
];
const FLOW = [
  ['DECIDE', 'WAKASEK_SARPRAS'],
  ['PROCURE', 'WAKASEK_SARPRAS'],
  ['REGISTER', 'WAKASEK_SARPRAS'],
];

let alpha;
let beta;
let ream;
let pcs;
let cast;
let admin;

const call = (method, url, body, caller) => {
  const request = api()
    [method](`${V1}${url}`)
    .set(...caller.auth);
  return body === undefined ? request : request.send(body);
};
const get = (url, caller) => call('get', url, undefined, caller);
const post = (url, body, caller) => call('post', url, body ?? {}, caller);
const patch = (url, body, caller) => call('patch', url, body, caller);

async function person(permissions, positions = [], institution = alpha) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: institution.id,
  });
  const assignments = [];
  for (const positionCode of positions) {
    assignments.push(
      await models.PositionAssignment.create({
        institutionId: institution.id,
        userId: caller.user.id,
        positionCode,
      })
    );
  }
  return { ...caller, assignment: assignments[0] };
}

async function workflow(steps = FLOW, { version = 1, institution = alpha } = {}) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: institution.id,
    category: 'COMMON',
    requesterPositionCode: 'COMMON_TEACHER',
    version,
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
  return definition;
}

/** A consumable with `onHand` received, through the API. */
async function consumable(name = 'Kertas A4 80gsm', { onHand = 0, unit = ream, caller } = {}) {
  const created = await post(
    '/consumables',
    { name, measurementUnitId: unit.id },
    caller ?? cast.sarpras
  );
  expect(created.status).toBe(201);
  if (onHand > 0) {
    const received = await post(
      `/consumables/${created.body.data.id}/receipts`,
      { quantity: onHand },
      caller ?? cast.sarpras
    );
    expect(received.status).toBe(200);
  }
  return (await get(`/consumables/${created.body.data.id}`, caller ?? cast.sarpras)).body.data;
}

const onHand = async (id) => (await models.Consumable.findByPk(id)).quantityOnHand;
const movementsOf = (id) =>
  models.ConsumableStockMovement.findAll({
    where: { consumableId: id },
    order: [['createdAt', 'ASC']],
    raw: true,
  });
const sumOfMovements = async (id) =>
  (await movementsOf(id)).reduce((sum, movement) => sum + movement.quantity, 0);

async function draft(lines, requester = cast.teacher) {
  const created = await post(
    '/requests',
    { requesterAssignmentId: requester.assignment.id, category: 'COMMON', title: 'ATK kelas' },
    requester
  );
  expect(created.status).toBe(201);
  for (const line of lines) {
    const added = await post(`/requests/${created.body.data.id}/items`, line, requester);
    expect(added.status).toBe(201);
  }
  return created.body.data.id;
}

const detail = async (id, caller = cast.teacher) =>
  (await get(`/requests/${id}`, caller)).body.data;
const activeStep = (request) => request.steps.find((step) => step.state === 'ACTIVE');
const decide = (stepId, body, caller = cast.sarpras) =>
  post(`/request-steps/${stepId}/decide`, body, caller);
const approve = async (id) => {
  const request = await detail(id, cast.sarpras);
  const response = await decide(activeStep(request).id, { decision: 'APPROVE' });
  expect(response.status).toBe(200);
  return response.body.data;
};
const issue = (id, items, caller = cast.sarpras, extra = {}) =>
  post(`/requests/${id}/issue`, { items, ...extra }, caller);

/** An APPROVED request with one consumable line of `quantity`. */
async function approvedFor(item, quantity) {
  const id = await draft([{ consumableId: item.id, quantityRequested: quantity }]);
  expect((await post(`/requests/${id}/submit`, {}, cast.teacher)).status).toBe(200);
  await approve(id);
  return detail(id, cast.sarpras);
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
  [ream] = await models.MeasurementUnit.findOrCreate({ where: { name: 'rim' } });
  [pcs] = await models.MeasurementUnit.findOrCreate({ where: { name: 'pcs' } });
  cast = {
    teacher: await person(REQUESTER, ['COMMON_TEACHER']),
    sarpras: await person(SARPRAS, ['WAKASEK_SARPRAS']),
    reader: await person(['consumable:read']),
    nobody: await person([]),
    betaStock: await person(STOCK, [], beta),
  };
  await workflow();
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

// ---------------------------------------------------------------------------

describe('the consumable master', () => {
  it('creates, reads, lists and updates a consumable of the caller’s institution', async () => {
    const created = await post(
      '/consumables',
      { name: 'Kertas A4 80gsm', description: 'Sidu', measurementUnitId: ream.id },
      cast.sarpras
    );
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      institutionId: alpha.id,
      name: 'Kertas A4 80gsm',
      description: 'Sidu',
      measurementUnit: { id: ream.id, name: 'rim' },
      quantityOnHand: 0,
      isActive: true,
    });
    // Not an Asset: nothing of one.
    for (const field of ['inventoryCode', 'lifecycleState', 'currentCondition', 'units']) {
      expect(created.body.data).not.toHaveProperty(field);
    }

    const id = created.body.data.id;
    expect((await get(`/consumables/${id}`, cast.reader)).body.data.name).toBe('Kertas A4 80gsm');
    const listed = await get('/consumables?q=a4', cast.reader);
    expect(listed.body.data.map((row) => row.id)).toEqual([id]);

    const renamed = await patch(`/consumables/${id}`, { name: 'Kertas A4' }, cast.sarpras);
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Kertas A4');
  });

  it('refuses invalid input: no name, an unknown unit, a duplicate name, a balance', async () => {
    expect(
      (await post('/consumables', { name: ' ', measurementUnitId: ream.id }, cast.sarpras)).status
    ).toBe(400);
    expect(
      (
        await post(
          '/consumables',
          { name: 'Spidol', measurementUnitId: crypto.randomUUID() },
          cast.sarpras
        )
      ).status
    ).toBe(400);
    expect(
      (
        await post(
          '/consumables',
          { name: 'Spidol', measurementUnitId: pcs.id, quantityOnHand: 50 },
          cast.sarpras
        )
      ).status
    ).toBe(400);
    await consumable('Spidol', { unit: pcs });
    const duplicate = await post(
      '/consumables',
      { name: 'SPIDOL', measurementUnitId: pcs.id },
      cast.sarpras
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.details[0].field).toBe('name');
  });

  it('fixes the measurement unit once stock has moved', async () => {
    const fresh = await consumable('Spidol', { unit: pcs });
    expect(
      (await patch(`/consumables/${fresh.id}`, { measurementUnitId: ream.id }, cast.sarpras)).status
    ).toBe(200);

    const stocked = await consumable('Kertas', { onHand: 5 });
    const response = await patch(
      `/consumables/${stocked.id}`,
      { measurementUnitId: pcs.id },
      cast.sarpras
    );
    expect(response.status).toBe(409);
    expect((await models.Consumable.findByPk(stocked.id)).measurementUnitId).toBe(ream.id);
  });

  it('isolates institutions: another institution’s consumable does not exist', async () => {
    const own = await consumable();
    const theirs = await consumable('Kertas Beta', { caller: cast.betaStock });

    expect((await get(`/consumables/${theirs.id}`, cast.sarpras)).status).toBe(404);
    expect((await get(`/consumables/${own.id}`, cast.betaStock)).status).toBe(404);
    expect((await patch(`/consumables/${theirs.id}`, { name: 'X' }, cast.sarpras)).status).toBe(
      404
    );
    expect(
      (await post(`/consumables/${theirs.id}/receipts`, { quantity: 1 }, cast.sarpras)).status
    ).toBe(404);
    expect(
      (
        await post(
          `/consumables/${theirs.id}/adjustments`,
          { quantity: -1, reason: 'x' },
          cast.sarpras
        )
      ).status
    ).toBe(404);
    expect((await get('/consumables', cast.sarpras)).body.data.map((row) => row.id)).toEqual([
      own.id,
    ]);
    // A scoped caller cannot create one in another institution.
    expect(
      (
        await post(
          '/consumables',
          { name: 'Masuk Beta', measurementUnitId: ream.id, institutionId: beta.id },
          cast.sarpras
        )
      ).status
    ).toBe(400);
    expect(await onHand(theirs.id)).toBe(0);
  });

  it('needs the permission for each act', async () => {
    const item = await consumable();
    expect((await get('/consumables', cast.nobody)).status).toBe(403);
    expect(
      (await post('/consumables', { name: 'X', measurementUnitId: ream.id }, cast.reader)).status
    ).toBe(403);
    expect((await patch(`/consumables/${item.id}`, { name: 'Y' }, cast.reader)).status).toBe(403);
    expect((await post(`/consumables/${item.id}/deactivate`, {}, cast.reader)).status).toBe(403);
    expect(
      (await post(`/consumables/${item.id}/receipts`, { quantity: 1 }, cast.reader)).status
    ).toBe(403);
    expect(
      (await post(`/consumables/${item.id}/adjustments`, { quantity: 1, reason: 'x' }, cast.reader))
        .status
    ).toBe(403);
    expect(await onHand(item.id)).toBe(0);
  });

  it('a system administrator creates one only by naming an institution', async () => {
    expect(
      (await post('/consumables', { name: 'Kertas', measurementUnitId: ream.id }, admin)).status
    ).toBe(400);
    const created = await post(
      '/consumables',
      { name: 'Kertas', measurementUnitId: ream.id, institutionId: beta.id },
      admin
    );
    expect(created.status).toBe(201);
    expect(created.body.data.institutionId).toBe(beta.id);
  });
});

describe('stock', () => {
  it('receives stock: one RECEIPT movement, the balance it left, audited', async () => {
    const item = await consumable('Kertas A4', { onHand: 25 });
    const received = await post(
      `/consumables/${item.id}/receipts`,
      { quantity: 10, note: 'Pembelian toko' },
      cast.sarpras
    );
    expect(received.status).toBe(200);
    expect(received.body.data.quantityOnHand).toBe(35);

    const movements = await movementsOf(item.id);
    expect(movements.map((m) => [m.movementType, m.quantity, m.balanceAfter])).toEqual([
      ['RECEIPT', 25, 25],
      ['RECEIPT', 10, 35],
    ]);
    expect(movements[1]).toMatchObject({ note: 'Pembelian toko', createdBy: cast.sarpras.user.id });
    expect(await sumOfMovements(item.id)).toBe(35);

    const history = await get(`/consumables/${item.id}/movements`, cast.reader);
    expect(history.body.data[0]).toMatchObject({
      movementType: 'RECEIPT',
      quantity: 10,
      balanceAfter: 35,
      createdBy: { id: cast.sarpras.user.id },
    });

    const audit = await models.AuditLog.findAll({
      where: { entityType: 'ConsumableStockMovement', entityId: movements[1].id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'CREATE', actorId: cast.sarpras.user.id });
  });

  it('refuses a zero, negative or fractional receipt', async () => {
    const item = await consumable();
    for (const quantity of [0, -3, 1.5]) {
      expect(
        (await post(`/consumables/${item.id}/receipts`, { quantity }, cast.sarpras)).status
      ).toBe(400);
    }
    expect(await movementsOf(item.id)).toHaveLength(0);
  });

  it('adjusts with a reason, either way, never to below zero', async () => {
    const item = await consumable('Kertas', { onHand: 20 });

    const noReason = await post(
      `/consumables/${item.id}/adjustments`,
      { quantity: -2 },
      cast.sarpras
    );
    expect(noReason.status).toBe(400);
    expect(
      (
        await post(
          `/consumables/${item.id}/adjustments`,
          { quantity: 0, reason: 'x' },
          cast.sarpras
        )
      ).status
    ).toBe(400);

    const counted = await post(
      `/consumables/${item.id}/adjustments`,
      { quantity: -2, reason: 'Stock opname fisik' },
      cast.sarpras
    );
    expect(counted.status).toBe(200);
    expect(counted.body.data.quantityOnHand).toBe(18);

    const found = await post(
      `/consumables/${item.id}/adjustments`,
      { quantity: 1, reason: 'Ditemukan di lemari' },
      cast.sarpras
    );
    expect(found.body.data.quantityOnHand).toBe(19);

    const tooMuch = await post(
      `/consumables/${item.id}/adjustments`,
      { quantity: -20, reason: 'Hilang' },
      cast.sarpras
    );
    expect(tooMuch.status).toBe(409);
    expect(await onHand(item.id)).toBe(19);

    const adjustments = (await movementsOf(item.id)).filter((m) => m.movementType === 'ADJUSTMENT');
    expect(adjustments.map((m) => [m.quantity, m.balanceAfter, m.note])).toEqual([
      [-2, 18, 'Stock opname fisik'],
      [1, 19, 'Ditemukan di lemari'],
    ]);
    expect(await sumOfMovements(item.id)).toBe(19);
  });

  it('refuses any movement on an inactive consumable', async () => {
    const item = await consumable('Kertas', { onHand: 3 });
    expect((await post(`/consumables/${item.id}/deactivate`, {}, cast.sarpras)).status).toBe(200);

    expect(
      (await post(`/consumables/${item.id}/receipts`, { quantity: 1 }, cast.sarpras)).status
    ).toBe(409);
    expect((await post(`/consumables/${item.id}/reactivate`, {}, cast.sarpras)).status).toBe(200);
    expect(
      (await post(`/consumables/${item.id}/receipts`, { quantity: 1 }, cast.sarpras)).status
    ).toBe(200);
    expect(await onHand(item.id)).toBe(4);
  });

  it('serialises concurrent changes: two takers cannot share the same stock', async () => {
    const item = await consumable('Kertas', { onHand: 5 });
    const take = () =>
      post(`/consumables/${item.id}/adjustments`, { quantity: -4, reason: 'Rusak' }, cast.sarpras);

    const results = await Promise.all([take(), take()]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await onHand(item.id)).toBe(1);
    expect(await sumOfMovements(item.id)).toBe(1);
  });
});

describe('consumable lines on the existing request', () => {
  it('names a consumable: its name and unit, no classification; options carry no stock', async () => {
    const paper = await consumable('Kertas A4', { onHand: 25 });
    const options = await get('/consumables/options', cast.teacher);
    expect(options.status).toBe(200);
    expect(options.body.data).toEqual([
      {
        id: paper.id,
        institutionId: alpha.id,
        name: 'Kertas A4',
        measurementUnit: { id: ream.id, name: 'rim' },
      },
    ]);
    // A requester is not a stock reader.
    expect((await get('/consumables', cast.teacher)).status).toBe(403);

    const id = await draft([{ consumableId: paper.id, quantityRequested: 2 }]);
    const [line] = (await detail(id)).items;
    expect(line).toMatchObject({
      consumableId: paper.id,
      consumable: { id: paper.id, name: 'Kertas A4' },
      description: 'Kertas A4',
      measurementUnit: { id: ream.id, name: 'rim' },
      quantityRequested: 2,
      quantityIssued: 0,
      classificationId: null,
    });

    const classified = await post(
      `/requests/${id}/items`,
      { consumableId: paper.id, quantityRequested: 1, classificationId: LEAF },
      cast.teacher
    );
    expect(classified.status).toBe(400);
    const theirs = await consumable('Kertas Beta', { caller: cast.betaStock });
    const foreign = await post(
      `/requests/${id}/items`,
      { consumableId: theirs.id, quantityRequested: 1 },
      cast.teacher
    );
    expect(foreign.status).toBe(400);
    // An asset line still needs its description.
    expect(
      (await post(`/requests/${id}/items`, { quantityRequested: 1 }, cast.teacher)).status
    ).toBe(400);
  });

  it('runs the existing workflow; submission and approval leave stock untouched', async () => {
    const paper = await consumable('Kertas A4', { onHand: 25 });
    const id = await draft([{ consumableId: paper.id, quantityRequested: 10 }]);

    expect((await post(`/requests/${id}/submit`, {}, cast.teacher)).status).toBe(200);
    expect(await onHand(paper.id)).toBe(25);

    await approve(id);
    const approved = await detail(id, cast.sarpras);
    expect(approved.status).toBe('APPROVED');
    expect(await onHand(paper.id)).toBe(25);
    // Nothing to register: REGISTER closes; PROCURE is the workflow's own step.
    const states = Object.fromEntries(approved.steps.map((s) => [s.stepType, s.state]));
    expect(states).toMatchObject({ DECIDE: 'APPROVED', PROCURE: 'ACTIVE', REGISTER: 'CLOSED' });
    expect(approved.actions.issue).toBe(true);
    expect((await detail(id, cast.teacher)).actions.issue).toBe(false);
  });

  it('is revised through the existing revision: the quantity edited, resubmitted, cycle 2', async () => {
    const paper = await consumable('Kertas A4', { onHand: 25 });
    const marker = await consumable('Spidol', { onHand: 30, unit: pcs });
    const id = await draft([
      { consumableId: paper.id, quantityRequested: 10 },
      { consumableId: marker.id, quantityRequested: 5 },
    ]);
    expect((await post(`/requests/${id}/submit`, {}, cast.teacher)).status).toBe(200);
    const submitted = await detail(id, cast.sarpras);
    const [paperLine] = submitted.items;

    const returned = await decide(activeStep(submitted).id, {
      decision: 'REQUEST_REVISION',
      comment: 'Please reduce the paper quantity.',
      itemNotes: [{ requestItemId: paperLine.id, note: 'Kurangi jadi 5' }],
    });
    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe('REVISION_REQUESTED');

    // A new active workflow version must not be picked up by the resubmission.
    await models.WorkflowDefinition.update(
      { status: 'RETIRED', retiredAt: new Date() },
      { where: { institutionId: alpha.id } }
    );
    await workflow([['DECIDE', 'KEPALA_SEKOLAH'], ...FLOW], { version: 2 });

    const edited = await patch(
      `/request-items/${paperLine.id}`,
      { quantityRequested: 5 },
      cast.teacher
    );
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ quantityRequested: 5, consumableId: paper.id });

    const resubmitted = await post(`/requests/${id}/submit`, {}, cast.teacher);
    expect(resubmitted.status).toBe(200);
    const again = await detail(id, cast.sarpras);
    expect(again.status).toBe('SUBMITTED');
    expect(again.cycle).toBe(2);
    expect(again.steps.map((s) => `${s.stepType}:${s.actorPositionCode}`)).toEqual(
      FLOW.map(([type, actor]) => `${type}:${actor}`)
    );
    expect(again.items.map((item) => [item.description, item.quantityRequested])).toEqual([
      ['Kertas A4', 5],
      ['Spidol', 5],
    ]);
    expect(await onHand(paper.id)).toBe(25);

    await approve(id);
    expect((await detail(id, cast.sarpras)).status).toBe('APPROVED');
  });

  it('issues the actual quantity: partial, then the rest; stock falls by what was issued', async () => {
    const paper = await consumable('Kertas A4', { onHand: 25 });
    const request = await approvedFor(paper, 10);
    const [line] = request.items;

    const first = await issue(request.id, [{ requestItemId: line.id, quantity: 8 }]);
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('PARTIALLY_FULFILLED');
    expect(first.body.data.items[0]).toMatchObject({
      quantityRequested: 10,
      quantityIssued: 8,
      quantityNotYetIssued: 2,
    });
    expect(await onHand(paper.id)).toBe(17);

    // More than the line still needs.
    const over = await issue(request.id, [{ requestItemId: line.id, quantity: 3 }]);
    expect(over.status).toBe(409);
    expect(await onHand(paper.id)).toBe(17);

    const rest = await issue(request.id, [{ requestItemId: line.id, quantity: 2 }], cast.sarpras, {
      note: 'Diambil sendiri',
    });
    expect(rest.body.data.status).toBe('FULFILLED');
    expect(await onHand(paper.id)).toBe(15);

    const issues = (await movementsOf(paper.id)).filter((m) => m.movementType === 'ISSUE');
    expect(issues.map((m) => [m.quantity, m.balanceAfter, m.requestItemId])).toEqual([
      [-8, 17, line.id],
      [-2, 15, line.id],
    ]);
    const audit = await models.AuditLog.findAll({
      where: { entityType: 'ConsumableStockMovement', entityId: issues[0].id },
    });
    expect(audit[0]).toMatchObject({ action: 'CREATE', actorId: cast.sarpras.user.id });

    const history = (await get(`/consumables/${paper.id}/movements`, cast.reader)).body.data;
    expect(history[0]).toMatchObject({
      movementType: 'ISSUE',
      request: { id: request.id, requestNumber: request.requestNumber, lineNo: 1 },
    });
    // Issued, the request can no longer be issued against.
    expect((await issue(request.id, [{ requestItemId: line.id, quantity: 1 }])).status).toBe(409);
  });

  it('closes the remainder after issuing short: requested 10, issued 8, cancelled 2', async () => {
    const paper = await consumable('Kertas A4', { onHand: 25 });
    const request = await approvedFor(paper, 10);
    await issue(request.id, [{ requestItemId: request.items[0].id, quantity: 8 }]);

    // Issued: the request is not cancellable — only its remainder closable.
    const cancel = await post(`/requests/${request.id}/cancel`, { reason: 'x' }, cast.teacher);
    expect([403, 409]).toContain(cancel.status);

    const closed = await post(
      `/requests/${request.id}/close`,
      { reason: 'Stok cukup 8' },
      cast.sarpras
    );
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('CLOSED');
    expect(closed.body.data.items[0]).toMatchObject({
      quantityRequested: 10,
      quantityCancelled: 2,
      quantityIssued: 8,
    });
    expect(await onHand(paper.id)).toBe(17);
  });

  it('refuses an issue beyond stock and writes nothing — every line or none', async () => {
    const paper = await consumable('Kertas A4', { onHand: 20 });
    const marker = await consumable('Spidol', { onHand: 5, unit: pcs });
    const id = await draft([
      { consumableId: paper.id, quantityRequested: 2 },
      { consumableId: marker.id, quantityRequested: 8 },
    ]);
    expect((await post(`/requests/${id}/submit`, {}, cast.teacher)).status).toBe(200);
    await approve(id);
    const [paperLine, markerLine] = (await detail(id, cast.sarpras)).items;

    const short = await issue(id, [
      { requestItemId: paperLine.id, quantity: 2 },
      { requestItemId: markerLine.id, quantity: 8 },
    ]);
    expect(short.status).toBe(409);
    expect(short.body.error.details[0].issue).toMatch(/5 on hand/);
    expect(await onHand(paper.id)).toBe(20);
    expect(await onHand(marker.id)).toBe(5);
    expect(await models.ConsumableStockMovement.count({ where: { movementType: 'ISSUE' } })).toBe(
      0
    );
    expect((await detail(id, cast.sarpras)).status).toBe('APPROVED');
  });

  it('never issues before approval, nor an asset line, nor another request’s line', async () => {
    const paper = await consumable('Kertas A4', { onHand: 20 });
    const id = await draft([
      { consumableId: paper.id, quantityRequested: 2 },
      { description: 'Proyektor', quantityRequested: 1 },
    ]);
    expect((await post(`/requests/${id}/submit`, {}, cast.teacher)).status).toBe(200);
    const submitted = await detail(id, cast.sarpras);
    const [paperLine, projectorLine] = submitted.items;
    expect((await issue(id, [{ requestItemId: paperLine.id, quantity: 1 }])).status).toBe(409);

    await approve(id);
    // Mixed: there IS something to register.
    const states = Object.fromEntries(
      (await detail(id, cast.sarpras)).steps.map((s) => [s.stepType, s.state])
    );
    expect(states.REGISTER).toBe('ACTIVE');
    expect((await issue(id, [{ requestItemId: projectorLine.id, quantity: 1 }])).status).toBe(400);

    const other = await approvedFor(paper, 3);
    expect((await issue(id, [{ requestItemId: other.items[0].id, quantity: 1 }])).status).toBe(400);
    // A consumable line is never registered as asset units.
    const registered = await post(
      `/request-items/${paperLine.id}/register`,
      { name: 'Kertas', classificationId: LEAF, unitCount: 1 },
      cast.sarpras
    );
    expect(registered.status).toBe(400);
    expect(await onHand(paper.id)).toBe(20);
  });

  it('completes REGISTER on the asset lines alone of a mixed request', async () => {
    const paper = await consumable('Kertas A4', { onHand: 20 });
    const id = await draft([
      { consumableId: paper.id, quantityRequested: 2 },
      { description: 'Proyektor', quantityRequested: 1 },
    ]);
    expect((await post(`/requests/${id}/submit`, {}, cast.teacher)).status).toBe(200);
    await approve(id);
    const projectorLine = (await detail(id, cast.sarpras)).items[1];

    const registered = await post(
      `/request-items/${projectorLine.id}/register`,
      { name: 'Proyektor', classificationId: LEAF, unitCount: 1 },
      cast.sarpras
    );
    expect(registered.status).toBe(201);
    const states = Object.fromEntries(
      (await detail(id, cast.sarpras)).steps.map((s) => [s.stepType, s.state])
    );
    expect(states.REGISTER).toBe('DONE');
    // The consumable line still awaits its issue.
    expect((await detail(id, cast.sarpras)).actions.issue).toBe(true);
  });

  it('authorization: the permission, the request’s visibility, the institution', async () => {
    const paper = await consumable('Kertas A4', { onHand: 20 });
    const request = await approvedFor(paper, 4);
    const line = { requestItemId: request.items[0].id, quantity: 1 };

    // The requester cannot issue to themself.
    expect((await issue(request.id, [line], cast.teacher)).status).toBe(403);
    // Stock rights without sight of the request: not found.
    const storekeeper = await person(STOCK);
    expect((await issue(request.id, [line], storekeeper)).status).toBe(404);
    // Another institution's stock keeper: not found.
    expect((await issue(request.id, [line], cast.betaStock)).status).toBe(404);
    expect(await onHand(paper.id)).toBe(20);
  });

  it('blocks submission while a line names an inactive consumable', async () => {
    const paper = await consumable('Kertas A4', { onHand: 20 });
    const id = await draft([{ consumableId: paper.id, quantityRequested: 2 }]);
    await post(`/consumables/${paper.id}/deactivate`, {}, cast.sarpras);

    const response = await post(`/requests/${id}/submit`, {}, cast.teacher);
    expect(response.status).toBe(400);
    expect((await detail(id)).submitBlockers.map((b) => b.code)).toContain('CONSUMABLE_INACTIVE');
  });
});

describe('the schema (migration 067)', () => {
  it('refuses a negative balance, a wrong-signed movement and an issue of another consumable', async () => {
    const paper = await consumable('Kertas A4', { onHand: 2 });
    const marker = await consumable('Spidol', { onHand: 2, unit: pcs });
    const request = await approvedFor(paper, 2);
    const by = cast.sarpras.user.id;

    await expect(
      query(`UPDATE public.consumables SET quantity_on_hand = -1 WHERE id = $1`, [paper.id])
    ).rejects.toThrow(/chk_consumables_on_hand/);
    await expect(
      query(
        `INSERT INTO public.consumable_stock_movements
           (consumable_id, movement_type, quantity, balance_after, created_by)
         VALUES ($1, 'RECEIPT', -1, 1, $2)`,
        [paper.id, by]
      )
    ).rejects.toThrow(/chk_csm_quantity/);
    await expect(
      query(
        `INSERT INTO public.consumable_stock_movements
           (consumable_id, movement_type, quantity, balance_after, created_by)
         VALUES ($1, 'ADJUSTMENT', -1, 1, $2)`,
        [paper.id, by]
      )
    ).rejects.toThrow(/chk_csm_adjustment_note/);
    await expect(
      query(
        `INSERT INTO public.consumable_stock_movements
           (consumable_id, movement_type, quantity, balance_after, created_by)
         VALUES ($1, 'ISSUE', -1, 1, $2)`,
        [paper.id, by]
      )
    ).rejects.toThrow(/chk_csm_request_item/);
    // The paper line, issued as markers: the composite key refuses it.
    await expect(
      query(
        `INSERT INTO public.consumable_stock_movements
           (consumable_id, movement_type, quantity, balance_after, request_item_id, created_by)
         VALUES ($1, 'ISSUE', -1, 1, $2, $3)`,
        [marker.id, request.items[0].id, by]
      )
    ).rejects.toThrow(/fk_csm_request_item/);
  });

  it('refuses to roll back while consumables exist, then rolls back and re-applies', async () => {
    const url = cycleDatabaseUrl();
    await migrate(url);
    await query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('C', 'CYC067', 'x')`,
      [],
      url
    );
    await query(`INSERT INTO ref.measurement_units (name) VALUES ('cyc067')`, [], url);
    await query(
      `INSERT INTO public.consumables (institution_id, name, measurement_unit_id)
       SELECT i.id, 'Kertas', m.id FROM public.institutions i, ref.measurement_units m
        WHERE i.code = 'CYC067' AND m.name = 'cyc067'`,
      [],
      url
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', MIGRATION], url)).rejects.toThrow(
        /Migration 067 rollback refused: 1 consumable/
      );

      await query(`DELETE FROM public.consumables`, [], url);
      await runCli(['db:migrate:undo', '--name', MIGRATION], url);
      const [gone] = await query(`SELECT to_regclass('public.consumables') AS name`, [], url);
      expect(gone.name).toBeNull();
      const [column] = await query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'request_items' AND column_name = 'consumable_id'`,
        [],
        url
      );
      expect(column.n).toBe(0);

      await migrate(url);
      const [back] = await query(`SELECT to_regclass('public.consumables') AS name`, [], url);
      expect(back.name).toBe('consumables');
    } finally {
      await migrate(url);
      await query(`DELETE FROM public.consumables`, [], url);
      await query(`DELETE FROM ref.measurement_units WHERE name = 'cyc067'`, [], url);
      await query(`DELETE FROM public.institutions WHERE code = 'CYC067'`, [], url);
    }
  });
});
