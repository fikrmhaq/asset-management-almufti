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
 * Department-PIC record scope — Phase 22 (`CR-003` §5, §14), REQ-ROLE-011,
 * REQ-AUTHZ-007.
 *
 * The third organization-scope tier. A PIC-scoped caller reaches ONLY the asset
 * units of departments they are CURRENTLY the person in charge of.
 *
 * Two things are being proved, and they are different:
 *
 *   THE BOUNDARY HOLDS      every way into an asset unit is narrowed — three
 *                           list paths, the record path, the scan path, and the
 *                           write paths. A gap in any one of them is a bypass,
 *                           so each is exercised separately rather than trusting
 *                           that they share a helper.
 *
 *   IT IS SYSTEM-ENFORCED   not achieved by withholding permissions. The
 *                           PIC-scoped caller here is granted the SAME asset-unit
 *                           permissions as the institution caller; only the tier
 *                           differs (the client's B1 requirement).
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

let admin;
let institution;

/** TKJ and RPL in one institution; the PIC holds TKJ only. */
let tkj;
let rpl;
let budi; // PIC-scoped, holds TKJ
let sari; // PIC-scoped, holds RPL
let staff; // institution-scoped, same permissions
let unitInTkj;
let unitInRpl;
let unitUnassigned;
let asset;

const UNIT_PERMISSIONS = [
  'asset-unit:read',
  'asset-unit:create',
  'asset-unit:update',
  'asset-unit:record-history',
];

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  // Operations first: borrowings reference users and units (`NO ACTION`).
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

  const createUnit = async (departmentId) =>
    (
      await api()
        .post(`${V1}/assets/${asset.id}/units`)
        .set(...admin.auth)
        .send(departmentId ? { departmentId } : {})
    ).body.data;

  unitInTkj = await createUnit(tkj.id);
  unitInRpl = await createUnit(rpl.id);
  unitUnassigned = await createUnit(null);

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
  // Identical permissions, ordinary tier — the control for every assertion below.
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

const get = (path, caller) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

const patch = (path, body, caller) =>
  api()
    .patch(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const post = (path, body, caller) =>
  api()
    .post(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

describe('the scope tiers resolve as documented (REQ-ROLE-011)', () => {
  it('narrows only when EVERY role is PIC-scoped', async () => {
    // `.some()` for isSystemWide, `.every()` for isPicScoped — the flag that
    // grants decides for the principal, the flag that restricts must be
    // unanimous.
    const alsoOrdinary = await createCaller({
      institutionId: institution.id,
      permissions: UNIT_PERMISSIONS,
      isPicScoped: true,
    });
    const ordinaryRole = await models.Role.create({ name: `extra-${Date.now()}` });
    await models.UserRole.create({ userId: alsoOrdinary.user.id, roleId: ordinaryRole.id });

    // Holding one ordinary role alongside restores institution reach: adding a
    // PIC-scoped role to an administrator must not silently demote them.
    const response = await get(`/asset-units/${unitInRpl.id}`, alsoOrdinary);
    expect(response.status).toBe(200);
  });

  it('refuses a role that is both system-wide and PIC-scoped (BR-023)', async () => {
    const response = await post(
      '/roles',
      { name: `contradictory-${Date.now()}`, isSystemWide: true, isPicScoped: true },
      admin
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('isPicScoped');
  });

  it('allows PIC-scoped together with institution-assignable (B3)', async () => {
    // Different questions: one is what the holder reaches, the other is who may
    // hand the role out.
    const response = await post(
      '/roles',
      { name: `delegable-${Date.now()}`, isPicScoped: true, isInstitutionAssignable: true },
      admin
    );

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      isPicScoped: true,
      isInstitutionAssignable: true,
    });
  });

  it('is refused by the database even if the service is bypassed', async () => {
    await expect(
      models.Role.create({ name: `db-${Date.now()}`, isSystemWide: true, isPicScoped: true })
    ).rejects.toThrow();
  });
});

describe('reading asset units', () => {
  it('narrows the list of an asset units to the holder departments', async () => {
    const mine = await get(`/assets/${asset.id}/units`, budi);
    const theirs = await get(`/assets/${asset.id}/units`, sari);
    const all = await get(`/assets/${asset.id}/units`, staff);

    expect(mine.body.data.map((row) => row.id)).toEqual([unitInTkj.id]);
    expect(theirs.body.data.map((row) => row.id)).toEqual([unitInRpl.id]);
    // The control: same permissions, ordinary tier, sees all three.
    expect(all.body.data).toHaveLength(3);
  });

  it('narrows the units of a location', async () => {
    const location = await models.Location.create({
      name: 'Lab 1',
      classificationId: LEAF,
      institutionId: institution.id,
    });
    for (const unit of [unitInTkj, unitInRpl, unitUnassigned]) {
      await post(
        `/asset-units/${unit.id}/history`,
        { condition: 'GOOD', locationId: location.id, description: 'Placed' },
        admin
      );
    }

    const mine = await get(`/locations/${location.id}/units`, budi);
    const all = await get(`/locations/${location.id}/units`, staff);

    expect(mine.body.data.map((row) => row.id)).toEqual([unitInTkj.id]);
    expect(all.body.data).toHaveLength(3);
  });

  it('narrows the units of a contract item', async () => {
    const supplier = await models.Supplier.create({ name: 'Supplier', address: 'x' });
    const contract = await models.Contract.create({
      contractNumber: `C-${Date.now()}`,
      contractDate: '2026-01-01',
      supplierId: supplier.id,
      institutionId: institution.id,
    });
    const item = await models.ContractItem.create({
      contractId: contract.id,
      assetName: 'Laptop',
      quantity: 2,
      unitPrice: 1000,
    });
    await models.AssetUnit.update(
      { contractItemId: item.id },
      { where: { id: [unitInTkj.id, unitInRpl.id] } }
    );

    const mine = await get(`/contract-items/${item.id}/asset-units`, budi);

    expect(mine.body.data.map((row) => row.id)).toEqual([unitInTkj.id]);
  });

  /**
   * 404, never 403 — a unit outside the caller's reach must be
   * indistinguishable from one that does not exist (`06-api.md` §1.4).
   */
  it('answers 404 for a unit in another department', async () => {
    expect((await get(`/asset-units/${unitInTkj.id}`, budi)).status).toBe(200);

    const refused = await get(`/asset-units/${unitInTkj.id}`, sari);
    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe('NOT_FOUND');
  });

  /** No department means no departmental responsibility (`CR-003` §5.5). */
  it('answers 404 for a unit with no department at all', async () => {
    expect((await get(`/asset-units/${unitUnassigned.id}`, budi)).status).toBe(404);
    expect((await get(`/asset-units/${unitUnassigned.id}`, sari)).status).toBe(404);
    // The control.
    expect((await get(`/asset-units/${unitUnassigned.id}`, staff)).status).toBe(200);
  });

  it('narrows the QR scan path the same way (REQ-UNIT-011)', async () => {
    const code = (await get(`/asset-units/${unitInRpl.id}`, staff)).body.data.inventoryCode;
    expect(code).toBeTruthy();

    // A code belonging to another department must look exactly like a code that
    // was never issued.
    expect((await get(`/asset-units/by-code/${code}`, budi)).status).toBe(404);
    expect((await get(`/asset-units/by-code/${code}`, sari)).status).toBe(200);
  });

  it('narrows the sub-resources that hang off a unit', async () => {
    for (const path of ['/history', '/locations', '/label']) {
      expect((await get(`/asset-units/${unitInRpl.id}${path}`, budi)).status).toBe(404);
      expect((await get(`/asset-units/${unitInTkj.id}${path}`, budi)).status).toBe(200);
    }
  });
});

describe('writing to asset units', () => {
  it('allows operational edits within the holder department', async () => {
    const response = await patch(
      `/asset-units/${unitInTkj.id}`,
      { description: 'Serial 123' },
      budi
    );

    expect(response.status).toBe(200);
    expect(response.body.data.description).toBe('Serial 123');
  });

  it('refuses operational edits outside it', async () => {
    expect(
      (await patch(`/asset-units/${unitInRpl.id}`, { description: 'Nope' }, budi)).status
    ).toBe(404);
    expect(
      (await patch(`/asset-units/${unitUnassigned.id}`, { description: 'Nope' }, budi)).status
    ).toBe(404);
  });

  it('allows recording history within the holder department', async () => {
    // A first history entry needs a location as well as a condition — the unit
    // has neither recorded yet. That rule predates this phase and is unrelated
    // to scope; supplying both is what makes this a test of the boundary.
    const location = await models.Location.create({
      name: 'Lab 1',
      classificationId: LEAF,
      institutionId: institution.id,
    });

    const response = await post(
      `/asset-units/${unitInTkj.id}/history`,
      { condition: 'GOOD', locationId: location.id, description: 'Checked' },
      budi
    );

    // 200, not 201: recording history returns the updated unit, not a new
    // resource with its own address.
    expect(response.status).toBe(200);
  });

  /**
   * The department is the boundary itself, so a PIC must not move it — in
   * either direction. Otherwise they could pull units into their own reach, or
   * push an inconvenient one out of it (`CR-003` §6).
   */
  describe('the department is not theirs to change (CR-003 §6)', () => {
    it('refuses moving a unit to another department', async () => {
      const response = await patch(`/asset-units/${unitInTkj.id}`, { departmentId: rpl.id }, budi);

      // 400 and not 404: the unit IS reachable, and the refusal names the field.
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('departmentId');
    });

    it('refuses clearing the department', async () => {
      const response = await patch(`/asset-units/${unitInTkj.id}`, { departmentId: null }, budi);

      expect(response.status).toBe(400);
    });

    it('refuses re-stating the department it already has', async () => {
      // Even a no-op move is refused: the boundary is "not yours to set", not
      // "not yours to change to something else".
      const response = await patch(`/asset-units/${unitInTkj.id}`, { departmentId: tkj.id }, budi);

      expect(response.status).toBe(400);
    });

    it('still allows an edit that does not mention the department', async () => {
      const response = await patch(`/asset-units/${unitInTkj.id}`, { description: 'Fine' }, budi);

      expect(response.status).toBe(200);
      expect(response.body.data.departmentId).toBe(tkj.id);
    });

    it('lets an institution-scoped caller move it, and the reach follows', async () => {
      const moved = await patch(`/asset-units/${unitInTkj.id}`, { departmentId: rpl.id }, staff);
      expect(moved.status).toBe(200);

      // Immediately, with no grace period and no previous-holder exception.
      expect((await get(`/asset-units/${unitInTkj.id}`, budi)).status).toBe(404);
      expect((await get(`/asset-units/${unitInTkj.id}`, sari)).status).toBe(200);
    });
  });

  /**
   * `CR-004` OQ-1 REVERSED THIS.
   *
   * Phase 22 let a PIC-scoped caller register a unit into a department they
   * held. `CR-004` forbids it: a PIC manages EXISTING units, and registering one
   * is an Asset-administration act. `asset-unit:create` left
   * `PIC_ALLOWED_PERMISSIONS`, so the ceiling suppresses the grant and the route
   * answers 403 — note the caller below IS granted the permission.
   */
  describe('creating units is not theirs to do (CR-004 OQ-1)', () => {
    it('refuses creation into a department the caller holds', async () => {
      expect(UNIT_PERMISSIONS).toContain('asset-unit:create');

      const response = await post(`/assets/${asset.id}/units`, { departmentId: tkj.id }, budi);

      expect(response.status).toBe(403);
    });

    it('refuses creation into another department', async () => {
      expect((await post(`/assets/${asset.id}/units`, { departmentId: rpl.id }, budi)).status).toBe(
        403
      );
    });

    it('refuses creation with no department', async () => {
      expect((await post(`/assets/${asset.id}/units`, {}, budi)).status).toBe(403);
      // The control: unchanged for an ordinary caller holding the same code.
      expect((await post(`/assets/${asset.id}/units`, {}, staff)).status).toBe(201);
    });
  });
});

/**
 * `CR-003` §5.7, as narrowed by `CR-004` OQ-1.
 *
 * A PIC-scoped role holds NO `asset:read` and NO `department:read`, and still
 * reads the units hanging off an asset — because permission and scope are
 * enforced at different layers: the route is gated by `asset-unit:read`, and the
 * internal load of the parent asset is containment, not browsing.
 *
 * The CREATION half of `DEC-094` is gone: `CR-004` closed that path, so what
 * survives is the read guarantee, which is what actually makes the tier usable.
 */
describe('containment is not browsing (CR-003 §5.7)', () => {
  it('reads an asset’s units without asset:read', async () => {
    const units = await get(`/assets/${asset.id}/units`, budi);

    expect(units.status).toBe(200);
    // Narrowed to their own department, and reached without `asset:read`.
    expect(units.body.data.map((row) => row.id)).toEqual([unitInTkj.id]);
  });

  it('still refuses to browse assets', async () => {
    expect((await get(`/assets/${asset.id}`, budi)).status).toBe(403);
    expect((await get('/assets', budi)).status).toBe(403);
  });

  it('carries the caller PIC departments on the profile instead of department:read', async () => {
    const me = await get('/auth/me', budi);

    expect(me.status).toBe(200);
    expect(me.body.data.isPicScoped).toBe(true);
    expect(me.body.data.picDepartments).toEqual([
      { id: tkj.id, code: 'TKJ', name: 'Teknik Komputer' },
    ]);
    // The picker is fed from the session, so the role needs no department:read.
    expect((await get('/departments', budi)).status).toBe(403);
  });
});

/**
 * `CR-003` B2 was a blanket refusal (`assertNotPicScoped`): a PIC-scoped caller
 * could not activate, return or extend ANY borrowing, including one made
 * entirely of their own units.
 *
 * `CR-004` §4.4 replaced it with unit-coverage authorization, so the tests that
 * lived here moved to `23-pic-operational-scope.test.js`, where the same
 * transitions are asserted to SUCCEED for an all-own-units borrowing and answer
 * 404 for a mixed one. Nothing is asserted here any more; this note exists so
 * the change is visible to anyone looking for the old block.
 */

/**
 * `CR-003` §11 of the brief — current responsibility, not historical.
 */
describe('only the CURRENT assignment grants access', () => {
  it('loses reach the moment the post is handed over', async () => {
    expect((await get(`/asset-units/${unitInTkj.id}`, budi)).status).toBe(200);

    // Handed to sari through the Phase 21 endpoint.
    await api()
      .put(`${V1}/departments/${tkj.id}/pic`)
      .set(...admin.auth)
      .send({ userId: sari.user.id });

    // No grace period, no previous-holder exception. The principal is resolved
    // live on every request, so this takes effect on the very next one.
    expect((await get(`/asset-units/${unitInTkj.id}`, budi)).status).toBe(404);
    expect((await get(`/asset-units/${unitInTkj.id}`, sari)).status).toBe(200);
  });

  it('grants nothing from a closed assignment', async () => {
    const formerly = await createCaller({
      institutionId: institution.id,
      permissions: UNIT_PERMISSIONS,
      isPicScoped: true,
    });
    await models.DepartmentPicAssignment.create({
      departmentId: rpl.id,
      userId: formerly.user.id,
      isCurrent: false,
      // Both stamped explicitly: the model defaults `assignedAt` to now, which
      // can land a millisecond AFTER an `endedAt` created on the line above and
      // trip `chk_dept_pic_dates`.
      assignedAt: new Date(Date.now() - 60_000),
      endedAt: new Date(),
    });

    expect((await get(`/asset-units/${unitInRpl.id}`, formerly)).status).toBe(404);
  });

  it('reaches nothing at all while holding no post', async () => {
    const holdsNothing = await createCaller({
      institutionId: institution.id,
      permissions: UNIT_PERMISSIONS,
      isPicScoped: true,
    });

    expect((await get(`/asset-units/${unitInTkj.id}`, holdsNothing)).status).toBe(404);
    expect((await get(`/assets/${asset.id}/units`, holdsNothing)).body.data).toEqual([]);
  });
});
