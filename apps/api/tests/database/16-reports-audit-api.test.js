import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetOperationsData,
  resetAssetCoreData,
  resetProcurementData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Reporting and audit APIs — `IMPLEMENTATION_PLAN.md` §21.0;
 * `06-api.md` §9, §10; REQ-REPORT-001–008, REQ-AUDIT-001/002/003.
 *
 * The fixture is deliberately small and hand-counted: an aggregate test is only
 * worth anything if the expected number can be derived by reading the setup
 * rather than by running the code under test.
 *
 * Two institutions exist throughout, so every report can be checked for
 * organization scope (`BR-007`) rather than merely for shape.
 */

const V1 = '/api/v1';
const LEAF = '117010101001'; // Aspal
const LEAF_2 = '117010101002'; // Semen

let admin;
let alpha; // institution A
let beta; // institution B
let alphaRoom;
let department;

function request(method, path, caller = admin) {
  return api()
    [method](`${V1}${path}`)
    .set(...caller.auth);
}

const get = (path, caller = admin) => request('get', path, caller);
const post = (path, body, caller = admin) => request('post', path, caller).send(body);

const isoDate = (offsetDays = 0) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

/** An asset with `unitCount` units, optionally commissioned into service. */
async function createAsset({
  name,
  institutionId,
  classificationId = LEAF,
  unitCount = 1,
  contractId,
  lifecycleState,
  condition,
  locationId,
  departmentId,
}) {
  const asset = (
    await post('/assets', {
      name,
      classificationId,
      institutionId,
      ...(contractId ? { contractId } : {}),
    })
  ).body.data;

  const units = [];
  for (let index = 0; index < unitCount; index += 1) {
    const unit = (await post(`/assets/${asset.id}/units`, departmentId ? { departmentId } : {}))
      .body.data;

    if (lifecycleState || condition || locationId) {
      await post(`/asset-units/${unit.id}/history`, {
        ...(condition ? { condition } : {}),
        ...(locationId ? { locationId } : {}),
        ...(lifecycleState ? { lifecycleState } : {}),
        description: 'Fixture state',
      });
    }

    units.push(unit);
  }

  return { asset, units };
}

/**
 * Institutions and departments are created ONCE, not per test.
 *
 * Scoped callers reference their institution (`fk_users_institution`), so
 * deleting institutions between tests would fail on every caller still holding
 * one. Nothing is lost by keeping them: every report aggregates over assets,
 * units and borrowings, and those ARE reset per test — an institution with no
 * assets contributes no group.
 */
beforeAll(async () => {
  await seed();
  admin = await createAdminCaller();

  const suffix = Date.now() % 100000;

  alpha = (await post('/institutions', { name: 'Alpha', code: `A${suffix}`, address: 'Jl. A' }))
    .body.data;
  beta = (await post('/institutions', { name: 'Beta', code: `B${suffix}`, address: 'Jl. B' })).body
    .data;

  // Phase 20 (`CR-003`): a department belongs to an institution, and only
  // `alpha`'s units may carry it.
  department = (
    await post('/departments', { code: `D${suffix}`, name: 'Umum', institutionId: alpha.id })
  ).body.data;
});

beforeEach(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetProcurementData();

  // Locations are removed by the asset-core reset, so this one is rebuilt here.
  alphaRoom = (
    await post('/locations', { name: 'Ruang A', classificationId: LEAF, institutionId: alpha.id })
  ).body.data;
});

afterAll(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
});

describe('reporting: authorization (§9, §1.3)', () => {
  const PATHS = [
    '/reports/inventory',
    '/reports/status',
    '/reports/by-classification',
    '/reports/by-organization',
    '/reports/by-location',
    '/reports/by-condition',
    '/reports/borrowings',
    '/reports/procurement-traceability',
  ];

  it('requires report:read on every report', async () => {
    const nobody = await createCaller({ permissions: [], isSystemWide: true });

    for (const path of PATHS) {
      const response = await get(path, nobody);
      expect(response.status, path).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('accepts a caller holding only report:read', async () => {
    const reader = await createCaller({ permissions: ['report:read'], isSystemWide: true });

    for (const path of PATHS) {
      expect((await get(path, reader)).status, path).toBe(200);
    }
  });

  it('exposes no write path', async () => {
    for (const method of ['post', 'patch', 'delete']) {
      expect((await request(method, '/reports/inventory')).status).toBe(404);
    }
  });
});

describe('GET /reports/inventory (REQ-REPORT-001)', () => {
  it('lists assets with their unit counts', async () => {
    await createAsset({ name: 'Alpha Truck', institutionId: alpha.id, unitCount: 3 });
    await createAsset({ name: 'Alpha Grader', institutionId: alpha.id, unitCount: 1 });

    const response = await get('/reports/inventory');

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(2);

    const truck = response.body.data.find((row) => row.name === 'Alpha Truck');
    expect(truck.unitCount).toBe(3);
    expect(truck.classificationId).toBe(LEAF);
    expect(truck.institutionName).toBe('Alpha');

    const grader = response.body.data.find((row) => row.name === 'Alpha Grader');
    expect(grader.unitCount).toBe(1);
  });

  it('reports zero units rather than omitting an asset with none', async () => {
    await createAsset({ name: 'Empty', institutionId: alpha.id, unitCount: 0 });

    const rows = (await get('/reports/inventory')).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0].unitCount).toBe(0);
  });

  it('filters by classification and search term', async () => {
    await createAsset({ name: 'Aspal Roller', institutionId: alpha.id });
    await createAsset({ name: 'Semen Mixer', institutionId: alpha.id, classificationId: LEAF_2 });

    expect((await get(`/reports/inventory?classificationId=${LEAF_2}`)).body.data).toHaveLength(1);
    expect((await get('/reports/inventory?q=roller')).body.data[0].name).toBe('Aspal Roller');
  });

  it('scopes to the caller institution (BR-007)', async () => {
    await createAsset({ name: 'Alpha Asset', institutionId: alpha.id });
    await createAsset({ name: 'Beta Asset', institutionId: beta.id });

    const scoped = await createCaller({ permissions: ['report:read'], institutionId: alpha.id });
    const rows = (await get('/reports/inventory', scoped)).body.data;

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alpha Asset');
  });

  it('rejects a scoped caller asking for another institution', async () => {
    const scoped = await createCaller({ permissions: ['report:read'], institutionId: alpha.id });
    const response = await get(`/reports/inventory?institutionId=${beta.id}`, scoped);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('institutionId');
  });

  it('paginates', async () => {
    await createAsset({ name: 'One', institutionId: alpha.id, unitCount: 0 });
    await createAsset({ name: 'Two', institutionId: alpha.id, unitCount: 0 });
    await createAsset({ name: 'Three', institutionId: alpha.id, unitCount: 0 });

    const response = await get('/reports/inventory?page=1&pageSize=2');
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });
});

/**
 * The unit-level inventory list and its export — `CR-009`.
 *
 * The report `inventory` above answers "how many kinds of thing do we own";
 * this answers "which items are they", and it is the one that gets printed.
 */
/**
 * The unit inventory requires `asset-unit:read`, not `report:read` — `CR-010`.
 *
 * Its rows ARE Asset Units, narrowed by the same `unitScopeFilter` as the unit
 * list, so that is the code the API's own derivation rule gives it (§1.3). The
 * consequence this change exists for is the last test here.
 */
describe('unit inventory authorization (CR-010)', () => {
  it('requires asset-unit:read, and report:read does not open it', async () => {
    const reporter = await createCaller({
      permissions: ['report:read'],
      isSystemWide: true,
    });

    for (const path of ['/reports/inventory-units', '/reports/inventory-units/export']) {
      const response = await get(path, reporter);
      expect(response.status, path).toBe(403);
    }
  });

  it('opens for a caller holding asset-unit:read alone', async () => {
    const unitReader = await createCaller({
      permissions: ['asset-unit:read'],
      isSystemWide: true,
    });

    for (const path of ['/reports/inventory-units', '/reports/inventory-units/export']) {
      expect((await get(path, unitReader)).status, path).toBe(200);
    }
  });

  /**
   * The whole point of `CR-010`. A PIC-scoped caller's permissions are
   * intersected with the `CR-004` ceiling, which admits `asset-unit:read` and
   * excludes `report:read` — so this report opens and every other one does not.
   */
  it('opens for a PIC-scoped caller, who still cannot reach any other report', async () => {
    const { units } = await createAsset({
      name: 'Departmental',
      institutionId: alpha.id,
      unitCount: 2,
      departmentId: department.id,
    });
    await createAsset({ name: 'Elsewhere', institutionId: alpha.id, unitCount: 1 });

    const pic = await createCaller({
      institutionId: alpha.id,
      isPicScoped: true,
      // `report:read` is granted, and inert: the ceiling strips it (`CR-004`
      // §1.2). That is exactly the situation this test exists to pin down.
      permissions: ['asset-unit:read', 'report:read'],
    });

    // Being PIC-scoped is a role flag; the departments come from the assignment.
    await models.DepartmentPicAssignment.create({
      departmentId: department.id,
      userId: pic.user.id,
    });

    const response = await get('/reports/inventory-units', pic);
    expect(response.status).toBe(200);

    // Their own department's units, and not the one registered outside it.
    const codes = response.body.data.map((row) => row.unitId).sort();
    expect(codes).toEqual(units.map((unit) => unit.id).sort());

    expect((await get('/reports/inventory-units/export', pic)).status).toBe(200);

    // Every aggregate report stays closed, granted code or not.
    for (const path of ['/reports/inventory', '/reports/status', '/reports/by-location']) {
      expect((await get(path, pic)).status, path).toBe(403);
    }
  });
});

describe('GET /reports/inventory-units (CR-009)', () => {
  it('lists one row per physical unit, not per asset', async () => {
    await createAsset({ name: 'Laptop', institutionId: alpha.id, unitCount: 3 });

    const rows = (await get('/reports/inventory-units')).body.data;

    // Three rows for ONE asset — exactly what `inventory` collapses into a
    // `unitCount` of 3.
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.assetName))).toEqual(new Set(['Laptop']));
    expect(new Set(rows.map((row) => row.unitId)).size).toBe(3);
  });

  it('carries what the printed sheet needs on every row', async () => {
    await createAsset({
      name: 'Laptop',
      institutionId: alpha.id,
      unitCount: 1,
      departmentId: department.id,
      condition: 'GOOD',
      locationId: alphaRoom.id,
      lifecycleState: 'ACTIVE',
    });

    const [row] = (await get('/reports/inventory-units')).body.data;

    expect(row).toMatchObject({
      assetName: 'Laptop',
      classificationId: LEAF,
      departmentName: 'Umum',
      locationName: 'Ruang A',
      condition: 'GOOD',
      lifecycleState: 'ACTIVE',
    });
    expect(row.inventoryCode).toEqual(expect.any(String));
  });

  it('scopes to the caller institution (BR-007)', async () => {
    await createAsset({ name: 'Alpha Unit', institutionId: alpha.id, unitCount: 1 });
    await createAsset({ name: 'Beta Unit', institutionId: beta.id, unitCount: 1 });

    const scoped = await createCaller({
      permissions: ['asset-unit:read'],
      institutionId: alpha.id,
    });
    const rows = (await get('/reports/inventory-units', scoped)).body.data;

    expect(rows).toHaveLength(1);
    expect(rows[0].assetName).toBe('Alpha Unit');
  });

  it('filters to one department, for an administrator printing its sheet', async () => {
    await createAsset({
      name: 'Assigned',
      institutionId: alpha.id,
      unitCount: 1,
      departmentId: department.id,
    });
    await createAsset({ name: 'Unassigned', institutionId: alpha.id, unitCount: 1 });

    const all = (await get('/reports/inventory-units')).body.data;
    expect(all).toHaveLength(2);

    const filtered = (await get(`/reports/inventory-units?departmentId=${department.id}`)).body
      .data;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].assetName).toBe('Assigned');
  });

  it('filters by condition and lifecycle state', async () => {
    await createAsset({
      name: 'Serviceable',
      institutionId: alpha.id,
      unitCount: 1,
      condition: 'GOOD',
      locationId: alphaRoom.id,
      lifecycleState: 'ACTIVE',
    });
    await createAsset({ name: 'Fresh', institutionId: alpha.id, unitCount: 1 });

    expect((await get('/reports/inventory-units?condition=GOOD')).body.data).toHaveLength(1);
    expect(
      (await get('/reports/inventory-units?lifecycleState=REGISTERED')).body.data
    ).toHaveLength(1);
  });

  it('paginates like every other row report', async () => {
    await createAsset({ name: 'Fleet', institutionId: alpha.id, unitCount: 3 });

    const response = await get('/reports/inventory-units?page=1&pageSize=2');

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });
});

describe('GET /reports/inventory-units/export (CR-009 DEC-D)', () => {
  it('answers a spreadsheet, not the JSON envelope', async () => {
    await createAsset({ name: 'Laptop', institutionId: alpha.id, unitCount: 2 });

    // `responseType('blob')` so superagent hands back the bytes rather than
    // trying to parse a content type it has no parser for.
    const response = await api()
      .get(`${V1}/reports/inventory-units/export`)
      .set(...admin.auth)
      .responseType('blob');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="inventaris-[\d-]+\.xlsx"$/
    );
    // A ZIP, which is what an XLSX is. `PK` is its magic number.
    expect(Buffer.from(response.body).subarray(0, 2).toString()).toBe('PK');
  });

  /**
   * The defect the endpoint exists to fix. An inventory list that stops at row
   * 100 is not an inventory list, so a page parameter is refused rather than
   * quietly honoured.
   */
  it('refuses a page parameter instead of exporting one', async () => {
    const response = await get('/reports/inventory-units/export?page=1&pageSize=2');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('applies the same scope as the report it exports', async () => {
    await createAsset({ name: 'Beta Unit', institutionId: beta.id, unitCount: 1 });

    const scoped = await createCaller({
      permissions: ['asset-unit:read'],
      institutionId: alpha.id,
    });
    const response = await get('/reports/inventory-units/export', scoped);

    // Alpha has nothing this test, so the sheet is a header with no data rows —
    // and crucially it is not Beta's.
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
  });

  it('names the file after the department when one was asked for', async () => {
    await createAsset({
      name: 'Assigned',
      institutionId: alpha.id,
      unitCount: 1,
      departmentId: department.id,
    });

    const response = await get(`/reports/inventory-units/export?departmentId=${department.id}`);

    expect(response.headers['content-disposition']).toContain('inventaris-umum-');
  });
});

describe('GET /reports/status (REQ-REPORT-002)', () => {
  it('groups units by lifecycle state and totals the assets', async () => {
    // 2 units left REGISTERED, 1 commissioned to ACTIVE.
    await createAsset({ name: 'Fleet', institutionId: alpha.id, unitCount: 2 });
    await createAsset({
      name: 'Commissioned',
      institutionId: alpha.id,
      unitCount: 1,
      condition: 'GOOD',
      locationId: alphaRoom.id,
      lifecycleState: 'ACTIVE',
    });

    const { groups, totals } = (await get('/reports/status')).body.data;

    const byKey = Object.fromEntries(groups.map((group) => [group.key, group.count]));
    expect(byKey.REGISTERED).toBe(2);
    expect(byKey.ACTIVE).toBe(1);

    expect(totals).toMatchObject({ assets: 2, activeAssets: 2, inactiveAssets: 0, units: 3 });
  });

  it('counts a deactivated asset as inactive', async () => {
    const { asset } = await createAsset({ name: 'Retired', institutionId: alpha.id, unitCount: 0 });
    await post(`/assets/${asset.id}/deactivate`);

    const { totals } = (await get('/reports/status')).body.data;
    expect(totals).toMatchObject({ assets: 1, activeAssets: 0, inactiveAssets: 1 });
  });

  it('scopes to the caller institution', async () => {
    await createAsset({ name: 'Alpha', institutionId: alpha.id, unitCount: 2 });
    await createAsset({ name: 'Beta', institutionId: beta.id, unitCount: 5 });

    const scoped = await createCaller({ permissions: ['report:read'], institutionId: alpha.id });
    const { totals } = (await get('/reports/status', scoped)).body.data;

    expect(totals.units).toBe(2);
  });
});

describe('GET /reports/by-classification (REQ-REPORT-003)', () => {
  it('groups assets by classification and resolves the name', async () => {
    await createAsset({ name: 'A', institutionId: alpha.id, unitCount: 0 });
    await createAsset({ name: 'B', institutionId: alpha.id, unitCount: 0 });
    await createAsset({
      name: 'C',
      institutionId: alpha.id,
      classificationId: LEAF_2,
      unitCount: 0,
    });

    const { groups, totals } = (await get('/reports/by-classification')).body.data;

    const leaf = groups.find((group) => group.key === LEAF);
    expect(leaf.count).toBe(2);
    expect(leaf.label).toBeTruthy();
    expect(leaf.label).not.toBe(LEAF); // the classification NAME, not its code

    expect(groups.find((group) => group.key === LEAF_2).count).toBe(1);
    expect(totals).toMatchObject({ classifications: 2, assets: 3 });
  });

  it('scopes to the caller institution', async () => {
    await createAsset({ name: 'Alpha', institutionId: alpha.id, unitCount: 0 });
    await createAsset({ name: 'Beta', institutionId: beta.id, unitCount: 0 });

    const scoped = await createCaller({ permissions: ['report:read'], institutionId: alpha.id });
    const { totals } = (await get('/reports/by-classification', scoped)).body.data;

    expect(totals.assets).toBe(1);
  });
});

describe('GET /reports/by-organization (REQ-REPORT-004)', () => {
  it('groups units by institution AND department', async () => {
    // Department lives on the UNIT, institution on the ASSET, so this grouping
    // necessarily counts units (`04-data-model.md` §5.3.4, §5.3.5).
    await createAsset({
      name: 'Alpha assigned',
      institutionId: alpha.id,
      unitCount: 2,
      departmentId: department.id,
    });
    await createAsset({ name: 'Alpha unassigned', institutionId: alpha.id, unitCount: 1 });

    const { groups, totals } = (await get('/reports/by-organization')).body.data;

    const assigned = groups.find((group) => group.departmentId === department.id);
    expect(assigned).toMatchObject({
      institutionId: alpha.id,
      institutionName: 'Alpha',
      departmentName: 'Umum',
      count: 2,
    });

    const unassigned = groups.find((group) => group.departmentId === null);
    expect(unassigned.count).toBe(1);

    expect(totals).toMatchObject({ units: 3, institutions: 1 });
  });

  it('separates institutions for a system-wide caller', async () => {
    await createAsset({ name: 'Alpha', institutionId: alpha.id, unitCount: 1 });
    await createAsset({ name: 'Beta', institutionId: beta.id, unitCount: 2 });

    const { groups, totals } = (await get('/reports/by-organization')).body.data;

    expect(totals.institutions).toBe(2);
    expect(groups.find((group) => group.institutionName === 'Beta').count).toBe(2);
  });
});

describe('GET /reports/by-location (REQ-REPORT-005)', () => {
  it('groups units by current location, keeping the unlocated ones visible', async () => {
    await createAsset({
      name: 'Placed',
      institutionId: alpha.id,
      unitCount: 2,
      condition: 'GOOD',
      locationId: alphaRoom.id,
      lifecycleState: 'ACTIVE',
    });
    await createAsset({ name: 'Unplaced', institutionId: alpha.id, unitCount: 3 });

    const { groups, totals } = (await get('/reports/by-location')).body.data;

    const placed = groups.find((group) => group.key === alphaRoom.id);
    expect(placed).toMatchObject({ label: 'Ruang A', count: 2 });

    // A unit with nothing recorded is its own group, not an omission.
    const unlocated = groups.find((group) => group.key === null);
    expect(unlocated.count).toBe(3);
    expect(unlocated.label).toBeNull();

    expect(totals).toMatchObject({ locations: 1, units: 5, unlocated: 3 });
  });
});

describe('GET /reports/by-condition (REQ-REPORT-006)', () => {
  it('groups units by condition and reports the unrecorded ones', async () => {
    await createAsset({
      name: 'Good',
      institutionId: alpha.id,
      unitCount: 2,
      condition: 'GOOD',
      locationId: alphaRoom.id,
      lifecycleState: 'ACTIVE',
    });
    await createAsset({
      name: 'Damaged',
      institutionId: alpha.id,
      unitCount: 1,
      condition: 'DAMAGED',
      locationId: alphaRoom.id,
      lifecycleState: 'ACTIVE',
    });
    await createAsset({ name: 'Unknown', institutionId: alpha.id, unitCount: 4 });

    const { groups, totals } = (await get('/reports/by-condition')).body.data;

    const byKey = Object.fromEntries(groups.map((group) => [group.key, group.count]));
    expect(byKey.GOOD).toBe(2);
    expect(byKey.DAMAGED).toBe(1);
    expect(byKey.null ?? groups.find((group) => group.key === null).count).toBe(4);

    expect(totals).toMatchObject({ units: 7, unrecorded: 4 });
  });

  it('scopes to the caller institution', async () => {
    await createAsset({ name: 'Beta only', institutionId: beta.id, unitCount: 3 });

    const scoped = await createCaller({ permissions: ['report:read'], institutionId: alpha.id });
    const { totals } = (await get('/reports/by-condition', scoped)).body.data;

    expect(totals.units).toBe(0);
  });
});

describe('GET /reports/borrowings (REQ-REPORT-007)', () => {
  async function createBorrowing(overrides = {}) {
    const { units } = await createAsset({
      name: `Borrowable ${Math.random()}`,
      institutionId: alpha.id,
      unitCount: 1,
      condition: 'GOOD',
      locationId: alphaRoom.id,
      lifecycleState: 'ACTIVE',
    });

    const borrowing = (
      await post('/borrowings', {
        borrowerName: 'Andi',
        borrowerContact: '0812',
        borrowDate: isoDate(-5),
        expectedReturnDate: isoDate(5),
        institutionId: alpha.id,
        ...overrides,
      })
    ).body.data;

    await post(`/borrowings/${borrowing.id}/items`, { assetUnitId: units[0].id });

    return borrowing;
  }

  it('reports active and historical records with their unit counts', async () => {
    const borrowing = await createBorrowing();
    await post(`/borrowings/${borrowing.id}/activate`);

    const response = await get('/reports/borrowings');

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0]).toMatchObject({
      borrowerName: 'Andi',
      status: 'ACTIVE',
      unitCount: 1,
      isOverdue: false,
      institutionName: 'Alpha',
    });
  });

  it('derives isOverdue rather than trusting the stored status', async () => {
    const borrowing = await createBorrowing({
      borrowDate: isoDate(-30),
      expectedReturnDate: isoDate(-1),
    });
    await post(`/borrowings/${borrowing.id}/activate`);

    const rows = (await get('/reports/borrowings')).body.data;

    // Still ACTIVE — the Phase 8 sweep has not run — but past due all the same.
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].isOverdue).toBe(true);

    expect((await get('/reports/borrowings?overdue=true')).body.data).toHaveLength(1);
  });

  it('filters by status and by borrow-date range', async () => {
    await createBorrowing({ borrowDate: isoDate(-20), expectedReturnDate: isoDate(-10) });
    const recent = await createBorrowing({ borrowDate: isoDate(-1) });
    await post(`/borrowings/${recent.id}/activate`);

    expect((await get('/reports/borrowings?status=DRAFT')).body.data).toHaveLength(1);
    expect((await get(`/reports/borrowings?dateFrom=${isoDate(-2)}`)).body.data).toHaveLength(1);
    expect((await get(`/reports/borrowings?dateTo=${isoDate(-15)}`)).body.data).toHaveLength(1);
  });

  it('scopes to the caller institution', async () => {
    await createBorrowing();

    const scoped = await createCaller({ permissions: ['report:read'], institutionId: beta.id });
    expect((await get('/reports/borrowings', scoped)).body.data).toHaveLength(0);
  });
});

describe('GET /reports/procurement-traceability (REQ-REPORT-008)', () => {
  async function createContract(overrides = {}) {
    const supplier = (await post('/suppliers', { name: `CV ${Math.random()}` })).body.data;

    const contract = (
      await post('/contracts', {
        contractNumber: `SPK/${Math.random().toString(36).slice(2, 9)}`,
        contractDate: isoDate(-30),
        supplierId: supplier.id,
        institutionId: alpha.id,
        ...overrides,
      })
    ).body.data;

    return { contract, supplier };
  }

  it('traces an asset to its contract and counts traced units', async () => {
    const { contract, supplier } = await createContract();

    const item = (
      await post(`/contracts/${contract.id}/items`, { assetName: 'Komputer', quantity: 5 })
    ).body.data;

    // Created THROUGH procurement: both links are populated by the server.
    await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 2,
      institutionId: alpha.id,
    });

    const rows = (await get('/reports/procurement-traceability')).body.data;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      assetName: 'Komputer',
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      unitCount: 2,
      tracedUnitCount: 2,
    });
  });

  it('shows the gap when units were added outside procurement (REQ-PROC-006)', async () => {
    const { contract } = await createContract();
    const item = (await post(`/contracts/${contract.id}/items`, { assetName: 'Meja' })).body.data;

    const created = (
      await post(`/contract-items/${item.id}/assets`, {
        classificationId: LEAF,
        unitCount: 1,
        institutionId: alpha.id,
      })
    ).body.data;

    // A unit added directly to the asset carries no contract item.
    await post(`/assets/${created.asset.id}/units`, {});

    const rows = (await get('/reports/procurement-traceability')).body.data;
    expect(rows[0]).toMatchObject({ unitCount: 2, tracedUnitCount: 1 });
  });

  it('finds assets with no procurement record at all (traced=false)', async () => {
    const { contract } = await createContract();
    const item = (await post(`/contracts/${contract.id}/items`, { assetName: 'Traced' })).body.data;
    await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 1,
      institutionId: alpha.id,
    });

    await createAsset({ name: 'Donated', institutionId: alpha.id, unitCount: 1 });

    const untraced = (await get('/reports/procurement-traceability?traced=false')).body.data;
    expect(untraced).toHaveLength(1);
    expect(untraced[0]).toMatchObject({
      assetName: 'Donated',
      contractId: null,
      contractNumber: null,
      tracedUnitCount: 0,
    });

    const traced = (await get('/reports/procurement-traceability?traced=true')).body.data;
    expect(traced).toHaveLength(1);
    expect(traced[0].assetName).toBe('Traced');
  });

  it('filters by supplier through the contract', async () => {
    const { contract, supplier } = await createContract();
    const item = (await post(`/contracts/${contract.id}/items`, { assetName: 'Alat' })).body.data;
    await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 1,
      institutionId: alpha.id,
    });

    await createAsset({ name: 'Donated', institutionId: alpha.id, unitCount: 1 });

    const rows = (await get(`/reports/procurement-traceability?supplierId=${supplier.id}`)).body
      .data;

    // The supplier reaches the asset only through its contract, so an untraced
    // asset cannot match — it has no supplier either.
    expect(rows).toHaveLength(1);
    expect(rows[0].assetName).toBe('Alat');
  });

  it('scopes to the caller institution', async () => {
    await createAsset({ name: 'Beta asset', institutionId: beta.id, unitCount: 1 });

    const scoped = await createCaller({ permissions: ['report:read'], institutionId: alpha.id });
    expect((await get('/reports/procurement-traceability', scoped)).body.data).toHaveLength(0);
  });
});

describe('GET /audit-logs (§10, REQ-AUDIT-001/002)', () => {
  it('requires audit-log:read', async () => {
    const nobody = await createCaller({ permissions: [], isSystemWide: true });

    expect((await get('/audit-logs', nobody)).status).toBe(403);
  });

  it('returns the trail Phase 8 recorded, newest first', async () => {
    const { asset } = await createAsset({ name: 'Audited', institutionId: alpha.id, unitCount: 0 });

    const response = await get(`/audit-logs?entityType=Asset&entityId=${asset.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);

    const entry = response.body.data[0];
    expect(entry).toMatchObject({ entityType: 'Asset', entityId: asset.id, action: 'CREATE' });
    expect(entry.newValues.name).toBe('Audited');
    expect(entry.actorId).toBe(admin.user.id);
    expect(entry.timestamp).toBeTruthy();
  });

  it('records an update as its own entry with old and new values', async () => {
    const { asset } = await createAsset({ name: 'Before', institutionId: alpha.id, unitCount: 0 });
    await request('patch', `/assets/${asset.id}`).send({ name: 'After' });

    const rows = (await get(`/audit-logs?entityId=${asset.id}&action=UPDATE`)).body.data;

    expect(rows).toHaveLength(1);
    expect(rows[0].oldValues.name).toBe('Before');
    expect(rows[0].newValues.name).toBe('After');
  });

  it('classifies a deactivation as STATUS_CHANGE', async () => {
    const { asset } = await createAsset({ name: 'Toggled', institutionId: alpha.id, unitCount: 0 });
    await post(`/assets/${asset.id}/deactivate`);

    const rows = (await get(`/audit-logs?entityId=${asset.id}&action=STATUS_CHANGE`)).body.data;

    expect(rows).toHaveLength(1);
    expect(rows[0].newValues.isActive).toBe(false);
  });

  it('filters by actor and by date range', async () => {
    await createAsset({ name: 'ByAdmin', institutionId: alpha.id, unitCount: 0 });

    const mine = (await get(`/audit-logs?actorId=${admin.user.id}`)).body.data;
    expect(mine.length).toBeGreaterThan(0);

    const stranger = await createCaller({ permissions: ['audit-log:read'], isSystemWide: true });
    expect((await get(`/audit-logs?actorId=${stranger.user.id}`)).body.data).toHaveLength(0);

    // `dateTo` covers the whole calendar day, so today's entries are included.
    const todayOnly = (await get(`/audit-logs?dateFrom=${isoDate()}&dateTo=${isoDate()}`)).body
      .data;
    expect(todayOnly.length).toBeGreaterThan(0);

    expect((await get(`/audit-logs?dateTo=${isoDate(-1)}`)).body.data).toHaveLength(0);
  });

  it('never exposes a password hash (REQ-NFR-SEC-001)', async () => {
    const created = (
      await post('/users', {
        username: `audited-${Date.now()}`,
        password: 'a-long-enough-password',
        firstName: 'Aud',
        lastName: 'Ited',
      })
    ).body.data;

    const rows = (await get(`/audit-logs?entityType=User&entityId=${created.id}`)).body.data;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].newValues.passwordHash).toBe('[REDACTED]');
    expect(JSON.stringify(rows[0])).not.toContain('$2b$');
  });

  it('paginates, newest first', async () => {
    await createAsset({ name: 'One', institutionId: alpha.id, unitCount: 0 });
    await createAsset({ name: 'Two', institutionId: alpha.id, unitCount: 0 });

    const response = await get('/audit-logs?pageSize=1');

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBeGreaterThan(1);

    const [first] = response.body.data;
    const [second] = (await get('/audit-logs?pageSize=1&page=2')).body.data;
    expect(new Date(first.timestamp) >= new Date(second.timestamp)).toBe(true);
  });

  it('is NOT organization-scoped, by decision (DEC-050)', async () => {
    await createAsset({ name: 'Beta asset', institutionId: beta.id, unitCount: 0 });

    // The table has no institution and no join path to one, so a scoped holder
    // of `audit-log:read` sees everything. Stated, not approximated.
    const scoped = await createCaller({
      permissions: ['audit-log:read'],
      institutionId: alpha.id,
    });

    const rows = (await get('/audit-logs?entityType=Asset', scoped)).body.data;
    expect(rows.some((row) => row.newValues?.name === 'Beta asset')).toBe(true);
  });
});

describe('GET /audit-logs/:id (REQ-AUDIT-002)', () => {
  it('returns one entry in full', async () => {
    const { asset } = await createAsset({
      name: 'Detailed',
      institutionId: alpha.id,
      unitCount: 0,
    });
    const [entry] = (await get(`/audit-logs?entityId=${asset.id}`)).body.data;

    const response = await get(`/audit-logs/${entry.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: entry.id, entityType: 'Asset' });
    expect(response.body.data.metadata.requestId).toBeTruthy();
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    const response = await get('/audit-logs/00000000-0000-0000-0000-000000000000');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('audit immutability (REQ-AUDIT-003, DR-015)', () => {
  it('exposes no write route of any kind', async () => {
    const { asset } = await createAsset({ name: 'Fixed', institutionId: alpha.id, unitCount: 0 });
    const [entry] = (await get(`/audit-logs?entityId=${asset.id}`)).body.data;

    expect((await post('/audit-logs', {})).status).toBe(404);
    expect(
      (await request('patch', `/audit-logs/${entry.id}`).send({ action: 'DELETE' })).status
    ).toBe(404);
    expect((await request('delete', `/audit-logs/${entry.id}`)).status).toBe(404);

    // Still exactly as it was written.
    const after = (await get(`/audit-logs/${entry.id}`)).body.data;
    expect(after).toMatchObject({ id: entry.id, action: entry.action });
  });
});
