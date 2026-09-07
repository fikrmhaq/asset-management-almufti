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
 * Organization API — `IMPLEMENTATION_PLAN.md` §10.1–§10.5, §10.9;
 * `06-api.md` §3.
 */

const V1 = '/api/v1';

let admin;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetOrganizationData();
  admin = await createAdminCaller();
});

afterAll(async () => {
  await resetOrganizationData();
});

const institutionBody = { name: 'Test Institution', code: 'TST-1', address: '1 Test Street' };

async function createInstitution(overrides = {}) {
  const response = await api()
    .post(`${V1}/institutions`)
    .set(...admin.auth)
    .send({ ...institutionBody, ...overrides });
  return response.body.data;
}

describe('authentication is required across the module', () => {
  it.each([
    ['get', '/institutions'],
    ['get', '/departments'],
    ['get', '/users'],
    ['get', '/roles'],
    ['get', '/permissions'],
    ['get', '/classifications'],
    ['get', '/attribute-definitions'],
    ['get', '/measurement-units'],
  ])('%s %s rejects an unauthenticated caller', async (method, path) => {
    const response = await api()[method](`${V1}${path}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('institutions (§3.1, REQ-ORG-001/002)', () => {
  it('creates and returns the documented envelope', async () => {
    const response = await api()
      .post(`${V1}/institutions`)
      .set(...admin.auth)
      .send(institutionBody);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ ...institutionBody, isActive: true });
    expect(response.body.data.id).toEqual(expect.any(String));
  });

  it('rejects a duplicate code naming the field (REQ-VAL-004)', async () => {
    await createInstitution();

    const response = await api()
      .post(`${V1}/institutions`)
      .set(...admin.auth)
      .send({ ...institutionBody, name: 'Another' });

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].field).toBe('code');
  });

  it('validates required fields', async () => {
    const response = await api()
      .post(`${V1}/institutions`)
      .set(...admin.auth)
      .send({ name: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((d) => d.field)).toEqual(
      expect.arrayContaining(['body.name', 'body.code', 'body.address'])
    );
  });

  it('rejects unknown fields rather than silently dropping them', async () => {
    const response = await api()
      .post(`${V1}/institutions`)
      .set(...admin.auth)
      .send({ ...institutionBody, isActive: false });

    expect(response.status).toBe(400);
  });

  it('lists with the pagination meta block (§1.5)', async () => {
    await createInstitution({ code: 'A-1' });
    await createInstitution({ code: 'B-1', name: 'Beta' });

    const response = await api()
      .get(`${V1}/institutions?page=1&pageSize=1`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
  });

  it('filters by search term and status', async () => {
    const alpha = await createInstitution({ code: 'A-1', name: 'Alpha College' });
    await createInstitution({ code: 'B-1', name: 'Beta School' });
    await api()
      .post(`${V1}/institutions/${alpha.id}/deactivate`)
      .set(...admin.auth);

    const search = await api()
      .get(`${V1}/institutions?q=beta`)
      .set(...admin.auth);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].name).toBe('Beta School');

    const inactive = await api()
      .get(`${V1}/institutions?status=inactive`)
      .set(...admin.auth);
    expect(inactive.body.data.map((row) => row.code)).toEqual(['A-1']);
  });

  it('sorts by an allowed field and rejects one outside the allow-list', async () => {
    await createInstitution({ code: 'A-1', name: 'Alpha' });
    await createInstitution({ code: 'B-1', name: 'Beta' });

    const sorted = await api()
      .get(`${V1}/institutions?sort=name&order=desc`)
      .set(...admin.auth);
    expect(sorted.body.data.map((row) => row.name)).toEqual(['Beta', 'Alpha']);

    const rejected = await api()
      .get(`${V1}/institutions?sort=address`)
      .set(...admin.auth);
    expect(rejected.status).toBe(400);
  });

  it('caps pageSize at 100 (REQ-NFR-PERF-002)', async () => {
    const response = await api()
      .get(`${V1}/institutions?pageSize=500`)
      .set(...admin.auth);

    expect(response.status).toBe(400);
  });

  it('updates editable fields and rejects an empty body', async () => {
    const created = await createInstitution();

    const updated = await api()
      .patch(`${V1}/institutions/${created.id}`)
      .set(...admin.auth)
      .send({ name: 'Renamed' });
    expect(updated.body.data.name).toBe('Renamed');
    expect(updated.body.data.code).toBe(institutionBody.code);

    const empty = await api()
      .patch(`${V1}/institutions/${created.id}`)
      .set(...admin.auth)
      .send({});
    expect(empty.status).toBe(400);
  });

  it('deactivates and reactivates, refusing a redundant transition (§1.7)', async () => {
    const created = await createInstitution();

    const off = await api()
      .post(`${V1}/institutions/${created.id}/deactivate`)
      .set(...admin.auth);
    expect(off.body.data.isActive).toBe(false);

    const again = await api()
      .post(`${V1}/institutions/${created.id}/deactivate`)
      .set(...admin.auth);
    expect(again.status).toBe(409);

    const on = await api()
      .post(`${V1}/institutions/${created.id}/reactivate`)
      .set(...admin.auth);
    expect(on.body.data.isActive).toBe(true);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const missing = await api()
      .get(`${V1}/institutions/00000000-0000-0000-0000-000000000000`)
      .set(...admin.auth);
    expect(missing.status).toBe(404);

    const malformed = await api()
      .get(`${V1}/institutions/not-a-uuid`)
      .set(...admin.auth);
    expect(malformed.status).toBe(400);
  });

  it('forbids a caller without the permission (REQ-AUTHZ-003)', async () => {
    const reader = await createCaller({ permissions: ['institution:read'] });

    const read = await api()
      .get(`${V1}/institutions`)
      .set(...reader.auth);
    expect(read.status).toBe(200);

    const write = await api()
      .post(`${V1}/institutions`)
      .set(...reader.auth)
      .send(institutionBody);
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('FORBIDDEN');
  });

  it('guards deactivate with its own permission, separate from update', async () => {
    const editor = await createCaller({
      permissions: ['institution:read', 'institution:create', 'institution:update'],
    });
    const created = await createInstitution();

    const response = await api()
      .post(`${V1}/institutions/${created.id}/deactivate`)
      .set(...editor.auth);

    expect(response.status).toBe(403);
  });
});

/**
 * Departments — §3.2, REQ-ORG-003/004, `BR-007`, `CR-003` Phase 20.
 *
 * Two things changed in Phase 20 and both are load-bearing: `code` replaced the
 * natural key, and the resource became institution-scoped. Until then these
 * endpoints had NO scope enforcement whatsoever, because the table had no
 * `institution_id` to enforce against.
 */
describe('departments (§3.2, REQ-ORG-003/004)', () => {
  const body = { code: 'ENG', name: 'Engineering' };

  async function createDepartment(overrides = {}, caller = admin) {
    return api()
      .post(`${V1}/departments`)
      .set(...caller.auth)
      .send({ ...body, ...overrides });
  }

  it('creates with a code and a generated id', async () => {
    const institution = await createInstitution();
    const response = await createDepartment({ institutionId: institution.id });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      code: 'ENG',
      name: 'Engineering',
      institutionId: institution.id,
      isActive: true,
    });
    // The key is a surrogate now, not the code.
    expect(response.body.data.id).not.toBe('ENG');
    expect(response.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a code longer than the column allows', async () => {
    expect((await createDepartment({ code: 'TOOLONGID' })).status).toBe(400);
  });

  /**
   * The heart of `CR-003`: `TKJ` in one institution and `TKJ` in another are
   * different departments that happen to share a label. The old global primary
   * key made this impossible.
   */
  it('allows two institutions to use the same department code', async () => {
    const alpha = await createInstitution({ code: 'ALPHA' });
    const beta = await createInstitution({ code: 'BETA', name: 'Beta Institution' });

    const first = await createDepartment({ code: 'TKJ', institutionId: alpha.id });
    const second = await createDepartment({ code: 'TKJ', institutionId: beta.id });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
  });

  it('rejects a duplicate code within one institution', async () => {
    const institution = await createInstitution();
    await createDepartment({ institutionId: institution.id });

    const response = await createDepartment({ institutionId: institution.id });

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].field).toBe('code');
  });

  it('refuses to move a department between institutions', async () => {
    const alpha = await createInstitution({ code: 'ALPHA' });
    const beta = await createInstitution({ code: 'BETA', name: 'Beta Institution' });
    const created = (await createDepartment({ institutionId: alpha.id })).body.data;

    // `.strict()` — the field is not merely ignored, it is an error. Moving a
    // department would invalidate every unit assigned to it at once.
    const response = await api()
      .patch(`${V1}/departments/${created.id}`)
      .set(...admin.auth)
      .send({ institutionId: beta.id });

    expect(response.status).toBe(400);
  });

  it('deactivates and reactivates', async () => {
    const institution = await createInstitution();
    const created = (await createDepartment({ institutionId: institution.id })).body.data;

    const off = await api()
      .post(`${V1}/departments/${created.id}/deactivate`)
      .set(...admin.auth);
    expect(off.body.data.isActive).toBe(false);

    const on = await api()
      .post(`${V1}/departments/${created.id}/reactivate`)
      .set(...admin.auth);
    expect(on.body.data.isActive).toBe(true);
  });

  describe('organization scope (BR-007)', () => {
    let alpha;
    let beta;
    let scoped;

    beforeEach(async () => {
      alpha = await createInstitution({ code: 'ALPHA' });
      beta = await createInstitution({ code: 'BETA', name: 'Beta Institution' });
      scoped = await createCaller({
        institutionId: alpha.id,
        permissions: ['department:read', 'department:create', 'department:update'],
      });
    });

    it('lists only the caller institution departments', async () => {
      await createDepartment({ code: 'AAA', institutionId: alpha.id });
      await createDepartment({ code: 'BBB', institutionId: beta.id });

      const response = await api()
        .get(`${V1}/departments`)
        .set(...scoped.auth);

      expect(response.status).toBe(200);
      expect(response.body.data.map((row) => row.code)).toEqual(['AAA']);
    });

    /**
     * 404, never 403 — `06-api.md` §1.4. Confirming the row exists but belongs
     * to someone else discloses the shape of another institution's organization.
     */
    it('answers 404 for a department in another institution', async () => {
      const other = (await createDepartment({ code: 'BBB', institutionId: beta.id })).body.data;

      const response = await api()
        .get(`${V1}/departments/${other.id}`)
        .set(...scoped.auth);

      expect(response.status).toBe(404);
    });

    it('refuses to update a department in another institution', async () => {
      const other = (await createDepartment({ code: 'BBB', institutionId: beta.id })).body.data;

      const response = await api()
        .patch(`${V1}/departments/${other.id}`)
        .set(...scoped.auth)
        .send({ name: 'Renamed' });

      expect(response.status).toBe(404);
    });

    it('defaults a scoped caller new department to their own institution', async () => {
      const response = await createDepartment({ code: 'OWN', institutionId: undefined }, scoped);

      expect(response.status).toBe(201);
      expect(response.body.data.institutionId).toBe(alpha.id);
    });

    it('refuses to create a department in another institution', async () => {
      const response = await createDepartment({ code: 'NOPE', institutionId: beta.id }, scoped);

      // 400, not 403: the caller named a value in a field they control, so the
      // response points at the field (`domain/scope.js assertCanAssignInstitution`).
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('institutionId');
    });

    /**
     * `institution_id IS NULL` means UNASSIGNED, never shared — `CR-003` §4.3.
     * A scoped caller matches their own institution and nothing else, so an
     * unassigned department is invisible to them rather than visible to all.
     */
    it('hides unassigned departments from a scoped caller', async () => {
      await createDepartment({ code: 'ORPHAN', institutionId: undefined });

      const list = await api()
        .get(`${V1}/departments`)
        .set(...scoped.auth);

      expect(list.body.data.map((row) => row.code)).not.toContain('ORPHAN');
    });
  });
});

describe('users (§3.3, REQ-USER-001–004, REQ-ROLE-002)', () => {
  const userBody = {
    username: 'jdoe',
    password: 'a-sufficiently-long-password',
    firstName: 'Jane',
    lastName: 'Doe',
  };

  it('creates a user and never returns the password hash', async () => {
    const response = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(userBody);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ username: 'jdoe', isActive: true });
    expect(JSON.stringify(response.body)).not.toMatch(/\$2b\$|passwordHash|password/);
  });

  it('stores a bcrypt hash rather than the password', async () => {
    await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(userBody);

    const stored = await models.User.scope('withPassword').findOne({
      where: { username: 'jdoe' },
    });

    expect(stored.passwordHash).toMatch(/^\$2b\$12\$/);
  });

  it('enforces the same password floor as the bootstrap command', async () => {
    const response = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send({ ...userBody, password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('body.password');
  });

  it('rejects a duplicate username', async () => {
    await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(userBody);

    const response = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(userBody);

    expect(response.status).toBe(409);
  });

  it('rejects an institution that does not exist (REQ-VAL-003)', async () => {
    const response = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send({ ...userBody, institutionId: '00000000-0000-0000-0000-000000000000' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('institutionId');
  });

  it('assigns roles at creation, transactionally', async () => {
    const role = await models.Role.create({ name: 'Asset Manager' });

    const response = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send({ ...userBody, roleIds: [role.id] });

    expect(response.status).toBe(201);
    expect(response.body.data.roles.map((r) => r.name)).toEqual(['Asset Manager']);
  });

  it('creates no user at all when a role id is invalid', async () => {
    const response = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send({ ...userBody, roleIds: ['00000000-0000-0000-0000-000000000000'] });

    expect(response.status).toBe(400);
    expect(await models.User.count({ where: { username: 'jdoe' } })).toBe(0);
  });

  it('refuses to change the username through update', async () => {
    const created = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(userBody);

    const response = await api()
      .patch(`${V1}/users/${created.body.data.id}`)
      .set(...admin.auth)
      .send({ username: 'someone-else' });

    expect(response.status).toBe(400);
  });

  it('adds and removes roles through the sub-resource', async () => {
    const created = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(userBody);
    const userId = created.body.data.id;
    const role = await models.Role.create({ name: 'Auditor' });

    const added = await api()
      .post(`${V1}/users/${userId}/roles`)
      .set(...admin.auth)
      .send({ roleId: role.id });
    expect(added.status).toBe(201);
    expect(added.body.data.map((r) => r.name)).toEqual(['Auditor']);

    const duplicate = await api()
      .post(`${V1}/users/${userId}/roles`)
      .set(...admin.auth)
      .send({ roleId: role.id });
    expect(duplicate.status).toBe(409);

    const removed = await api()
      .delete(`${V1}/users/${userId}/roles/${role.id}`)
      .set(...admin.auth);
    expect(removed.body.data).toEqual([]);

    const removeAgain = await api()
      .delete(`${V1}/users/${userId}/roles/${role.id}`)
      .set(...admin.auth);
    expect(removeAgain.status).toBe(404);
  });

  it('guards role assignment separately from profile editing', async () => {
    const editor = await createCaller({ permissions: ['user:read', 'user:update'] });
    const created = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(userBody);
    const role = await models.Role.create({ name: 'Escalation' });

    const response = await api()
      .post(`${V1}/users/${created.body.data.id}/roles`)
      .set(...editor.auth)
      .send({ roleId: role.id });

    expect(response.status).toBe(403);
  });

  it('revokes sessions when a user is deactivated (REQ-USER-004)', async () => {
    const created = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send(userBody);
    const userId = created.body.data.id;

    const login = await api().post(`${V1}/auth/login`).send({
      username: userBody.username,
      password: userBody.password,
    });
    const cookie = login.headers['set-cookie']
      .find((c) => c.startsWith('refreshToken='))
      .split(';')[0];

    // Refresh works while active.
    expect((await api().post(`${V1}/auth/refresh`).set('Cookie', cookie)).status).toBe(200);

    await api()
      .post(`${V1}/users/${userId}/deactivate`)
      .set(...admin.auth);

    // ...and stops immediately after deactivation, without waiting for expiry.
    expect((await api().post(`${V1}/auth/refresh`).set('Cookie', cookie)).status).toBe(401);
  });

  it('filters by institution and status', async () => {
    const institution = await createInstitution({ code: 'FILT-1' });
    await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send({ ...userBody, institutionId: institution.id });
    await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send({ ...userBody, username: 'other' });

    const filtered = await api()
      .get(`${V1}/users?institutionId=${institution.id}`)
      .set(...admin.auth);

    expect(filtered.body.data.map((u) => u.username)).toEqual(['jdoe']);
  });
});

describe('the user list carries roles (§3.3)', () => {
  it('includes each user’s assigned roles, not only the detail endpoint', async () => {
    const role = await models.Role.create({ name: `lister-${Date.now()}` });
    const created = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send({
        username: `roled-${Date.now()}`,
        password: 'a-long-enough-password',
        firstName: 'Roled',
        lastName: 'User',
        roleIds: [role.id],
      });

    expect(created.status).toBe(201);

    const list = await api()
      .get(`${V1}/users?pageSize=100`)
      .set(...admin.auth);

    const row = list.body.data.find((user) => user.id === created.body.data.id);

    // Without the include this was `undefined`, and every row in the UI read
    // "None" however many roles were actually assigned.
    expect(row.roles).toEqual([{ id: role.id, name: role.name, isSystemWide: false }]);
  });

  it('counts a multi-role user once, so the total is users and not assignments', async () => {
    const stamp = Date.now();
    const first = await models.Role.create({ name: `multi-a-${stamp}` });
    const second = await models.Role.create({ name: `multi-b-${stamp}` });

    const before = await api()
      .get(`${V1}/users?pageSize=100`)
      .set(...admin.auth);

    await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send({
        username: `multi-${stamp}`,
        password: 'a-long-enough-password',
        firstName: 'Multi',
        lastName: 'Role',
        roleIds: [first.id, second.id],
      });

    const after = await api()
      .get(`${V1}/users?pageSize=100`)
      .set(...admin.auth);

    // The belongsToMany join multiplies rows; `distinct: true` is what keeps
    // `findAndCountAll` counting users rather than user-role pairs.
    expect(after.body.meta.total).toBe(before.body.meta.total + 1);
    expect(after.body.data.filter((u) => u.username === `multi-${stamp}`)).toHaveLength(1);
  });
});

describe('users are institution-scoped for a non-system-wide caller (BR-007, REQ-AUTHZ-004)', () => {
  const userBody = {
    username: 'scoped-target',
    password: 'a-sufficiently-long-password',
    firstName: 'Scoped',
    lastName: 'Target',
  };

  let instB;
  let userInB;
  let scopedA; // an institution admin bounded to a DIFFERENT institution

  beforeEach(async () => {
    const instA = await createInstitution({ code: 'SCOPE-A' });
    instB = await createInstitution({ code: 'SCOPE-B' });

    const created = await api()
      .post(`${V1}/users`)
      .set(...admin.auth)
      .send({ ...userBody, institutionId: instB.id });
    userInB = created.body.data;

    scopedA = await createCaller({
      permissions: ['user:read', 'user:create', 'user:update', 'user:deactivate'],
      isSystemWide: false,
      institutionId: instA.id,
    });
  });

  it('a scoped caller does not see users from another institution in the list', async () => {
    const list = await api()
      .get(`${V1}/users?pageSize=100`)
      .set(...scopedA.auth);

    expect(list.status).toBe(200);
    const institutions = new Set(list.body.data.map((u) => u.institutionId));
    expect(institutions.has(instB.id)).toBe(false);
  });

  it('returns 404 reading a user in another institution (existence does not leak)', async () => {
    const response = await api()
      .get(`${V1}/users/${userInB.id}`)
      .set(...scopedA.auth);
    expect(response.status).toBe(404);
  });

  it('rejects creating a user in another institution (400, BR-007)', async () => {
    const response = await api()
      .post(`${V1}/users`)
      .set(...scopedA.auth)
      .send({ ...userBody, username: 'sneaky', institutionId: instB.id });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('institutionId');
  });

  it('defaults a new user to the caller institution when none is named', async () => {
    const response = await api()
      .post(`${V1}/users`)
      .set(...scopedA.auth)
      .send({ ...userBody, username: 'homed' });

    expect(response.status).toBe(201);
    expect(response.body.data.institutionId).toBe(scopedA.user.institutionId);
  });

  it('returns 404 updating or deactivating a user in another institution', async () => {
    const patched = await api()
      .patch(`${V1}/users/${userInB.id}`)
      .set(...scopedA.auth)
      .send({ lastName: 'Tampered' });
    expect(patched.status).toBe(404);

    const deactivated = await api()
      .post(`${V1}/users/${userInB.id}/deactivate`)
      .set(...scopedA.auth);
    expect(deactivated.status).toBe(404);
  });
});

describe('roles and permissions (§3.4, §3.5, REQ-ROLE-001/003/006/007/008)', () => {
  it('creates a role and lists it', async () => {
    const response = await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Asset Manager' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ name: 'Asset Manager', isSystemWide: false });
    expect(response.body.data.permissions).toEqual([]);
  });

  it('rejects a duplicate role name', async () => {
    await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Duplicate' });

    const response = await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Duplicate' });

    expect(response.status).toBe(409);
  });

  it('replaces the granted permission set (REQ-ROLE-007)', async () => {
    const created = await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Asset Manager' });

    const granted = await api()
      .put(`${V1}/roles/${created.body.data.id}/permissions`)
      .set(...admin.auth)
      .send({ permissionCodes: ['asset:read', 'asset:create'] });

    expect(granted.status).toBe(200);
    expect(granted.body.data).toEqual(['asset:create', 'asset:read']);

    // PUT replaces rather than merges, so an unchecked box really is removed.
    const replaced = await api()
      .put(`${V1}/roles/${created.body.data.id}/permissions`)
      .set(...admin.auth)
      .send({ permissionCodes: ['asset:read'] });
    expect(replaced.body.data).toEqual(['asset:read']);
  });

  it('rejects a permission code outside the catalog (BR-013)', async () => {
    const created = await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Bogus' });

    const response = await api()
      .put(`${V1}/roles/${created.body.data.id}/permissions`)
      .set(...admin.auth)
      .send({ permissionCodes: ['asset:teleport'] });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/asset:teleport/);
  });

  it('refuses management permissions on a non-system-wide role (BR-015)', async () => {
    const created = await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Scoped Admin', isSystemWide: false });

    const response = await api()
      .put(`${V1}/roles/${created.body.data.id}/permissions`)
      .set(...admin.auth)
      .send({ permissionCodes: ['institution:create'] });

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toMatch(/BR-015/);
  });

  it('allows the same grant on a system-wide role', async () => {
    const created = await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Global Admin', isSystemWide: true });

    const response = await api()
      .put(`${V1}/roles/${created.body.data.id}/permissions`)
      .set(...admin.auth)
      .send({ permissionCodes: ['institution:create', 'role:update'] });

    expect(response.status).toBe(200);
  });

  it('refuses to clear isSystemWide while management grants remain (BR-015)', async () => {
    const created = await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Global Admin', isSystemWide: true });
    await api()
      .put(`${V1}/roles/${created.body.data.id}/permissions`)
      .set(...admin.auth)
      .send({ permissionCodes: ['institution:create'] });

    const response = await api()
      .patch(`${V1}/roles/${created.body.data.id}`)
      .set(...admin.auth)
      .send({ isSystemWide: false });

    expect(response.status).toBe(409);
  });

  it('deletes an unassigned role but blocks one still in use', async () => {
    const created = await api()
      .post(`${V1}/roles`)
      .set(...admin.auth)
      .send({ name: 'Disposable' });
    const roleId = created.body.data.id;

    const user = await models.User.create({
      username: 'holder',
      passwordHash: '$2b$12$0123456789012345678901234567890123456789012345678901',
      firstName: 'Role',
      lastName: 'Holder',
    });
    await models.UserRole.create({ userId: user.id, roleId });

    const blocked = await api()
      .delete(`${V1}/roles/${roleId}`)
      .set(...admin.auth);
    expect(blocked.status).toBe(409);

    await models.UserRole.destroy({ where: { roleId } });
    const deleted = await api()
      .delete(`${V1}/roles/${roleId}`)
      .set(...admin.auth);
    expect(deleted.status).toBe(204);
  });

  it('serves the permission catalog read-only (REQ-ROLE-006)', async () => {
    const response = await api()
      .get(`${V1}/permissions`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(100);
    expect(response.body.data[0]).toMatchObject({
      code: expect.any(String),
      description: expect.any(String),
      group: expect.any(String),
    });
  });

  it.each([
    ['post', ''],
    ['patch', '/asset:read'],
    ['delete', '/asset:read'],
  ])('offers no %s on the permission catalog (BR-013)', async (method, suffix) => {
    const response = await api()
      [method](`${V1}/permissions${suffix}`)
      .set(...admin.auth)
      .send({ code: 'x:y', description: 'nope' });

    expect(response.status).toBe(404);
  });

  it('marks which codes require a system-wide role, for the UI checklist', async () => {
    const response = await api()
      .get(`${V1}/permissions`)
      .set(...admin.auth);

    const institutionCreate = response.body.data.find((p) => p.code === 'institution:create');
    const assetCreate = response.body.data.find((p) => p.code === 'asset:create');

    expect(institutionCreate.systemWideOnly).toBe(true);
    expect(assetCreate.systemWideOnly).toBe(false);
  });
});
