import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetAssetCoreData,
  resetOperationsData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Units by location and condition — Phase 32 (`CR-012`), REQ-REPORT-010.
 * TC-REPORT-010.
 *
 * `/reports/by-location` and `/reports/by-condition` each answer one axis of
 * this; neither can answer "which room holds the damaged items". Two properties
 * are being pinned:
 *
 *   IT AGREES WITH ITS NEIGHBOURS  the same units, counted the same way, so the
 *                                  new report cannot quietly drift from the two
 *                                  it crosses.
 *   TOTALS SURVIVE ROLL-UP         under `rollUp` the groups deliberately
 *                                  overlap, so the totals must be counted over
 *                                  the units rather than summed from the groups.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

let admin;
let institution;
let tkj;
let rpl;
let budi;
let asset;
let building;
let floor;
let room;
let annexe;

const get = (path, caller) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

async function createLocation(name, parentLocationId) {
  const response = await api()
    .post(`${V1}/locations`)
    .set(...admin.auth)
    .send({
      name,
      classificationId: LEAF,
      institutionId: institution.id,
      ...(parentLocationId ? { parentLocationId } : {}),
    });

  return response.body.data;
}

/** A unit placed at `locationId` in `condition`, or left unrecorded when null. */
async function placeUnit({ departmentId, locationId, condition }) {
  const unit = (
    await api()
      .post(`${V1}/assets/${asset.id}/units`)
      .set(...admin.auth)
      .send(departmentId ? { departmentId } : {})
  ).body.data;

  if (locationId) {
    await api()
      .post(`${V1}/asset-units/${unit.id}/history`)
      .set(...admin.auth)
      .send({ description: 'Placed', locationId, condition: condition ?? 'GOOD' });
  }

  return unit;
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetOrganizationData();

  admin = await createAdminCaller();

  institution = await models.Institution.create({
    name: 'Alpha',
    code: 'ALPHA',
    address: 'Jl. A',
  });

  tkj = await models.Department.create({
    code: 'TKJ',
    name: 'Teknik Komputer',
    institutionId: institution.id,
  });
  rpl = await models.Department.create({
    code: 'RPL',
    name: 'Rekayasa Perangkat Lunak',
    institutionId: institution.id,
  });

  asset = (
    await api()
      .post(`${V1}/assets`)
      .set(...admin.auth)
      .send({ name: 'Laptop', classificationId: LEAF, institutionId: institution.id })
  ).body.data;

  // Gedung A › Lantai 1 › Ruang 101, plus a sibling at the top.
  building = await createLocation('Gedung A');
  floor = await createLocation('Lantai 1', building.id);
  room = await createLocation('Ruang 101', floor.id);
  annexe = await createLocation('Annexe');

  budi = await createCaller({
    institutionId: institution.id,
    permissions: ['asset-unit:read', 'asset-unit:record-history'],
    isPicScoped: true,
  });

  await models.DepartmentPicAssignment.create({ departmentId: tkj.id, userId: budi.user.id });
  await tkj.update({ currentPicUserId: budi.user.id });
});

afterAll(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetOrganizationData();
});

const groupFor = (body, key) => body.data.groups.find((group) => group.key === key);

describe('the matrix (REQ-REPORT-010)', () => {
  beforeEach(async () => {
    await placeUnit({ departmentId: tkj.id, locationId: room.id, condition: 'GOOD' });
    await placeUnit({ departmentId: tkj.id, locationId: room.id, condition: 'GOOD' });
    await placeUnit({ departmentId: tkj.id, locationId: room.id, condition: 'DAMAGED' });
    await placeUnit({ departmentId: rpl.id, locationId: annexe.id, condition: 'FAIR' });
    // Registered but never placed: no location, and no condition either.
    await placeUnit({ departmentId: rpl.id, locationId: null });
  });

  it('breaks each location down by condition', async () => {
    const body = (await get('/reports/by-location-condition', admin)).body;

    expect(groupFor(body, room.id)).toMatchObject({
      label: 'Ruang 101',
      parentId: floor.id,
      counts: { GOOD: 2, FAIR: 0, POOR: 0, DAMAGED: 1, UNSERVICEABLE: 0 },
      unrecorded: 0,
      total: 3,
    });
  });

  it('carries a column for every stored condition, present or not', async () => {
    const body = (await get('/reports/by-location-condition', admin)).body;

    expect(Object.keys(groupFor(body, annexe.id).counts)).toEqual([
      'GOOD',
      'FAIR',
      'POOR',
      'DAMAGED',
      'UNSERVICEABLE',
    ]);
  });

  /**
   * A unit that has never been assessed has no location AND no condition. Both
   * absences are reported rather than folded into a total that hides them.
   */
  it('reports unlocated units as their own group', async () => {
    const body = (await get('/reports/by-location-condition', admin)).body;

    expect(groupFor(body, null)).toMatchObject({ label: null, unrecorded: 1, total: 1 });
    expect(body.data.totals).toMatchObject({ units: 5, unlocated: 1, unrecorded: 1 });
  });

  it('counts only the units standing exactly there by default', async () => {
    const body = (await get('/reports/by-location-condition', admin)).body;

    // The building and floor hold nothing themselves.
    expect(groupFor(body, building.id)).toBeUndefined();
    expect(groupFor(body, floor.id)).toBeUndefined();
  });

  it('agrees with /reports/by-location and /reports/by-condition', async () => {
    const matrix = (await get('/reports/by-location-condition', admin)).body.data;
    const byLocation = (await get('/reports/by-location', admin)).body.data;
    const byCondition = (await get('/reports/by-condition', admin)).body.data;

    expect(matrix.totals.units).toBe(byLocation.totals.units);
    expect(matrix.totals.unlocated).toBe(byLocation.totals.unlocated);
    expect(matrix.totals.unrecorded).toBe(byCondition.totals.unrecorded);

    const good = matrix.groups.reduce((sum, group) => sum + group.counts.GOOD, 0);
    expect(good).toBe(byCondition.groups.find((group) => group.key === 'GOOD').count);
  });
});

describe('hierarchy roll-up', () => {
  beforeEach(async () => {
    await placeUnit({ departmentId: tkj.id, locationId: room.id, condition: 'GOOD' });
    await placeUnit({ departmentId: tkj.id, locationId: floor.id, condition: 'DAMAGED' });
    await placeUnit({ departmentId: rpl.id, locationId: annexe.id, condition: 'GOOD' });
  });

  it('includes everything beneath a location when rolled up', async () => {
    const body = (await get('/reports/by-location-condition?rollUp=true', admin)).body;

    expect(groupFor(body, building.id)).toMatchObject({
      counts: { GOOD: 1, FAIR: 0, POOR: 0, DAMAGED: 1, UNSERVICEABLE: 0 },
      total: 2,
    });
    // A leaf still counts its own units — the closure includes the self-row.
    expect(groupFor(body, room.id).total).toBe(1);
  });

  /**
   * The groups overlap by design once rolled up: a unit in a room is also
   * counted in its floor and its building. The totals must therefore be counted
   * over the units, never summed from the groups.
   */
  it('keeps totals honest even though the groups overlap', async () => {
    const direct = (await get('/reports/by-location-condition', admin)).body.data;
    const rolled = (await get('/reports/by-location-condition?rollUp=true', admin)).body.data;

    expect(direct.totals.units).toBe(3);
    expect(rolled.totals.units).toBe(3);

    expect(direct.groups.reduce((sum, group) => sum + group.total, 0)).toBe(3);
    expect(rolled.groups.reduce((sum, group) => sum + group.total, 0)).toBeGreaterThan(3);
  });

  it('restricts to one subtree when a location is named', async () => {
    // The building holds nothing directly — the units are on the floor and in
    // the room beneath it — so `direct` correctly counts none of them.
    const body = (await get(`/reports/by-location-condition?locationId=${building.id}`, admin))
      .body;

    expect(body.data.totals.units).toBe(0);

    const rolled = (
      await get(`/reports/by-location-condition?locationId=${building.id}&rollUp=true`, admin)
    ).body;
    expect(rolled.data.totals.units).toBe(2);
  });

  it('reports which mode answered', async () => {
    expect((await get('/reports/by-location-condition', admin)).body.data.totals.rollUp).toBe(
      false
    );
    expect(
      (await get('/reports/by-location-condition?rollUp=true', admin)).body.data.totals.rollUp
    ).toBe(true);
  });
});

describe('scope (CR-012 DEC-N)', () => {
  beforeEach(async () => {
    await placeUnit({ departmentId: tkj.id, locationId: room.id, condition: 'GOOD' });
    await placeUnit({ departmentId: rpl.id, locationId: room.id, condition: 'DAMAGED' });
    await placeUnit({ departmentId: null, locationId: room.id, condition: 'GOOD' });
  });

  /**
   * The room holds three units from three different owners. A PIC must see only
   * their own — the aggregate cannot become a way to count somebody else's
   * property just because it stands in a shared space.
   */
  it('shows a PIC only their own units in a shared room', async () => {
    const mine = (await get('/reports/by-location-condition', budi)).body.data;
    const theirs = (await get('/reports/by-location-condition', admin)).body.data;

    expect(mine.totals.units).toBe(1);
    expect(theirs.totals.units).toBe(3);
    expect(mine.groups[0].counts).toMatchObject({ GOOD: 1, DAMAGED: 0 });
  });

  it('cannot be widened by naming another department', async () => {
    const body = (await get(`/reports/by-location-condition?departmentId=${rpl.id}`, budi)).body;

    expect(body.data.totals.units).toBe(0);
  });

  it('cannot be widened by naming a location', async () => {
    const body = (await get(`/reports/by-location-condition?locationId=${room.id}`, budi)).body;

    expect(body.data.totals.units).toBe(1);
  });

  it('lets an institution caller filter by department normally', async () => {
    const body = (await get(`/reports/by-location-condition?departmentId=${rpl.id}`, admin)).body;

    expect(body.data.totals.units).toBe(1);
    expect(body.data.groups[0].counts.DAMAGED).toBe(1);
  });

  it('does not show another institution’s units', async () => {
    const other = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
    const otherAsset = (
      await api()
        .post(`${V1}/assets`)
        .set(...admin.auth)
        .send({ name: 'Printer', classificationId: LEAF, institutionId: other.id })
    ).body.data;
    await api()
      .post(`${V1}/assets/${otherAsset.id}/units`)
      .set(...admin.auth)
      .send({});

    const scoped = await createCaller({
      institutionId: institution.id,
      permissions: ['asset-unit:read'],
    });

    expect((await get('/reports/by-location-condition', scoped)).body.data.totals.units).toBe(3);
  });
});

describe('the drill-down target (CR-012, REQ-REPORT-009 amended)', () => {
  beforeEach(async () => {
    await placeUnit({ departmentId: tkj.id, locationId: room.id, condition: 'GOOD' });
    await placeUnit({ departmentId: tkj.id, locationId: floor.id, condition: 'GOOD' });
  });

  it('matches the location exactly by default', async () => {
    const body = (await get(`/reports/inventory-units?locationId=${building.id}`, admin)).body;

    expect(body.meta.total).toBe(0);
  });

  it('includes descendants when asked', async () => {
    const body = (
      await get(`/reports/inventory-units?locationId=${building.id}&locationScope=all`, admin)
    ).body;

    expect(body.meta.total).toBe(2);
  });

  it('reconciles a matrix cell with the units behind it', async () => {
    const cell = groupFor((await get('/reports/by-location-condition', admin)).body, room.id);
    const units = (
      await get(`/reports/inventory-units?locationId=${room.id}&condition=GOOD`, admin)
    ).body;

    expect(units.meta.total).toBe(cell.counts.GOOD);
  });

  /**
   * REGRESSION — a defect this phase found and fixed, predating `CR-012`.
   *
   * `buildWhere` returns a plain object for one filter and `{ [Op.and]: [...] }`
   * for two or more. `Op.and` is a Symbol, so the `Object.keys(...).length > 0`
   * guard in `inventoryUnits` saw zero keys on the second shape and discarded
   * the caller's ENTIRE filter set — silently, answering `200` with the full
   * list. Organization scope was never affected, so this was a wrong answer
   * rather than a leak; it is pinned here because a drill-down that quietly
   * ignores half its filters is indistinguishable from one that works until
   * somebody counts the rows.
   */
  it('applies every filter when several are combined', async () => {
    const oneFilter = (await get(`/reports/inventory-units?locationId=${room.id}`, admin)).body;
    const twoFilters = (
      await get(`/reports/inventory-units?locationId=${room.id}&condition=GOOD`, admin)
    ).body;
    const threeFilters = (
      await get(
        `/reports/inventory-units?locationId=${room.id}&condition=GOOD&departmentId=${tkj.id}`,
        admin
      )
    ).body;
    const unfiltered = (await get('/reports/inventory-units', admin)).body;

    expect(unfiltered.meta.total).toBe(2);
    expect(oneFilter.meta.total).toBe(1);
    // The point of the regression: adding filters must never widen the result.
    expect(twoFilters.meta.total).toBe(1);
    expect(threeFilters.meta.total).toBe(1);
  });

  it('still narrows when a combination matches nothing', async () => {
    const body = (
      await get(`/reports/inventory-units?locationId=${room.id}&condition=DAMAGED`, admin)
    ).body;

    expect(body.meta.total).toBe(0);
  });
});
