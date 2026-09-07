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
import {
  getCatalog,
  PIC_ALLOWED_PERMISSIONS,
} from '../../src/auth/permissionCatalog.js';

/**
 * The PIC permission ceiling — `CR-004` §1.2, §2, REQ-AUTHZ-008.
 *
 * `CR-003` §48.5 accepted "do not grant the permission to PIC-scoped roles" as
 * a control for Reports, Assets, the operational lists and the PIC-assignment
 * endpoints. This file exists because that is a convention, not a boundary.
 *
 * EVERY CALLER HERE IS GRANTED THE PERMISSION. The assertions are that granting
 * it changes nothing:
 *
 *     effectivePermissions = grantedPermissions ∩ PIC_ALLOWED_PERMISSIONS
 *
 * and that the four consumers — `hasPermission`, `requirePermission`,
 * `requireAnyPermission` and `/auth/me` — cannot disagree, because there is only
 * one place the set is built.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

let admin;
let institution;
let department;
let asset;
let unit;

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

  department = await models.Department.create({
    code: 'TKJ',
    name: 'Teknik Komputer',
    institutionId: institution.id,
  });

  asset = (
    await api()
      .post(`${V1}/assets`)
      .set(...admin.auth)
      .send({ name: 'Laptop', classificationId: LEAF, institutionId: institution.id })
  ).body.data;

  unit = (
    await api()
      .post(`${V1}/assets/${asset.id}/units`)
      .set(...admin.auth)
      .send({ departmentId: department.id })
  ).body.data;
});

afterAll(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetOrganizationData();
});

/** A PIC-scoped caller holding `permissions`, currently in charge of TKJ. */
async function createPic(permissions) {
  const caller = await createCaller({
    institutionId: institution.id,
    permissions,
    isPicScoped: true,
  });

  await models.DepartmentPicAssignment.create({
    departmentId: department.id,
    userId: caller.user.id,
  });
  await department.update({ currentPicUserId: caller.user.id });

  return caller;
}

const get = (path, caller) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

describe('the allow-set is exactly what CR-004 §2 specifies', () => {
  it('holds 30 codes, and every one of them exists in the catalog', () => {
    const codes = getCatalog().map((entry) => entry.code);

    expect(PIC_ALLOWED_PERMISSIONS.size).toBe(30);
    expect([...PIC_ALLOWED_PERMISSIONS].filter((code) => !codes.includes(code))).toEqual([]);
  });

  // 86 since Phase 25 (`CR-006`) added `inventory-code-format:read` and
  // `:update`. Both are correctly outside the ceiling — configuring an
  // institution's inventory codes is an administration act, not something a
  // Department PIC does — and this count is exactly the mechanism that made
  // their addition visible rather than silent.
  it('leaves 86 codes forbidden, and publishes the flag on the catalog', () => {
    const catalog = getCatalog();

    expect(catalog.filter((entry) => entry.picAllowed)).toHaveLength(30);
    expect(catalog.filter((entry) => !entry.picAllowed)).toHaveLength(86);
  });

  /**
   * The codes the client named explicitly, asserted one by one rather than as a
   * family. A wildcard would pass even if `asset-unit:create` crept back in.
   */
  it('excludes every institution-wide management code', () => {
    for (const code of [
      'asset:create',
      'asset:read',
      'asset:update',
      'asset:deactivate',
      'asset-unit:create',
      'contract:read',
      'contract-item:read',
      'department:read',
      'department-pic:read',
      'department-pic:create',
      'department-pic:delete',
      'location:create',
      'location:update',
      'location:deactivate',
      'location-pic:read',
      'location-pic:create',
      'location-pic:delete',
      'user:read',
      'user-role:read',
      'user-role:create',
      'user-role:delete',
      'institution:read',
      'role:read',
      'role-permission:read',
      'permission:read',
      'report:read',
      'audit-log:read',
    ]) {
      expect(PIC_ALLOWED_PERMISSIONS.has(code)).toBe(false);
    }
  });
});

/**
 * The client's central requirement: an administrator's mistake must not become
 * an authorization hole.
 */
describe('a forbidden permission granted by mistake is inert', () => {
  const cases = [
    { code: 'asset:read', label: 'the asset list', path: () => '/assets' },
    { code: 'asset:read', label: 'an asset record', path: () => `/assets/${asset.id}` },
    { code: 'report:read', label: 'the status report', path: () => '/reports/status' },
    { code: 'department:read', label: 'the department list', path: () => '/departments' },
    { code: 'contract:read', label: 'the contract list', path: () => '/contracts' },
    { code: 'user:read', label: 'the user directory', path: () => '/users' },
    { code: 'audit-log:read', label: 'the audit trail', path: () => '/audit-logs' },
    { code: 'institution:read', label: 'the institution list', path: () => '/institutions' },
    { code: 'supplier:read', label: 'the supplier list', path: () => '/suppliers' },
    { code: 'vendor:read', label: 'the vendor list', path: () => '/vendors' },
    {
      code: 'contract-item:read',
      label: "a contract item's units",
      // 403 lands at the route, before any record lookup, so any id will do.
      path: () => `/contract-items/${asset.id}/asset-units`,
    },
  ];

  for (const { code, label, path } of cases) {
    it(`suppresses ${code}, so ${label} stays closed`, async () => {
      const pic = await createPic([code]);

      expect((await get(path(), pic)).status).toBe(403);
    });
  }

  it('grants the same codes normally to an institution-scoped caller', async () => {
    // The control. Without it, a 403 above could mean the route is broken rather
    // than that the ceiling fired.
    const staff = await createCaller({
      institutionId: institution.id,
      permissions: ['asset:read', 'report:read', 'department:read', 'user:read'],
    });

    expect((await get('/assets', staff)).status).toBe(200);
    expect((await get('/reports/status', staff)).status).toBe(200);
    expect((await get('/departments', staff)).status).toBe(200);
    expect((await get('/users', staff)).status).toBe(200);
  });
});

describe('the effective set is what /auth/me publishes', () => {
  it('omits suppressed codes from the profile', async () => {
    const pic = await createPic(['asset-unit:read', 'asset:read', 'report:read']);

    const me = await get('/auth/me', pic);

    expect(me.status).toBe(200);
    expect(me.body.data.isPicScoped).toBe(true);
    expect(me.body.data.permissions).toEqual(['asset-unit:read']);
  });

  /**
   * The ceiling filters the PRINCIPAL, never the data. An administrator must
   * still see what they granted — otherwise clearing `isPicScoped` would be a
   * lossy operation and the record of intent would be gone.
   */
  it('leaves the stored grant untouched', async () => {
    const pic = await createPic(['asset-unit:read', 'asset:read']);

    const granted = await api()
      .get(`${V1}/roles/${pic.role.id}/permissions`)
      .set(...admin.auth);

    expect(granted.status).toBe(200);
    expect(granted.body.data).toContain('asset:read');
  });

  it('reports the full set for an institution-scoped caller', async () => {
    const staff = await createCaller({
      institutionId: institution.id,
      permissions: ['asset-unit:read', 'asset:read', 'report:read'],
    });

    const me = await get('/auth/me', staff);

    expect(me.body.data.isPicScoped).toBe(false);
    expect(me.body.data.permissions.sort()).toEqual(
      ['asset-unit:read', 'asset:read', 'report:read'].sort()
    );
  });

  /**
   * `DEC-092` survives the ceiling. The narrowing is unanimous or it does not
   * happen — attaching a PIC-scoped role to an administrator must not silently
   * demote them, and must not silently strip their permissions either.
   */
  it('does not apply when the user also holds an ordinary role', async () => {
    const mixed = await createPic(['asset-unit:read', 'asset:read']);

    const ordinary = await models.Role.create({ name: `ordinary-${Date.now()}` });
    await models.RolePermission.create({ roleId: ordinary.id, permissionCode: 'report:read' });
    await models.UserRole.create({ userId: mixed.user.id, roleId: ordinary.id });

    const me = await get('/auth/me', mixed);

    expect(me.body.data.isPicScoped).toBe(false);
    // Sorted by code, where `-` precedes `:`.
    expect(me.body.data.permissions).toEqual(['asset-unit:read', 'asset:read', 'report:read']);
    // And the suppressed code now works.
    expect((await get('/assets', mixed)).status).toBe(200);
  });
});

/**
 * The allowed codes must actually still work. A ceiling that also broke the
 * legitimate path would pass every test above and be useless.
 */
describe('the allowed codes still work', () => {
  it('reads and edits an in-scope unit, and its supporting reference data', async () => {
    const pic = await createPic([
      'asset-unit:read',
      'asset-unit:update',
      'location:read',
      'classification:read',
      'condition:read',
    ]);

    expect((await get(`/asset-units/${unit.id}`, pic)).status).toBe(200);
    expect((await get('/locations', pic)).status).toBe(200);
    expect((await get('/reference/conditions', pic)).status).toBe(200);

    const edited = await api()
      .patch(`${V1}/asset-units/${unit.id}`)
      .set(...pic.auth)
      .send({ description: 'Checked' });

    expect(edited.status).toBe(200);
  });

  it('gives location READ without location administration', async () => {
    const pic = await createPic(['location:read', 'location:create', 'location:update']);

    expect((await get('/locations', pic)).status).toBe(200);

    // Granted, suppressed, refused — the distinction CR-004 §2.5 draws.
    const created = await api()
      .post(`${V1}/locations`)
      .set(...pic.auth)
      .send({ name: 'Room 1', classificationId: LEAF, institutionId: institution.id });

    expect(created.status).toBe(403);
  });
});

/**
 * `CR-004` §8 — a PIC must not be able to change their own tier, by any route.
 *
 * Each attempt is followed by a re-read of `/auth/me`, because the thing being
 * protected is not the endpoint, it is the invariant.
 */
describe('no route lets a PIC escape PIC scope', () => {
  let pic;
  let other;

  beforeEach(async () => {
    pic = await createPic([
      'asset-unit:read',
      // Every escalation code, granted deliberately.
      'user-role:create',
      'user-role:delete',
      'user:create',
      'user:update',
      'department-pic:create',
      'department-pic:delete',
      'location-pic:create',
      'role:update',
      'role-permission:update',
    ]);

    other = await models.Department.create({
      code: 'RPL',
      name: 'Rekayasa Perangkat Lunak',
      institutionId: institution.id,
    });
  });

  const stillPicScoped = async () => {
    const me = await get('/auth/me', pic);
    expect(me.body.data.isPicScoped).toBe(true);
    expect(me.body.data.permissions).toEqual(['asset-unit:read']);
  };

  it('cannot make itself PIC of another department', async () => {
    const response = await api()
      .put(`${V1}/departments/${other.id}/pic`)
      .set(...pic.auth)
      .send({ userId: pic.user.id });

    expect(response.status).toBe(403);
    await stillPicScoped();
  });

  it('cannot unseat the PIC of a department it does not hold', async () => {
    const sari = await createCaller({ institutionId: institution.id, permissions: [] });
    await models.DepartmentPicAssignment.create({
      departmentId: other.id,
      userId: sari.user.id,
    });
    await other.update({ currentPicUserId: sari.user.id });

    const response = await api()
      .delete(`${V1}/departments/${other.id}/pic`)
      .set(...pic.auth);

    expect(response.status).toBe(403);
    await stillPicScoped();
  });

  /**
   * The sharpest one — `CR-004` §8.1. An ordinary institution-assignable role
   * attached to their own account would make `.every()` fail and hand them
   * institution scope on the next request.
   */
  it('cannot assign itself an ordinary role', async () => {
    const ordinary = await models.Role.create({
      name: `assignable-${Date.now()}`,
      isInstitutionAssignable: true,
    });

    const response = await api()
      .post(`${V1}/users/${pic.user.id}/roles`)
      .set(...pic.auth)
      .send({ roleId: ordinary.id });

    expect(response.status).toBe(403);
    await stillPicScoped();
  });

  it('cannot assign an ordinary role to ANOTHER PIC-scoped user', async () => {
    const colleague = await createCaller({
      institutionId: institution.id,
      permissions: ['asset-unit:read'],
      isPicScoped: true,
    });
    const ordinary = await models.Role.create({
      name: `assignable2-${Date.now()}`,
      isInstitutionAssignable: true,
    });

    const response = await api()
      .post(`${V1}/users/${colleague.user.id}/roles`)
      .set(...pic.auth)
      .send({ roleId: ordinary.id });

    expect(response.status).toBe(403);

    // The colleague's tier is unchanged — no promotion by proxy.
    const theirProfile = await get('/auth/me', colleague);
    expect(theirProfile.body.data.isPicScoped).toBe(true);
  });

  it('cannot remove its own PIC-scoped role', async () => {
    const response = await api()
      .delete(`${V1}/users/${pic.user.id}/roles/${pic.role.id}`)
      .set(...pic.auth);

    expect(response.status).toBe(403);
    await stillPicScoped();
  });

  it('cannot clear isPicScoped on its own role', async () => {
    const response = await api()
      .patch(`${V1}/roles/${pic.role.id}`)
      .set(...pic.auth)
      .send({ isPicScoped: false });

    expect(response.status).toBe(403);
    await stillPicScoped();
  });

  it('cannot grant itself more permissions', async () => {
    const response = await api()
      .put(`${V1}/roles/${pic.role.id}/permissions`)
      .set(...pic.auth)
      .send({ permissionCodes: ['asset:read', 'report:read'] });

    expect(response.status).toBe(403);
    await stillPicScoped();
  });

  it('cannot move itself to another institution', async () => {
    const beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });

    const response = await api()
      .patch(`${V1}/users/${pic.user.id}`)
      .set(...pic.auth)
      .send({ institutionId: beta.id });

    expect(response.status).toBe(403);
    await stillPicScoped();
  });

  it('cannot take over a location PIC post either', async () => {
    const location = await models.Location.create({
      name: 'Lab',
      classificationId: LEAF,
      institutionId: institution.id,
    });

    const response = await api()
      .put(`${V1}/locations/${location.id}/pic`)
      .set(...pic.auth)
      .send({ userId: pic.user.id });

    expect(response.status).toBe(403);
    await stillPicScoped();
  });
});
