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
 * Person in charge — Phase 21 (`CR-003` §9), REQ-ORG-006, REQ-LOC-014.
 *
 * Two things are under test and they are not the same thing:
 *
 *   CURRENT   who holds the post now, and the guarantee that exactly one person
 *             does. `departments.current_pic_user_id` must never disagree with
 *             the live assignment row.
 *
 *   HISTORY   who held it before, preserved by never rewriting a closed row.
 *             This is the whole reason for an assignment table rather than a
 *             mutable column, so it is asserted directly rather than implied.
 *
 * NOTHING HERE GRANTS ACCESS. Phase 22 reads the current department assignment;
 * this phase deliberately does not, and the last block asserts that.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

let admin;
let alpha;
let beta;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();

  admin = await createAdminCaller();

  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

async function createDepartment(institutionId, code = 'TKJ') {
  return models.Department.create({ code, name: 'Teknik Komputer', institutionId });
}

async function createLocation(institutionId, name = 'Lab 1') {
  return models.Location.create({ name, classificationId: LEAF, institutionId });
}

/** A plain user of an institution — not a caller, just someone to appoint. */
async function createStaff(institutionId, username) {
  return models.User.create({
    username,
    // `CHAR(60)` exactly — a bcrypt-shaped placeholder, never used to sign in.
    passwordHash: `$2b$10$${'0'.repeat(53)}`,
    firstName: 'Staff',
    lastName: username,
    institutionId,
    isActive: true,
  });
}

const put = (path, body, caller = admin) =>
  api()
    .put(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const del = (path, caller = admin) =>
  api()
    .delete(`${V1}${path}`)
    .set(...caller.auth);

const get = (path, caller = admin) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

describe('assigning a department PIC (REQ-ORG-006)', () => {
  it('appoints a holder and resolves them on the department', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');

    const response = await put(`/departments/${department.id}/pic`, { userId: budi.id });

    expect(response.status).toBe(200);
    expect(response.body.data.currentPicUserId).toBe(budi.id);
    expect(response.body.data.currentPic).toMatchObject({ id: budi.id, username: 'budi' });
  });

  it('keeps the denormalized column and the live row in step', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');

    await put(`/departments/${department.id}/pic`, { userId: budi.id });

    const [reread, live] = await Promise.all([
      models.Department.findByPk(department.id),
      models.DepartmentPicAssignment.findOne({
        where: { departmentId: department.id, isCurrent: true },
      }),
    ]);

    // The assignment table is authoritative; the column is a cache of it. A
    // disagreement is the failure this design exists to prevent.
    expect(live.userId).toBe(budi.id);
    expect(reread.currentPicUserId).toBe(live.userId);
    expect(live.endedAt).toBeNull();
    expect(live.assignedBy).toBe(admin.user.id);
  });

  it('refuses a user from another institution (BR-007)', async () => {
    const department = await createDepartment(alpha.id);
    const outsider = await createStaff(beta.id, 'outsider');

    const response = await put(`/departments/${department.id}/pic`, { userId: outsider.id });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('userId');
  });

  it('refuses a deactivated user', async () => {
    const department = await createDepartment(alpha.id);
    const gone = await createStaff(alpha.id, 'gone');
    await gone.update({ isActive: false });

    expect((await put(`/departments/${department.id}/pic`, { userId: gone.id })).status).toBe(400);
  });

  /**
   * An unassigned department (`institution_id IS NULL`, Phase 20) has no
   * institution whose staff could hold the post, so there is no correct answer
   * — not "anyone will do".
   */
  it('refuses a PIC on a department with no institution', async () => {
    const orphan = await createDepartment(null, 'ORPH');
    const budi = await createStaff(alpha.id, 'budi');

    expect((await put(`/departments/${orphan.id}/pic`, { userId: budi.id })).status).toBe(400);
  });

  it('refuses a user that does not exist', async () => {
    const department = await createDepartment(alpha.id);

    const response = await put(`/departments/${department.id}/pic`, {
      userId: '00000000-0000-4000-8000-000000000000',
    });

    expect(response.status).toBe(400);
  });

  it('refuses to re-appoint the person already holding the post', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    await put(`/departments/${department.id}/pic`, { userId: budi.id });

    const again = await put(`/departments/${department.id}/pic`, { userId: budi.id });

    // A CONFLICT, not a silent no-op: a second history row would claim
    // responsibility changed hands when it did not.
    expect(again.status).toBe(409);
    expect(
      await models.DepartmentPicAssignment.count({ where: { departmentId: department.id } })
    ).toBe(1);
  });
});

describe('handover (CR-003 §9.6)', () => {
  it('closes the old assignment and opens the new one atomically', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const sari = await createStaff(alpha.id, 'sari');

    await put(`/departments/${department.id}/pic`, { userId: budi.id });
    const handover = await put(`/departments/${department.id}/pic`, { userId: sari.id });

    expect(handover.status).toBe(200);
    expect(handover.body.data.currentPicUserId).toBe(sari.id);

    const rows = await models.DepartmentPicAssignment.findAll({
      where: { departmentId: department.id },
      order: [['assignedAt', 'ASC']],
    });

    expect(rows).toHaveLength(2);

    const [first, second] = rows;
    expect(first.userId).toBe(budi.id);
    expect(first.isCurrent).toBe(false);
    expect(first.endedAt).not.toBeNull();
    expect(first.endedBy).toBe(admin.user.id);

    expect(second.userId).toBe(sari.id);
    expect(second.isCurrent).toBe(true);
    expect(second.endedAt).toBeNull();
  });

  /**
   * The database refuses two live rows rather than trusting the service to.
   * Inserted directly, bypassing the service, because that is the only way the
   * constraint can be the thing under test.
   */
  it('cannot store two current assignments for one department', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const sari = await createStaff(alpha.id, 'sari');

    await models.DepartmentPicAssignment.create({
      departmentId: department.id,
      userId: budi.id,
      isCurrent: true,
    });

    await expect(
      models.DepartmentPicAssignment.create({
        departmentId: department.id,
        userId: sari.id,
        isCurrent: true,
      })
    ).rejects.toThrow();
  });

  /** `is_current` and `ended_at` are one fact — `chk_dept_pic_current`. */
  it('cannot store a closed assignment that still reads as current', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');

    await expect(
      models.DepartmentPicAssignment.create({
        departmentId: department.id,
        userId: budi.id,
        isCurrent: true,
        endedAt: new Date(),
      })
    ).rejects.toThrow();

    await expect(
      models.DepartmentPicAssignment.create({
        departmentId: department.id,
        userId: budi.id,
        isCurrent: false,
        endedAt: null,
      })
    ).rejects.toThrow();
  });

  it('clears the post and leaves the closed row behind', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    await put(`/departments/${department.id}/pic`, { userId: budi.id });

    const cleared = await del(`/departments/${department.id}/pic`);

    expect(cleared.status).toBe(200);
    expect(cleared.body.data.currentPicUserId).toBeNull();

    const rows = await models.DepartmentPicAssignment.findAll({
      where: { departmentId: department.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isCurrent).toBe(false);
    expect(rows[0].endedAt).not.toBeNull();
  });

  it('refuses to clear a post nobody holds', async () => {
    const department = await createDepartment(alpha.id);

    expect((await del(`/departments/${department.id}/pic`)).status).toBe(409);
  });
});

describe('history (CR-003 §9.7)', () => {
  it('answers who held the post and when, newest first', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const sari = await createStaff(alpha.id, 'sari');

    await put(`/departments/${department.id}/pic`, { userId: budi.id });
    await put(`/departments/${department.id}/pic`, { userId: sari.id });

    const response = await get(`/departments/${department.id}/pic-assignments`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);

    const [current, previous] = response.body.data;
    expect(current).toMatchObject({ userId: sari.id, isCurrent: true, endedAt: null });
    expect(current.user).toMatchObject({ username: 'sari' });
    expect(previous).toMatchObject({ userId: budi.id, isCurrent: false });
    expect(previous.endedAt).not.toBeNull();
    // Who made the change is part of the record.
    expect(previous.ender).toMatchObject({ id: admin.user.id });
  });

  it('survives the holder being deactivated', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    await put(`/departments/${department.id}/pic`, { userId: budi.id });
    await budi.update({ isActive: false });

    // The historical fact does not stop being true because the person left.
    const response = await get(`/departments/${department.id}/pic-assignments`);
    expect(response.body.data[0].user).toMatchObject({ username: 'budi' });
  });
});

describe('location PIC (REQ-LOC-014)', () => {
  it('assigns, hands over and reports the holder', async () => {
    const location = await createLocation(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const sari = await createStaff(alpha.id, 'sari');

    const assigned = await put(`/locations/${location.id}/pic`, { userId: budi.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.currentPic).toMatchObject({ username: 'budi' });

    await put(`/locations/${location.id}/pic`, { userId: sari.id });

    const history = await get(`/locations/${location.id}/pic-assignments`);
    expect(history.body.data.map((row) => row.user.username)).toEqual(['sari', 'budi']);
  });

  it('refuses a user from another institution', async () => {
    const location = await createLocation(alpha.id);
    const outsider = await createStaff(beta.id, 'outsider');

    expect((await put(`/locations/${location.id}/pic`, { userId: outsider.id })).status).toBe(400);
  });

  /**
   * Moving a location between institutions ends its PIC — `CR-003` I7. The
   * holder belongs to the institution being left, so keeping them would be the
   * cross-institution assignment the previous test refuses to create directly.
   */
  it('ends the assignment when the location changes institution', async () => {
    const location = await createLocation(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    await put(`/locations/${location.id}/pic`, { userId: budi.id });

    const moved = await api()
      .patch(`${V1}/locations/${location.id}`)
      .set(...admin.auth)
      .send({ institutionId: beta.id });

    expect(moved.status).toBe(200);
    expect(moved.body.data.currentPicUserId).toBeNull();

    // Ended, not erased: the record of who was responsible before the move
    // is exactly what an audit would ask for.
    const rows = await models.LocationPicAssignment.findAll({
      where: { locationId: location.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isCurrent).toBe(false);
    expect(rows[0].endedAt).not.toBeNull();
  });

  it('leaves the assignment alone when the institution does not change', async () => {
    const location = await createLocation(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    await put(`/locations/${location.id}/pic`, { userId: budi.id });

    await api()
      .patch(`${V1}/locations/${location.id}`)
      .set(...admin.auth)
      .send({ name: 'Renamed only' });

    const reread = await models.Location.findByPk(location.id);
    expect(reread.currentPicUserId).toBe(budi.id);
  });
});

describe('a user cannot leave an institution while responsible for it (CR-003 I7)', () => {
  it('refuses the move and names what they hold', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    await put(`/departments/${department.id}/pic`, { userId: budi.id });

    const response = await api()
      .patch(`${V1}/users/${budi.id}`)
      .set(...admin.auth)
      .send({ institutionId: beta.id });

    // Refused rather than silently ended: whoever is moving the user may not
    // know what they are currently in charge of.
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/person in charge/i);

    const reread = await models.User.findByPk(budi.id);
    expect(reread.institutionId).toBe(alpha.id);
  });

  it('allows the move once the post has been handed over', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    await put(`/departments/${department.id}/pic`, { userId: budi.id });
    await del(`/departments/${department.id}/pic`);

    const response = await api()
      .patch(`${V1}/users/${budi.id}`)
      .set(...admin.auth)
      .send({ institutionId: beta.id });

    expect(response.status).toBe(200);
  });

  it('allows an unrelated edit while they still hold the post', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    await put(`/departments/${department.id}/pic`, { userId: budi.id });

    const response = await api()
      .patch(`${V1}/users/${budi.id}`)
      .set(...admin.auth)
      .send({ firstName: 'Budi' });

    expect(response.status).toBe(200);
  });
});

describe('organization scope and permissions (BR-007, REQ-AUTHZ-003)', () => {
  it('answers 404 for a department in another institution', async () => {
    const department = await createDepartment(beta.id);
    const budi = await createStaff(beta.id, 'budi');
    const scoped = await createCaller({
      institutionId: alpha.id,
      permissions: ['department-pic:read', 'department-pic:create'],
    });

    expect(
      (await put(`/departments/${department.id}/pic`, { userId: budi.id }, scoped)).status
    ).toBe(404);
    expect((await get(`/departments/${department.id}/pic-assignments`, scoped)).status).toBe(404);
  });

  /**
   * Assigning a PIC is guarded by `department-pic:*`, not `department:update`.
   * Renaming a department and choosing who is responsible for it are different
   * authorities — and in Phase 22 the second will decide what its holder may
   * touch.
   */
  it('does not let department:update stand in for department-pic:create', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const editor = await createCaller({
      institutionId: alpha.id,
      permissions: ['department:read', 'department:update'],
    });

    const response = await put(`/departments/${department.id}/pic`, { userId: budi.id }, editor);

    expect(response.status).toBe(403);
  });

  it('guards clearing separately from assigning', async () => {
    const department = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    await put(`/departments/${department.id}/pic`, { userId: budi.id });

    const assigner = await createCaller({
      institutionId: alpha.id,
      permissions: ['department-pic:read', 'department-pic:create'],
    });

    expect((await del(`/departments/${department.id}/pic`, assigner)).status).toBe(403);
  });
});

/**
 * The Phase 21/22 boundary, asserted rather than assumed.
 *
 * Holding a PIC post is responsibility data in this phase. If any of these ever
 * fail, authorization has been wired ahead of its phase.
 */
describe('PIC grants no access in this phase (CR-003 §5.4)', () => {
  /**
   * The profile NAMES what the caller is responsible for, and that is all it
   * does.
   *
   * Phase 21 asserted the field was absent entirely; Phase 22 adds it
   * deliberately (`CR-003` §5.7) so a PIC-scoped role can populate a department
   * picker without holding `department:read`. The assertion moved with it rather
   * than being deleted — what must stay true is that appearing here changes
   * nothing about what the holder may reach, which the two tests below check
   * directly.
   */
  it('names the post in the caller profile without conferring a tier', async () => {
    const department = await createDepartment(alpha.id);
    const holder = await createCaller({
      institutionId: alpha.id,
      permissions: ['department-pic:read'],
    });
    await put(`/departments/${department.id}/pic`, { userId: holder.user.id });

    const me = await get('/auth/me', holder);

    expect(me.status).toBe(200);
    expect(me.body.data.picDepartments).toEqual([
      { id: department.id, code: 'TKJ', name: 'Teknik Komputer' },
    ]);
    // Holding a post is not a scope tier: that comes from the ROLE flag, and
    // this caller's role does not carry it.
    expect(me.body.data.isPicScoped).toBe(false);
    // The raw id set stays server-side; the profile carries resolved rows.
    expect(me.body.data).not.toHaveProperty('picDepartmentIds');
  });

  it('does not widen what a PIC may read', async () => {
    const department = await createDepartment(alpha.id);
    const holder = await createCaller({
      institutionId: alpha.id,
      permissions: ['department-pic:read'],
    });
    await put(`/departments/${department.id}/pic`, { userId: holder.user.id });

    // Being the PIC of a department does not confer the right to read
    // departments, let alone the asset units assigned to it.
    expect((await get(`/departments/${department.id}`, holder)).status).toBe(403);
  });
});
