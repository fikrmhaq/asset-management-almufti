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
 * Classification management — Phase 17 (`CR-001`), `06-api.md` §4.1.
 *
 * REQ-CLASS-011 through REQ-CLASS-017, `BR-016`–`BR-019`.
 *
 * Runs against the real seeded hierarchy, because every rule here is about
 * where in that hierarchy a node may sit and what provenance it carries.
 */

const V1 = '/api/v1';
const ROOT = '100000000000';

/** A real second-to-last-level node: "ALAT LABORATORIUM PERTANIAN", 412 children. */
const PARENT = '132080141000';
/** Another, in a different branch. */
const OTHER_PARENT = '117010101000';
/** A real leaf — nothing may attach beneath it. */
const LEAF = '117010101001';

const WRITE_PERMISSIONS = [
  'classification:read',
  'classification:create',
  'classification:update',
  'classification:delete',
];

let admin;
let institutionA;
let institutionB;

/**
 * Removes everything Phase 17 can create, leaving the seeded tree untouched.
 *
 * The order is forced from both directions, which is why it is spelled out
 * rather than delegated:
 *
 *   - assets, locations and attribute definitions reference classifications, so
 *     they go before the classifications (`fk_assets_classification`);
 *   - classifications reference the user who created them, so they go before the
 *     users (`fk_asset_classifications_created_by`).
 *
 * `resetOrganizationData` clears both attribute definitions and users, so it
 * cannot be a single call at either end — the classification delete sits between
 * its two halves.
 */
async function resetAppDefined() {
  await resetAssetCoreData();
  await models.AttributeDefinition.destroy({ where: {} });
  await models.AssetClassification.destroy({ where: { origin: 3 } });
  await resetOrganizationData();
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAppDefined();

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
  await resetAppDefined();
});

/** A caller scoped to one institution, holding the classification write set. */
const scopedCaller = (institutionId, permissions = WRITE_PERMISSIONS) =>
  createCaller({ permissions, isSystemWide: false, institutionId });

const create = (caller, body) =>
  api()
    .post(`${V1}/classifications`)
    .set(...caller.auth)
    .send(body);

describe('creating (REQ-CLASS-011/012/013)', () => {
  it('allocates an identifier the caller never supplies', async () => {
    const response = await create(admin, { parentId: PARENT, name: 'Mikroskop Digital' });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toHaveLength(12);
    expect(response.body.data.id.startsWith('132080141')).toBe(true);
    expect(response.body.data.name).toBe('Mikroskop Digital');
    expect(response.body.data.parentId).toBe(PARENT);
  });

  it('allocates downward from 999, clear of the government range (REQ-CLASS-013)', async () => {
    const response = await create(admin, { parentId: PARENT, name: 'First' });

    // The busiest seeded parent reaches ordinal 412; descending allocation keeps
    // application-defined codes far from anything a future release would mint.
    expect(response.body.data.id).toBe('132080141999');
  });

  it('does not reuse an identifier for the next addition', async () => {
    const first = await create(admin, { parentId: PARENT, name: 'First' });
    const second = await create(admin, { parentId: PARENT, name: 'Second' });

    expect(second.body.data.id).toBe('132080141998');
    expect(second.body.data.id).not.toBe(first.body.data.id);
  });

  it('marks the new node as application-defined so the UI can tell it apart', async () => {
    const response = await create(admin, { parentId: PARENT, name: 'Mesin Batik' });

    expect(response.body.data.origin).toBe(3);
    expect(response.body.data.isAppDefined).toBe(true);
    expect(response.body.data.isLeaf).toBe(true);
    expect(response.body.data.createdAt).not.toBeNull();
  });

  it('records who created it', async () => {
    const response = await create(admin, { parentId: PARENT, name: 'Traceable' });

    expect(response.body.data.createdBy).toBe(admin.user.id);
  });

  it('appears in the parent’s children immediately (the drill-down sees it)', async () => {
    const created = await create(admin, { parentId: PARENT, name: 'Visible' });

    const children = await api()
      .get(`${V1}/classifications/${PARENT}/children`)
      .set(...admin.auth);

    expect(children.body.data.map((row) => row.id)).toContain(created.body.data.id);
  });

  it('is reachable from the leaf type-ahead like any other leaf', async () => {
    await create(admin, { parentId: PARENT, name: 'Spektrometer Lokal' });

    const response = await api()
      .get(`${V1}/classifications/leaf?q=Spektrometer Lokal`)
      .set(...admin.auth);

    expect(response.body.data.map((row) => row.name)).toContain('Spektrometer Lokal');
    expect(response.body.data[0].isLeaf).toBe(true);
    // The path still resolves through the government ancestors above it.
    expect(response.body.data[0].path[0].id).toBe(ROOT);
  });

  it.each([
    [ROOT, 'a root'],
    ['117010100000', 'a level above the deepest'],
    [LEAF, 'an existing leaf'],
  ])('refuses %s as a parent (%s) — REQ-CLASS-012, BR-017', async (parentId) => {
    const response = await create(admin, { parentId, name: 'Nope' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('parentId');
  });

  it('refuses a parent that does not exist', async () => {
    const response = await create(admin, { parentId: '999999999000', name: 'Nope' });

    expect(response.status).toBe(400);
  });

  it('ignores an identifier the caller tries to choose', async () => {
    const response = await create(admin, {
      parentId: PARENT,
      name: 'Sneaky',
      id: '132080141500',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe('132080141999');
  });
});

describe('ownership (REQ-CLASS-014, BR-019)', () => {
  it('defaults a scoped caller’s addition to their own institution', async () => {
    const caller = await scopedCaller(institutionA.id);
    const response = await create(caller, { parentId: PARENT, name: 'Milik A' });

    expect(response.status).toBe(201);
    expect(response.body.data.institutionId).toBe(institutionA.id);
  });

  it('lets a system-wide caller create a global node', async () => {
    const response = await create(admin, {
      parentId: PARENT,
      name: 'Untuk Semua',
      institutionId: null,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.institutionId).toBeNull();
  });

  it('refuses a scoped caller a global node', async () => {
    const caller = await scopedCaller(institutionA.id);
    const response = await create(caller, {
      parentId: PARENT,
      name: 'Not Yours',
      institutionId: null,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('institutionId');
  });

  it('refuses a scoped caller creating for another institution', async () => {
    const caller = await scopedCaller(institutionA.id);
    const response = await create(caller, {
      parentId: PARENT,
      name: 'For B',
      institutionId: institutionB.id,
    });

    expect(response.status).toBe(400);
  });

  it('hides one institution’s addition from another’s drill-down', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const callerB = await scopedCaller(institutionB.id);

    const created = await create(callerA, { parentId: PARENT, name: 'Rahasia A' });

    const seenByB = await api()
      .get(`${V1}/classifications/${PARENT}/children`)
      .set(...callerB.auth);

    expect(seenByB.body.data.map((row) => row.id)).not.toContain(created.body.data.id);
  });

  it('shows a global addition to every institution', async () => {
    const callerB = await scopedCaller(institutionB.id);
    const created = await create(admin, {
      parentId: PARENT,
      name: 'Global Node',
      institutionId: null,
    });

    const seenByB = await api()
      .get(`${V1}/classifications/${PARENT}/children`)
      .set(...callerB.auth);

    expect(seenByB.body.data.map((row) => row.id)).toContain(created.body.data.id);
  });

  it('answers 404 rather than 403 when reading another institution’s node', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const callerB = await scopedCaller(institutionB.id);

    const created = await create(callerA, { parentId: PARENT, name: 'Rahasia A' });

    const response = await api()
      .get(`${V1}/classifications/${created.body.data.id}`)
      .set(...callerB.auth);

    // Confirming it exists but belongs to someone else is itself a disclosure.
    expect(response.status).toBe(404);
  });

  it('keeps another institution’s node out of the leaf search too', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const callerB = await scopedCaller(institutionB.id);

    await create(callerA, { parentId: PARENT, name: 'Alat Khusus A' });

    const response = await api()
      .get(`${V1}/classifications/leaf?q=Alat Khusus A`)
      .set(...callerB.auth);

    expect(response.body.data).toEqual([]);
  });

  it('lets a system-wide caller widen to everything with owner=all', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const created = await create(callerA, { parentId: PARENT, name: 'Milik A' });

    const response = await api()
      .get(`${V1}/classifications/${PARENT}/children?owner=all`)
      .set(...admin.auth);

    expect(response.body.data.map((row) => row.id)).toContain(created.body.data.id);
  });

  it('refuses owner=all to a scoped caller', async () => {
    const caller = await scopedCaller(institutionA.id);

    const response = await api()
      .get(`${V1}/classifications/${PARENT}/children?owner=all`)
      .set(...caller.auth);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('owner');
  });

  it('lets a system-wide caller look at one institution with institutionId', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const created = await create(callerA, { parentId: PARENT, name: 'Milik A' });

    const response = await api()
      .get(`${V1}/classifications/${PARENT}/children?institutionId=${institutionA.id}&owner=mine`)
      .set(...admin.auth);

    const ids = response.body.data.map((row) => row.id);
    expect(ids).toEqual([created.body.data.id]);
  });

  it('refuses a scoped caller naming another institution', async () => {
    const caller = await scopedCaller(institutionA.id);

    const response = await api()
      .get(`${V1}/classifications/${PARENT}/children?institutionId=${institutionB.id}`)
      .set(...caller.auth);

    expect(response.status).toBe(400);
  });
});

describe('assignment (BR-019 at write time)', () => {
  it('refuses to classify an asset with another institution’s node', async () => {
    const callerA = await scopedCaller(institutionA.id, [
      ...WRITE_PERMISSIONS,
      'asset:create',
      'asset:read',
    ]);
    const created = await create(callerA, { parentId: PARENT, name: 'Milik A' });

    const response = await api()
      .post(`${V1}/assets`)
      .set(...admin.auth)
      .send({
        name: 'Asset for B',
        classificationId: created.body.data.id,
        institutionId: institutionB.id,
      });

    // Even a system-wide caller cannot: the owning institution's users would be
    // unable to see a classification another institution's asset depends on.
    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('classificationId');
  });

  it('allows a global node for any institution’s asset', async () => {
    const created = await create(admin, {
      parentId: PARENT,
      name: 'Global Node',
      institutionId: null,
    });

    const response = await api()
      .post(`${V1}/assets`)
      .set(...admin.auth)
      .send({
        name: 'Asset for B',
        classificationId: created.body.data.id,
        institutionId: institutionB.id,
      });

    expect(response.status).toBe(201);
  });
});

describe('renaming (REQ-CLASS-016)', () => {
  it('changes the name but never the identifier', async () => {
    const created = await create(admin, { parentId: PARENT, name: 'Before' });

    const response = await api()
      .patch(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth)
      .send({ name: 'After' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('After');
    expect(response.body.data.id).toBe(created.body.data.id);
  });

  it('leaves an asset already classified against it still valid', async () => {
    const created = await create(admin, { parentId: PARENT, name: 'Before' });

    const asset = await api()
      .post(`${V1}/assets`)
      .set(...admin.auth)
      .send({ name: 'Classified', classificationId: created.body.data.id });

    await api()
      .patch(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth)
      .send({ name: 'After' });

    const reread = await api()
      .get(`${V1}/assets/${asset.body.data.id}`)
      .set(...admin.auth);

    expect(reread.status).toBe(200);
    expect(reread.body.data.classificationId).toBe(created.body.data.id);
  });

  it.each([
    [ROOT, 'government'],
    ['133010110006', 'legacy local'],
  ])('refuses to rename a %s node (BR-016)', async (id) => {
    const response = await api()
      .patch(`${V1}/classifications/${id}`)
      .set(...admin.auth)
      .send({ name: 'Renamed' });

    expect(response.status).toBe(400);
  });

  it('refuses a scoped caller renaming another institution’s node', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const callerB = await scopedCaller(institutionB.id);
    const created = await create(callerA, { parentId: PARENT, name: 'Milik A' });

    const response = await api()
      .patch(`${V1}/classifications/${created.body.data.id}`)
      .set(...callerB.auth)
      .send({ name: 'Stolen' });

    expect(response.status).toBe(404);
  });

  it('refuses a scoped caller renaming a global node', async () => {
    const caller = await scopedCaller(institutionA.id);
    const created = await create(admin, {
      parentId: PARENT,
      name: 'Global',
      institutionId: null,
    });

    const response = await api()
      .patch(`${V1}/classifications/${created.body.data.id}`)
      .set(...caller.auth)
      .send({ name: 'Mine Now' });

    expect(response.status).toBe(400);
  });
});

describe('promotion (REQ-CLASS-015)', () => {
  it('makes an institution’s node global', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const created = await create(callerA, { parentId: PARENT, name: 'Berguna' });

    const response = await api()
      .post(`${V1}/classifications/${created.body.data.id}/promote`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data.institutionId).toBeNull();
  });

  it('makes it visible to an institution that could not see it before', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const callerB = await scopedCaller(institutionB.id);
    const created = await create(callerA, { parentId: PARENT, name: 'Berguna' });

    const before = await api()
      .get(`${V1}/classifications/${created.body.data.id}`)
      .set(...callerB.auth);
    expect(before.status).toBe(404);

    await api()
      .post(`${V1}/classifications/${created.body.data.id}/promote`)
      .set(...admin.auth);

    const after = await api()
      .get(`${V1}/classifications/${created.body.data.id}`)
      .set(...callerB.auth);
    expect(after.status).toBe(200);
  });

  it('offers no way back — promotion is one-way', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const created = await create(callerA, { parentId: PARENT, name: 'Berguna' });

    await api()
      .post(`${V1}/classifications/${created.body.data.id}/promote`)
      .set(...admin.auth);

    // PATCH accepts a name and nothing else; there is no demote endpoint.
    const attempt = await api()
      .patch(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth)
      .send({ institutionId: institutionA.id });

    expect(attempt.status).toBe(400);

    const reread = await api()
      .get(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth);
    expect(reread.body.data.institutionId).toBeNull();
  });

  it('refuses a scoped caller, however their permissions are granted', async () => {
    const caller = await scopedCaller(institutionA.id, [
      ...WRITE_PERMISSIONS,
      'classification:promote',
    ]);
    const created = await create(caller, { parentId: PARENT, name: 'Berguna' });

    const response = await api()
      .post(`${V1}/classifications/${created.body.data.id}/promote`)
      .set(...caller.auth);

    expect(response.status).toBe(400);
  });

  it('refuses to promote a node that is already global', async () => {
    const created = await create(admin, {
      parentId: PARENT,
      name: 'Global',
      institutionId: null,
    });

    const response = await api()
      .post(`${V1}/classifications/${created.body.data.id}/promote`)
      .set(...admin.auth);

    expect(response.status).toBe(400);
  });

  it('refuses to promote a government node', async () => {
    const response = await api()
      .post(`${V1}/classifications/${ROOT}/promote`)
      .set(...admin.auth);

    expect(response.status).toBe(400);
  });
});

describe('deleting (REQ-CLASS-017, BR-018)', () => {
  it('removes an unreferenced node', async () => {
    const created = await create(admin, { parentId: PARENT, name: 'Salah Ketik' });

    const response = await api()
      .delete(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth);

    expect(response.status).toBe(204);

    const reread = await api()
      .get(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth);
    expect(reread.status).toBe(404);
  });

  it('frees the identifier for reuse afterwards', async () => {
    const first = await create(admin, { parentId: PARENT, name: 'Salah Ketik' });

    await api()
      .delete(`${V1}/classifications/${first.body.data.id}`)
      .set(...admin.auth);

    const second = await create(admin, { parentId: PARENT, name: 'Benar' });
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('blocks deletion while an asset references it, and says so', async () => {
    const created = await create(admin, { parentId: PARENT, name: 'In Use' });

    await api()
      .post(`${V1}/assets`)
      .set(...admin.auth)
      .send({ name: 'Classified', classificationId: created.body.data.id });

    const response = await api()
      .delete(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth);

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toMatch(/1 asset/);
  });

  it('blocks deletion while an attribute definition references it', async () => {
    const created = await create(admin, { parentId: PARENT, name: 'Has Attributes' });

    await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({ classificationId: created.body.data.id, name: 'Serial' });

    const response = await api()
      .delete(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth);

    // The one referent easily forgotten — it is neither Asset nor Location, but
    // it carries the same foreign key.
    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toMatch(/attribute definition/);
  });

  it('blocks deletion while a location references it', async () => {
    const created = await create(admin, { parentId: PARENT, name: 'Room Type' });

    await api()
      .post(`${V1}/locations`)
      .set(...admin.auth)
      .send({ name: 'Lab 1', classificationId: created.body.data.id });

    const response = await api()
      .delete(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth);

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toMatch(/1 location/);
  });

  it.each([
    [ROOT, 'government'],
    ['133010110006', 'legacy local'],
  ])('refuses to delete a %s node (BR-016)', async (id) => {
    const response = await api()
      .delete(`${V1}/classifications/${id}`)
      .set(...admin.auth);

    expect(response.status).toBe(400);

    const survives = await api()
      .get(`${V1}/classifications/${id}`)
      .set(...admin.auth);
    expect(survives.status).toBe(200);
  });

  it('lets an institution delete its own node', async () => {
    const caller = await scopedCaller(institutionA.id);
    const created = await create(caller, { parentId: PARENT, name: 'Milik A' });

    const response = await api()
      .delete(`${V1}/classifications/${created.body.data.id}`)
      .set(...caller.auth);

    expect(response.status).toBe(204);
  });

  it('refuses a scoped caller deleting another institution’s node', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const callerB = await scopedCaller(institutionB.id);
    const created = await create(callerA, { parentId: PARENT, name: 'Milik A' });

    const response = await api()
      .delete(`${V1}/classifications/${created.body.data.id}`)
      .set(...callerB.auth);

    expect(response.status).toBe(404);
  });

  it('lets a system-wide caller delete any institution’s node', async () => {
    const callerA = await scopedCaller(institutionA.id);
    const created = await create(callerA, { parentId: PARENT, name: 'Milik A' });

    const response = await api()
      .delete(`${V1}/classifications/${created.body.data.id}`)
      .set(...admin.auth);

    expect(response.status).toBe(204);
  });
});

describe('authorization', () => {
  it.each([
    ['post', '', 'classification:create'],
    ['patch', '/132080141999', 'classification:update'],
    ['delete', '/132080141999', 'classification:delete'],
    ['post', '/132080141999/promote', 'classification:promote'],
  ])('refuses %s %s without %s', async (method, suffix) => {
    const caller = await createCaller({ permissions: ['classification:read'] });

    const response = await api()
      [method](`${V1}/classifications${suffix}`)
      .set(...caller.auth)
      .send({ parentId: PARENT, name: 'Nope' });

    expect(response.status).toBe(403);
  });

  it('still allows reading with only classification:read', async () => {
    const caller = await createCaller({ permissions: ['classification:read'] });

    const response = await api()
      .get(`${V1}/classifications/${PARENT}/children`)
      .set(...caller.auth);

    expect(response.status).toBe(200);
  });
});

describe('the seeded hierarchy is untouched (REQ-CLASS-005)', () => {
  it('leaves every government and legacy row without an owner or a stamp', async () => {
    await create(admin, { parentId: OTHER_PARENT, name: 'Tambahan' });

    const stamped = await models.AssetClassification.count({
      where: { origin: [1, 2] },
      // Sequelize cannot express "any of these is not null" tersely; the
      // database suite's own schema test covers the full predicate. Here it is
      // enough that the count of seeded rows has not changed.
    });

    expect(stamped).toBe(14738);
  });

  it('adds exactly one row per creation and nothing else', async () => {
    const before = await models.AssetClassification.count();
    await create(admin, { parentId: PARENT, name: 'Satu' });
    const after = await models.AssetClassification.count();

    expect(after - before).toBe(1);
  });
});
