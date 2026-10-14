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
const reports = require('../../src/modules/reports/service.js');
const { applyStateChange } = require('../../src/modules/assetUnits/service.js');
const { withTransaction } = require('../../src/db/withTransaction.js');

/**
 * Room PIC reports — REQ-REQUEST-025, migrations 065–066
 * (`IMPLEMENTATION_PLAN.md` §72).
 *
 *   REPORTING   only the CURRENT PIC of the unit's EXACT current room, in their own
 *               institution, with `asset-unit-report:create`; everything else
 *               404 / 403; the destination validated and snapshotted
 *   READING     my units, destinations, my reports; the reviewer's queue
 *   REVIEW      never one's own; PENDING only; reject needs a note; CONDITION /
 *               MOVEMENT write ONE `REPORT` row in the same transaction;
 *               OBSERVATION writes none; stale needs acknowledging
 *   CR-012      `REPORT` never counts — coverage and assessedByOthers unchanged
 *   PERAWATAN   a confirmed condition ticks; the narrative is a note
 *   SCHEMA      the CHECKs, the guarded rollbacks of 065 and 066
 */

const V1 = '/api/v1';
const LEAF = '117010101001';
const M065 = '20261008010000-065-add-report-history-entry-type.js';
const M066 = '20261009010000-066-create-asset-unit-reports.js';

let alpha;
let beta;
let admin;
let reporter;
let reviewer;
let room;
let lab;
let building;
let childRoom;
let asset;

const call = (method, url, body, caller) => {
  const request = api()
    [method](`${V1}${url}`)
    .set(...caller.auth);
  return body === undefined ? request : request.send(body);
};
const get = (url, caller = admin) => call('get', url, undefined, caller);
const post = (url, body, caller = admin) => call('post', url, body ?? {}, caller);

const place = (name, institution = alpha, extra = {}) =>
  models.Location.create({ name, classificationId: LEAF, institutionId: institution.id, ...extra });
const picOf = (caller, location, extra = {}) =>
  models.LocationPicAssignment.create({
    locationId: location.id,
    userId: caller.user.id,
    ...extra,
  });

/** A unit placed by a MANUAL assessment — condition `GOOD` — at `location`. */
async function unitAt(location, { condition = 'GOOD', departmentId = null, of = asset } = {}) {
  const unit = await models.AssetUnit.create({
    assetId: of.id,
    inventoryCode: `U-${Math.random().toString(36).slice(2, 8)}`,
    departmentId,
  });
  const recorded = await post(`/asset-units/${unit.id}/history`, {
    condition,
    locationId: location.id,
    description: 'Diperiksa',
  });
  expect(recorded.status).toBe(200);
  return models.AssetUnit.findByPk(unit.id);
}

const file = (body, caller = reporter) => post('/asset-unit-reports', body, caller);
/**
 * Confirms as a reviewer does (M1): looks at the report first and sends back the
 * open history row it showed — `currentHistoryId` as `seenHistoryId`.
 */
async function confirm(id, body = {}, caller = reviewer) {
  const seen = await get(`/asset-unit-reports/${id}`, caller);
  return post(
    `/asset-unit-reports/${id}/confirm`,
    { seenHistoryId: seen.body.data?.currentHistoryId ?? null, ...body },
    caller
  );
}
const conditionReport = (unit, extra = {}) => ({
  assetUnitId: unit.id,
  kind: 'CONDITION',
  narrative: 'Layar retak',
  reportedCondition: 'DAMAGED',
  ...extra,
});
const historyOf = (unitId) =>
  models.LongitudinalHistory.findAll({
    where: { assetUnitId: unitId },
    order: [['effectiveFrom', 'ASC']],
  });

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
  reporter = await createCaller({
    permissions: ['asset-unit-report:create'],
    institutionId: alpha.id,
  });
  reviewer = await createCaller({
    permissions: ['asset-unit-report:review'],
    institutionId: alpha.id,
  });
  room = await place('Kelas 1');
  lab = await place('Lab TKJ');
  building = await place('Gedung A');
  childRoom = await place('Kelas 2', alpha, { parentLocationId: building.id });
  asset = await models.Asset.create({
    name: 'Laptop',
    classificationId: LEAF,
    institutionId: alpha.id,
  });
  await picOf(reporter, room);
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

// ---------------------------------------------------------------------------

describe('filing a report (REQ-REQUEST-025)', () => {
  it('records the claim and the unit as it was — and changes nothing about the unit', async () => {
    const unit = await unitAt(room);
    const before = await historyOf(unit.id);

    const response = await file(conditionReport(unit));

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      kind: 'CONDITION',
      narrative: 'Layar retak',
      reportedCondition: 'DAMAGED',
      destination: null,
      reportedState: { location: { id: room.id, name: 'Kelas 1' }, condition: 'GOOD' },
      status: 'PENDING',
      reporter: { id: reporter.user.id },
      historyId: null,
    });
    // The reporter's view (M2): no live comparison.
    expect(response.body.data).not.toHaveProperty('stale');
    expect((await historyOf(unit.id)).map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(await models.AssetUnit.findByPk(unit.id)).toMatchObject({
      currentLocationId: room.id,
      currentCondition: 'GOOD',
    });
  });

  it('refuses everyone but the current PIC of the unit’s exact room — as not found', async () => {
    const inChild = await unitAt(childRoom);
    const inLab = await unitAt(lab);
    const unplaced = await models.AssetUnit.create({ assetId: asset.id, inventoryCode: 'NOLOC' });
    const inactive = await unitAt(room);
    await inactive.update({ isActive: false });
    const disposed = await unitAt(room);
    await disposed.update({ lifecycleState: 'DISPOSED' });

    // The PIC of a parent location gains nothing over its child rooms.
    await picOf(reporter, building);
    for (const unit of [inChild, inLab, unplaced, inactive, disposed]) {
      const response = await file(conditionReport(unit));
      expect(response.status, unit.inventoryCode).toBe(404);
    }

    // A former PIC, and someone who never was.
    const formerPic = await createCaller({
      permissions: ['asset-unit-report:create'],
      institutionId: alpha.id,
    });
    await picOf(formerPic, lab, { isCurrent: false, endedAt: new Date() });
    expect((await file(conditionReport(inLab), formerPic)).status).toBe(404);

    // Another institution's unit, even in a room of the same name and PIC.
    const betaRoom = await place('Kelas 1', beta);
    const betaAsset = await models.Asset.create({
      name: 'Laptop',
      classificationId: LEAF,
      institutionId: beta.id,
    });
    const betaUnit = await unitAt(betaRoom, { of: betaAsset });
    await picOf(reporter, betaRoom);
    expect((await file(conditionReport(betaUnit))).status).toBe(404);
    expect(await models.AssetUnitReport.count()).toBe(0);
  });

  it('needs the permission, and an institution of one’s own', async () => {
    const unit = await unitAt(room);
    const noPermission = await createCaller({ permissions: [], institutionId: alpha.id });
    await picOf(noPermission, lab);
    expect((await file(conditionReport(unit), noPermission)).status).toBe(403);

    const systemWide = await createCaller({
      permissions: ['asset-unit-report:create'],
      isSystemWide: true,
    });
    expect((await file(conditionReport(unit), systemWide)).status).toBe(403);
  });

  it('requires what each kind names, and nothing else', async () => {
    const unit = await unitAt(room);
    const cases = [
      { assetUnitId: unit.id, kind: 'CONDITION', narrative: 'x' },
      { assetUnitId: unit.id, kind: 'MOVEMENT', narrative: 'x' },
      { assetUnitId: unit.id, kind: 'OBSERVATION', narrative: 'x', reportedCondition: 'GOOD' },
      { assetUnitId: unit.id, kind: 'OBSERVATION', narrative: '   ' },
      { assetUnitId: unit.id, kind: 'REPAIR', narrative: 'x' },
    ];
    for (const body of cases) expect((await file(body)).status, JSON.stringify(body)).toBe(400);
  });

  it('takes a move only to an active location of the institution, elsewhere — and keeps its name', async () => {
    const unit = await unitAt(room);
    const closed = await place('Gudang lama', alpha, { isActive: false });
    const foreign = await place('Gudang Beta', beta);
    for (const target of [closed, foreign, room]) {
      const response = await file({
        assetUnitId: unit.id,
        kind: 'MOVEMENT',
        narrative: 'Dipindah',
        destinationLocationId: target.id,
      });
      expect(response.status, target.name).toBe(400);
      expect(response.body.error.details[0].field).toBe('destinationLocationId');
    }

    const filed = await file({
      assetUnitId: unit.id,
      kind: 'MOVEMENT',
      narrative: 'Dipindah ke lab',
      destinationLocationId: lab.id,
    });
    expect(filed.status).toBe(201);
    await lab.update({ name: 'Lab Baru', isActive: false });

    const later = await get(`/asset-unit-reports/${filed.body.data.id}`, reviewer);
    expect(later.body.data.destination).toEqual({ id: lab.id, name: 'Lab TKJ' });
  });
});

describe('the reporter’s view', () => {
  it('lists the units in their rooms, exactly, and where a move may go', async () => {
    const mine = await unitAt(room);
    await unitAt(childRoom);
    await unitAt(lab);
    await picOf(reporter, building);
    const closed = await place('Gudang lama', alpha, { isActive: false });

    const units = await get('/asset-unit-reports/my-units', reporter);
    expect(units.status).toBe(200);
    expect(units.body.data.map((u) => u.id)).toEqual([mine.id]);
    expect(units.body.data[0]).toMatchObject({
      currentLocation: { id: room.id, name: 'Kelas 1' },
      currentCondition: 'GOOD',
      assetName: 'Laptop',
    });

    const destinations = (await get('/asset-unit-reports/destinations', reporter)).body.data;
    expect(destinations.map((d) => d.name)).toContain('Lab TKJ');
    expect(destinations.map((d) => d.id)).not.toContain(closed.id);
    // A reviewer with no reporting right gets neither.
    expect((await get('/asset-unit-reports/my-units', reviewer)).status).toBe(403);
  });

  it('shows a reporter their own reports, and a reviewer their institution’s', async () => {
    const unit = await unitAt(room);
    const { id } = (await file(conditionReport(unit))).body.data;
    const stranger = await createCaller({
      permissions: ['asset-unit-report:create'],
      institutionId: alpha.id,
    });
    const betaReviewer = await createCaller({
      permissions: ['asset-unit-report:review'],
      institutionId: beta.id,
    });

    expect(
      (await get('/asset-unit-reports?mine=true', reporter)).body.data.map((r) => r.id)
    ).toEqual([id]);
    expect((await get('/asset-unit-reports?mine=true', stranger)).body.data).toEqual([]);
    expect((await get(`/asset-unit-reports/${id}`, stranger)).status).toBe(404);
    expect(
      (await get('/asset-unit-reports?status=PENDING', reviewer)).body.data.map((r) => r.id)
    ).toEqual([id]);
    expect((await get('/asset-unit-reports', betaReviewer)).body.data).toEqual([]);
    expect((await get(`/asset-unit-reports/${id}`, betaReviewer)).status).toBe(404);
    // The queue is the reviewer's; a reporter without `review` cannot open it.
    expect((await get('/asset-unit-reports', reporter)).status).toBe(403);
  });
});

describe('review', () => {
  it('never lets the reporter review their own report', async () => {
    const both = await createCaller({
      permissions: ['asset-unit-report:create', 'asset-unit-report:review'],
      institutionId: alpha.id,
    });
    await picOf(both, lab);
    const unit = await unitAt(lab);
    const { id } = (await file(conditionReport(unit), both)).body.data;

    expect((await confirm(id, {}, both)).status).toBe(403);
    expect((await post(`/asset-unit-reports/${id}/reject`, { note: 'x' }, both)).status).toBe(403);
  });

  it('rejects with a note only, keeps the report, and changes nothing', async () => {
    const unit = await unitAt(room);
    const { id } = (await file(conditionReport(unit))).body.data;

    expect((await post(`/asset-unit-reports/${id}/reject`, { note: '  ' }, reviewer)).status).toBe(
      400
    );
    const rejected = await post(
      `/asset-unit-reports/${id}/reject`,
      { note: 'Tidak sesuai' },
      reviewer
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      status: 'REJECTED',
      reviewNote: 'Tidak sesuai',
      reviewer: { id: reviewer.user.id },
      historyId: null,
      narrative: 'Layar retak',
    });
    expect((await historyOf(unit.id)).map((row) => row.entryType)).toEqual(['MANUAL']);
    // Reviewed once.
    expect((await confirm(id, {}, reviewer)).status).toBe(409);
  });

  it('confirms a CONDITION report as one REPORT row by the reviewer, in place', async () => {
    const unit = await unitAt(room);
    const { id } = (await file(conditionReport(unit))).body.data;

    const confirmed = await confirm(id, {}, reviewer);

    expect(confirmed.status).toBe(200);
    const rows = await historyOf(unit.id);
    expect(rows.map((row) => [row.entryType, row.condition, row.locationId])).toEqual([
      ['MANUAL', 'GOOD', room.id],
      ['REPORT', 'DAMAGED', room.id],
    ]);
    expect(rows[1]).toMatchObject({
      createdBy: reviewer.user.id,
      lifecycleState: unit.lifecycleState,
    });
    expect(rows[1].description).toMatch(/Layar retak — reported by Test Caller/);
    expect(confirmed.body.data).toMatchObject({ status: 'CONFIRMED', historyId: rows[1].id });
    expect(await models.AssetUnit.findByPk(unit.id)).toMatchObject({
      currentCondition: 'DAMAGED',
      currentLocationId: room.id,
    });

    const audit = await models.AuditLog.findAll({
      where: { entityType: 'AssetUnitReport', entityId: id },
      order: [['timestamp', 'ASC']],
    });
    expect(audit.map((entry) => [entry.action, entry.actorId])).toEqual([
      ['CREATE', reporter.user.id],
      [expect.any(String), reviewer.user.id],
    ]);
  });

  it('confirms a MOVEMENT, carrying the condition — or none, for a unit that never had one', async () => {
    const assessed = await unitAt(room);
    const placedOnly = await models.AssetUnit.create({ assetId: asset.id, inventoryCode: 'SYS-1' });
    await withTransaction((transaction) =>
      applyStateChange(
        placedOnly,
        { locationId: room.id, description: 'Placed' },
        { userId: admin.user.id },
        { models, transaction, entryType: 'SYSTEM' }
      )
    );

    for (const unit of [assessed, placedOnly]) {
      const { id } = (
        await file({
          assetUnitId: unit.id,
          kind: 'MOVEMENT',
          narrative: 'Dipindah ke lab',
          destinationLocationId: lab.id,
        })
      ).body.data;
      expect((await confirm(id, {}, reviewer)).status).toBe(200);
    }

    expect(await models.AssetUnit.findByPk(assessed.id)).toMatchObject({
      currentLocationId: lab.id,
      currentCondition: 'GOOD',
    });
    expect((await historyOf(assessed.id)).at(-1)).toMatchObject({
      entryType: 'REPORT',
      condition: 'GOOD',
      locationId: lab.id,
    });
    expect(await models.AssetUnit.findByPk(placedOnly.id)).toMatchObject({
      currentLocationId: lab.id,
      currentCondition: null,
    });
    expect((await historyOf(placedOnly.id)).at(-1)).toMatchObject({
      entryType: 'REPORT',
      condition: null,
    });
  });

  it('confirms an OBSERVATION without touching the unit', async () => {
    const unit = await unitAt(room);
    const { id } = (
      await file({ assetUnitId: unit.id, kind: 'OBSERVATION', narrative: 'Kabel longgar' })
    ).body.data;

    const confirmed = await confirm(id, { note: 'Dicatat' }, reviewer);

    expect(confirmed.body.data).toMatchObject({
      status: 'CONFIRMED',
      historyId: null,
      reviewNote: 'Dicatat',
    });
    expect((await historyOf(unit.id)).map((row) => row.entryType)).toEqual(['MANUAL']);
  });

  it('never applies a stale report silently — acknowledged, it applies', async () => {
    const unit = await unitAt(room);
    const fresh = await file(conditionReport(unit, { reportedCondition: 'POOR' }));
    // The unit changes after the report was filed.
    await post(`/asset-units/${unit.id}/history`, { condition: 'FAIR', description: 'Cek ulang' });

    expect((await get(`/asset-unit-reports/${fresh.body.data.id}`, reviewer)).body.data.stale).toBe(
      true
    );
    const refused = await confirm(fresh.body.data.id, {}, reviewer);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details[0].field).toBe('acknowledgeStale');
    expect((await models.AssetUnit.findByPk(unit.id)).currentCondition).toBe('FAIR');

    const applied = await confirm(fresh.body.data.id, { acknowledgeStale: true }, reviewer);
    expect(applied.status).toBe(200);
    expect(applied.body.data).toMatchObject({ status: 'CONFIRMED', staleAcknowledged: true });
    expect((await models.AssetUnit.findByPk(unit.id)).currentCondition).toBe('POOR');
  });

  it('refuses to confirm what can no longer be applied; rejecting still works', async () => {
    const unit = await unitAt(room);
    const move = (
      await file({
        assetUnitId: unit.id,
        kind: 'MOVEMENT',
        narrative: 'Dipindah',
        destinationLocationId: lab.id,
      })
    ).body.data;
    await lab.update({ isActive: false });
    expect((await confirm(move.id, {}, reviewer)).status).toBe(409);

    const other = await unitAt(room);
    const condition = (await file(conditionReport(other))).body.data;
    await other.update({ lifecycleState: 'DISPOSED' });
    expect((await confirm(condition.id, {}, reviewer)).status).toBe(409);
    expect(
      (
        await post(
          `/asset-unit-reports/${condition.id}/reject`,
          { note: 'Sudah dihapus' },
          reviewer
        )
      ).status
    ).toBe(200);
    expect((await historyOf(other.id)).map((row) => row.entryType)).toEqual(['MANUAL']);
  });
});

describe('a confirmation applies only to the state the reviewer saw (M1)', () => {
  const seen = async (id) => (await get(`/asset-unit-reports/${id}`, reviewer)).body.data;
  const send = (id, body) => post(`/asset-unit-reports/${id}/confirm`, body, reviewer);

  it('refuses after a second change, even acknowledged — then applies to what was re-reviewed', async () => {
    const unit = await unitAt(room);
    const { id } = (await file(conditionReport(unit, { reportedCondition: 'DAMAGED' }))).body.data;
    // First change: the reviewer sees the report as stale, and acknowledges it.
    await post(`/asset-units/${unit.id}/history`, { condition: 'FAIR', description: 'Cek 1' });
    const first = await seen(id);
    expect(first).toMatchObject({ stale: true, currentHistoryId: expect.any(String) });
    const historyBefore = (await historyOf(unit.id)).length;

    // Second change, after they looked.
    await post(`/asset-units/${unit.id}/history`, { condition: 'POOR', description: 'Cek 2' });
    const refused = await send(id, {
      seenHistoryId: first.currentHistoryId,
      acknowledgeStale: true,
    });

    expect(refused.status).toBe(409);
    expect(refused.body.error.details[0]).toMatchObject({ field: 'seenHistoryId' });
    expect(refused.body.error.details[0].issue).toMatch(/now at Kelas 1 \(POOR\)/);
    expect((await models.AssetUnit.findByPk(unit.id)).currentCondition).toBe('POOR');
    expect((await historyOf(unit.id)).length).toBe(historyBefore + 1);
    expect((await models.AssetUnitReport.findByPk(id)).status).toBe('PENDING');

    // Looked at again: the newer state, acknowledged, is what it applies over.
    const second = await seen(id);
    expect(second.currentHistoryId).not.toBe(first.currentHistoryId);
    expect(second.unit.currentCondition).toBe('POOR');
    const applied = await send(id, {
      seenHistoryId: second.currentHistoryId,
      acknowledgeStale: true,
    });
    expect(applied.status).toBe(200);
    expect((await models.AssetUnit.findByPk(unit.id)).currentCondition).toBe('DAMAGED');
  });

  it('refuses a report that was current when seen but changed before confirming', async () => {
    const unit = await unitAt(room);
    const { id } = (await file(conditionReport(unit))).body.data;
    const first = await seen(id);
    expect(first.stale).toBe(false);

    await post(`/asset-units/${unit.id}/history`, { condition: 'FAIR', description: 'Cek' });
    for (const body of [
      { seenHistoryId: first.currentHistoryId },
      { seenHistoryId: first.currentHistoryId, acknowledgeStale: true },
    ]) {
      const refused = await send(id, body);
      expect(refused.status).toBe(409);
      expect(refused.body.error.details[0].field).toBe('seenHistoryId');
    }
    expect((await models.AssetUnit.findByPk(unit.id)).currentCondition).toBe('FAIR');
  });

  it('requires the seen state — an acknowledgement alone is not enough', async () => {
    const unit = await unitAt(room);
    const { id } = (await file(conditionReport(unit))).body.data;

    expect((await send(id, { acknowledgeStale: true })).status).toBe(400);
    expect((await send(id, {})).status).toBe(400);
    expect((await models.AssetUnitReport.findByPk(id)).status).toBe('PENDING');
  });
});

describe('what a reporter sees of their own reports (M2)', () => {
  const LIVE = ['currentLocation', 'currentCondition', 'lifecycleState'];

  it('never the unit’s live state — not after it has left their room', async () => {
    const unit = await unitAt(room);
    const created = await file(conditionReport(unit));
    const { id } = created.body.data;
    // Not even in the response to filing it.
    expect(Object.keys(created.body.data.unit).sort()).toEqual([
      'assetName',
      'id',
      'inventoryCode',
    ]);

    // The unit leaves the room, in another condition.
    await post(`/asset-units/${unit.id}/history`, {
      condition: 'POOR',
      locationId: lab.id,
      description: 'Dipindah oleh Sarpras',
    });

    const detail = (await get(`/asset-unit-reports/${id}`, reporter)).body.data;
    const [mine] = (await get('/asset-unit-reports?mine=true', reporter)).body.data;
    for (const view of [detail, mine]) {
      expect(Object.keys(view.unit).sort()).toEqual(['assetName', 'id', 'inventoryCode']);
      for (const key of LIVE) expect(view.unit).not.toHaveProperty(key);
      expect(view).not.toHaveProperty('stale');
      expect(view).not.toHaveProperty('currentHistoryId');
      // What they reported stays exactly as reported.
      expect(view.reportedState).toEqual({
        location: { id: room.id, name: 'Kelas 1' },
        condition: 'GOOD',
      });
      expect(JSON.stringify(view)).not.toMatch(/Lab TKJ|POOR/);
    }

    // The reviewer still sees the unit now.
    const reviewed = (await get(`/asset-unit-reports/${id}`, reviewer)).body.data;
    expect(reviewed).toMatchObject({
      stale: true,
      unit: { currentLocation: { id: lab.id, name: 'Lab TKJ' }, currentCondition: 'POOR' },
    });
  });

  it('shows the outcome of the review, still without the unit’s live state', async () => {
    const unit = await unitAt(room);
    const { id } = (
      await file({
        assetUnitId: unit.id,
        kind: 'MOVEMENT',
        narrative: 'Dipindah ke lab',
        destinationLocationId: lab.id,
      })
    ).body.data;
    expect((await confirm(id, { note: 'Benar' })).status).toBe(200);

    const detail = (await get(`/asset-unit-reports/${id}`, reporter)).body.data;
    expect(detail).toMatchObject({
      status: 'CONFIRMED',
      reviewNote: 'Benar',
      destination: { id: lab.id, name: 'Lab TKJ' },
    });
    for (const key of LIVE) expect(detail.unit).not.toHaveProperty(key);
  });
});

describe('CR-012 — a REPORT row is never an assessment', () => {
  it('leaves coverage and assessedByOthers unchanged, even confirmed by the department’s PIC', async () => {
    const tkj = await models.Department.create({
      code: 'TKJ',
      name: 'TKJ',
      institutionId: alpha.id,
    });
    const pic = await createCaller({
      permissions: ['asset-unit-report:review'],
      institutionId: alpha.id,
    });
    await models.DepartmentPicAssignment.create({ departmentId: tkj.id, userId: pic.user.id });
    await tkj.update({ currentPicUserId: pic.user.id });
    const unit = await unitAt(room, { departmentId: tkj.id });
    const month = new Date().toISOString().slice(0, 7);
    const coverage = async () =>
      (await get(`/reports/assessment-coverage?month=${month}`)).body.data.groups.find(
        (group) => group.code === 'TKJ'
      );

    const before = await coverage();
    const { id } = (await file(conditionReport(unit))).body.data;
    expect((await confirm(id, {}, pic)).status).toBe(200);

    const after = await coverage();
    expect(after).toMatchObject({
      assessed: before.assessed,
      assessedByOthers: before.assessedByOthers,
    });
  });
});

describe('PERAWATAN', () => {
  it('ticks the confirmed condition and keeps the narrative as the month’s note', async () => {
    const unit = await unitAt(room);
    const { id } = (await file(conditionReport(unit))).body.data;
    await confirm(id, {}, reviewer);

    const months = reports.monthWindow();
    const history = await reports.maintenanceHistoryFor([{ unitId: unit.id }], months, models);
    const thisMonth = history.get(unit.id).at(-1);
    expect(thisMonth.condition).toBe('DAMAGED');
    expect(thisMonth.note).toContain('Layar retak');
  });
});

describe('the schema (migrations 065, 066)', () => {
  it('keeps the condition required on MANUAL and BORROWING rows', async () => {
    const unit = await unitAt(room);
    const insert = (entryType) =>
      query(
        `INSERT INTO public.longitudinal_history
           (asset_unit_id, description, condition, location_id, entry_type, effective_from)
         VALUES ($1, 'x', NULL, $2, $3, now() + interval '1 day')`,
        [unit.id, room.id, entryType]
      );
    for (const type of ['MANUAL', 'BORROWING']) {
      await expect(insert(type)).rejects.toThrow(/chk_longitudinal_history_condition/);
    }
  });

  it('refuses a review that breaks the rules even below the API', async () => {
    const unit = await unitAt(room);
    const { id } = (await file(conditionReport(unit))).body.data;
    await expect(
      query(
        `UPDATE public.asset_unit_reports SET status = 'CONFIRMED', reviewed_by = reporter_id,
                reviewed_at = now() WHERE id = $1`,
        [id]
      )
    ).rejects.toThrow(/chk_aur_reviewer|chk_aur_history/);
    await expect(
      query(
        `UPDATE public.asset_unit_reports SET status = 'REJECTED', reviewed_by = $2,
                reviewed_at = now() WHERE id = $1`,
        [id, reviewer.user.id]
      )
    ).rejects.toThrow(/chk_aur_reject_note/);
  });

  it('refuses to roll back while reports or REPORT rows exist, then rolls back and re-applies', async () => {
    const CYCLE = cycleDatabaseUrl();
    await migrate(CYCLE);
    const one = async (sql, params) => (await query(sql, params, CYCLE))[0];

    const institution = await one(
      `INSERT INTO public.institutions (name, code, address) VALUES ('C', 'CYC065', 'x') RETURNING id`
    );
    await query(
      `INSERT INTO ref.asset_classifications (id, name) VALUES ('999999999065', 'Cycle 065')`,
      [],
      CYCLE
    );
    const location = await one(
      `INSERT INTO public.locations (name, classification_id, institution_id)
       VALUES ('Kelas', '999999999065', $1) RETURNING id`,
      [institution.id]
    );
    const asset = await one(
      `INSERT INTO public.assets (name, classification_id, institution_id)
       VALUES ('Laptop', '999999999065', $1) RETURNING id`,
      [institution.id]
    );
    const unit = await one(
      `INSERT INTO public.asset_units (asset_id, inventory_code) VALUES ($1, 'CYC-065-1') RETURNING id`,
      [asset.id]
    );
    const user = await one(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-reports', $1, 'Cycle', 'Reports', $2) RETURNING id`,
      [`$2b$10$${'0'.repeat(53)}`, institution.id]
    );
    const history = await one(
      `INSERT INTO public.longitudinal_history
         (asset_unit_id, description, condition, location_id, entry_type, effective_from)
       VALUES ($1, 'From a report', NULL, $2, 'REPORT', now()) RETURNING id`,
      [unit.id, location.id]
    );
    const report = await one(
      `INSERT INTO public.asset_unit_reports (institution_id, asset_unit_id, kind, narrative,
         snapshot_location_id, snapshot_location_name, reporter_id)
       VALUES ($1, $2, 'OBSERVATION', 'x', $3, 'Kelas', $4) RETURNING id`,
      [institution.id, unit.id, location.id, user.id]
    );

    const cleanup = async () => {
      await query('DELETE FROM public.asset_unit_reports WHERE id = $1', [report.id], CYCLE).catch(
        () => undefined
      );
      await query('DELETE FROM public.longitudinal_history WHERE id = $1', [history.id], CYCLE);
    };

    try {
      await expect(runCli(['db:migrate:undo', '--name', M066], CYCLE)).rejects.toThrow(
        /Migration 066 rollback refused: 1 unit report/
      );
      await query('DELETE FROM public.asset_unit_reports WHERE id = $1', [report.id], CYCLE);
      await expect(runCli(['db:migrate:undo', '--name', M066], CYCLE)).rejects.toThrow(
        /Migration 066 rollback refused: 1 REPORT history row/
      );
      await query(
        `UPDATE public.longitudinal_history SET condition = 'GOOD' WHERE id = $1`,
        [history.id],
        CYCLE
      );
      await runCli(['db:migrate:undo', '--name', M066], CYCLE);
      await expect(runCli(['db:migrate:undo', '--name', M065], CYCLE)).rejects.toThrow(
        /Migration 065 rollback refused/
      );
      await query('DELETE FROM public.longitudinal_history WHERE id = $1', [history.id], CYCLE);
      await runCli(['db:migrate:undo', '--name', M065], CYCLE);

      const values = await query(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'history_entry_type' ORDER BY e.enumsortorder`,
        [],
        CYCLE
      );
      expect(values.map((row) => row.enumlabel)).toEqual(['MANUAL', 'BORROWING', 'SYSTEM']);
      const table = await one(`SELECT to_regclass('public.asset_unit_reports') AS t`);
      expect(table.t).toBeNull();
    } finally {
      await migrate(CYCLE);
      await cleanup();
      for (const [table, rowId] of [
        ['users', user.id],
        ['asset_units', unit.id],
        ['assets', asset.id],
        ['locations', location.id],
        ['institutions', institution.id],
      ]) {
        await query(`DELETE FROM public.${table} WHERE id = $1`, [rowId], CYCLE);
      }
      await query(`DELETE FROM ref.asset_classifications WHERE id = '999999999065'`, [], CYCLE);
    }
  });
});
