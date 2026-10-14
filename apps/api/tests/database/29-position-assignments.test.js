import { createRequire } from 'node:module';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetAssetCoreData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { cycleDatabaseUrl, migrate, query, runCli, seed } from './helpers/db.js';

const require = createRequire(import.meta.url);
const { POSITION_CODES, requiresDepartment } = require('../../src/domain/schoolPositions.js');

/**
 * School position assignments — Phase 35 (`CR-014` §4), REQ-POS-001 – REQ-POS-003,
 * `BR-028`, `BR-033`.
 *
 * Four things are under test:
 *
 *   THE LIST      the database CHECK and `domain/schoolPositions.js` never drift
 *                 apart (`DEC-U`).
 *   THE RULES     department-bound positions, single holders, one Toolman
 *                 department per person, no duplicate live assignment — each by
 *                 the API's reasoned refusal AND by the database backstop.
 *   THE BOUNDARY  scope (404), permissions (403), the PIC ceiling, and the
 *                 self-assignment refusal.
 *   NOTHING MORE  a position grants no permission and touches no PIC record.
 */

const V1 = '/api/v1';

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
  return models.Department.create({ code, name: `Jurusan ${code}`, institutionId });
}

/** A plain user of an institution — someone to appoint, not a caller. */
async function createStaff(institutionId, username) {
  return models.User.create({
    username,
    passwordHash: `$2b$10$${'0'.repeat(53)}`,
    firstName: 'Staff',
    lastName: username,
    institutionId,
    isActive: true,
  });
}

const get = (path, caller = admin) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

const post = (path, body = {}, caller = admin) =>
  api()
    .post(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const patch = (path, body, caller = admin) =>
  api()
    .patch(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const assign = (user, body, caller = admin) =>
  post(`/users/${user.id}/position-assignments`, body, caller);

/** The quoted literals inside a CHECK definition, as a sorted list. */
async function checkLiterals(name) {
  const [row] = await query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1`,
    [name]
  );
  return [...row.definition.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
}

// ---------------------------------------------------------------------------

describe('the position list does not drift (CR-014 DEC-U)', () => {
  it('chk_pos_assign_position admits exactly the codes in domain/schoolPositions.js', async () => {
    expect(await checkLiterals('chk_pos_assign_position')).toEqual([...POSITION_CODES].sort());
  });

  it('chk_pos_assign_department names exactly the department-bound codes', async () => {
    const bound = POSITION_CODES.filter((code) => requiresDepartment(code)).sort();

    expect(await checkLiterals('chk_pos_assign_department')).toEqual(bound);
  });

  it('does not include SARPRAS_STAFF, which awaits CR-014 Q4', () => {
    expect(POSITION_CODES).not.toContain('SARPRAS_STAFF');
    expect(POSITION_CODES).toHaveLength(8);
  });
});

describe('GET /school-positions (REQ-POS-001)', () => {
  it('lists the fixed positions with their department rule and holder limit', async () => {
    const response = await get('/school-positions');

    expect(response.status).toBe(200);
    expect(response.body.data.map((row) => row.code)).toEqual([...POSITION_CODES]);
    expect(response.body.data.find((row) => row.code === 'KAJUR')).toMatchObject({
      department: 'REQUIRED',
      holders: 'ONE_PER_DEPARTMENT',
    });
    expect(response.body.data.find((row) => row.code === 'COMMON_TEACHER')).toMatchObject({
      department: 'NONE',
      requestContext: true,
    });
  });

  it('requires school-position:read', async () => {
    const caller = await createCaller({ institutionId: alpha.id });

    expect((await get('/school-positions', caller)).status).toBe(403);
  });
});

describe('assigning a position (REQ-POS-002)', () => {
  it('assigns a department-bound position and records who did it', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');

    const response = await assign(budi, { positionCode: 'KAJUR', departmentId: tkj.id });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      positionCode: 'KAJUR',
      departmentId: tkj.id,
      department: { id: tkj.id, code: 'TKJ' },
      institutionId: alpha.id,
      userId: budi.id,
      isCurrent: true,
      endedAt: null,
      assignedBy: admin.user.id,
    });
  });

  it('assigns an institution-wide position with no department', async () => {
    const siti = await createStaff(alpha.id, 'siti');

    const response = await assign(siti, { positionCode: 'KEPALA_SEKOLAH' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ departmentId: null, institutionId: alpha.id });
  });

  it.each([
    ['KAJUR', 'omitted', undefined],
    ['JURUSAN_TEACHER', 'omitted', undefined],
    ['TOOLMAN', 'omitted', undefined],
  ])('refuses %s with the department %s', async (positionCode) => {
    const budi = await createStaff(alpha.id, 'budi');

    const response = await assign(budi, { positionCode });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('departmentId');
  });

  it.each(['COMMON_TEACHER', 'WAKASEK_SARPRAS', 'KEPALA_SEKOLAH'])(
    'refuses %s with a department',
    async (positionCode) => {
      const tkj = await createDepartment(alpha.id);
      const budi = await createStaff(alpha.id, 'budi');

      const response = await assign(budi, { positionCode, departmentId: tkj.id });

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('departmentId');
    }
  );

  it('refuses an unknown position code, including SARPRAS_STAFF', async () => {
    const budi = await createStaff(alpha.id, 'budi');

    const response = await assign(budi, { positionCode: 'SARPRAS_STAFF' });

    expect(response.status).toBe(400);
  });

  it('refuses a department of another institution (BR-007)', async () => {
    const foreign = await createDepartment(beta.id);
    const budi = await createStaff(alpha.id, 'budi');

    const response = await assign(budi, { positionCode: 'KAJUR', departmentId: foreign.id });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('departmentId');
  });

  it('refuses a deactivated department (decision D5)', async () => {
    const tkj = await createDepartment(alpha.id);
    await tkj.update({ isActive: false });
    const budi = await createStaff(alpha.id, 'budi');

    const response = await assign(budi, { positionCode: 'KAJUR', departmentId: tkj.id });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toContain('deactivated');
  });

  it('refuses a deactivated user', async () => {
    const gone = await createStaff(alpha.id, 'gone');
    await gone.update({ isActive: false });

    const response = await assign(gone, { positionCode: 'KEPALA_SEKOLAH' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('userId');
  });

  it('refuses a user with no institution', async () => {
    const drifter = await createStaff(null, 'drifter');

    const response = await assign(drifter, { positionCode: 'KEPALA_SEKOLAH' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('userId');
  });
});

describe('who may hold what at once (REQ-POS-002)', () => {
  it('refuses a second current Kajur for a department, with the reason in details', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const ani = await createStaff(alpha.id, 'ani');

    await assign(budi, { positionCode: 'KAJUR', departmentId: tkj.id });
    const response = await assign(ani, { positionCode: 'KAJUR', departmentId: tkj.id });

    // No automatic handover: the current holder is ended deliberately first.
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.details[0].issue).toContain('position occupied');
  });

  it('admits the next Kajur once the current one is ended, keeping the history', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const ani = await createStaff(alpha.id, 'ani');

    const first = await assign(budi, { positionCode: 'KAJUR', departmentId: tkj.id });
    await post(`/position-assignments/${first.body.data.id}/end`);
    const second = await assign(ani, { positionCode: 'KAJUR', departmentId: tkj.id });

    expect(second.status).toBe(201);

    const history = await get(`/departments/${tkj.id}/position-assignments`);
    expect(history.body.data.map((row) => [row.user.username, row.isCurrent])).toEqual([
      ['ani', true],
      ['budi', false],
    ]);
  });

  it('allows one Kajur per department, in several departments', async () => {
    const tkj = await createDepartment(alpha.id, 'TKJ');
    const tkr = await createDepartment(alpha.id, 'TKR');
    const budi = await createStaff(alpha.id, 'budi');
    const ani = await createStaff(alpha.id, 'ani');

    expect((await assign(budi, { positionCode: 'KAJUR', departmentId: tkj.id })).status).toBe(201);
    expect((await assign(ani, { positionCode: 'KAJUR', departmentId: tkr.id })).status).toBe(201);
  });

  it('refuses a second current Kepala Sekolah in one institution, not across two', async () => {
    const siti = await createStaff(alpha.id, 'siti');
    const rina = await createStaff(alpha.id, 'rina');
    const joko = await createStaff(beta.id, 'joko');

    await assign(siti, { positionCode: 'KEPALA_SEKOLAH' });

    expect((await assign(rina, { positionCode: 'KEPALA_SEKOLAH' })).status).toBe(409);
    expect((await assign(joko, { positionCode: 'KEPALA_SEKOLAH' })).status).toBe(201);
  });

  it('refuses a person being the Toolman of two departments', async () => {
    const tkj = await createDepartment(alpha.id, 'TKJ');
    const tkr = await createDepartment(alpha.id, 'TKR');
    const eko = await createStaff(alpha.id, 'eko');

    await assign(eko, { positionCode: 'TOOLMAN', departmentId: tkj.id });
    const response = await assign(eko, { positionCode: 'TOOLMAN', departmentId: tkr.id });

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toContain('one department at a time');
  });

  it('allows several Jurusan teachers in one department', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const ani = await createStaff(alpha.id, 'ani');

    for (const user of [budi, ani]) {
      expect(
        (await assign(user, { positionCode: 'JURUSAN_TEACHER', departmentId: tkj.id })).status
      ).toBe(201);
    }
  });

  /**
   * CR-014 §4.2: one teacher, several capacities — never two jobs.
   */
  it('lets one teacher hold the common context and Jurusan contexts together', async () => {
    const tkj = await createDepartment(alpha.id, 'TKJ');
    const tkr = await createDepartment(alpha.id, 'TKR');
    const budi = await createStaff(alpha.id, 'budi');

    expect((await assign(budi, { positionCode: 'COMMON_TEACHER' })).status).toBe(201);
    expect(
      (await assign(budi, { positionCode: 'JURUSAN_TEACHER', departmentId: tkj.id })).status
    ).toBe(201);
    expect(
      (await assign(budi, { positionCode: 'JURUSAN_TEACHER', departmentId: tkr.id })).status
    ).toBe(201);
    expect((await assign(budi, { positionCode: 'KAJUR', departmentId: tkj.id })).status).toBe(201);
  });

  it('refuses a duplicate live assignment, including a second common-teacher context', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');

    await assign(budi, { positionCode: 'COMMON_TEACHER' });
    await assign(budi, { positionCode: 'JURUSAN_TEACHER', departmentId: tkj.id });

    expect((await assign(budi, { positionCode: 'COMMON_TEACHER' })).status).toBe(409);
    expect(
      (await assign(budi, { positionCode: 'JURUSAN_TEACHER', departmentId: tkj.id })).status
    ).toBe(409);
  });
});

describe('the database is the backstop (migration 049)', () => {
  const insert = (row) => models.PositionAssignment.create({ isCurrent: true, ...row });

  // An explicit, earlier start, so an ended row satisfies chk_pos_assign_dates
  // and a refusal is attributable to the constraint under test. Leaving
  // assigned_at to its default made it land a millisecond AFTER an `endedAt`
  // computed first — a timing-dependent failure.
  const past = () => ({ assignedAt: new Date(Date.now() - 60_000), endedAt: new Date() });

  it('refuses two current holders of one department post', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const ani = await createStaff(alpha.id, 'ani');
    const base = { institutionId: alpha.id, positionCode: 'TOOLMAN', departmentId: tkj.id };

    await insert({ ...base, userId: budi.id });

    await expect(insert({ ...base, userId: ani.id })).rejects.toThrow();
  });

  it('refuses two current holders of one institution post', async () => {
    const siti = await createStaff(alpha.id, 'siti');
    const rina = await createStaff(alpha.id, 'rina');
    const base = { institutionId: alpha.id, positionCode: 'WAKASEK_SARPRAS' };

    await insert({ ...base, userId: siti.id });

    await expect(insert({ ...base, userId: rina.id })).rejects.toThrow();
  });

  it('refuses a second current common-teacher row for one user (NULLS NOT DISTINCT)', async () => {
    const budi = await createStaff(alpha.id, 'budi');
    const base = { institutionId: alpha.id, userId: budi.id, positionCode: 'COMMON_TEACHER' };

    await insert(base);

    await expect(insert(base)).rejects.toThrow();
  });

  it('refuses a department-bound code without a department, and the reverse', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const base = { institutionId: alpha.id, userId: budi.id };

    await expect(insert({ ...base, positionCode: 'KAJUR' })).rejects.toThrow();
    await expect(
      insert({ ...base, positionCode: 'COMMON_TEACHER', departmentId: tkj.id })
    ).rejects.toThrow();
  });

  it('refuses a current row that has ended, and an unknown code', async () => {
    const budi = await createStaff(alpha.id, 'budi');
    const base = { institutionId: alpha.id, userId: budi.id };

    await expect(insert({ ...base, positionCode: 'KEPALA_SEKOLAH', ...past() })).rejects.toThrow();
    await expect(insert({ ...base, positionCode: 'SARPRAS_STAFF' })).rejects.toThrow();
  });

  it('allows a new current row beside ended ones', async () => {
    const budi = await createStaff(alpha.id, 'budi');
    const base = { institutionId: alpha.id, userId: budi.id, positionCode: 'KEPALA_SEKOLAH' };

    await insert({ ...base, isCurrent: false, ...past() });

    await expect(insert(base)).resolves.toBeDefined();
  });
});

describe('ending a position', () => {
  it('closes the assignment without deleting it', async () => {
    const siti = await createStaff(alpha.id, 'siti');
    const created = await assign(siti, { positionCode: 'KEPALA_SEKOLAH' });

    const response = await post(`/position-assignments/${created.body.data.id}/end`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ isCurrent: false, endedBy: admin.user.id });
    expect(response.body.data.endedAt).not.toBeNull();
    expect(await models.PositionAssignment.count({ where: { userId: siti.id } })).toBe(1);
  });

  it('refuses to end an ended assignment — history is never modified', async () => {
    const siti = await createStaff(alpha.id, 'siti');
    const created = await assign(siti, { positionCode: 'KEPALA_SEKOLAH' });
    await post(`/position-assignments/${created.body.data.id}/end`);

    const again = await post(`/position-assignments/${created.body.data.id}/end`);

    expect(again.status).toBe(409);
  });

  it('answers 404 for an unknown assignment', async () => {
    const response = await post('/position-assignments/00000000-0000-4000-8000-000000000000/end');

    expect(response.status).toBe(404);
  });
});

describe('reading assignments', () => {
  it('lists a user’s assignments current first, and ?current=true filters', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const ended = await assign(budi, { positionCode: 'COMMON_TEACHER' });
    await post(`/position-assignments/${ended.body.data.id}/end`);
    await assign(budi, { positionCode: 'JURUSAN_TEACHER', departmentId: tkj.id });

    const all = await get(`/users/${budi.id}/position-assignments`);
    const current = await get(`/users/${budi.id}/position-assignments?current=true`);

    expect(all.body.data.map((row) => [row.positionCode, row.isCurrent])).toEqual([
      ['JURUSAN_TEACHER', true],
      ['COMMON_TEACHER', false],
    ]);
    expect(current.body.data.map((row) => row.positionCode)).toEqual(['JURUSAN_TEACHER']);
  });

  it('lists only the department’s own assignments', async () => {
    const tkj = await createDepartment(alpha.id, 'TKJ');
    const tkr = await createDepartment(alpha.id, 'TKR');
    const budi = await createStaff(alpha.id, 'budi');
    const siti = await createStaff(alpha.id, 'siti');
    await assign(budi, { positionCode: 'KAJUR', departmentId: tkj.id });
    await assign(budi, { positionCode: 'JURUSAN_TEACHER', departmentId: tkr.id });
    await assign(siti, { positionCode: 'KEPALA_SEKOLAH' });

    const response = await get(`/departments/${tkj.id}/position-assignments`);

    expect(response.body.data.map((row) => row.positionCode)).toEqual(['KAJUR']);
  });
});

describe('the boundary', () => {
  const ALL = [
    'school-position:read',
    'position-assignment:read',
    'position-assignment:create',
    'position-assignment:end',
  ];

  it('requires the matching permission on every endpoint', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');
    const held = await assign(budi, { positionCode: 'KAJUR', departmentId: tkj.id });
    const none = await createCaller({ institutionId: alpha.id });

    expect((await get(`/users/${budi.id}/position-assignments`, none)).status).toBe(403);
    expect((await get(`/departments/${tkj.id}/position-assignments`, none)).status).toBe(403);
    expect((await assign(budi, { positionCode: 'COMMON_TEACHER' }, none)).status).toBe(403);
    expect((await post(`/position-assignments/${held.body.data.id}/end`, {}, none)).status).toBe(
      403
    );
  });

  it('answers 404 for users, departments and assignments of another institution', async () => {
    const scopedAdmin = await createCaller({ permissions: ALL, institutionId: alpha.id });
    const foreignDept = await createDepartment(beta.id);
    const foreigner = await createStaff(beta.id, 'foreigner');
    const held = await assign(foreigner, { positionCode: 'KEPALA_SEKOLAH' });

    expect((await get(`/users/${foreigner.id}/position-assignments`, scopedAdmin)).status).toBe(
      404
    );
    expect((await assign(foreigner, { positionCode: 'COMMON_TEACHER' }, scopedAdmin)).status).toBe(
      404
    );
    expect(
      (await get(`/departments/${foreignDept.id}/position-assignments`, scopedAdmin)).status
    ).toBe(404);
    expect(
      (await post(`/position-assignments/${held.body.data.id}/end`, {}, scopedAdmin)).status
    ).toBe(404);
  });

  it('lets an institution administrator manage their own institution', async () => {
    const scopedAdmin = await createCaller({ permissions: ALL, institutionId: alpha.id });
    const budi = await createStaff(alpha.id, 'budi');

    expect((await assign(budi, { positionCode: 'COMMON_TEACHER' }, scopedAdmin)).status).toBe(201);
  });

  it('refuses a PIC-scoped caller even when the codes are granted (CR-004 ceiling)', async () => {
    const pic = await createCaller({
      permissions: ALL,
      institutionId: alpha.id,
      isPicScoped: true,
    });
    const budi = await createStaff(alpha.id, 'budi');

    expect((await get('/school-positions', pic)).status).toBe(403);
    expect((await get(`/users/${budi.id}/position-assignments`, pic)).status).toBe(403);
    expect((await assign(budi, { positionCode: 'COMMON_TEACHER' }, pic)).status).toBe(403);
  });

  describe('BR-033 — no self-assignment', () => {
    it('refuses assigning a position to oneself, whatever the permissions', async () => {
      const response = await assign(admin.user, { positionCode: 'KEPALA_SEKOLAH' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.details[0].issue).toContain('BR-033');
    });

    it('refuses ending one’s own assignment', async () => {
      const scopedAdmin = await createCaller({ permissions: ALL, institutionId: alpha.id });
      const other = await createCaller({ permissions: ALL, institutionId: alpha.id });
      const held = await assign(scopedAdmin.user, { positionCode: 'KEPALA_SEKOLAH' }, other);

      const response = await post(
        `/position-assignments/${held.body.data.id}/end`,
        {},
        scopedAdmin
      );

      expect(held.status).toBe(201);
      expect(response.status).toBe(403);
      expect(response.body.error.details[0].issue).toContain('BR-033');
    });
  });
});

describe('a position grants nothing (BR-028)', () => {
  it('leaves the holder’s permissions unchanged and reports the position on /auth/me', async () => {
    const holder = await createCaller({ permissions: ['asset:read'], institutionId: alpha.id });
    const before = await get('/auth/me', holder);

    await assign(holder.user, { positionCode: 'KEPALA_SEKOLAH' });
    const after = await get('/auth/me', holder);

    expect(after.body.data.permissions).toEqual(before.body.data.permissions);
    expect(after.body.data.isSystemWide).toBe(false);
    expect(after.body.data.positionAssignments).toEqual([
      expect.objectContaining({ positionCode: 'KEPALA_SEKOLAH', institutionId: alpha.id }),
    ]);
  });

  it('reports only current assignments on /auth/me', async () => {
    const holder = await createCaller({ institutionId: alpha.id });
    const held = await assign(holder.user, { positionCode: 'KEPALA_SEKOLAH' });
    await post(`/position-assignments/${held.body.data.id}/end`);

    const me = await get('/auth/me', holder);

    expect(me.body.data.positionAssignments).toEqual([]);
  });

  it('never touches the department PIC', async () => {
    const tkj = await createDepartment(alpha.id);
    const budi = await createStaff(alpha.id, 'budi');

    await assign(budi, { positionCode: 'KAJUR', departmentId: tkj.id });

    expect((await models.Department.findByPk(tkj.id)).currentPicUserId).toBeNull();
    expect(await models.DepartmentPicAssignment.count()).toBe(0);
  });
});

describe('changing institution while holding a position (decision D2)', () => {
  it('is refused, and allowed once the assignment is ended', async () => {
    const siti = await createStaff(alpha.id, 'siti');
    const held = await assign(siti, { positionCode: 'KEPALA_SEKOLAH' });

    const refused = await patch(`/users/${siti.id}`, { institutionId: beta.id });

    expect(refused.status).toBe(409);
    expect(refused.body.error.details[0].field).toBe('institutionId');

    await post(`/position-assignments/${held.body.data.id}/end`);
    const allowed = await patch(`/users/${siti.id}`, { institutionId: beta.id });

    expect(allowed.status).toBe(200);
  });

  it('does not affect a user who holds no position', async () => {
    const siti = await createStaff(alpha.id, 'siti');

    expect((await patch(`/users/${siti.id}`, { institutionId: beta.id })).status).toBe(200);
  });
});

/**
 * Migration 049's `down()` refuses rather than discarding assignment history.
 * Run against the cycle database, which `01-migration-cycle` leaves migrated.
 */
describe('rolling back migration 049', () => {
  const CYCLE = cycleDatabaseUrl();

  /**
   * Vitest does not guarantee file order (it sorts by recorded duration), so
   * this cannot rely on `01-migration-cycle` having run first. `db:migrate` only
   * applies what is pending, and `01` runs from whatever state it finds, so
   * migrating here is safe in either order.
   */
  beforeAll(async () => {
    await migrate(CYCLE);
  });

  it('refuses while assignment history exists', async () => {
    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address)
       VALUES ('Cycle', 'CYCLE', 'Jl. C') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-holder', $1, 'Cycle', 'Holder', $2) RETURNING id`,
      [`$2b$10$${'0'.repeat(53)}`, institution.id],
      CYCLE
    );
    await query(
      `INSERT INTO public.position_assignments (institution_id, user_id, position_code)
       VALUES ($1, $2, 'KEPALA_SEKOLAH')`,
      [institution.id, user.id],
      CYCLE
    );

    try {
      // Named, not "the latest": since Phase 36 the latest is 050, whose own
      // guard is exercised in 30-workflow-definitions.
      await expect(
        runCli(
          ['db:migrate:undo', '--name', '20260923010000-049-create-position-assignments.js'],
          CYCLE
        )
      ).rejects.toThrow(/Migration 049 rollback refused/);

      const [{ count }] = await query(
        'SELECT count(*)::int AS count FROM public.position_assignments',
        [],
        CYCLE
      );
      expect(count).toBe(1);
    } finally {
      await query('DELETE FROM public.position_assignments', [], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }
  });
});
