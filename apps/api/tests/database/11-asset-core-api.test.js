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

/**
 * Asset Core API — `IMPLEMENTATION_PLAN.md` §11; `06-api.md` §5.
 *
 * Runs against the real seeded classification hierarchy, so the leaf rule
 * (`BR-011`) is exercised against genuine depth rather than a fixture.
 */

const V1 = '/api/v1';
const ROOT_CLASSIFICATION = '100000000000';
const LEAF = '117010101001'; // Aspal — a real leaf
const LEAF_2 = '117010101002'; // Semen

let admin;
let institution;
let location;

async function post(path, body, caller = admin) {
  return api()
    .post(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);
}

async function get(path, caller = admin) {
  return api()
    .get(`${V1}${path}`)
    .set(...caller.auth);
}

async function createAsset(overrides = {}) {
  const response = await post('/assets', {
    name: 'Test Asset',
    classificationId: LEAF,
    ...overrides,
  });
  return response.body.data;
}

async function createUnit(assetId, overrides = {}) {
  const response = await post(`/assets/${assetId}/units`, overrides);
  return response.body.data;
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();

  admin = await createAdminCaller();
  institution = await models.Institution.create({
    name: 'Core Institution',
    code: `CORE-${Math.random().toString(36).slice(2, 7)}`,
    address: 'Somewhere',
  });
  location = (
    await post('/locations', {
      name: 'Room 1',
      classificationId: LEAF_2,
      institutionId: institution.id,
    })
  ).body.data;
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

describe('leaf classification enforcement (BR-011, REQ-CLASS-009)', () => {
  it('rejects an asset classified against a non-leaf node', async () => {
    const response = await post('/assets', {
      name: 'Bad Asset',
      classificationId: ROOT_CLASSIFICATION,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('classificationId');
    expect(response.body.error.details[0].issue).toMatch(/BR-011/);
  });

  it('accepts an asset classified against a leaf', async () => {
    const response = await post('/assets', { name: 'Good Asset', classificationId: LEAF });

    expect(response.status).toBe(201);
    expect(response.body.data.classificationId).toBe(LEAF);
  });

  it('rejects a location classified against a non-leaf node (REQ-LOC-008)', async () => {
    const response = await post('/locations', {
      name: 'Bad Location',
      classificationId: ROOT_CLASSIFICATION,
    });

    expect(response.status).toBe(400);
  });

  it('rejects a classification that does not exist', async () => {
    const response = await post('/assets', {
      name: 'Bad Asset',
      classificationId: '999999999999',
    });

    expect(response.status).toBe(400);
  });

  it('re-checks the rule on update', async () => {
    const asset = await createAsset();

    const response = await api()
      .patch(`${V1}/assets/${asset.id}`)
      .set(...admin.auth)
      .send({ classificationId: ROOT_CLASSIFICATION });

    expect(response.status).toBe(400);
  });
});

/**
 * Locating the top of the hierarchy — REQ-LOC-007.
 *
 * The location tree has no fixed depth, so a client that wants to drill down
 * has to be able to ask where the tree STARTS. `?rootsOnly=true` is that
 * question; without it the only way to find the roots is to fetch a page of
 * every location and filter client-side, which silently misses any root beyond
 * the page cap.
 *
 * `beforeEach` has already created one root ("Room 1"), so each test below
 * builds its own tree on top of that.
 */
describe('root locations (§5.3, REQ-LOC-007)', () => {
  async function createLocation(name, parentLocationId) {
    const response = await post('/locations', {
      name,
      classificationId: LEAF_2,
      institutionId: institution.id,
      ...(parentLocationId ? { parentLocationId } : {}),
    });
    expect(response.status).toBe(201);
    return response.body.data;
  }

  it('returns only locations with no parent', async () => {
    const site = await createLocation('Site A');
    const building = await createLocation('Building 2', site.id);
    await createLocation('Floor 3', building.id);

    const response = await get('/locations?rootsOnly=true');

    expect(response.status).toBe(200);
    // "Room 1" comes from the shared setup and is a root too.
    expect(response.body.data.map((row) => row.name).sort()).toEqual(['Room 1', 'Site A']);
    expect(response.body.data.every((row) => row.parentLocationId === null)).toBe(true);
  });

  it('reaches a root however deep the tree below it goes', async () => {
    // Six levels: nothing about the query may depend on the depth beneath it.
    let parent = await createLocation('Deep Site');
    for (const name of ['Building', 'Floor', 'Wing', 'Room', 'Cabinet']) {
      parent = await createLocation(name, parent.id);
    }

    const response = await get('/locations?rootsOnly=true');

    expect(response.body.data.map((row) => row.name).sort()).toEqual(['Deep Site', 'Room 1']);
  });

  it('treats rootsOnly=false as no filter at all', async () => {
    const site = await createLocation('Site A');
    await createLocation('Building 2', site.id);

    const response = await get('/locations?rootsOnly=false');

    // Not "parent IS NOT NULL" — absent and false mean the same thing.
    expect(response.body.data.map((row) => row.name).sort()).toEqual([
      'Building 2',
      'Room 1',
      'Site A',
    ]);
  });

  it('rejects a spelling it cannot interpret rather than guessing', async () => {
    const response = await get('/locations?rootsOnly=1');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses rootsOnly together with parentLocationId', async () => {
    const site = await createLocation('Site A');

    // Filters AND together, so the pair could only ever match nothing.
    const response = await get(`/locations?rootsOnly=true&parentLocationId=${site.id}`);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/rootsOnly cannot be combined/i);
  });

  it('combines with the other filters instead of replacing them', async () => {
    await createLocation('Site A');
    const inactive = await createLocation('Retired Site');
    await post(`/locations/${inactive.id}/deactivate`, {});

    const response = await get('/locations?rootsOnly=true&status=active&q=Site');

    expect(response.body.data.map((row) => row.name)).toEqual(['Site A']);
  });

  it('respects institution scope like every other list (BR-007)', async () => {
    const otherInstitution = await models.Institution.create({
      name: 'Unrelated Institution',
      code: `UNREL-${Math.random().toString(36).slice(2, 7)}`,
      address: 'Elsewhere',
    });
    await createLocation('Mine');
    await post('/locations', {
      name: 'Theirs',
      classificationId: LEAF_2,
      institutionId: otherInstitution.id,
    });

    const scoped = await createCaller({
      permissions: ['location:read'],
      isSystemWide: false,
      institutionId: institution.id,
    });

    const response = await get('/locations?rootsOnly=true', scoped);

    expect(response.body.data.map((row) => row.name).sort()).toEqual(['Mine', 'Room 1']);
  });
});

/** The existing parent filter must keep behaving exactly as it did. */
describe('parentLocationId filter (unchanged by rootsOnly)', () => {
  it('returns the direct children of one location', async () => {
    const site = (
      await post('/locations', {
        name: 'Site A',
        classificationId: LEAF_2,
        institutionId: institution.id,
      })
    ).body.data;

    for (const name of ['Building 1', 'Building 2']) {
      await post('/locations', {
        name,
        classificationId: LEAF_2,
        institutionId: institution.id,
        parentLocationId: site.id,
      });
    }

    const response = await get(`/locations?parentLocationId=${site.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((row) => row.name).sort()).toEqual(['Building 1', 'Building 2']);
    expect(response.body.data.every((row) => row.parentLocationId === site.id)).toBe(true);
  });

  /**
   * A list row must be renderable without a second request per row.
   *
   * `parentLocationId` on its own leaves a client with a UUID and no way to turn
   * it into a name, which is how the "Inside" column ended up showing a
   * truncated id. Mirrors `currentLocation` on an asset unit.
   */
  it('resolves the parent to a readable name on every read path', async () => {
    const site = (
      await post('/locations', {
        name: 'Site A',
        classificationId: LEAF_2,
        institutionId: institution.id,
      })
    ).body.data;

    const created = await post('/locations', {
      name: 'Building 1',
      classificationId: LEAF_2,
      institutionId: institution.id,
      parentLocationId: site.id,
    });

    const expected = { id: site.id, name: 'Site A' };

    // create
    expect(created.body.data.parentLocation).toEqual(expected);
    // detail
    expect((await get(`/locations/${created.body.data.id}`)).body.data.parentLocation).toEqual(
      expected
    );
    // list
    const listed = (await get('/locations')).body.data.find((row) => row.name === 'Building 1');
    expect(listed.parentLocation).toEqual(expected);
    // children
    expect((await get(`/locations/${site.id}/children`)).body.data[0].parentLocation).toEqual(
      expected
    );

    // A top-level location has no parent, and says so rather than omitting it.
    expect(listed.parentLocationId).toBe(site.id);
    expect((await get(`/locations/${site.id}`)).body.data.parentLocation).toBeNull();
  });

  /**
   * The envelope itself, not just the rows.
   *
   * This endpoint used to answer in the single-resource envelope — the only
   * collection in the API that did. A client read it as a list, got nothing, and
   * the location picker's drill-down went empty: no location below the top level
   * could be chosen as a parent. The shape is the contract, so it is asserted
   * here rather than left to whichever client happens to guess right (§1.5).
   */
  it('answers /children in the collection envelope, complete rather than paged (§1.5)', async () => {
    const site = (await post('/locations', { name: 'Site X', classificationId: LEAF_2 })).body.data;
    for (const name of ['Block 1', 'Block 2']) {
      await post('/locations', { name, classificationId: LEAF_2, parentLocationId: site.id });
    }

    const response = await get(`/locations/${site.id}/children`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    // One page holding everything — never a slice of it.
    expect(response.body.meta).toEqual({ page: 1, pageSize: 2, total: 2, totalPages: 1 });

    // A childless node is an empty collection, not a missing one, and zero rows
    // is zero pages — the same rule every other list follows.
    const leaf = (await get(`/locations/${site.id}/children`)).body.data[0];
    const empty = await get(`/locations/${leaf.id}/children`);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta).toEqual({ page: 1, pageSize: 0, total: 0, totalPages: 0 });
  });

  it('keeps the resolved parent correct after a re-parent', async () => {
    const a = (await post('/locations', { name: 'Site A', classificationId: LEAF_2 })).body.data;
    const b = (await post('/locations', { name: 'Site B', classificationId: LEAF_2 })).body.data;
    const child = (
      await post('/locations', {
        name: 'Building 1',
        classificationId: LEAF_2,
        parentLocationId: a.id,
      })
    ).body.data;

    const moved = await api()
      .patch(`${V1}/locations/${child.id}`)
      .set(...admin.auth)
      .send({ parentLocationId: b.id });

    // Serializing the instance we already had in memory would have reported the
    // OLD parent here.
    expect(moved.body.data.parentLocation).toEqual({ id: b.id, name: 'Site B' });
  });

  it('still lists every location when neither filter is supplied', async () => {
    const site = (
      await post('/locations', {
        name: 'Site A',
        classificationId: LEAF_2,
        institutionId: institution.id,
      })
    ).body.data;
    await post('/locations', {
      name: 'Building 1',
      classificationId: LEAF_2,
      institutionId: institution.id,
      parentLocationId: site.id,
    });

    const response = await get('/locations');

    expect(response.body.data.map((row) => row.name).sort()).toEqual([
      'Building 1',
      'Room 1',
      'Site A',
    ]);
  });
});

describe('organization scope (BR-007, REQ-AUTHZ-004/005)', () => {
  let scopedCaller;
  let otherInstitution;

  beforeEach(async () => {
    otherInstitution = await models.Institution.create({
      name: 'Other Institution',
      code: `OTHER-${Math.random().toString(36).slice(2, 7)}`,
      address: 'Elsewhere',
    });
    scopedCaller = await createCaller({
      permissions: ['asset:read', 'asset:create', 'asset:update', 'location:read'],
      isSystemWide: false,
      institutionId: institution.id,
    });
  });

  it('hides another institution’s assets from a scoped caller', async () => {
    await createAsset({ institutionId: institution.id, name: 'Mine' });
    await createAsset({ institutionId: otherInstitution.id, name: 'Theirs' });

    const response = await get('/assets', scopedCaller);

    expect(response.body.data.map((a) => a.name)).toEqual(['Mine']);
  });

  it('answers 404, not 403, for an out-of-scope asset (§1.4)', async () => {
    const theirs = await createAsset({ institutionId: otherInstitution.id });

    const response = await get(`/assets/${theirs.id}`, scopedCaller);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('defaults a new asset to the caller’s own institution', async () => {
    const response = await post(
      '/assets',
      { name: 'Defaulted', classificationId: LEAF },
      scopedCaller
    );

    expect(response.status).toBe(201);
    expect(response.body.data.institutionId).toBe(institution.id);
  });

  it('refuses to create into another institution', async () => {
    const response = await post(
      '/assets',
      { name: 'Sneaky', classificationId: LEAF, institutionId: otherInstitution.id },
      scopedCaller
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/BR-007/);
  });

  it('refuses to move an asset into another institution', async () => {
    const mine = await createAsset({ institutionId: institution.id });

    const response = await api()
      .patch(`${V1}/assets/${mine.id}`)
      .set(...scopedCaller.auth)
      .send({ institutionId: otherInstitution.id });

    expect(response.status).toBe(400);
  });

  it('lets a system-wide caller see every institution (REQ-AUTHZ-005)', async () => {
    await createAsset({ institutionId: institution.id, name: 'Mine' });
    await createAsset({ institutionId: otherInstitution.id, name: 'Theirs' });

    const response = await get('/assets');

    expect(response.body.data.map((a) => a.name).sort()).toEqual(['Mine', 'Theirs']);
  });
});

describe('assets (§5.1, REQ-ASSET-001–011)', () => {
  it('creates, reads and resolves related records', async () => {
    const vendor = await models.Vendor.create({ name: 'Acme' });
    const created = await createAsset({ vendorId: vendor.id, institutionId: institution.id });

    const response = await get(`/assets/${created.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.classification.name).toBe('Aspal');
    expect(response.body.data.vendor.name).toBe('Acme');
    expect(response.body.data.institution.code).toBe(institution.code);
  });

  it('exposes the contract number for procurement traceability (REQ-ASSET-011)', async () => {
    const contract = await models.Contract.create({
      contractNumber: 'CTR-2026-1',
      contractDate: '2026-01-01',
    });
    const created = await createAsset({ contractId: contract.id });

    const response = await get(`/assets/${created.id}`);

    expect(response.body.data.contract).toEqual({
      id: contract.id,
      contractNumber: 'CTR-2026-1',
    });
  });

  it('allows an asset with no procurement record (REQ-ASSET-011 exception)', async () => {
    const created = await createAsset();

    expect(created.contractId).toBeNull();
  });

  it('rejects a vendor that does not exist', async () => {
    const response = await post('/assets', {
      name: 'X',
      classificationId: LEAF,
      vendorId: '00000000-0000-0000-0000-000000000000',
    });

    expect(response.status).toBe(400);
  });

  it('searches by name and description (REQ-SEARCH-001)', async () => {
    await createAsset({ name: 'Office Chair' });
    await createAsset({ name: 'Standing Desk', description: 'adjustable' });

    expect((await get('/assets?q=chair')).body.data.map((a) => a.name)).toEqual(['Office Chair']);
    expect((await get('/assets?q=adjustable')).body.data.map((a) => a.name)).toEqual([
      'Standing Desk',
    ]);
  });

  it('filters by unit-level attributes through a subquery (REQ-ASSET-009)', async () => {
    const withUnit = await createAsset({ name: 'Has Unit' });
    await createAsset({ name: 'No Unit' });
    const unit = await createUnit(withUnit.id);
    await post(`/asset-units/${unit.id}/history`, {
      description: 'Placed',
      condition: 'GOOD',
      locationId: location.id,
    });

    const byLocation = await get(`/assets?locationId=${location.id}`);
    expect(byLocation.body.data.map((a) => a.name)).toEqual(['Has Unit']);

    const byCondition = await get('/assets?condition=GOOD');
    expect(byCondition.body.data.map((a) => a.name)).toEqual(['Has Unit']);
  });

  it('paginates and sorts (REQ-ASSET-007/010)', async () => {
    await createAsset({ name: 'Alpha' });
    await createAsset({ name: 'Beta' });

    const page = await get('/assets?page=1&pageSize=1&sort=name&order=asc');
    expect(page.body.data.map((a) => a.name)).toEqual(['Alpha']);
    expect(page.body.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
  });

  it('deactivates without destroying its units (REQ-ASSET-005, BR-005)', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    const response = await post(`/assets/${asset.id}/deactivate`);
    expect(response.body.data.isActive).toBe(false);

    expect((await get(`/asset-units/${unit.id}`)).status).toBe(200);
  });

  it('records who created and updated it', async () => {
    const asset = await createAsset();

    expect(asset.createdBy).toBe(admin.user.id);
    expect(asset.updatedBy).toBe(admin.user.id);
  });
});

describe('asset units (§5.2, REQ-UNIT-001–006)', () => {
  it('creates a unit under its asset, defaulting to REGISTERED', async () => {
    const asset = await createAsset();

    const response = await post(`/assets/${asset.id}/units`, { description: 'Serial 001' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      assetId: asset.id,
      lifecycleState: 'REGISTERED',
      currentCondition: null,
      currentLocationId: null,
    });
  });

  it('lists units for an asset', async () => {
    const asset = await createAsset();
    await createUnit(asset.id);
    await createUnit(asset.id);

    const response = await get(`/assets/${asset.id}/units`);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
  });

  /**
   * Department assignment — Phase 20 (`CR-003`), REQ-ORG-004, `BR-007`.
   *
   * The rule lives in `domain/departmentRules.js` and is applied identically on
   * create and update. Before Phase 20 both paths had their own copy of an
   * existence-only check, and neither compared institutions at all.
   */
  describe('department assignment (REQ-ORG-004, BR-007)', () => {
    async function createDepartment(institutionId, overrides = {}) {
      return models.Department.create({
        code: overrides.code ?? 'TKJ',
        name: 'Teknik Komputer dan Jaringan',
        institutionId,
        ...overrides,
      });
    }

    it('rejects a department that does not exist', async () => {
      const asset = await createAsset();

      const response = await post(`/assets/${asset.id}/units`, {
        departmentId: '00000000-0000-4000-8000-000000000000',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('departmentId');
    });

    it('assigns a department of the same institution and resolves it by name', async () => {
      const department = await createDepartment(institution.id);
      const asset = await createAsset({ institutionId: institution.id });

      const unit = await createUnit(asset.id, { departmentId: department.id });

      expect(unit.departmentId).toBe(department.id);
      // The resolved object is what stops the UI printing a UUID (`CR-003` §1.4).
      expect(unit.department).toMatchObject({
        id: department.id,
        code: 'TKJ',
        name: 'Teknik Komputer dan Jaringan',
      });
    });

    it('reports no department as null rather than omitting the field', async () => {
      const asset = await createAsset({ institutionId: institution.id });

      const unit = await createUnit(asset.id, {});

      expect(unit.departmentId).toBeNull();
      expect(unit.department).toBeNull();
    });

    it('refuses a department belonging to another institution', async () => {
      const other = await models.Institution.create({
        name: 'Other',
        code: 'OTH-DEPT',
        address: 'Jl. Lain',
      });
      const foreign = await createDepartment(other.id);
      const asset = await createAsset({ institutionId: institution.id });

      const response = await post(`/assets/${asset.id}/units`, { departmentId: foreign.id });

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('departmentId');
    });

    it('refuses a deactivated department', async () => {
      const department = await createDepartment(institution.id, { isActive: false });
      const asset = await createAsset({ institutionId: institution.id });

      const response = await post(`/assets/${asset.id}/units`, { departmentId: department.id });

      expect(response.status).toBe(400);
    });

    /**
     * `NULL = NULL` is two absences, not a match. An unassigned department and
     * an institution-less asset have no organizational owner to agree about.
     */
    it('refuses an unassigned department, and refuses one on an institution-less asset', async () => {
      const unassigned = await createDepartment(null, { code: 'ORPH' });
      const assigned = await createDepartment(institution.id);

      const noInstitutionAsset = await createAsset({ name: 'No institution' });
      const scopedAsset = await createAsset({ institutionId: institution.id });

      const orphanDepartment = await post(`/assets/${scopedAsset.id}/units`, {
        departmentId: unassigned.id,
      });
      expect(orphanDepartment.status).toBe(400);

      const orphanAsset = await post(`/assets/${noInstitutionAsset.id}/units`, {
        departmentId: assigned.id,
      });
      expect(orphanAsset.status).toBe(400);
    });

    it('enforces the same rule on update as on create', async () => {
      const other = await models.Institution.create({
        name: 'Other',
        code: 'OTH-UPD',
        address: 'Jl. Lain',
      });
      const foreign = await createDepartment(other.id);
      const mine = await createDepartment(institution.id, { code: 'RPL' });
      const asset = await createAsset({ institutionId: institution.id });
      const unit = await createUnit(asset.id, {});

      const refused = await api()
        .patch(`${V1}/asset-units/${unit.id}`)
        .set(...admin.auth)
        .send({ departmentId: foreign.id });
      expect(refused.status).toBe(400);

      const accepted = await api()
        .patch(`${V1}/asset-units/${unit.id}`)
        .set(...admin.auth)
        .send({ departmentId: mine.id });
      expect(accepted.status).toBe(200);
      expect(accepted.body.data.department.code).toBe('RPL');

      // Clearing is always legal — the association is optional (REQ-ORG-004).
      const cleared = await api()
        .patch(`${V1}/asset-units/${unit.id}`)
        .set(...admin.auth)
        .send({ departmentId: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.department).toBeNull();
    });
  });

  /**
   * Moving an asset between institutions — Phase 20 (`CR-003` §6.4),
   * REQ-UNIT-008, REQ-NFR-REL-001.
   */
  describe('asset institution move clears unit departments', () => {
    it('clears every department and leaves one audit record per unit', async () => {
      const target = await models.Institution.create({
        name: 'Target',
        code: 'TGT-MOVE',
        address: 'Jl. Target',
      });
      const department = await models.Department.create({
        code: 'TKJ',
        name: 'Teknik Komputer',
        institutionId: institution.id,
      });
      const asset = await createAsset({ institutionId: institution.id });
      const first = await createUnit(asset.id, { departmentId: department.id });
      const second = await createUnit(asset.id, { departmentId: department.id });

      const auditBefore = await models.AuditLog.count({
        where: { entityType: 'AssetUnit', action: 'UPDATE' },
      });

      const moved = await api()
        .patch(`${V1}/assets/${asset.id}`)
        .set(...admin.auth)
        .send({ institutionId: target.id });
      expect(moved.status).toBe(200);
      expect(moved.body.data.institutionId).toBe(target.id);

      const units = await models.AssetUnit.findAll({ where: { assetId: asset.id } });
      expect(units.map((unit) => unit.departmentId)).toEqual([null, null]);

      /**
       * The audit assertion is the point of this test. `auditHooks` registers
       * only INSTANCE hooks, so a bulk update without `individualHooks: true`
       * would clear both departments and record nothing — the change would be
       * correct and invisible at the same time.
       */
      const auditAfter = await models.AuditLog.count({
        where: { entityType: 'AssetUnit', action: 'UPDATE' },
      });
      expect(auditAfter - auditBefore).toBe(2);

      // The inventory code is deliberately NOT reissued (REQ-UNIT-008): it is
      // already printed on a physical label.
      const reread = await models.AssetUnit.findByPk(first.id);
      expect(reread.inventoryCode).toBe(first.inventoryCode);
      expect(second.inventoryCode).not.toBe(first.inventoryCode);
    });

    it('leaves departments alone when the institution does not change', async () => {
      const department = await models.Department.create({
        code: 'RPL',
        name: 'Rekayasa Perangkat Lunak',
        institutionId: institution.id,
      });
      const asset = await createAsset({ institutionId: institution.id });
      const unit = await createUnit(asset.id, { departmentId: department.id });

      await api()
        .patch(`${V1}/assets/${asset.id}`)
        .set(...admin.auth)
        .send({ name: 'Renamed only' });

      const reread = await models.AssetUnit.findByPk(unit.id);
      expect(reread.departmentId).toBe(department.id);
    });
  });

  it('refuses to edit condition, location or lifecycle state directly', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    for (const body of [
      { currentCondition: 'GOOD' },
      { currentLocationId: location.id },
      { lifecycleState: 'ACTIVE' },
    ]) {
      const response = await api()
        .patch(`${V1}/asset-units/${unit.id}`)
        .set(...admin.auth)
        .send(body);

      expect(response.status).toBe(400);
    }
  });

  it('is scoped through its asset', async () => {
    const other = await models.Institution.create({
      name: 'Far Away',
      code: `FAR-${Math.random().toString(36).slice(2, 7)}`,
      address: 'Elsewhere',
    });
    const theirAsset = await createAsset({ institutionId: other.id });
    const theirUnit = await createUnit(theirAsset.id);
    const scoped = await createCaller({
      permissions: ['asset-unit:read'],
      institutionId: institution.id,
    });

    expect((await get(`/asset-units/${theirUnit.id}`, scoped)).status).toBe(404);
  });
});

describe('longitudinal history (§5.2, REQ-LIFE-002/003/004, REQ-LOC-003/004)', () => {
  let asset;
  let unit;

  beforeEach(async () => {
    asset = await createAsset();
    unit = await createUnit(asset.id);
  });

  it('records condition, location and lifecycle state in one entry', async () => {
    const response = await post(`/asset-units/${unit.id}/history`, {
      description: 'Received and placed',
      condition: 'GOOD',
      locationId: location.id,
      lifecycleState: 'ACTIVE',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      currentCondition: 'GOOD',
      currentLocationId: location.id,
      lifecycleState: 'ACTIVE',
    });
  });

  /**
   * Provenance — `CR-012` `DEC-A`, REQ-COND-006, TC-COND-006.
   *
   * This endpoint is the ONE writer of `MANUAL`, and `MANUAL` is the only value
   * that satisfies the monthly assessment obligation. The borrowing paths write
   * `BORROWING`, asserted in `14-operations-api`.
   */
  describe('entry provenance (CR-012)', () => {
    it('records a manual entry as MANUAL', async () => {
      await post(`/asset-units/${unit.id}/history`, {
        description: 'Monthly check',
        condition: 'GOOD',
        locationId: location.id,
      });

      const history = await get(`/asset-units/${unit.id}/history`);

      expect(history.body.data[0].entryType).toBe('MANUAL');
    });

    /**
     * The caller must not be able to declare its own provenance. Accepting it
     * would let any client mark a borrowing return as a monthly assessment,
     * which is exactly the distinction the column exists to hold.
     */
    it('refuses entryType in the request body', async () => {
      const response = await post(`/asset-units/${unit.id}/history`, {
        description: 'Trying to classify my own entry',
        condition: 'GOOD',
        locationId: location.id,
        entryType: 'BORROWING',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(response.body.error.details)).toMatch(/entryType/);
    });
  });

  it('syncs the denormalized columns with the history (§5.3.2 note)', async () => {
    await post(`/asset-units/${unit.id}/history`, {
      description: 'Placed',
      condition: 'FAIR',
      locationId: location.id,
    });

    const stored = await models.AssetUnit.findByPk(unit.id);
    const entry = await models.LongitudinalHistory.findOne({ where: { assetUnitId: unit.id } });

    expect(stored.currentCondition).toBe(entry.condition);
    expect(stored.currentLocationId).toBe(entry.locationId);
  });

  it('closes the previous entry rather than editing it (append-only)', async () => {
    await post(`/asset-units/${unit.id}/history`, {
      description: 'First',
      condition: 'GOOD',
      locationId: location.id,
    });
    await post(`/asset-units/${unit.id}/history`, { description: 'Second', condition: 'POOR' });

    const entries = await models.LongitudinalHistory.findAll({
      where: { assetUnitId: unit.id },
      order: [['effectiveFrom', 'ASC']],
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].description).toBe('First');
    expect(entries[0].condition).toBe('GOOD');
    expect(entries[0].effectiveTo).not.toBeNull();
    expect(entries[1].effectiveTo).toBeNull();
  });

  it('carries omitted fields forward from the current snapshot', async () => {
    await post(`/asset-units/${unit.id}/history`, {
      description: 'First',
      condition: 'GOOD',
      locationId: location.id,
    });

    const response = await post(`/asset-units/${unit.id}/history`, {
      description: 'Condition only',
      condition: 'DAMAGED',
    });

    expect(response.body.data.currentLocationId).toBe(location.id);
    expect(response.body.data.currentCondition).toBe('DAMAGED');
  });

  it('requires condition and location on the first entry', async () => {
    const response = await post(`/asset-units/${unit.id}/history`, { description: 'Nothing' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('condition');
  });

  it('maintains the location assignment history (§11.5, REQ-LOC-004)', async () => {
    const second = (await post('/locations', { name: 'Room 2', classificationId: LEAF_2 })).body
      .data;

    await post(`/asset-units/${unit.id}/history`, {
      description: 'Placed',
      condition: 'GOOD',
      locationId: location.id,
    });
    await post(`/asset-units/${unit.id}/history`, { description: 'Moved', locationId: second.id });

    const response = await get(`/asset-units/${unit.id}/locations`);

    expect(response.body.data).toHaveLength(2);
    const current = response.body.data.filter((row) => row.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].locationId).toBe(second.id);
    const closed = response.body.data.find((row) => !row.isCurrent);
    expect(closed.unassignedAt).not.toBeNull();
  });

  it('does not open a new location assignment when the location is unchanged', async () => {
    await post(`/asset-units/${unit.id}/history`, {
      description: 'Placed',
      condition: 'GOOD',
      locationId: location.id,
    });
    await post(`/asset-units/${unit.id}/history`, {
      description: 'Condition only',
      condition: 'FAIR',
    });

    const response = await get(`/asset-units/${unit.id}/locations`);

    expect(response.body.data).toHaveLength(1);
  });

  it('returns history newest first', async () => {
    await post(`/asset-units/${unit.id}/history`, {
      description: 'First',
      condition: 'GOOD',
      locationId: location.id,
    });
    await post(`/asset-units/${unit.id}/history`, { description: 'Second', condition: 'FAIR' });

    const response = await get(`/asset-units/${unit.id}/history`);

    expect(response.body.data[0].description).toBe('Second');
  });

  it('rejects an effective date before the current entry', async () => {
    await post(`/asset-units/${unit.id}/history`, {
      description: 'First',
      condition: 'GOOD',
      locationId: location.id,
    });

    const response = await post(`/asset-units/${unit.id}/history`, {
      description: 'Backdated',
      condition: 'FAIR',
      effectiveFrom: '2020-01-01T00:00:00Z',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('effectiveFrom');
  });

  it('rejects a location that does not exist', async () => {
    const response = await post(`/asset-units/${unit.id}/history`, {
      description: 'Nowhere',
      condition: 'GOOD',
      locationId: '00000000-0000-0000-0000-000000000000',
    });

    expect(response.status).toBe(400);
  });
});

describe('lifecycle state machine (03-domain.md §7.1, REQ-LIFE-002)', () => {
  let unit;

  beforeEach(async () => {
    const asset = await createAsset();
    unit = await createUnit(asset.id);
    await post(`/asset-units/${unit.id}/history`, {
      description: 'Initial',
      condition: 'GOOD',
      locationId: location.id,
    });
  });

  const move = (state, description = 'Transition') =>
    post(`/asset-units/${unit.id}/history`, { description, lifecycleState: state });

  it('allows REGISTERED to ACTIVE', async () => {
    expect((await move('ACTIVE')).status).toBe(200);
  });

  it.each(['IN_STORAGE', 'BORROWED', 'UNDER_MAINTENANCE', 'DISPOSED', 'DEACTIVATED'])(
    'allows ACTIVE to %s',
    async (state) => {
      await move('ACTIVE');

      expect((await move(state)).status).toBe(200);
    }
  );

  it.each(['IN_STORAGE', 'BORROWED', 'DISPOSED'])(
    'rejects REGISTERED straight to %s',
    async (state) => {
      const response = await move(state);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    }
  );

  it('treats DISPOSED as terminal (REQ-LIFE-006)', async () => {
    await move('ACTIVE');
    await move('DISPOSED');

    const response = await move('ACTIVE');

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/end of life/);
  });

  it('treats DEACTIVATED as terminal', async () => {
    await move('ACTIVE');
    await move('DEACTIVATED');

    expect((await move('ACTIVE')).status).toBe(409);
  });

  it('allows re-recording the same state', async () => {
    await move('ACTIVE');

    expect((await move('ACTIVE')).status).toBe(200);
  });

  it('names the reachable states when it refuses', async () => {
    const response = await move('DISPOSED');

    expect(response.body.error.details[0].issue).toMatch(/ACTIVE/);
  });
});

/**
 * Procurement links outside the procurement flow — REQ-ASSET-011, REQ-PROC-006.
 *
 * `Asset.contractId` was writable from Phase 5 but only ever set by
 * `POST /contract-items/:id/assets`; `AssetUnit.contractItemId` could be set at
 * creation and never afterwards. Both are reachable from the asset module now,
 * which makes it possible for the two to disagree — so the rules that keep them
 * consistent are what these tests are really about.
 */
describe('procurement links from the asset module (REQ-ASSET-011, REQ-PROC-006)', () => {
  let contract;
  let otherContract;
  let item;
  let otherItem;

  async function patch(path, body, caller = admin) {
    return api()
      .patch(`${V1}${path}`)
      .set(...caller.auth)
      .send(body);
  }

  beforeEach(async () => {
    contract = await models.Contract.create({
      contractNumber: `CTR-A-${Math.random().toString(36).slice(2, 8)}`,
      contractDate: '2026-01-01',
    });
    otherContract = await models.Contract.create({
      contractNumber: `CTR-B-${Math.random().toString(36).slice(2, 8)}`,
      contractDate: '2026-02-01',
    });
    item = await models.ContractItem.create({ contractId: contract.id, assetName: 'Laptop' });
    otherItem = await models.ContractItem.create({
      contractId: otherContract.id,
      assetName: 'Proyektor',
    });
  });

  it('attaches a contract to an asset that was registered without one', async () => {
    const asset = await createAsset();

    const response = await patch(`/assets/${asset.id}`, { contractId: contract.id });

    expect(response.status).toBe(200);
    expect(response.body.data.contract.contractNumber).toBe(contract.contractNumber);
  });

  it('attaches a line item to a unit after the fact', async () => {
    const asset = await createAsset({ contractId: contract.id });
    const unit = await createUnit(asset.id);

    const response = await patch(`/asset-units/${unit.id}`, { contractItemId: item.id });

    expect(response.status).toBe(200);
    expect(response.body.data.contractItemId).toBe(item.id);
  });

  it('clears a line item that was recorded in error', async () => {
    const asset = await createAsset({ contractId: contract.id });
    const unit = await createUnit(asset.id, { contractItemId: item.id });

    const response = await patch(`/asset-units/${unit.id}`, { contractItemId: null });

    expect(response.status).toBe(200);
    expect(response.body.data.contractItemId).toBeNull();
  });

  it("refuses a line item from a contract other than the asset's", async () => {
    const asset = await createAsset({ contractId: contract.id });
    const unit = await createUnit(asset.id);

    const response = await patch(`/asset-units/${unit.id}`, { contractItemId: otherItem.id });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('contractItemId');
  });

  it('refuses the same mismatch at creation', async () => {
    const asset = await createAsset({ contractId: contract.id });

    const response = await post(`/assets/${asset.id}/units`, { contractItemId: otherItem.id });

    expect(response.status).toBe(400);
  });

  /**
   * Nothing to contradict: an asset with no procurement record makes no claim
   * about which contract its units arrived on.
   */
  it('allows a line item on a unit whose asset has no contract', async () => {
    const asset = await createAsset();
    const unit = await createUnit(asset.id);

    const response = await patch(`/asset-units/${unit.id}`, { contractItemId: item.id });

    expect(response.status).toBe(200);
  });

  it('refuses to move an asset to a contract its units contradict', async () => {
    const asset = await createAsset({ contractId: contract.id });
    await createUnit(asset.id, { contractItemId: item.id });

    const response = await patch(`/assets/${asset.id}`, { contractId: otherContract.id });

    expect(response.status).toBe(409);
  });

  it('refuses to clear a contract while a unit still names one of its items', async () => {
    const asset = await createAsset({ contractId: contract.id });
    await createUnit(asset.id, { contractItemId: item.id });

    expect((await patch(`/assets/${asset.id}`, { contractId: null })).status).toBe(409);
  });

  it('allows the move once the units no longer contradict it', async () => {
    const asset = await createAsset({ contractId: contract.id });
    const unit = await createUnit(asset.id, { contractItemId: item.id });

    await patch(`/asset-units/${unit.id}`, { contractItemId: null });

    expect((await patch(`/assets/${asset.id}`, { contractId: otherContract.id })).status).toBe(200);
  });

  it('leaves an asset with untraced units free to change contract', async () => {
    const asset = await createAsset({ contractId: contract.id });
    await createUnit(asset.id);

    expect((await patch(`/assets/${asset.id}`, { contractId: otherContract.id })).status).toBe(200);
  });
});
