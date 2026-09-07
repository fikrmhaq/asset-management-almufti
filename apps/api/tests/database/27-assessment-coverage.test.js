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
 * Monthly assessment coverage — Phase 32 (`CR-012`), REQ-COND-006,
 * REQ-REPORT-011/012. TC-COND-006, TC-REPORT-011, TC-REPORT-012.
 *
 * THE RULE THIS FILE EXISTS TO PIN:
 *
 *   Every applicable asset unit belonging to a department must have at least one
 *   qualifying MANUAL assessment during the business month. Coverage counts
 *   UNIQUE asset units; individual activity is counted separately.
 *
 * The first test is the one that matters most — two people assessing the same
 * unit is one unit of coverage and two entries — because every other number in
 * the feature is built on that distinction holding.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

/** Jakarta is UTC+7, so a business month runs 17:00Z to 17:00Z. */
const JAKARTA_OFFSET_HOURS = 7;

let admin;
let institution;
let tkj;
let rpl;
let budi; // PIC of TKJ
let sari; // PIC of RPL
let staff; // institution-scoped, same unit permissions
let asset;

const UNIT_PERMISSIONS = ['asset-unit:read', 'asset-unit:update', 'asset-unit:record-history'];

/** The month the suite reports on, chosen so "now" always falls inside it. */
const month = () => new Date().toISOString().slice(0, 7);

const get = (path, caller) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

async function createUnit(departmentId) {
  const response = await api()
    .post(`${V1}/assets/${asset.id}/units`)
    .set(...admin.auth)
    .send(departmentId ? { departmentId } : {});

  return response.body.data;
}

/** Records a manual assessment as `caller`, which is the only qualifying write. */
async function assess(unitId, caller, description = 'Monthly check') {
  const response = await api()
    .post(`${V1}/asset-units/${unitId}/history`)
    .set(...caller.auth)
    .send({ description, condition: 'GOOD', locationId: location.id });

  expect(response.status).toBe(200);
  return response.body.data;
}

let location;

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

  location = (
    await api()
      .post(`${V1}/locations`)
      .set(...admin.auth)
      .send({ name: 'Ruang 101', classificationId: LEAF, institutionId: institution.id })
  ).body.data;

  asset = (
    await api()
      .post(`${V1}/assets`)
      .set(...admin.auth)
      .send({ name: 'Laptop', classificationId: LEAF, institutionId: institution.id })
  ).body.data;

  budi = await createCaller({
    institutionId: institution.id,
    permissions: UNIT_PERMISSIONS,
    isPicScoped: true,
  });
  sari = await createCaller({
    institutionId: institution.id,
    permissions: UNIT_PERMISSIONS,
    isPicScoped: true,
  });
  staff = await createCaller({ institutionId: institution.id, permissions: UNIT_PERMISSIONS });

  await models.DepartmentPicAssignment.create({ departmentId: tkj.id, userId: budi.user.id });
  await tkj.update({ currentPicUserId: budi.user.id });
  await models.DepartmentPicAssignment.create({ departmentId: rpl.id, userId: sari.user.id });
  await rpl.update({ currentPicUserId: sari.user.id });
});

afterAll(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetOrganizationData();
});

const departmentIn = (body, code) => body.data.groups.find((group) => group.code === code);

describe('coverage counts unique asset units (CR-012 DEC-E)', () => {
  /**
   * THE CORE RULE.
   *
   * Two eligible people assessing the SAME unit is one unit of coverage and two
   * entries. If this ever inverts, every figure the feature produces is wrong in
   * the direction that flatters the department.
   */
  it('counts a unit once however many times it is assessed', async () => {
    const unit = await createUnit(tkj.id);
    await createUnit(tkj.id);

    await assess(unit.id, budi, 'First look');
    await assess(unit.id, budi, 'Second look');

    const coverage = await get(`/reports/assessment-coverage?month=${month()}`, admin);
    const activity = await get(`/reports/assessment-activity?month=${month()}`, admin);

    expect(departmentIn(coverage.body, 'TKJ')).toMatchObject({
      applicable: 2,
      assessed: 1,
      unassessed: 1,
      coverage: 0.5,
    });

    const budiActivity = activity.body.data.groups.find((row) => row.key === budi.user.id);
    expect(budiActivity).toMatchObject({ entries: 2, uniqueUnits: 1, qualifyingUnits: 1 });
  });

  it('reaches full coverage when every unit has one assessment', async () => {
    for (const unit of [await createUnit(tkj.id), await createUnit(tkj.id)]) {
      await assess(unit.id, budi);
    }

    const response = await get(`/reports/assessment-coverage?month=${month()}`, admin);

    expect(departmentIn(response.body, 'TKJ')).toMatchObject({
      applicable: 2,
      assessed: 2,
      unassessed: 0,
      coverage: 1,
      state: 'TRACKED',
    });
  });
});

describe('what qualifies (CR-012 DEC-A, DEC-F)', () => {
  it('does not count a BORROWING entry', async () => {
    const unit = await createUnit(tkj.id);
    // A manual entry first, so the unit is ACTIVE and can be borrowed at all.
    await assess(unit.id, budi);
    await api()
      .post(`${V1}/asset-units/${unit.id}/history`)
      .set(...admin.auth)
      .send({ description: 'Ready', lifecycleState: 'ACTIVE' });

    const before = await get(`/reports/assessment-coverage?month=${month()}`, admin);
    expect(departmentIn(before.body, 'TKJ').assessed).toBe(1);

    const borrowing = (
      await api()
        .post(`${V1}/borrowings`)
        .set(...admin.auth)
        .send({
          borrowerName: 'Bu Tuti',
          borrowerContact: 'tuti@example.test',
          borrowDate: new Date().toISOString().slice(0, 10),
          expectedReturnDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
          institutionId: institution.id,
        })
    ).body.data;

    await api()
      .post(`${V1}/borrowings/${borrowing.id}/items`)
      .set(...admin.auth)
      .send({ assetUnitId: unit.id });
    await api()
      .post(`${V1}/borrowings/${borrowing.id}/activate`)
      .set(...admin.auth);

    // The borrowing wrote a history row. It must not move the figure.
    const after = await get(`/reports/assessment-coverage?month=${month()}`, admin);
    expect(departmentIn(after.body, 'TKJ').assessed).toBe(1);
  });

  /**
   * `DEC-F`: the obligation belongs to the department, so an institution
   * administrator's entry does not discharge it — but the unit HAS been looked
   * at, and `assessedByOthers` says so rather than letting the gap look
   * unexplained (`DEC-G`).
   */
  it('does not count an entry by someone who was not the department PIC', async () => {
    const unit = await createUnit(tkj.id);

    await assess(unit.id, staff, 'Checked by head office');

    const response = await get(`/reports/assessment-coverage?month=${month()}`, admin);

    expect(departmentIn(response.body, 'TKJ')).toMatchObject({
      applicable: 1,
      assessed: 0,
      unassessed: 1,
      assessedByOthers: 1,
      coverage: 0,
    });
  });

  it('never adds assessedByOthers into assessed', async () => {
    const unit = await createUnit(tkj.id);

    await assess(unit.id, budi, 'By the PIC');
    await assess(unit.id, staff, 'And by head office');

    // One unit, assessed by the responsible person. It is covered, and it is
    // NOT also reported as somebody else's — that column explains the gap.
    expect(
      departmentIn((await get(`/reports/assessment-coverage?month=${month()}`, admin)).body, 'TKJ')
    ).toMatchObject({ applicable: 1, assessed: 1, assessedByOthers: 0, coverage: 1 });
  });

  /**
   * A handover part-way through the month must not void the outgoing PIC's
   * work. Attribution reads the assignment history, not `is_current` — the
   * distinction `CR-003` §11 draws between authorization and audit.
   */
  it('keeps an outgoing PIC’s assessments after a handover', async () => {
    const unit = await createUnit(tkj.id);
    await assess(unit.id, budi, 'Recorded while in post');

    await api()
      .put(`${V1}/departments/${tkj.id}/pic`)
      .set(...admin.auth)
      .send({ userId: staff.user.id });

    const response = await get(`/reports/assessment-coverage?month=${month()}`, admin);

    expect(departmentIn(response.body, 'TKJ')).toMatchObject({ assessed: 1, coverage: 1 });
  });
});

describe('the applicable set (CR-012 DEC-J)', () => {
  it('keeps a borrowed unit applicable and reports it separately', async () => {
    const unit = await createUnit(tkj.id);
    await assess(unit.id, budi);
    await models.AssetUnit.update({ lifecycleState: 'BORROWED' }, { where: { id: unit.id } });

    const group = departmentIn(
      (await get(`/reports/assessment-coverage?month=${month()}`, admin)).body,
      'TKJ'
    );

    expect(group).toMatchObject({ applicable: 1, applicableBorrowed: 1 });
  });

  it.each(['DISPOSED', 'DEACTIVATED'])('excludes a %s unit from the denominator', async (state) => {
    const unit = await createUnit(tkj.id);
    await createUnit(tkj.id);
    await models.AssetUnit.update({ lifecycleState: state }, { where: { id: unit.id } });

    expect(
      departmentIn((await get(`/reports/assessment-coverage?month=${month()}`, admin)).body, 'TKJ')
        .applicable
    ).toBe(1);
  });

  it('keeps an UNDER_MAINTENANCE unit applicable', async () => {
    const unit = await createUnit(tkj.id);
    await models.AssetUnit.update(
      { lifecycleState: 'UNDER_MAINTENANCE' },
      { where: { id: unit.id } }
    );

    expect(
      departmentIn((await get(`/reports/assessment-coverage?month=${month()}`, admin)).body, 'TKJ')
        .applicable
    ).toBe(1);
  });

  it('excludes an inactive unit', async () => {
    const unit = await createUnit(tkj.id);
    await api()
      .post(`${V1}/asset-units/${unit.id}/deactivate`)
      .set(...admin.auth);

    expect(
      departmentIn((await get(`/reports/assessment-coverage?month=${month()}`, admin)).body, 'TKJ')
        .applicable
    ).toBe(0);
  });

  /**
   * A unit registered in September was never assessable in August. Without this
   * every past month would appear to degrade as the estate grows.
   */
  it('excludes a unit registered after the month ended', async () => {
    await createUnit(tkj.id);

    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);

    const response = await get(
      `/reports/assessment-coverage?month=${lastMonth.toISOString().slice(0, 7)}`,
      admin
    );

    expect(departmentIn(response.body, 'TKJ').applicable).toBe(0);
  });
});

describe('department states (CR-012 DEC-I)', () => {
  it('reports NO_UNITS rather than zero per cent', async () => {
    const group = departmentIn(
      (await get(`/reports/assessment-coverage?month=${month()}`, admin)).body,
      'TKJ'
    );

    expect(group).toMatchObject({ state: 'NO_UNITS', applicable: 0, coverage: null });
  });

  it('reports NO_RESPONSIBLE_USER when the post is vacant', async () => {
    await createUnit(tkj.id);
    await api()
      .delete(`${V1}/departments/${tkj.id}/pic`)
      .set(...admin.auth);

    const group = departmentIn(
      (await get(`/reports/assessment-coverage?month=${month()}`, admin)).body,
      'TKJ'
    );

    expect(group).toMatchObject({ state: 'NO_RESPONSIBLE_USER', responsible: null });
    // The counts are still reported — the department is not excused, it is unstaffed.
    expect(group.applicable).toBe(1);
  });

  /**
   * The other half of `DEC-I`, and the one a naive implementation misses: the
   * assignment exists, the capability does not.
   */
  it('reports NO_RESPONSIBLE_USER when the PIC cannot record history', async () => {
    await createUnit(tkj.id);

    const cannotRecord = await createCaller({
      institutionId: institution.id,
      permissions: ['asset-unit:read'],
      isPicScoped: true,
    });

    await api()
      .put(`${V1}/departments/${tkj.id}/pic`)
      .set(...admin.auth)
      .send({ userId: cannotRecord.user.id });

    const group = departmentIn(
      (await get(`/reports/assessment-coverage?month=${month()}`, admin)).body,
      'TKJ'
    );

    expect(group.state).toBe('NO_RESPONSIBLE_USER');
    expect(group.responsible).not.toBeNull();
  });

  it('still reports a deactivated department that holds applicable units', async () => {
    await createUnit(tkj.id);
    await api()
      .post(`${V1}/departments/${tkj.id}/deactivate`)
      .set(...admin.auth);

    const group = departmentIn(
      (await get(`/reports/assessment-coverage?month=${month()}`, admin)).body,
      'TKJ'
    );

    expect(group).toMatchObject({ isActive: false, applicable: 1 });
  });

  it('drops a deactivated department with nothing left on its books', async () => {
    await api()
      .post(`${V1}/departments/${tkj.id}/deactivate`)
      .set(...admin.auth);

    const response = await get(`/reports/assessment-coverage?month=${month()}`, admin);

    expect(departmentIn(response.body, 'TKJ')).toBeUndefined();
    expect(departmentIn(response.body, 'RPL')).toBeDefined();
  });
});

describe('units with no department (CR-012 DEC-K)', () => {
  it('excludes them from every department and reports them separately', async () => {
    await createUnit(null);
    await createUnit(tkj.id);

    const body = (await get(`/reports/assessment-coverage?month=${month()}`, admin)).body;

    expect(departmentIn(body, 'TKJ').applicable).toBe(1);
    expect(body.data.unassigned).toMatchObject({ applicable: 1, withManualEntry: 0 });
    // Never a pseudo-department row, which would sort into the table as one.
    expect(body.data.groups.some((group) => group.key === null)).toBe(false);
  });

  it('reports whether anyone has looked at them', async () => {
    const orphan = await createUnit(null);
    await assess(orphan.id, staff);

    const body = (await get(`/reports/assessment-coverage?month=${month()}`, admin)).body;

    expect(body.data.unassigned).toMatchObject({ applicable: 1, withManualEntry: 1 });
  });
});

describe('the business month (CR-012 DEC-D, DEC-L)', () => {
  it('reports Asia/Jakarta bounds ending 17:00Z', async () => {
    const { totals } = (await get('/reports/assessment-coverage?month=2026-08', admin)).body.data;

    expect(totals.month).toBe('2026-08');
    expect(totals.timeZone).toBe('Asia/Jakarta');
    expect(new Date(totals.monthStart).toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(new Date(totals.monthEnd).toISOString()).toBe('2026-08-31T17:00:00.000Z');
  });

  it('defaults to the current business month', async () => {
    const { totals } = (await get('/reports/assessment-coverage', admin)).body.data;

    const now = new Date();
    const jakarta = new Date(now.getTime() + JAKARTA_OFFSET_HOURS * 3600_000);
    expect(totals.month).toBe(jakarta.toISOString().slice(0, 7));
  });

  it.each(['2026-13', '2026', 'august', '2026-8'])(
    'refuses a malformed month "%s"',
    async (bad) => {
      const response = await get(`/reports/assessment-coverage?month=${bad}`, admin);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  );

  /**
   * `DEC-D`: the month is keyed on `created_at`, so backdating `effectiveFrom`
   * moves when the condition APPLIED and not which month the work counted for.
   * A closed month's figure cannot be edited after the fact.
   */
  it('counts the month the entry was written, not the date it names', async () => {
    const unit = await createUnit(tkj.id);

    const backdated = new Date();
    backdated.setUTCMonth(backdated.getUTCMonth() - 1);

    await api()
      .post(`${V1}/asset-units/${unit.id}/history`)
      .set(...budi.auth)
      .send({
        description: 'Inspected last month, written up today',
        condition: 'GOOD',
        locationId: location.id,
        effectiveFrom: backdated.toISOString(),
      });

    const thisMonth = await get(`/reports/assessment-coverage?month=${month()}`, admin);
    const previous = await get(
      `/reports/assessment-coverage?month=${backdated.toISOString().slice(0, 7)}`,
      admin
    );

    expect(departmentIn(thisMonth.body, 'TKJ').assessed).toBe(1);
    expect(departmentIn(previous.body, 'TKJ').assessed).toBe(0);
  });
});

/**
 * The security boundary — `CR-012` `DEC-N`.
 *
 * These reports are reachable by a PIC-scoped caller, unlike the eight
 * `report:read` aggregates, so every one of them must narrow to the caller's own
 * departments INSIDE the aggregation.
 */
describe('scope isolation (CR-012 DEC-N)', () => {
  beforeEach(async () => {
    await assess((await createUnit(tkj.id)).id, budi);
    await createUnit(tkj.id);
    await assess((await createUnit(rpl.id)).id, sari);
    await createUnit(null);
  });

  it('shows a PIC only their own department', async () => {
    const body = (await get(`/reports/assessment-coverage?month=${month()}`, budi)).body;

    expect(body.data.groups.map((group) => group.code)).toEqual(['TKJ']);
  });

  it('computes a PIC’s totals over their own departments only', async () => {
    const body = (await get(`/reports/assessment-coverage?month=${month()}`, budi)).body;

    // 2 units in TKJ, not the 3 that exist across departments, and not the 4
    // including the unassigned one.
    expect(body.data.totals).toMatchObject({ departments: 1, applicable: 2, assessed: 1 });
    expect(body.data.totals.applicable).toBe(
      body.data.groups.reduce((sum, group) => sum + group.applicable, 0)
    );
  });

  it('omits the unassigned block for a PIC rather than zeroing it', async () => {
    const mine = (await get(`/reports/assessment-coverage?month=${month()}`, budi)).body;
    const theirs = (await get(`/reports/assessment-coverage?month=${month()}`, admin)).body;

    expect(mine.data.unassigned).toBeNull();
    expect(theirs.data.unassigned.applicable).toBe(1);
  });

  it('returns nothing when a PIC names another department', async () => {
    const body = (
      await get(`/reports/assessment-coverage?month=${month()}&departmentId=${rpl.id}`, budi)
    ).body;

    expect(body.data.groups).toEqual([]);
    expect(body.data.totals.applicable).toBe(0);
  });

  it('refuses another institution rather than answering emptily', async () => {
    const other = await models.Institution.create({
      name: 'Beta',
      code: 'BETA',
      address: 'Jl. B',
    });

    const response = await get(
      `/reports/assessment-coverage?month=${month()}&institutionId=${other.id}`,
      budi
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('narrows a PIC’s activity to contributors on their own units', async () => {
    const body = (await get(`/reports/assessment-activity?month=${month()}`, budi)).body;

    expect(body.data.groups.map((row) => row.key)).toEqual([budi.user.id]);
    expect(body.data.totals.assessed).toBe(1);
  });

  it('narrows a PIC’s location matrix to their own units', async () => {
    const mine = (await get('/reports/by-location-condition', budi)).body;
    const theirs = (await get('/reports/by-location-condition', admin)).body;

    expect(mine.data.totals.units).toBe(2);
    expect(theirs.data.totals.units).toBe(4);
  });

  it('holds for a PIC with no current post at all', async () => {
    const nobody = await createCaller({
      institutionId: institution.id,
      permissions: UNIT_PERMISSIONS,
      isPicScoped: true,
    });

    const body = (await get(`/reports/assessment-coverage?month=${month()}`, nobody)).body;

    expect(body.data.groups).toEqual([]);
    expect(body.data.unassigned).toBeNull();
  });

  it('requires asset-unit:read, and does not accept report:read instead', async () => {
    const reporter = await createCaller({
      institutionId: institution.id,
      permissions: ['report:read'],
    });

    for (const path of [
      '/reports/assessment-coverage',
      '/reports/assessment-activity',
      '/reports/by-location-condition',
    ]) {
      expect((await get(path, reporter)).status).toBe(403);
    }
  });
});

describe('activity is not coverage (CR-012, REQ-REPORT-012)', () => {
  it('reports entries and unique units as separate figures', async () => {
    const first = await createUnit(tkj.id);
    const second = await createUnit(tkj.id);

    await assess(first.id, budi);
    await assess(first.id, budi);
    await assess(second.id, budi);

    const body = (await get(`/reports/assessment-activity?month=${month()}`, admin)).body;
    const row = body.data.groups.find((group) => group.key === budi.user.id);

    expect(row).toMatchObject({ entries: 3, uniqueUnits: 2, qualifyingUnits: 2 });
    expect(body.data.totals.assessed).toBe(2);
  });

  /**
   * Contribution is a share of COVERED units, so two people assessing the same
   * unit legitimately sum above 100%. `totals.assessed` is returned beside the
   * rows so the overlap is legible rather than confusing.
   */
  it('allows contributions to exceed the whole when work overlaps', async () => {
    const unit = await createUnit(tkj.id);

    await assess(unit.id, budi);
    // A second PIC of the same department is impossible under the current model,
    // so the overlap is produced by the same person recording twice — which is
    // the case the metric has to survive either way.
    await assess(unit.id, budi);

    const body = (await get(`/reports/assessment-activity?month=${month()}`, admin)).body;

    expect(body.data.totals.assessed).toBe(1);
    expect(body.data.groups[0]).toMatchObject({ entries: 2, uniqueUnits: 1, contribution: 1 });
  });

  it('labels a contributor who was not the PIC as INSTITUTION', async () => {
    const unit = await createUnit(tkj.id);
    await assess(unit.id, staff);

    const row = (
      await get(`/reports/assessment-activity?month=${month()}`, admin)
    ).body.data.groups.find((group) => group.key === staff.user.id);

    expect(row).toMatchObject({ relationship: 'INSTITUTION', qualifyingUnits: 0, uniqueUnits: 1 });
  });

  it('never exposes a password hash on a contributor', async () => {
    await assess((await createUnit(tkj.id)).id, budi);

    const body = (await get(`/reports/assessment-activity?month=${month()}`, admin)).body;

    expect(body.data.groups[0].user).toEqual({
      id: budi.user.id,
      username: expect.any(String),
      firstName: expect.any(String),
      lastName: expect.any(String),
    });
  });
});

/**
 * The drill-down must reconcile with the figure it was reached through — a
 * coverage cell saying "2 unassessed" has to list exactly those two.
 */
describe('the unassessed drill-down (CR-012, REQ-REPORT-009 amended)', () => {
  it('partitions the coverage denominator exactly', async () => {
    const assessed = await createUnit(tkj.id);
    await createUnit(tkj.id);
    await createUnit(tkj.id);
    await assess(assessed.id, budi);

    const current = month();
    const coverage = (await get(`/reports/assessment-coverage?month=${current}`, admin)).body.data;
    const unassessed = (await get(`/reports/inventory-units?unassessedIn=${current}`, admin)).body;
    const already = (await get(`/reports/inventory-units?assessedIn=${current}`, admin)).body;

    expect(already.meta.total).toBe(coverage.totals.assessed);
    expect(unassessed.meta.total).toBe(coverage.totals.unassessed);
    expect(already.meta.total + unassessed.meta.total).toBe(coverage.totals.applicable);
  });

  it('excludes a disposed unit from the unassessed list, as from the denominator', async () => {
    const unit = await createUnit(tkj.id);
    await models.AssetUnit.update({ lifecycleState: 'DISPOSED' }, { where: { id: unit.id } });

    const response = await get(`/reports/inventory-units?unassessedIn=${month()}`, admin);

    expect(response.body.meta.total).toBe(0);
  });

  it('excludes a unit with no department', async () => {
    await createUnit(null);

    expect(
      (await get(`/reports/inventory-units?unassessedIn=${month()}`, admin)).body.meta.total
    ).toBe(0);
  });

  it('narrows to a PIC’s own departments', async () => {
    await createUnit(tkj.id);
    await createUnit(rpl.id);

    const body = (await get(`/reports/inventory-units?unassessedIn=${month()}`, budi)).body;

    expect(body.meta.total).toBe(1);
    expect(body.data[0].departmentCode).toBe('TKJ');
  });
});
