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

/**
 * Teacher Storage Room — REQ-REQUEST-023, migration 063
 * (`IMPLEMENTATION_PLAN.md` §70). One Location per institution, shared by all
 * teachers: the DEFAULT intended location for a teacher who is no Location PIC.
 *
 *   SETTING     GET / PUT /institutions/:id/teacher-storage-room — an active
 *               location of THAT institution, or null; its own permission;
 *               another institution is 404; audited
 *   DEFAULT     guidance: PIC rooms first; else, in a teacher's context only, the
 *               active room; nothing for other contexts; never filled in by the
 *               server; category plays no part
 *   FUTURE ONLY requests already holding it are never rewritten
 *   MOVE        a room moved to another institution stops being the room
 *   SCHEMA      the composite key, existing rows NULL, the guarded rollback
 */

const V1 = '/api/v1';
const LEAF = '117010101001';
const MIGRATION = '20261006010000-063-add-teacher-storage-room.js';
const ROOM_PERMISSIONS = ['teacher-storage-room:read', 'teacher-storage-room:update'];

let alpha;
let beta;
let admin;

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

// --- helpers ----------------------------------------------------------------

const call = (method, url, body, caller) => {
  const request = api()
    [method](`${V1}${url}`)
    .set(...caller.auth);
  return body === undefined ? request : request.send(body);
};
const get = (url, caller = admin) => call('get', url, undefined, caller);
const put = (url, body, caller = admin) => call('put', url, body, caller);
const post = (url, body, caller = admin) => call('post', url, body, caller);
const patch = (url, body, caller = admin) => call('patch', url, body, caller);

const room = (institution = alpha) => `/institutions/${institution.id}/teacher-storage-room`;
const location = (name, institution = alpha, extra = {}) =>
  models.Location.create({ name, classificationId: LEAF, institutionId: institution.id, ...extra });
const configure = async (target, institution = alpha) =>
  models.Institution.update(
    { teacherStorageLocationId: target?.id ?? null },
    { where: { id: institution.id } }
  );
const settingOf = async (institution = alpha) =>
  (await models.Institution.findByPk(institution.id)).teacherStorageLocationId;

/** A user holding `positionCode` in `institution`, allowed to request. */
async function holder(positionCode, { institution = alpha, department = null } = {}) {
  const caller = await createCaller({
    permissions: ['request:create', 'request:read', 'request:update'],
    institutionId: institution.id,
  });
  const assignment = await models.PositionAssignment.create({
    institutionId: institution.id,
    userId: caller.user.id,
    positionCode,
    departmentId: department?.id ?? null,
  });
  return { ...caller, assignment };
}

const picOf = (caller, place) =>
  models.LocationPicAssignment.create({ locationId: place.id, userId: caller.user.id });

const contextOf = async (caller) => {
  const response = await get('/requests/guidance', caller);
  expect(response.status).toBe(200);
  return response.body.data.contexts.find((c) => c.assignmentId === caller.assignment.id);
};

// ---------------------------------------------------------------------------

describe('the setting (REQ-REQUEST-023)', () => {
  it('is not configured at first; names an active room of its own; null clears it', async () => {
    const store = await location('Ruang Penyimpanan Guru');

    expect((await get(room())).body.data).toEqual({ location: null });

    const set = await put(room(), { locationId: store.id });
    expect(set.status).toBe(200);
    expect(set.body.data).toEqual({
      location: { id: store.id, name: 'Ruang Penyimpanan Guru', isActive: true },
    });
    expect((await get(room())).body.data.location.id).toBe(store.id);

    const cleared = await put(room(), { locationId: null });
    expect(cleared.body.data).toEqual({ location: null });
    expect(await settingOf()).toBeNull();
  });

  it('audits the change as an Institution UPDATE by its actor', async () => {
    const store = await location('Gudang Guru');
    await put(room(), { locationId: store.id });

    const [entry] = await models.AuditLog.findAll({
      where: { entityType: 'Institution', entityId: alpha.id },
      order: [['timestamp', 'DESC']],
    });
    expect(entry).toMatchObject({ actorId: admin.user.id });
    expect(entry.oldValues).toMatchObject({ teacherStorageLocationId: null });
    expect(entry.newValues).toMatchObject({ teacherStorageLocationId: store.id });
  });

  it('refuses another institution’s, a missing, or a deactivated location — unchanged', async () => {
    const theirs = await location('Beta room', beta);
    const closed = await location('Closed room', alpha, { isActive: false });

    for (const locationId of [theirs.id, '00000000-0000-4000-8000-000000000000', closed.id]) {
      const response = await put(room(), { locationId });
      expect(response.status, locationId).toBe(400);
      expect(response.body.error.details[0].field).toBe('locationId');
    }
    for (const body of [{}, { locationId: 'nope' }, { locationId: null, extra: 1 }]) {
      expect((await put(room(), body)).status).toBe(400);
    }
    expect(await settingOf()).toBeNull();
  });

  it('needs its own permission, and stays inside the caller’s institution', async () => {
    const store = await location('Gudang');
    const reader = await createCaller({
      permissions: ['teacher-storage-room:read'],
      institutionId: alpha.id,
    });
    const scopedAdmin = await createCaller({
      permissions: [...ROOM_PERMISSIONS, 'location:read'],
      institutionId: alpha.id,
    });
    const nobody = await createCaller({ permissions: ['location:read'], institutionId: alpha.id });

    expect((await get(room(), nobody)).status).toBe(403);
    expect((await get(room(), reader)).status).toBe(200);
    expect((await put(room(), { locationId: store.id }, reader)).status).toBe(403);
    // An institution administrator, without `institution:update`.
    expect((await put(room(), { locationId: store.id }, scopedAdmin)).status).toBe(200);
    // Another institution is not found, as everywhere.
    expect((await get(room(beta), scopedAdmin)).status).toBe(404);
    expect((await put(room(beta), { locationId: null }, scopedAdmin)).status).toBe(404);
  });
});

describe('the default destination in the guidance', () => {
  it('proposes the room to a teacher who is no Location PIC — Common and Jurusan alike', async () => {
    const store = await location('Ruang Penyimpanan Guru');
    await configure(store);
    const tkj = await models.Department.create({
      code: 'TKJ',
      name: 'TKJ',
      institutionId: alpha.id,
    });

    for (const teacher of [
      await holder('COMMON_TEACHER'),
      await holder('JURUSAN_TEACHER', { department: tkj }),
    ]) {
      expect(await contextOf(teacher)).toMatchObject({
        defaultDestinations: [{ id: store.id, name: 'Ruang Penyimpanan Guru' }],
        defaultDestinationSource: 'TEACHER_STORAGE_ROOM',
      });
    }
  });

  it('proposes nothing when no room is configured, exactly as before', async () => {
    const teacher = await holder('COMMON_TEACHER');
    expect(await contextOf(teacher)).toMatchObject({
      defaultDestinations: [],
      defaultDestinationSource: null,
    });
  });

  it('keeps a Location PIC on their own rooms — the room is not added', async () => {
    await configure(await location('Gudang'));
    const classroom = await location('Kelas 1');
    const teacher = await holder('COMMON_TEACHER');
    await picOf(teacher, classroom);

    expect(await contextOf(teacher)).toMatchObject({
      defaultDestinations: [{ id: classroom.id, name: 'Kelas 1' }],
      defaultDestinationSource: 'LOCATION_PIC',
    });
  });

  it('counts a PIC of only a deactivated room as no PIC', async () => {
    const store = await location('Gudang');
    await configure(store);
    const teacher = await holder('COMMON_TEACHER');
    await picOf(teacher, await location('Old room', alpha, { isActive: false }));

    expect((await contextOf(teacher)).defaultDestinationSource).toBe('TEACHER_STORAGE_ROOM');
  });

  it('offers it in a teacher’s context only, not to Kajur, a Wakasek or the Kepala', async () => {
    await configure(await location('Gudang'));
    const tkj = await models.Department.create({
      code: 'TKJ',
      name: 'TKJ',
      institutionId: alpha.id,
    });

    for (const other of [
      await holder('KEPALA_SEKOLAH'),
      await holder('WAKASEK_SARPRAS'),
      await holder('KAJUR', { department: tkj }),
    ]) {
      expect(await contextOf(other)).toMatchObject({
        defaultDestinations: [],
        defaultDestinationSource: null,
      });
    }
  });

  it('offers a deactivated room to nobody, though it stays configured', async () => {
    const store = await location('Gudang');
    await configure(store);
    await store.update({ isActive: false });
    const teacher = await holder('COMMON_TEACHER');

    expect((await contextOf(teacher)).defaultDestinations).toEqual([]);
    expect((await get(room())).body.data.location).toMatchObject({
      id: store.id,
      isActive: false,
    });
  });

  it('offers each institution its own room only', async () => {
    const mine = await location('Gudang Alpha');
    await configure(await location('Gudang Beta', beta), beta);
    await configure(mine);
    const theirs = await holder('COMMON_TEACHER', { institution: beta });

    expect((await contextOf(theirs)).defaultDestinations[0].name).toBe('Gudang Beta');
  });
});

describe('a default only — never written for anyone, never rewritten', () => {
  it('leaves a request created without a destination with none', async () => {
    await configure(await location('Gudang'));
    const teacher = await holder('COMMON_TEACHER');

    const created = await post(
      '/requests',
      { requesterAssignmentId: teacher.assignment.id, category: 'COMMON', title: 'Laptop' },
      teacher
    );
    expect(created.status).toBe(201);
    expect(created.body.data.destinationLocationId).toBeNull();
  });

  it('keeps every request that took the old room when the room changes or is cleared', async () => {
    const old = await location('Gudang Lama');
    await configure(old);
    const teacher = await holder('COMMON_TEACHER');
    const created = await post(
      '/requests',
      {
        requesterAssignmentId: teacher.assignment.id,
        category: 'COMMON',
        title: 'Proyektor',
        destinationLocationId: old.id,
      },
      teacher
    );
    expect(created.status).toBe(201);

    await put(room(), { locationId: (await location('Gudang Baru')).id });
    await put(room(), { locationId: null });

    const request = await models.Request.findByPk(created.body.data.id);
    expect(request.destinationLocationId).toBe(old.id);
  });
});

describe('moving the room to another institution', () => {
  it('stops it being the room it was — that institution’s future defaults only', async () => {
    const store = await location('Gudang');
    const other = await location('Kelas');
    await configure(store);

    const moved = await patch(`/locations/${other.id}`, { institutionId: beta.id });
    expect(moved.status).toBe(200);
    expect(await settingOf()).toBe(store.id);

    const movedRoom = await patch(`/locations/${store.id}`, { institutionId: beta.id });
    expect(movedRoom.status).toBe(200);
    expect(await settingOf()).toBeNull();
    const [entry] = await models.AuditLog.findAll({
      where: { entityType: 'Institution', entityId: alpha.id },
      order: [['timestamp', 'DESC']],
    });
    expect(entry.newValues).toMatchObject({ teacherStorageLocationId: null });
  });
});

describe('the schema (migration 063)', () => {
  it('holds the room to its own institution', async () => {
    const theirs = await location('Beta room', beta);
    await expect(
      query('UPDATE public.institutions SET teacher_storage_location_id = $1 WHERE id = $2', [
        theirs.id,
        alpha.id,
      ])
    ).rejects.toThrow(/fk_institutions_teacher_storage/);
  });

  it('leaves existing institutions NULL, and refuses to roll back while a room is set', async () => {
    const CYCLE = cycleDatabaseUrl();
    await migrate(CYCLE);
    await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);

    const one = async (sql, params) => (await query(sql, params, CYCLE))[0];
    const institution = await one(
      `INSERT INTO public.institutions (name, code, address) VALUES ('C', 'CYC063', 'x') RETURNING id`
    );
    await query(
      `INSERT INTO ref.asset_classifications (id, name) VALUES ('999999999063', 'Cycle 063')`,
      [],
      CYCLE
    );
    const place = await one(
      `INSERT INTO public.locations (name, classification_id, institution_id)
       VALUES ('Gudang', '999999999063', $1) RETURNING id`,
      [institution.id]
    );

    try {
      await migrate(CYCLE);
      const existing = await one(
        'SELECT teacher_storage_location_id FROM public.institutions WHERE id = $1',
        [institution.id]
      );
      expect(existing.teacher_storage_location_id).toBeNull();

      await query(
        'UPDATE public.institutions SET teacher_storage_location_id = $1 WHERE id = $2',
        [place.id, institution.id],
        CYCLE
      );
      await expect(runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE)).rejects.toThrow(
        /Migration 063 rollback refused/
      );

      await query(
        'UPDATE public.institutions SET teacher_storage_location_id = NULL WHERE id = $1',
        [institution.id],
        CYCLE
      );
      await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);
      const gone = await one(
        `SELECT count(*)::int AS columns FROM information_schema.columns
          WHERE table_name = 'institutions' AND column_name = 'teacher_storage_location_id'`
      );
      expect(gone.columns).toBe(0);
    } finally {
      await migrate(CYCLE);
      await query(
        'UPDATE public.institutions SET teacher_storage_location_id = NULL WHERE id = $1',
        [institution.id],
        CYCLE
      );
      await query('DELETE FROM public.locations WHERE id = $1', [place.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
      await query(`DELETE FROM ref.asset_classifications WHERE id = '999999999063'`, [], CYCLE);
    }
  });
});
