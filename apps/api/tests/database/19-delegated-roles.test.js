import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Delegated role assignment — Phase 19 (`CR-002`), `06-api.md` §3.3–§3.4.
 *
 * REQ-ROLE-009, REQ-ROLE-010, `BR-015` as amended, `BR-022`.
 *
 * The assignment ceiling is the whole security boundary here, so it is tested
 * from the attacker's direction as well as the happy path: the escalation this
 * feature would open without it is spelled out as its own case.
 */

const V1 = '/api/v1';

let admin;
let institutionA;
let institutionB;

/** A scoped administrator: manages users in their own institution, nothing more. */
const INSTITUTION_ADMIN_PERMISSIONS = [
  'user:create',
  'user:read',
  'user:update',
  'user-role:create',
  'user-role:read',
  'user-role:delete',
  'role:read',
  'role-permission:read',
];

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetOrganizationData();

  admin = await createAdminCaller();
  institutionA = await models.Institution.create({
    name: 'Institution A',
    code: 'INST-A',
    address: 'A',
  });
  institutionB = await models.Institution.create({
    name: 'Institution B',
    code: 'INST-B',
    address: 'B',
  });
});

afterAll(async () => {
  await resetOrganizationData();
});

/** A role created the way a system administrator would. */
async function createRole({ name, isSystemWide = false, isInstitutionAssignable = false }) {
  const response = await api()
    .post(`${V1}/roles`)
    .set(...admin.auth)
    .send({ name, isSystemWide, isInstitutionAssignable });

  expect(response.status).toBe(201);
  return response.body.data;
}

const scopedAdmin = () =>
  createCaller({ permissions: INSTITUTION_ADMIN_PERMISSIONS, institutionId: institutionA.id });

const newUser = (overrides = {}) => ({
  username: `u-${Math.random().toString(36).slice(2, 8)}`,
  password: 'a-long-enough-password',
  firstName: 'Test',
  lastName: 'User',
  ...overrides,
});

describe('the assignable flag (REQ-ROLE-009)', () => {
  it('defaults to false, so a new role is undelegatable until chosen', async () => {
    const role = await createRole({ name: 'Storekeeper' });

    expect(role.isInstitutionAssignable).toBe(false);
  });

  it('can be set by a system-wide caller', async () => {
    const role = await createRole({ name: 'Storekeeper', isInstitutionAssignable: true });

    expect(role.isInstitutionAssignable).toBe(true);
  });

  it('refuses the system-wide combination on create (BR-022)', async () => {
    const response = await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Impossible', isSystemWide: true, isInstitutionAssignable: true });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('isInstitutionAssignable');
  });

  it('refuses the combination reached by two separate updates', async () => {
    const role = await createRole({ name: 'Storekeeper', isInstitutionAssignable: true });

    const response = await api()
      .patch(`${V1}/roles/${role.id}`)
      .set(...admin.auth)
      .send({ isSystemWide: true });

    // Judged on the resulting state, not the field being sent.
    expect(response.status).toBe(400);
  });

  it('allows swapping both flags in one call, judged on the result', async () => {
    const role = await createRole({ name: 'Wide', isSystemWide: true });

    const response = await api()
      .patch(`${V1}/roles/${role.id}`)
      .set(...admin.auth)
      .send({ isSystemWide: false, isInstitutionAssignable: true });

    expect(response.status).toBe(200);
    expect(response.body.data.isInstitutionAssignable).toBe(true);
  });

  it('is refused by the database even if the application were wrong', async () => {
    const role = await models.Role.create({ name: 'Direct', isSystemWide: true });

    // chk_roles_system_wide_not_assignable is the guarantee; the service check
    // is only the explanation.
    await expect(role.update({ isInstitutionAssignable: true })).rejects.toThrow();
  });

  it('cannot be set by a scoped caller', async () => {
    const role = await createRole({ name: 'Storekeeper' });
    const caller = await createCaller({
      permissions: [...INSTITUTION_ADMIN_PERMISSIONS, 'role:update'],
      institutionId: institutionA.id,
    });

    const response = await api()
      .patch(`${V1}/roles/${role.id}`)
      .set(...caller.auth)
      .send({ isInstitutionAssignable: true });

    expect([400, 403]).toContain(response.status);
  });
});

describe('authoring roles stays central (BR-015)', () => {
  it.each([
    ['post', '/roles', { name: 'Nope' }],
    ['patch', '/roles/:id', { name: 'Renamed' }],
  ])('refuses %s for a scoped caller', async (method, path, body) => {
    const role = await createRole({ name: 'Existing' });
    const caller = await scopedAdmin();

    const url = path.replace(':id', role.id);
    const response = await api()
      [method](`${V1}${url}`)
      .set(...caller.auth)
      .send(body);

    // The permission itself is system-wide-only, so this never reaches the service.
    expect(response.status).toBe(403);
  });

  it('lets a scoped caller READ roles and their grants (REQ-ROLE-010)', async () => {
    const role = await createRole({ name: 'Storekeeper', isInstitutionAssignable: true });
    await api()
      .put(`${V1}/roles/${role.id}/permissions`)
      .set(...admin.auth)
      .send({ permissionCodes: ['asset:read'] });

    const caller = await scopedAdmin();

    const detail = await api()
      .get(`${V1}/roles/${role.id}`)
      .set(...caller.auth);
    const permissions = await api()
      .get(`${V1}/roles/${role.id}/permissions`)
      .set(...caller.auth);

    // Assigning a role without seeing what it grants is assigning blind.
    expect(detail.status).toBe(200);
    expect(permissions.status).toBe(200);
    expect(permissions.body.data).toEqual(['asset:read']);
  });
});

describe('the roles list narrows for a scoped caller (REQ-ROLE-010)', () => {
  it('shows only assignable roles', async () => {
    await createRole({ name: 'Assignable', isInstitutionAssignable: true });
    await createRole({ name: 'Reserved' });

    const caller = await scopedAdmin();
    const response = await api()
      .get(`${V1}/roles?pageSize=100`)
      .set(...caller.auth);

    const names = response.body.data.map((role) => role.name);
    expect(names).toContain('Assignable');
    expect(names).not.toContain('Reserved');
  });

  it('does not disclose the seeded System Admin role', async () => {
    const caller = await scopedAdmin();

    const response = await api()
      .get(`${V1}/roles?pageSize=100`)
      .set(...caller.auth);

    expect(response.body.data.map((role) => role.name)).not.toContain('System Admin');
  });

  it('shows everything to a system-wide caller', async () => {
    await createRole({ name: 'Reserved' });

    const response = await api()
      .get(`${V1}/roles?pageSize=100`)
      .set(...admin.auth);

    expect(response.body.data.map((role) => role.name)).toContain('Reserved');
  });
});

describe('the assignment ceiling (BR-022)', () => {
  it('lets a scoped admin assign an assignable role on create', async () => {
    const role = await createRole({ name: 'Storekeeper', isInstitutionAssignable: true });
    const caller = await scopedAdmin();

    const response = await api()
      .post(`${V1}/users`)
      .set(...caller.auth)
      .send(newUser({ roleIds: [role.id] }));

    expect(response.status).toBe(201);
    expect(response.body.data.institutionId).toBe(institutionA.id);
  });

  it('refuses a non-assignable role on create', async () => {
    const role = await createRole({ name: 'Reserved' });
    const caller = await scopedAdmin();

    const response = await api()
      .post(`${V1}/users`)
      .set(...caller.auth)
      .send(newUser({ roleIds: [role.id] }));

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('roleIds');
  });

  it('refuses a non-assignable role on POST /users/:id/roles', async () => {
    const reserved = await createRole({ name: 'Reserved' });
    const caller = await scopedAdmin();

    const created = await api()
      .post(`${V1}/users`)
      .set(...caller.auth)
      .send(newUser());

    const response = await api()
      .post(`${V1}/users/${created.body.data.id}/roles`)
      .set(...caller.auth)
      .send({ roleId: reserved.id });

    // The same grant by another route — it has to be guarded there too.
    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('roleId');
  });

  it('names the role it refused, so the message is actionable', async () => {
    const role = await createRole({ name: 'Reserved' });
    const caller = await scopedAdmin();

    const response = await api()
      .post(`${V1}/users`)
      .set(...caller.auth)
      .send(newUser({ roleIds: [role.id] }));

    expect(response.body.error.details[0].issue).toContain('Reserved');
  });

  it('CLOSES THE ESCALATION: a scoped admin cannot become System Admin', async () => {
    const systemAdminRole = await models.Role.findOne({ where: { name: 'System Admin' } });
    const caller = await scopedAdmin();

    // Without the ceiling this succeeds, and the attacker then signs in as the
    // account they just created — they chose its password — holding every
    // permission in the system.
    const response = await api()
      .post(`${V1}/users`)
      .set(...caller.auth)
      .send(newUser({ username: 'backdoor', password: 'chosen-by-the-attacker', roleIds: [systemAdminRole.id] }));

    expect(response.status).toBe(400);

    const created = await models.User.findOne({ where: { username: 'backdoor' } });
    expect(created).toBeNull();
  });

  it('does not ceiling a system-wide caller', async () => {
    const role = await createRole({ name: 'Reserved' });

    const response = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(newUser({ roleIds: [role.id], institutionId: institutionB.id }));

    expect(response.status).toBe(201);
  });

  it('leaves unassignment unceilinged, so an inherited role can be removed', async () => {
    const reserved = await createRole({ name: 'Reserved' });

    // A system administrator assigns a role the institution could never grant.
    const created = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(newUser({ roleIds: [reserved.id], institutionId: institutionA.id }));

    const caller = await scopedAdmin();

    const response = await api()
      .delete(`${V1}/users/${created.body.data.id}/roles/${reserved.id}`)
      .set(...caller.auth);

    // Removing a role can only reduce access; refusing would strand the user.
    expect(response.status).toBe(200);
  });

  it('still refuses a user in another institution, ceiling or not', async () => {
    const role = await createRole({ name: 'Storekeeper', isInstitutionAssignable: true });
    const caller = await scopedAdmin();

    const response = await api()
      .post(`${V1}/users`)
      .set(...caller.auth)
      .send(newUser({ roleIds: [role.id], institutionId: institutionB.id }));

    expect(response.status).toBe(400);
  });
});

describe('the end-to-end delegation flow', () => {
  it('lets an institution run itself once set up', async () => {
    // 1. A system administrator prepares the institution's role...
    const staffRole = await createRole({ name: 'Staff', isInstitutionAssignable: true });
    const adminRole = await createRole({ name: 'Institution Admin' });

    await api()
      .put(`${V1}/roles/${adminRole.id}/permissions`)
      .set(...admin.auth)
      .send({ permissionCodes: INSTITUTION_ADMIN_PERMISSIONS });

    // 2. ...and its first administrator.
    const firstAdmin = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(newUser({ username: 'inst-admin', institutionId: institutionA.id, roleIds: [adminRole.id] }));

    expect(firstAdmin.status).toBe(201);

    // 3. That administrator signs in and registers their own staff, unaided.
    const login = await api()
      .post(`${V1}/auth/login`)
      .send({ username: 'inst-admin', password: 'a-long-enough-password' });

    expect(login.status).toBe(200);

    const staff = await api()
      .post(`${V1}/users`)
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send(newUser({ username: 'staff-1', roleIds: [staffRole.id] }));

    expect(staff.status).toBe(201);
    expect(staff.body.data.institutionId).toBe(institutionA.id);
  });
});
