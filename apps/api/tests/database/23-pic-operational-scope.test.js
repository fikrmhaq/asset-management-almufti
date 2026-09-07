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
 * Unit-coverage scope for operational records — `CR-004` §4, §5, §9, §10.
 *
 * `CR-003` scoped Borrowings and Transactions by `institution_id`, so a
 * PIC-scoped caller holding `borrowing:read` saw every borrowing in their
 * institution. `CR-004` scopes them by the ASSET UNITS they contain:
 *
 *   every unit in the caller's departments  → in scope
 *   any unit in another department          → out of scope, 404
 *   any unit with department_id = NULL      → out of scope, 404
 *
 * ALL-OR-NOTHING (`CR-004` §9). There is no partial view of a mixed record: the
 * TKJ PIC does not see "borrowing X, RPL item hidden", they do not see
 * borrowing X.
 *
 * 404 THROUGHOUT, never 403 (`CR-004` §12). An out-of-scope record must be
 * indistinguishable from one that does not exist, so the response cannot betray
 * that the caller is PIC-scoped rather than that the id is unknown.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

/** A one-pixel PNG — the upload paths reject types outside the allow-list. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const OPERATIONS_PERMISSIONS = [
  'asset-unit:read',
  'asset-unit:update',
  'asset-unit:record-history',
  'borrowing:read',
  'borrowing:create',
  'borrowing:update',
  'borrowing:activate',
  'borrowing:cancel',
  'borrowing:return',
  'borrowing:extend',
  'borrowing-item:read',
  'borrowing-item:create',
  'borrowing-item:delete',
  'transaction:read',
  'transaction:create',
  'attachment:read',
  'attachment:create',
  'attachment:delete',
  'asset-attribute-value:read',
  'asset-attribute-value:update',
  'location:read',
];

let admin;
let institution;
let tkj;
let rpl;
let budi; // PIC of TKJ
let staff; // institution-scoped control, same permissions
let asset;
let location;
let transactionTypeId;

let unitInTkj;
let unitInTkj2;
let unitInRpl;
let unitUnassigned;

beforeAll(async () => {
  await seed();
});

const get = (path, caller) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

const post = (path, body, caller) =>
  api()
    .post(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const patch = (path, body, caller) =>
  api()
    .patch(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const del = (path, caller) =>
  api()
    .delete(`${V1}${path}`)
    .set(...caller.auth);

beforeEach(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetOrganizationData();

  admin = await createAdminCaller();

  institution = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });

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

  location = await models.Location.create({
    name: 'Lab 1',
    classificationId: LEAF,
    institutionId: institution.id,
  });

  asset = (
    await post(
      '/assets',
      { name: 'Laptop', classificationId: LEAF, institutionId: institution.id },
      admin
    )
  ).body.data;

  const createUnit = async (departmentId) => {
    const unit = (
      await post(`/assets/${asset.id}/units`, departmentId ? { departmentId } : {}, admin)
    ).body.data;

    // Units must be ACTIVE with a recorded condition and location before they
    // can be borrowed — REQ-LIFE-002.
    await post(
      `/asset-units/${unit.id}/history`,
      {
        description: 'Registered',
        condition: 'GOOD',
        locationId: location.id,
        lifecycleState: 'ACTIVE',
      },
      admin
    );

    return unit;
  };

  unitInTkj = await createUnit(tkj.id);
  unitInTkj2 = await createUnit(tkj.id);
  unitInRpl = await createUnit(rpl.id);
  unitUnassigned = await createUnit(null);

  budi = await createCaller({
    institutionId: institution.id,
    permissions: OPERATIONS_PERMISSIONS,
    isPicScoped: true,
  });
  // Identical permissions, ordinary tier — the control for every assertion here.
  staff = await createCaller({
    institutionId: institution.id,
    permissions: OPERATIONS_PERMISSIONS,
  });

  await models.DepartmentPicAssignment.create({ departmentId: tkj.id, userId: budi.user.id });
  await tkj.update({ currentPicUserId: budi.user.id });

  // Created rather than looked up: `resetOperationsData` clears the table, so
  // there is nothing to find (the pattern `14-operations-api` already uses).
  transactionTypeId = (await models.TransactionType.create({ name: 'Penghapusan' })).id;
});

afterAll(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetOrganizationData();
});

/** A borrowing created by `caller`, holding `unitIds`. */
async function createBorrowing(unitIds, caller = admin) {
  const borrowing = (
    await post(
      '/borrowings',
      {
        borrowerName: 'Someone',
        borrowerContact: '0800',
        borrowDate: '2026-01-01',
        expectedReturnDate: '2026-02-01',
        institutionId: institution.id,
      },
      caller
    )
  ).body.data;

  for (const assetUnitId of unitIds) {
    await post(`/borrowings/${borrowing.id}/items`, { assetUnitId }, admin);
  }

  return borrowing;
}

async function createTransaction(unitIds) {
  return (
    await post(
      '/transactions',
      {
        transactionDate: '2026-01-15',
        transactionTypeId,
        institutionId: institution.id,
        items: unitIds.map((assetUnitId) => ({ assetUnitId })),
      },
      admin
    )
  ).body.data;
}

// --- Borrowings --------------------------------------------------------------

describe('borrowing scope follows its asset units (CR-004 §4)', () => {
  it('lists only borrowings made entirely of the caller’s units', async () => {
    const own = await createBorrowing([unitInTkj.id, unitInTkj2.id]);
    const mixed = await createBorrowing([unitInTkj.id, unitInRpl.id]);
    const foreign = await createBorrowing([unitInRpl.id]);
    const unassigned = await createBorrowing([unitUnassigned.id]);

    const list = await get('/borrowings', budi);

    expect(list.status).toBe(200);
    expect(list.body.data.map((row) => row.id)).toEqual([own.id]);
    expect(list.body.meta.total).toBe(1);

    // The control: the institution caller sees all four.
    const all = await get('/borrowings', staff);
    expect(all.body.data.map((row) => row.id).sort()).toEqual(
      [own.id, mixed.id, foreign.id, unassigned.id].sort()
    );
  });

  it('answers 404 on detail and items for a mixed borrowing', async () => {
    const mixed = await createBorrowing([unitInTkj.id, unitInRpl.id]);

    expect((await get(`/borrowings/${mixed.id}`, budi)).status).toBe(404);
    expect((await get(`/borrowings/${mixed.id}/items`, budi)).status).toBe(404);
    // 404, not 403 — existence must not leak (CR-004 §12).
    expect((await get(`/borrowings/${mixed.id}`, staff)).status).toBe(200);
  });

  it('answers 404 for a borrowing of another department’s units only', async () => {
    const foreign = await createBorrowing([unitInRpl.id]);

    expect((await get(`/borrowings/${foreign.id}`, budi)).status).toBe(404);
  });

  /**
   * THE NULL TEST — `CR-004` §10.
   *
   * A `NOT IN` implementation would evaluate `NULL NOT IN (…)` to UNKNOWN, the
   * `NOT EXISTS` would not see the row, and this borrowing would be judged IN
   * scope. That is why the coverage SQL matches `department_id IS NULL`
   * explicitly, and why this test exists rather than being folded into the one
   * above.
   */
  it('answers 404 for a borrowing containing an unassigned unit', async () => {
    const unassigned = await createBorrowing([unitUnassigned.id]);

    expect((await get(`/borrowings/${unassigned.id}`, budi)).status).toBe(404);
    expect((await get('/borrowings', budi)).body.data).toEqual([]);
  });

  it('hides a mixed borrowing even when reached through a unit the caller holds', async () => {
    const mixed = await createBorrowing([unitInTkj.id, unitInRpl.id]);
    const own = await createBorrowing([unitInTkj.id]);

    const viaUnit = await get(`/asset-units/${unitInTkj.id}/borrowings`, budi);

    expect(viaUnit.status).toBe(200);
    expect(viaUnit.body.data.map((row) => row.id)).toEqual([own.id]);
    expect(viaUnit.body.data.map((row) => row.id)).not.toContain(mixed.id);
  });

  it('refuses every write path on a mixed borrowing with 404', async () => {
    const mixed = await createBorrowing([unitInTkj.id, unitInRpl.id]);
    const items = (await get(`/borrowings/${mixed.id}/items`, staff)).body.data;
    const ownItem = items.find((row) => row.assetUnitId === unitInTkj.id);

    expect((await patch(`/borrowings/${mixed.id}`, { borrowerName: 'X' }, budi)).status).toBe(404);
    expect(
      (await post(`/borrowings/${mixed.id}/items`, { assetUnitId: unitInTkj2.id }, budi)).status
    ).toBe(404);
    // C-4: removal had no scope check at all before CR-004.
    expect((await del(`/borrowings/${mixed.id}/items/${ownItem.id}`, budi)).status).toBe(404);
    expect((await post(`/borrowings/${mixed.id}/activate`, {}, budi)).status).toBe(404);
    expect((await post(`/borrowings/${mixed.id}/cancel`, {}, budi)).status).toBe(404);
    expect((await post(`/borrowings/${mixed.id}/return`, {}, budi)).status).toBe(404);
    expect(
      (await post(`/borrowings/${mixed.id}/extend`, { expectedReturnDate: '2027-03-01' }, budi))
        .status
    ).toBe(404);
  });

  it('refuses to add a foreign or unassigned unit to the caller’s own borrowing', async () => {
    const own = await createBorrowing([unitInTkj.id], budi);

    expect((await post(`/borrowings/${own.id}/items`, { assetUnitId: unitInRpl.id }, budi)).status)
      .toBe(404);
    expect(
      (await post(`/borrowings/${own.id}/items`, { assetUnitId: unitUnassigned.id }, budi)).status
    ).toBe(404);
  });
});

/**
 * The behaviour `CR-003`'s `assertNotPicScoped` forbade outright. This is the
 * regression that proves C-3 is fixed: the transitions now depend on WHAT the
 * borrowing holds, not on the caller's tier.
 */
describe('state transitions work when every unit is the caller’s (CR-004 C-3)', () => {
  it('activates, returns and extends an all-own-units borrowing', async () => {
    const own = await createBorrowing([unitInTkj.id, unitInTkj2.id]);

    const activated = await post(`/borrowings/${own.id}/activate`, {}, budi);
    expect(activated.status).toBe(200);
    expect(activated.body.data.status).toBe('ACTIVE');

    // The units moved, which is the whole reason B2 was refused before.
    expect((await get(`/asset-units/${unitInTkj.id}`, budi)).body.data.lifecycleState).toBe(
      'BORROWED'
    );

    const extended = await post(
      `/borrowings/${own.id}/extend`,
      // After today: `extend` defaults `actualReturnDate` to now, and the
      // continuation cannot be due before it starts.
      { expectedReturnDate: '2027-03-01' },
      budi
    );
    // 201: extend OPENS a continuation, so the route uses sendCreated.
    expect(extended.status).toBe(201);

    const continuation = extended.body.data.borrowing;
    expect((await post(`/borrowings/${continuation.id}/activate`, {}, budi)).status).toBe(200);

    const returned = await post(`/borrowings/${continuation.id}/return`, {}, budi);
    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe('RETURNED');

    expect((await get(`/asset-units/${unitInTkj.id}`, budi)).body.data.lifecycleState).toBe(
      'ACTIVE'
    );
  });

  it('cancels an all-own-units draft', async () => {
    const own = await createBorrowing([unitInTkj.id]);

    const cancelled = await post(`/borrowings/${own.id}/cancel`, {}, budi);

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });
});

/**
 * `CR-004` §4.3 — the one deliberate exception, and its limits.
 */
describe('empty DRAFT borrowings belong to their creator', () => {
  it('lets the creator see and fill their own empty draft', async () => {
    const own = await createBorrowing([], budi);

    expect((await get(`/borrowings/${own.id}`, budi)).status).toBe(200);
    expect((await get('/borrowings', budi)).body.data.map((row) => row.id)).toEqual([own.id]);

    const added = await post(`/borrowings/${own.id}/items`, { assetUnitId: unitInTkj.id }, budi);
    expect(added.status).toBe(201);

    // Still theirs once it holds only their own unit.
    expect((await get(`/borrowings/${own.id}`, budi)).status).toBe(200);
  });

  it('hides an empty draft created by someone else', async () => {
    const theirs = await createBorrowing([], admin);

    expect((await get(`/borrowings/${theirs.id}`, budi)).status).toBe(404);
    expect((await get('/borrowings', budi)).body.data).toEqual([]);
  });

  it('loses the draft the moment a foreign unit is added to it', async () => {
    const own = await createBorrowing([], budi);
    expect((await get(`/borrowings/${own.id}`, budi)).status).toBe(200);

    // An institution-scoped administrator adds a unit Budi does not hold.
    await post(`/borrowings/${own.id}/items`, { assetUnitId: unitInRpl.id }, admin);

    expect((await get(`/borrowings/${own.id}`, budi)).status).toBe(404);
    expect((await get('/borrowings', budi)).body.data).toEqual([]);
  });

  it('reverts to creator-only visibility when emptied again', async () => {
    const own = await createBorrowing([unitInTkj.id], budi);
    const items = (await get(`/borrowings/${own.id}/items`, budi)).body.data;

    expect((await del(`/borrowings/${own.id}/items/${items[0].id}`, budi)).status).toBe(204);
    expect((await get(`/borrowings/${own.id}`, budi)).status).toBe(200);
  });
});

// --- Transactions ------------------------------------------------------------

describe('transaction scope follows its asset units (CR-004 §5)', () => {
  it('lists only transactions made entirely of the caller’s units', async () => {
    const own = await createTransaction([unitInTkj.id, unitInTkj2.id]);
    await createTransaction([unitInTkj.id, unitInRpl.id]);
    await createTransaction([unitInRpl.id]);
    await createTransaction([unitUnassigned.id]);

    const list = await get('/transactions', budi);

    expect(list.status).toBe(200);
    expect(list.body.data.map((row) => row.id)).toEqual([own.id]);
    expect(list.body.meta.total).toBe(1);

    expect((await get('/transactions', staff)).body.meta.total).toBe(4);
  });

  it('answers 404 on detail and items for a mixed transaction', async () => {
    const mixed = await createTransaction([unitInTkj.id, unitInRpl.id]);

    expect((await get(`/transactions/${mixed.id}`, budi)).status).toBe(404);
    expect((await get(`/transactions/${mixed.id}/items`, budi)).status).toBe(404);
    expect((await get(`/transactions/${mixed.id}`, staff)).status).toBe(200);
  });

  it('answers 404 for another department’s transaction', async () => {
    const foreign = await createTransaction([unitInRpl.id]);

    expect((await get(`/transactions/${foreign.id}`, budi)).status).toBe(404);
  });

  /** THE SECOND NULL TEST — `CR-004` §10. */
  it('answers 404 for a transaction containing an unassigned unit', async () => {
    const unassigned = await createTransaction([unitUnassigned.id]);

    expect((await get(`/transactions/${unassigned.id}`, budi)).status).toBe(404);
    expect((await get('/transactions', budi)).body.data).toEqual([]);
  });

  it('hides a mixed transaction reached through a unit the caller holds', async () => {
    const own = await createTransaction([unitInTkj.id]);
    await createTransaction([unitInTkj.id, unitInRpl.id]);

    const viaUnit = await get(`/asset-units/${unitInTkj.id}/transactions`, budi);

    expect(viaUnit.body.data.map((row) => row.id)).toEqual([own.id]);
  });

  /**
   * Preserved behaviour, not new. `create` validated every unit individually
   * before `CR-004` and still does; this asserts it did not regress.
   */
  it('still refuses to create a transaction over units the caller cannot reach', async () => {
    const foreign = await post(
      '/transactions',
      {
        transactionDate: '2026-01-15',
        transactionTypeId,
        institutionId: institution.id,
        items: [{ assetUnitId: unitInTkj.id }, { assetUnitId: unitInRpl.id }],
      },
      budi
    );

    expect(foreign.status).toBe(404);

    const unassigned = await post(
      '/transactions',
      {
        transactionDate: '2026-01-15',
        transactionTypeId,
        institutionId: institution.id,
        items: [{ assetUnitId: unitUnassigned.id }],
      },
      budi
    );

    expect(unassigned.status).toBe(404);
  });

  it('creates and then reads back a transaction over its own units', async () => {
    const created = await post(
      '/transactions',
      {
        transactionDate: '2026-01-15',
        transactionTypeId,
        institutionId: institution.id,
        items: [{ assetUnitId: unitInTkj.id }],
      },
      budi
    );

    expect(created.status).toBe(201);
    expect((await get(`/transactions/${created.body.data.id}`, budi)).status).toBe(200);
  });
});

// --- The remaining asset-unit holes ------------------------------------------

/**
 * The Asset Unit collection — `CR-005`.
 *
 * The discovery surface a PIC-scoped role previously had no equivalent of. Two
 * things are proved here and they are different:
 *
 *   THE SCOPE HOLDS       no query parameter can widen it. Every filter is
 *                         exercised against a value the caller must NOT reach,
 *                         because "filter" and "scope" living in the same
 *                         `where` is exactly how they get confused.
 *
 *   IT IS COMPLETE        a unit with no location, no borrowing and no
 *                         transaction still appears. That is the gap this
 *                         endpoint exists to close — such a unit was reachable
 *                         through no list at all.
 */
describe('the asset unit collection (CR-005)', () => {
  /** A TKJ unit with no location, no history, no operational record at all. */
  let strandedInTkj;

  beforeEach(async () => {
    strandedInTkj = (
      await post(`/assets/${asset.id}/units`, { departmentId: tkj.id }, admin)
    ).body.data;
  });

  const ids = (response) => response.body.data.map((row) => row.id).sort();

  it('lists exactly the caller’s own departments’ units', async () => {
    const response = await get('/asset-units', budi);

    expect(response.status).toBe(200);
    expect(ids(response)).toEqual([unitInTkj.id, unitInTkj2.id, strandedInTkj.id].sort());
    expect(response.body.meta.total).toBe(3);
  });

  it('excludes another department’s units and unassigned units', async () => {
    const listed = ids(await get('/asset-units', budi));

    expect(listed).not.toContain(unitInRpl.id);
    expect(listed).not.toContain(unitUnassigned.id);
  });

  /**
   * THE POINT OF THE ENDPOINT. This unit has no `current_location_id`, so it
   * appears under no location; it is on no borrowing and no transaction. Before
   * `CR-005` a PIC could not reach it through any list in the application.
   */
  it('includes a unit with no location, no borrowing and no transaction', async () => {
    const response = await get('/asset-units', budi);

    const stranded = response.body.data.find((row) => row.id === strandedInTkj.id);
    expect(stranded).toBeDefined();
    expect(stranded.currentLocationId).toBeNull();
    expect((await get(`/asset-units/${strandedInTkj.id}`, budi)).status).toBe(200);
  });

  it('carries the parent asset and department as context', async () => {
    const row = (await get('/asset-units', budi)).body.data[0];

    expect(row.asset).toEqual({ id: asset.id, name: 'Laptop' });
    expect(row.department).toEqual({ id: tkj.id, code: 'TKJ', name: 'Teknik Komputer' });

    // Naming the asset does not make it browsable — CR-004 §7 is untouched.
    expect((await get(`/assets/${row.asset.id}`, budi)).status).toBe(403);
    expect((await get('/assets', budi)).status).toBe(403);
  });

  describe('no query parameter can widen the scope', () => {
    it('ignores departmentId naming a department the caller does not hold', async () => {
      const response = await get(`/asset-units?departmentId=${rpl.id}`, budi);

      expect(response.status).toBe(200);
      // Narrowed to the intersection, which is empty — never RPL's units.
      expect(response.body.data).toEqual([]);
      expect(response.body.meta.total).toBe(0);
    });

    it('narrows, but does not widen, when departmentId names a held department', async () => {
      const response = await get(`/asset-units?departmentId=${tkj.id}`, budi);

      expect(ids(response)).toEqual([unitInTkj.id, unitInTkj2.id, strandedInTkj.id].sort());
    });

    it('returns the same set with no department filter at all', async () => {
      expect(ids(await get('/asset-units', budi))).toEqual(
        ids(await get(`/asset-units?departmentId=${tkj.id}`, budi))
      );
    });

    it('cannot reach another department’s unit through locationId', async () => {
      // Every located unit shares one location, so this filter matches units in
      // BOTH departments before scope is applied.
      const response = await get(`/asset-units?locationId=${location.id}`, budi);

      expect(ids(response)).toEqual([unitInTkj.id, unitInTkj2.id].sort());
      expect(ids(response)).not.toContain(unitInRpl.id);
    });

    it('cannot reach another department’s unit through q', async () => {
      const rplUnit = (await get(`/asset-units/${unitInRpl.id}`, staff)).body.data;

      // Searching for the exact inventory code of a unit in another department.
      const response = await get(`/asset-units?q=${rplUnit.inventoryCode}`, budi);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it('cannot reach an unassigned unit through any filter', async () => {
      const unassigned = (await get(`/asset-units/${unitUnassigned.id}`, staff)).body.data;

      expect((await get(`/asset-units?q=${unassigned.inventoryCode}`, budi)).body.data).toEqual([]);
      expect(
        (await get(`/asset-units?locationId=${location.id}`, budi)).body.data.map((r) => r.id)
      ).not.toContain(unitUnassigned.id);
    });

    it('holds for a caller with no current post at all', async () => {
      const nobody = await createCaller({
        institutionId: institution.id,
        permissions: OPERATIONS_PERMISSIONS,
        isPicScoped: true,
      });

      const response = await get('/asset-units', nobody);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });

  describe('the other two tiers are unaffected', () => {
    it('shows an institution caller every unit of their institution', async () => {
      const response = await get('/asset-units', staff);

      expect(ids(response)).toEqual(
        [unitInTkj.id, unitInTkj2.id, unitInRpl.id, unitUnassigned.id, strandedInTkj.id].sort()
      );
    });

    it('lets an institution caller filter by department normally', async () => {
      expect(ids(await get(`/asset-units?departmentId=${rpl.id}`, staff))).toEqual([unitInRpl.id]);
    });

    it('does not show an institution caller another institution’s units', async () => {
      const beta = await models.Institution.create({
        name: 'Beta',
        code: 'BETA',
        address: 'Jl. B',
      });
      const betaAsset = (
        await post(
          '/assets',
          { name: 'Printer', classificationId: LEAF, institutionId: beta.id },
          admin
        )
      ).body.data;
      const betaUnit = (await post(`/assets/${betaAsset.id}/units`, {}, admin)).body.data;

      expect(ids(await get('/asset-units', staff))).not.toContain(betaUnit.id);
      // The system-wide caller sees both institutions.
      expect(ids(await get('/asset-units', admin))).toContain(betaUnit.id);
    });
  });

  it('requires asset-unit:read, not asset:read', async () => {
    const reader = await createCaller({
      institutionId: institution.id,
      permissions: ['asset-unit:read'],
    });

    expect((await get('/asset-units', reader)).status).toBe(200);
    expect((await get('/assets', reader)).status).toBe(403);
  });
});

describe('asset unit labels are narrowed too (CR-004 C-1)', () => {
  it('omits other departments’ and unassigned units', async () => {
    const labels = await get(`/assets/${asset.id}/units/labels`, budi);

    expect(labels.status).toBe(200);
    expect(labels.body.data.map((row) => row.assetUnitId).sort()).toEqual(
      [unitInTkj.id, unitInTkj2.id].sort()
    );

    // The control: the institution caller still prints the whole sheet.
    const all = await get(`/assets/${asset.id}/units/labels`, staff);
    expect(all.body.data).toHaveLength(4);
  });
});

describe('unit-linked attachments follow unit scope (CR-004 C-2)', () => {
  /**
   * Uploads a file against `assetUnitId`, or against the asset when null.
   *
   * `.field()` BEFORE `.attach()`: multipart parts are read in order, and the
   * body validator runs against the fields multer has seen by the time the file
   * part is handled.
   */
  const upload = async (assetUnitId, caller) => {
    const request = api()
      .post(`${V1}/assets/${asset.id}/attachments`)
      .set(...caller.auth);

    if (assetUnitId) request.field('assetUnitId', assetUnitId);

    return request.attach('file', PNG, { filename: 'doc.png', contentType: 'image/png' });
  };

  it('lets the caller attach to, read and delete a file on their own unit', async () => {
    const created = await upload(unitInTkj.id, budi);
    expect(created.status).toBe(201);

    const id = created.body.data.id;
    expect((await get(`/attachments/${id}`, budi)).status).toBe(200);
    expect((await del(`/attachments/${id}`, budi)).status).toBe(204);
  });

  it('refuses to attach to another department’s unit', async () => {
    expect((await upload(unitInRpl.id, budi)).status).toBe(404);
    expect((await upload(unitUnassigned.id, budi)).status).toBe(404);
  });

  it('refuses to attach to the asset itself', async () => {
    const response = await upload(null, budi);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('assetUnitId');

    // The control: an asset-level attachment is ordinary for an institution
    // caller holding the same permission.
    expect((await upload(null, staff)).status).toBe(201);
  });

  it('hides asset-level and out-of-scope files from the asset’s list', async () => {
    const own = await upload(unitInTkj.id, staff);
    await upload(unitInRpl.id, staff);
    await upload(null, staff);

    const mine = await get(`/assets/${asset.id}/attachments`, budi);

    expect(mine.status).toBe(200);
    expect(mine.body.data.map((row) => row.id)).toEqual([own.body.data.id]);

    expect((await get(`/assets/${asset.id}/attachments`, staff)).body.data).toHaveLength(3);
  });

  it('answers 404 for an asset-level file addressed directly', async () => {
    const assetLevel = await upload(null, staff);

    expect((await get(`/attachments/${assetLevel.body.data.id}`, budi)).status).toBe(404);
    expect((await del(`/attachments/${assetLevel.body.data.id}`, budi)).status).toBe(404);
  });
});

describe('asset-target attribute values are closed to a PIC (CR-004 C-6)', () => {
  it('refuses reading and writing values on the asset', async () => {
    expect((await get(`/assets/${asset.id}/attribute-values`, budi)).status).toBe(403);

    const written = await api()
      .put(`${V1}/assets/${asset.id}/attribute-values`)
      .set(...budi.auth)
      .send({ values: {} });

    expect(written.status).toBe(403);

    // The control: unchanged for an institution caller with the same codes.
    expect((await get(`/assets/${asset.id}/attribute-values`, staff)).status).toBe(200);
  });

  it('still allows values on their own unit', async () => {
    expect((await get(`/asset-units/${unitInTkj.id}/attribute-values`, budi)).status).toBe(200);
    expect((await get(`/asset-units/${unitInRpl.id}/attribute-values`, budi)).status).toBe(404);
  });
});

/**
 * `CR-004` §11 — the transfer carries everything with it, on the next request
 * and with no re-login.
 */
describe('a department transfer moves the whole operational trail', () => {
  it('hands the unit, its borrowings and its transactions to the new PIC', async () => {
    const sari = await createCaller({
      institutionId: institution.id,
      permissions: OPERATIONS_PERMISSIONS,
      isPicScoped: true,
    });
    await models.DepartmentPicAssignment.create({ departmentId: rpl.id, userId: sari.user.id });
    await rpl.update({ currentPicUserId: sari.user.id });

    const borrowing = await createBorrowing([unitInTkj.id]);
    const transaction = await createTransaction([unitInTkj.id]);
    const attachment = (
      await api()
        .post(`${V1}/assets/${asset.id}/attachments`)
        .set(...admin.auth)
        .field('assetUnitId', unitInTkj.id)
        .attach('file', PNG, { filename: 'doc.png', contentType: 'image/png' })
    ).body.data;

    // Budi holds all four; Sari holds none.
    expect((await get(`/asset-units/${unitInTkj.id}`, budi)).status).toBe(200);
    expect((await get(`/borrowings/${borrowing.id}`, budi)).status).toBe(200);
    expect((await get(`/transactions/${transaction.id}`, budi)).status).toBe(200);
    expect((await get(`/attachments/${attachment.id}`, budi)).status).toBe(200);
    expect((await get(`/asset-units/${unitInTkj.id}`, sari)).status).toBe(404);

    // An institution-scoped caller moves the unit TKJ → RPL.
    expect((await patch(`/asset-units/${unitInTkj.id}`, { departmentId: rpl.id }, staff)).status)
      .toBe(200);

    // Next request, no re-login: everything follows the unit.
    expect((await get(`/asset-units/${unitInTkj.id}`, budi)).status).toBe(404);
    expect((await get(`/borrowings/${borrowing.id}`, budi)).status).toBe(404);
    expect((await get(`/transactions/${transaction.id}`, budi)).status).toBe(404);
    expect((await get(`/attachments/${attachment.id}`, budi)).status).toBe(404);

    expect((await get(`/asset-units/${unitInTkj.id}`, sari)).status).toBe(200);
    expect((await get(`/borrowings/${borrowing.id}`, sari)).status).toBe(200);
    expect((await get(`/transactions/${transaction.id}`, sari)).status).toBe(200);
    expect((await get(`/attachments/${attachment.id}`, sari)).status).toBe(200);
  });
});
