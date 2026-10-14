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
const { businessDate } = require('../../src/domain/requestFulfilmentRules.js');
const { needsPlacement } = require('../../src/domain/receiptPlacement.js');
const reports = require('../../src/modules/reports/service.js');

/**
 * Receipt places the unit at its intended location — REQ-REQUEST-024,
 * migration 064 (`IMPLEMENTATION_PLAN.md` §71).
 *
 *   PLACEMENT   AT_INTENDED_PLACE + active snapshot of the request's institution
 *               + unit without a location → one SYSTEM row: the location, no
 *               condition, lifecycle unchanged, dated when recorded
 *   NOT PLACED  NOT_AT, no destination, inactive, another institution's, already
 *               located — the receipt still succeeds
 *   CONDITION   never cleared or invented; MANUAL / BORROWING still require one
 *   REVERSAL    never moves the unit back
 *   NEEDS PLACEMENT  derived — the unit filter, the receipt view, the predicate
 *   PERAWATAN   no SYSTEM text among the notes
 *   SCHEMA      the CHECK, the guarded rollback
 */

const V1 = '/api/v1';
const LEAF = '117010101001';
const MIGRATION = '20261007010000-064-allow-system-history-without-condition.js';

const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request:submit',
  'request:receive',
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
const OVERSEER = [
  'request:read',
  'request:oversee',
  'request-receipt:reverse',
  'request-item-unit:read',
];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

let alpha;
let beta;
let admin;
let cast;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
  cast = null;
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
const get = (url, caller = admin) => call('get', url, undefined, caller);
const post = (url, body, caller = admin) => call('post', url, body ?? {}, caller);

const place = (name, institution = alpha) =>
  models.Location.create({ name, classificationId: LEAF, institutionId: institution.id });

async function person(permissions, positionCode) {
  const caller = await createCaller({ permissions, institutionId: alpha.id });
  const assignment = positionCode
    ? await models.PositionAssignment.create({
        institutionId: alpha.id,
        userId: caller.user.id,
        positionCode,
      })
    : null;
  return { ...caller, assignment };
}

async function setUp() {
  if (cast) return cast;
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
  cast = {
    kepala: await person(APPROVER, 'KEPALA_SEKOLAH'),
    sarpras: await person(REGISTRAR, 'WAKASEK_SARPRAS'),
  };
  return cast;
}

/** An APPROVED request with `count` registered units, its destination `destination`. */
async function registeredRequest({ destination, quantity = 2, count = 2 } = {}) {
  const { kepala, sarpras } = await setUp();
  const teacher = await person(REQUESTER, 'COMMON_TEACHER');
  const created = await post(
    '/requests',
    {
      requesterAssignmentId: teacher.assignment.id,
      category: 'COMMON',
      title: 'Laptop',
      ...(destination ? { destinationLocationId: destination.id } : {}),
    },
    teacher
  );
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  await post(
    `/requests/${id}/items`,
    { description: 'Laptop', quantityRequested: quantity },
    teacher
  );
  const submitted = (await post(`/requests/${id}/submit`, {}, teacher)).body.data;
  const decided = await post(
    `/request-steps/${submitted.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    kepala
  );
  const itemId = decided.body.data.items[0].id;
  const registered = await post(
    `/request-items/${itemId}/register`,
    { name: 'Laptop', classificationId: LEAF, unitCount: count },
    sarpras
  );
  expect(registered.status).toBe(201);
  return { id, units: registered.body.data.units.map((unit) => unit.id), teacher };
}

/** `POST /requests/:id/receive` — the body exactly as before REQ-REQUEST-024. */
function receive(requestId, fields, caller) {
  const pending = api()
    .post(`${V1}/requests/${requestId}/receive`)
    .set(...caller.auth);
  const all = { receivedOn: businessDate(), description: 'Sudah diterima', ...fields };
  for (const [key, value] of Object.entries(all)) {
    if (value === undefined) continue;
    for (const entry of [value].flat()) pending.field(key, String(entry));
  }
  pending.attach('photos', PNG, { filename: 'bukti.png', contentType: 'image/png' });
  return pending;
}

const unitOf = (id) => models.AssetUnit.findByPk(id);
const historyOf = (id) =>
  models.LongitudinalHistory.findAll({
    where: { assetUnitId: id },
    order: [['effectiveFrom', 'ASC']],
  });
const receiptOf = (unitId) =>
  models.RequestItemUnitReceipt.findOne({
    include: [{ association: 'link', where: { assetUnitId: unitId }, required: true }],
    order: [['recordedAt', 'DESC']],
  });
const unplacedIds = async (value = 'true') =>
  (await get(`/asset-units?needsPlacement=${value}&pageSize=100`)).body.data.map((u) => u.id);

// ---------------------------------------------------------------------------

describe('AT_INTENDED_PLACE places an unplaced unit (REQ-REQUEST-024)', () => {
  it('writes one SYSTEM row: the snapshot location, no condition, REGISTERED, dated when recorded', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({ destination: room });

    const response = await receive(id, { all: true, placement: 'AT_INTENDED_PLACE' }, teacher);
    expect(response.status).toBe(200);

    for (const unitId of units) {
      const unit = await unitOf(unitId);
      expect(unit).toMatchObject({
        currentLocationId: room.id,
        lifecycleState: 'REGISTERED',
        currentCondition: null,
      });
      const [row, ...rest] = await historyOf(unitId);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        entryType: 'SYSTEM',
        condition: null,
        locationId: room.id,
        lifecycleState: 'REGISTERED',
        effectiveTo: null,
        createdBy: teacher.user.id,
      });
      expect(row.description).toMatch(/intended location on receipt \(REQ\/\d{4}\/\d{4}\)/);
      // The recording instant, never the typed `receivedOn`.
      expect(row.effectiveFrom.getTime()).toBe((await receiptOf(unitId)).recordedAt.getTime());

      const assignment = await models.AssetUnitLocation.findOne({
        where: { assetUnitId: unitId, isCurrent: true },
      });
      expect(assignment.locationId).toBe(room.id);
    }
  });

  it('audits the unit as an AssetUnit UPDATE by the requester', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({
      destination: room,
      count: 1,
      quantity: 1,
    });
    await receive(id, { all: true, placement: 'AT_INTENDED_PLACE' }, teacher);

    const entries = await models.AuditLog.findAll({
      where: { entityType: 'AssetUnit', entityId: units[0], action: 'UPDATE' },
    });
    const placed = entries.find((entry) => entry.newValues?.currentLocationId === room.id);
    expect(placed).toMatchObject({ actorId: teacher.user.id });
    expect(placed.newValues).not.toHaveProperty('currentCondition');
  });

  it('leaves an existing current condition exactly as it was', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({
      destination: room,
      count: 1,
      quantity: 1,
    });
    await models.AssetUnit.update({ currentCondition: 'GOOD' }, { where: { id: units[0] } });

    await receive(id, { all: true, placement: 'AT_INTENDED_PLACE' }, teacher);

    expect(await unitOf(units[0])).toMatchObject({
      currentLocationId: room.id,
      currentCondition: 'GOOD',
    });
    expect((await historyOf(units[0]))[0].condition).toBeNull();
  });
});

describe('no placement — and the receipt still succeeds', () => {
  const expectUnplaced = async (unitIds) => {
    for (const unitId of unitIds) {
      expect((await unitOf(unitId)).currentLocationId).toBeNull();
      expect(await historyOf(unitId)).toEqual([]);
      expect(await receiptOf(unitId)).not.toBeNull();
    }
  };

  it('for NOT_AT_INTENDED_PLACE', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({ destination: room });
    const response = await receive(id, { all: true, placement: 'NOT_AT_INTENDED_PLACE' }, teacher);
    expect(response.status).toBe(200);
    await expectUnplaced(units);
  });

  it('for a request with no intended location', async () => {
    const { id, units, teacher } = await registeredRequest();
    expect((await receive(id, { all: true }, teacher)).status).toBe(200);
    await expectUnplaced(units);
  });

  it('when the intended location was deactivated before receipt', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({ destination: room });
    await room.update({ isActive: false });

    const response = await receive(id, { all: true, placement: 'AT_INTENDED_PLACE' }, teacher);
    expect(response.status).toBe(200);
    expect(response.body.data.receiptConfirmations[0].placement).toBe('AT_INTENDED_PLACE');
    await expectUnplaced(units);
  });

  it('when the intended location now belongs to another institution', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({ destination: room });
    await room.update({ institutionId: beta.id });

    const response = await receive(id, { all: true, placement: 'AT_INTENDED_PLACE' }, teacher);
    expect(response.status).toBe(200);
    await expectUnplaced(units);
  });

  it('for a unit that already has a location — which never moves', async () => {
    const room = await place('Kelas 1');
    const lab = await place('Lab');
    const { id, units, teacher } = await registeredRequest({ destination: room });
    const recorded = await post(`/asset-units/${units[0]}/history`, {
      condition: 'GOOD',
      locationId: lab.id,
      description: 'Diperiksa',
    });
    expect(recorded.status).toBe(200);

    const response = await receive(id, { all: true, placement: 'AT_INTENDED_PLACE' }, teacher);
    expect(response.status).toBe(200);

    expect(await unitOf(units[0])).toMatchObject({
      currentLocationId: lab.id,
      currentCondition: 'GOOD',
    });
    expect((await historyOf(units[0])).map((row) => row.entryType)).toEqual(['MANUAL']);
    // Its sibling, unplaced, was placed in the same receipt.
    expect((await unitOf(units[1])).currentLocationId).toBe(room.id);
  });
});

describe('condition rules', () => {
  it('keeps MANUAL and BORROWING rows requiring a condition — only SYSTEM may omit it', async () => {
    const room = await place('Kelas 1');
    const unit = await registeredRequest({ destination: room, count: 1, quantity: 1 });
    const insert = (entryType) =>
      query(
        `INSERT INTO public.longitudinal_history
           (asset_unit_id, description, condition, location_id, entry_type, effective_from)
         VALUES ($1, 'x', NULL, $2, $3, now())`,
        [unit.units[0], room.id, entryType]
      );

    await expect(insert('MANUAL')).rejects.toThrow(/chk_longitudinal_history_condition/);
    await expect(insert('BORROWING')).rejects.toThrow(/chk_longitudinal_history_condition/);
    await expect(insert('SYSTEM')).resolves.toBeDefined();
  });

  it('still asks Record History for a condition on a placed unit, and then records it', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({
      destination: room,
      count: 1,
      quantity: 1,
    });
    await receive(id, { all: true, placement: 'AT_INTENDED_PLACE' }, teacher);

    const without = await post(`/asset-units/${units[0]}/history`, { description: 'Cek' });
    expect(without.status).toBe(400);
    expect(without.body.error.details[0].field).toBe('condition');

    const withCondition = await post(`/asset-units/${units[0]}/history`, {
      condition: 'GOOD',
      description: 'Cek',
    });
    expect(withCondition.status).toBe(200);
    expect(await unitOf(units[0])).toMatchObject({
      currentLocationId: room.id,
      currentCondition: 'GOOD',
    });
    expect((await historyOf(units[0])).map((row) => [row.entryType, row.condition])).toEqual([
      ['SYSTEM', null],
      ['MANUAL', 'GOOD'],
    ]);
  });
});

describe('reversal', () => {
  it('never moves the unit back', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({ destination: room, quantity: 3 });
    await receive(id, { assetUnitIds: [units[0]], placement: 'AT_INTENDED_PLACE' }, teacher);
    const overseer = await person(OVERSEER);

    const reversed = await post(
      `/request-receipts/${(await receiptOf(units[0])).id}/reverse`,
      { reason: 'Salah unit' },
      overseer
    );
    expect(reversed.status).toBe(200);

    expect((await unitOf(units[0])).currentLocationId).toBe(room.id);
    expect((await historyOf(units[0])).map((row) => row.entryType)).toEqual(['SYSTEM']);
  });
});

describe('needs placement — derived, one definition', () => {
  it('filters the unit list, and marks each unit on the receipt view', async () => {
    const room = await place('Kelas 1');
    const placedRequest = await registeredRequest({ destination: room, count: 1, quantity: 1 });
    await receive(
      placedRequest.id,
      { all: true, placement: 'AT_INTENDED_PLACE' },
      placedRequest.teacher
    );

    const elsewhere = await registeredRequest({ destination: room, count: 1, quantity: 1 });
    const response = await receive(
      elsewhere.id,
      { all: true, placement: 'NOT_AT_INTENDED_PLACE' },
      elsewhere.teacher
    );

    // Received nowhere yet: no receipt, so nothing to place.
    const pending = await registeredRequest({ destination: room, count: 1, quantity: 1 });

    expect(await unplacedIds()).toEqual([elsewhere.units[0]]);
    const placedOrNot = await unplacedIds('false');
    expect(placedOrNot).toEqual(expect.arrayContaining([placedRequest.units[0], pending.units[0]]));
    expect(placedOrNot).not.toContain(elsewhere.units[0]);

    expect(response.body.data.receiptConfirmations[0].units[0]).toMatchObject({
      assetUnitId: elsewhere.units[0],
      currentLocation: null,
      needsPlacement: true,
    });
    const placedView = (await get(`/requests/${placedRequest.id}`, placedRequest.teacher)).body
      .data;
    expect(placedView.receiptConfirmations[0].units[0]).toMatchObject({
      currentLocation: { id: room.id, name: 'Kelas 1' },
      needsPlacement: false,
    });
  });

  it('drops a unit whose only receipt is reversed, and an inactive unit', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({ destination: room, quantity: 3 });
    await receive(id, { all: true, placement: 'NOT_AT_INTENDED_PLACE' }, teacher);
    expect((await unplacedIds()).sort()).toEqual([...units].sort());

    const overseer = await person(OVERSEER);
    await post(
      `/request-receipts/${(await receiptOf(units[0])).id}/reverse`,
      { reason: 'x' },
      overseer
    );
    await models.AssetUnit.update({ isActive: false }, { where: { id: units[1] } });

    expect(await unplacedIds()).toEqual([]);
  });

  it('gives, as a row predicate, the same answers as the filter cases above', () => {
    const cases = [
      [{ isActive: true, currentLocationId: null, hasUnreversedReceipt: true }, true],
      [{ isActive: false, currentLocationId: null, hasUnreversedReceipt: true }, false],
      [{ isActive: true, currentLocationId: 'loc', hasUnreversedReceipt: true }, false],
      [{ isActive: true, currentLocationId: null, hasUnreversedReceipt: false }, false],
    ];
    for (const [unit, expected] of cases)
      expect(needsPlacement(unit), JSON.stringify(unit)).toBe(expected);
  });
});

describe('PERAWATAN', () => {
  it('keeps the placement text out of the notes, and leaves the month unticked', async () => {
    const room = await place('Kelas 1');
    const { id, units, teacher } = await registeredRequest({
      destination: room,
      count: 1,
      quantity: 1,
    });
    await receive(id, { all: true, placement: 'AT_INTENDED_PLACE' }, teacher);

    const months = reports.monthWindow();
    const history = await reports.maintenanceHistoryFor([{ unitId: units[0] }], months, models);
    const thisMonth = history.get(units[0]).at(-1);
    expect(thisMonth).toMatchObject({ condition: null, note: '', moved: false });
  });
});

describe('the schema (migration 064)', () => {
  it('refuses to roll back while a SYSTEM row has no condition, then re-applies', async () => {
    const CYCLE = cycleDatabaseUrl();
    await migrate(CYCLE);

    const one = async (sql, params) => (await query(sql, params, CYCLE))[0];
    const institution = await one(
      `INSERT INTO public.institutions (name, code, address) VALUES ('C', 'CYC064', 'x') RETURNING id`
    );
    await query(
      `INSERT INTO ref.asset_classifications (id, name) VALUES ('999999999064', 'Cycle 064')`,
      [],
      CYCLE
    );
    const location = await one(
      `INSERT INTO public.locations (name, classification_id, institution_id)
       VALUES ('Gudang', '999999999064', $1) RETURNING id`,
      [institution.id]
    );
    const asset = await one(
      `INSERT INTO public.assets (name, classification_id, institution_id)
       VALUES ('Laptop', '999999999064', $1) RETURNING id`,
      [institution.id]
    );
    const unit = await one(
      `INSERT INTO public.asset_units (asset_id, inventory_code) VALUES ($1, 'CYC-064-1') RETURNING id`,
      [asset.id]
    );
    const row = await one(
      `INSERT INTO public.longitudinal_history
         (asset_unit_id, description, condition, location_id, entry_type, effective_from)
       VALUES ($1, 'Placed', NULL, $2, 'SYSTEM', now()) RETURNING id`,
      [unit.id, location.id]
    );

    try {
      // Migrations 066 / 065 (REQ-REQUEST-025) widen and use the same CHECK and
      // type — off first, re-applied with the rest.
      await runCli(
        ['db:migrate:undo', '--name', '20261009010000-066-create-asset-unit-reports.js'],
        CYCLE
      );
      await runCli(
        ['db:migrate:undo', '--name', '20261008010000-065-add-report-history-entry-type.js'],
        CYCLE
      );
      await expect(runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE)).rejects.toThrow(
        /Migration 064 rollback refused/
      );
      await query('DELETE FROM public.longitudinal_history WHERE id = $1', [row.id], CYCLE);
      await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);
      const column = await one(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'longitudinal_history' AND column_name = 'condition'`
      );
      expect(column.is_nullable).toBe('NO');
    } finally {
      await migrate(CYCLE);
      await query('DELETE FROM public.longitudinal_history WHERE id = $1', [row.id], CYCLE);
      for (const [table, rowId] of [
        ['asset_units', unit.id],
        ['assets', asset.id],
        ['locations', location.id],
        ['institutions', institution.id],
      ]) {
        await query(`DELETE FROM public.${table} WHERE id = $1`, [rowId], CYCLE);
      }
      await query(`DELETE FROM ref.asset_classifications WHERE id = '999999999064'`, [], CYCLE);
    }
  });
});
