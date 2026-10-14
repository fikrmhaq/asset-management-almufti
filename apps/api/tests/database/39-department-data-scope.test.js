import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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

const require = createRequire(import.meta.url);
const storage = require('../../src/services/storage.js');

/**
 * Department-bound asset scope — P3 (`IMPLEMENTATION_PLAN.md` §64.3).
 *
 * A KAJUR or TOOLMAN reaches only the Asset Units of their department, and an
 * Asset only through one of those units. Out of reach is `404`, like every
 * other scope. Whole-asset changes need every unit to be theirs (`403`);
 * standalone asset creation is refused (`403`). Registration in a
 * department-bound REGISTER step is for the request's department only.
 *
 *   TKJ Kajur / Toolman  vs  TKJ, TKR and no-department units
 *   assets: MIXED (TKJ + TKR), TKJ only, TKR only, no department, no unit
 *   Sarpras, a plain institution user, and the PIC suites (21 – 23) unchanged
 *   positions are read live: ending a post changes reach on the next call
 */

const V1 = '/api/v1';
const LEAF = '117010101001';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const OPS = [
  'asset:read',
  'asset:create',
  'asset:update',
  'asset:deactivate',
  'asset-unit:read',
  'asset-unit:create',
  'asset-unit:update',
  'asset-unit:deactivate',
  'asset-unit:record-history',
  'attachment:read',
  'attachment:create',
  'attachment:delete',
  'asset-attribute-value:read',
  'asset-attribute-value:update',
  'location:read',
];
const REGISTRAR = [
  ...OPS,
  'request:read',
  'request-item:register',
  'request-item-unit:read',
  'request-item-unit:create',
  'request-item-unit:delete',
];

let admin;
let alpha;
let tkj;
let tkr;
let kajur; // KAJUR of TKJ
let a; // the assets, by shape
let u; // the units, by shape
const createdAssets = new Set();

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  tkj = await models.Department.create({ code: 'TKJ', name: 'TKJ', institutionId: alpha.id });
  tkr = await models.Department.create({ code: 'TKR', name: 'TKR', institutionId: alpha.id });

  const asset = async (name) => {
    const created = await post(
      '/assets',
      { name, classificationId: LEAF, institutionId: alpha.id },
      admin
    );
    expect(created.status).toBe(201);
    createdAssets.add(created.body.data.id);
    return created.body.data;
  };
  const unit = async (assetId, departmentId) => {
    const created = await post(
      `/assets/${assetId}/units`,
      departmentId ? { departmentId } : {},
      admin
    );
    expect(created.status).toBe(201);
    return created.body.data;
  };

  a = {
    mixed: await asset('Laptop (TKJ + TKR)'),
    tkjOnly: await asset('Router (TKJ)'),
    tkrOnly: await asset('Kunci torsi (TKR)'),
    unassigned: await asset('Meja (none)'),
    empty: await asset('Kosong (no unit)'),
  };
  u = {
    mixedTkj: await unit(a.mixed.id, tkj.id),
    mixedTkr: await unit(a.mixed.id, tkr.id),
    tkj: await unit(a.tkjOnly.id, tkj.id),
    tkr: await unit(a.tkrOnly.id, tkr.id),
    unassigned: await unit(a.unassigned.id, null),
  };

  // The registrar codes include every asset code the other tests use.
  kajur = await person(REGISTRAR, [['KAJUR', tkj]]);
});

afterAll(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetOrganizationData();
  for (const id of createdAssets) {
    fs.rmSync(path.join(storage.storageRoot(), id), { recursive: true, force: true });
  }
});

// --- helpers ----------------------------------------------------------------

const send = (method, url, body, caller) => {
  const request = api()
    [method](`${V1}${url}`)
    .set(...caller.auth);
  return body === undefined ? request : request.send(body);
};
const get = (url, caller) => send('get', url, undefined, caller);
const post = (url, body, caller) => send('post', url, body ?? {}, caller);
const patch = (url, body, caller) => send('patch', url, body, caller);
const put = (url, body, caller) => send('put', url, body, caller);
const del = (url, caller) => send('delete', url, undefined, caller);

/** A caller with `permissions`, holding each `[position, department?]`. */
async function person(permissions, positions = []) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: alpha.id,
  });
  const assignments = [];
  for (const [positionCode, department] of positions) {
    assignments.push(
      await models.PositionAssignment.create({
        institutionId: alpha.id,
        userId: caller.user.id,
        positionCode,
        departmentId: department?.id ?? null,
      })
    );
  }
  return { ...caller, assignments };
}

const ids = (rows) => rows.map((row) => row.id).sort();
const assetIds = async (caller, query = '') =>
  ids((await get(`/assets?pageSize=100${query}`, caller)).body.data);
const unitIds = async (caller, query = '') =>
  ids((await get(`/asset-units?pageSize=100${query}`, caller)).body.data);

function upload(assetId, caller, assetUnitId) {
  const pending = api()
    .post(`${V1}/assets/${assetId}/attachments`)
    .set(...caller.auth);
  if (assetUnitId) pending.field('assetUnitId', assetUnitId);
  return pending.attach('file', PNG, { filename: 'foto.png', contentType: 'image/png' });
}

// ---------------------------------------------------------------------------

describe('reading assets and units (P3)', () => {
  it('lists only the assets with a unit of their department — TKJ Kajur', async () => {
    expect(await assetIds(kajur)).toEqual(ids([a.mixed, a.tkjOnly]));
  });

  it('never widens through a supplied filter or search', async () => {
    expect(await assetIds(kajur, '&q=Kunci')).toEqual([]);
    expect(await unitIds(kajur, `&departmentId=${tkr.id}`)).toEqual([]);
  });

  it('lists only their department’s units, and of a mixed asset only theirs', async () => {
    expect(await unitIds(kajur)).toEqual(ids([u.mixedTkj, u.tkj]));
    const units = await get(`/assets/${a.mixed.id}/units`, kajur);
    expect(ids(units.body.data)).toEqual([u.mixedTkj.id]);
  });

  it('answers 404 for an asset with only another department’s units, no department, or no unit', async () => {
    for (const asset of [a.tkrOnly, a.unassigned, a.empty]) {
      expect((await get(`/assets/${asset.id}`, kajur)).status).toBe(404);
    }
    expect((await get(`/assets/${a.mixed.id}`, kajur)).status).toBe(200);
  });

  it('answers 404 for another department’s unit, and a unit with none — by id, by code, and its history', async () => {
    for (const unit of [u.tkr, u.mixedTkr, u.unassigned]) {
      expect((await get(`/asset-units/${unit.id}`, kajur)).status).toBe(404);
      expect(
        (await get(`/asset-units/by-code?code=${encodeURIComponent(unit.inventoryCode)}`, kajur))
          .status
      ).toBe(404);
      expect((await get(`/asset-units/${unit.id}/history`, kajur)).status).toBe(404);
    }
    const own = await get(
      `/asset-units/by-code?code=${encodeURIComponent(u.tkj.inventoryCode)}`,
      kajur
    );
    expect(own.status).toBe(200);
  });

  it('narrows the units at a location the same way', async () => {
    const lab = await models.Location.create({
      name: 'Lab',
      classificationId: LEAF,
      institutionId: alpha.id,
    });
    await models.AssetUnit.update(
      { currentLocationId: lab.id },
      { where: { id: [u.tkj.id, u.tkr.id, u.unassigned.id] } }
    );

    const units = await get(`/locations/${lab.id}/units`, kajur);
    expect(ids(units.body.data)).toEqual([u.tkj.id]);
  });

  it('applies to a TOOLMAN exactly as to a KAJUR', async () => {
    const toolman = await person(OPS, [['TOOLMAN', tkj]]);

    expect(await assetIds(toolman)).toEqual(ids([a.mixed, a.tkjOnly]));
    expect(await unitIds(toolman)).toEqual(ids([u.mixedTkj, u.tkj]));
    expect((await get(`/asset-units/${u.tkr.id}`, toolman)).status).toBe(404);
  });
});

describe('writing (P3)', () => {
  it('answers 404 for another department’s unit, and keeps their own units in their department', async () => {
    expect((await patch(`/asset-units/${u.tkr.id}`, { description: 'x' }, kajur)).status).toBe(404);
    expect((await post(`/asset-units/${u.tkr.id}/deactivate`, {}, kajur)).status).toBe(404);

    expect((await patch(`/asset-units/${u.tkj.id}`, { description: 'Rak 2' }, kajur)).status).toBe(
      200
    );
    for (const departmentId of [tkr.id, null]) {
      const moved = await patch(`/asset-units/${u.tkj.id}`, { departmentId }, kajur);
      expect(moved.status).toBe(400);
      expect(moved.body.error.details[0].field).toBe('departmentId');
    }
    expect((await models.AssetUnit.findByPk(u.tkj.id)).departmentId).toBe(tkj.id);
  });

  it('adds a unit to an asset they can see, in their own department only', async () => {
    expect(
      (await post(`/assets/${a.mixed.id}/units`, { departmentId: tkr.id }, kajur)).status
    ).toBe(400);
    expect((await post(`/assets/${a.mixed.id}/units`, {}, kajur)).status).toBe(400);
    expect(
      (await post(`/assets/${a.tkrOnly.id}/units`, { departmentId: tkj.id }, kajur)).status
    ).toBe(404);

    const added = await post(`/assets/${a.mixed.id}/units`, { departmentId: tkj.id }, kajur);
    expect(added.status).toBe(201);
    expect(added.body.data.department.id).toBe(tkj.id);
  });

  it('refuses a change to the whole asset while another department has units of it', async () => {
    expect((await patch(`/assets/${a.mixed.id}`, { name: 'Laptop baru' }, kajur)).status).toBe(403);
    expect((await post(`/assets/${a.mixed.id}/deactivate`, {}, kajur)).status).toBe(403);
    expect(
      (await put(`/assets/${a.mixed.id}/attribute-values`, { values: {} }, kajur)).status
    ).toBe(403);
    expect((await models.Asset.findByPk(a.mixed.id)).name).toBe('Laptop (TKJ + TKR)');

    // Reading them is fine: the asset is theirs to see.
    expect((await get(`/assets/${a.mixed.id}/attribute-values`, kajur)).status).toBe(200);
    // Every unit theirs: the whole asset is theirs to change.
    expect((await patch(`/assets/${a.tkjOnly.id}`, { name: 'Router baru' }, kajur)).status).toBe(
      200
    );
  });

  it('refuses a standalone asset — it would have no unit, and so be out of reach at once', async () => {
    const response = await post(
      '/assets',
      { name: 'Baru', classificationId: LEAF, institutionId: alpha.id },
      kajur
    );

    expect(response.status).toBe(403);
    expect(await models.Asset.count({ where: { name: 'Baru' } })).toBe(0);
  });
});

describe('what the screens are told (P3 UI)', () => {
  it('reports the caller’s own reach: narrowed departments, and no standalone asset', async () => {
    const own = await get('/assets/scope', kajur);
    expect(own.status).toBe(200);
    expect(own.body.data).toEqual({
      departmentScoped: true,
      departments: [{ id: tkj.id, code: 'TKJ', name: 'TKJ' }],
      createStandaloneAsset: false,
    });

    const staff = await person(OPS);
    expect((await get('/assets/scope', staff)).body.data).toEqual({
      departmentScoped: false,
      departments: [],
      createStandaloneAsset: true,
    });
  });

  it('flags whether a whole-asset change is open — the rule the server enforces', async () => {
    expect((await get(`/assets/${a.mixed.id}`, kajur)).body.data.scope).toEqual({
      wholeAssetChange: false,
    });
    expect((await get(`/assets/${a.tkjOnly.id}`, kajur)).body.data.scope).toEqual({
      wholeAssetChange: true,
    });
    expect((await get(`/assets/${a.mixed.id}`, admin)).body.data.scope).toEqual({
      wholeAssetChange: true,
    });
  });
});

describe('attachments (P3)', () => {
  it('shows the asset’s own files and their units’ files, never another department’s', async () => {
    const assetFile = (await upload(a.mixed.id, admin)).body.data;
    const ownFile = (await upload(a.mixed.id, admin, u.mixedTkj.id)).body.data;
    const otherFile = (await upload(a.mixed.id, admin, u.mixedTkr.id)).body.data;

    const listed = await get(`/assets/${a.mixed.id}/attachments`, kajur);
    expect(ids(listed.body.data)).toEqual(ids([assetFile, ownFile]));
    expect((await get(`/attachments/${otherFile.id}`, kajur)).status).toBe(404);
    expect((await get(`/attachments/${assetFile.id}`, kajur)).status).toBe(200);
  });

  it('files on the asset itself only when every unit is theirs; on their own units always', async () => {
    expect((await upload(a.mixed.id, kajur)).status).toBe(403);
    expect((await upload(a.mixed.id, kajur, u.mixedTkr.id)).status).toBe(404);
    expect((await upload(a.mixed.id, kajur, u.mixedTkj.id)).status).toBe(201);
    expect((await upload(a.tkjOnly.id, kajur)).status).toBe(201);

    const assetFile = (await upload(a.mixed.id, admin)).body.data;
    expect((await del(`/attachments/${assetFile.id}`, kajur)).status).toBe(403);
  });
});

describe('who is narrowed (P3 context rules)', () => {
  it('leaves Sarpras and a plain institution user with the whole institution', async () => {
    const sarpras = await person(OPS, [['WAKASEK_SARPRAS']]);
    const staff = await person(OPS);
    const all = ids(Object.values(a));

    for (const caller of [sarpras, staff]) {
      expect(await assetIds(caller)).toEqual(all);
      expect((await get(`/asset-units/${u.tkr.id}`, caller)).status).toBe(200);
    }
    expect((await patch(`/assets/${a.mixed.id}`, { name: 'Laptop X' }, sarpras)).status).toBe(200);
    expect(
      (
        await post(
          '/assets',
          { name: 'Baru', classificationId: LEAF, institutionId: alpha.id },
          sarpras
        )
      ).status
    ).toBe(201);
  });

  it('keeps a Kajur who also teaches narrowed — teaching posts are neither operator kind', async () => {
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: kajur.user.id,
      positionCode: 'JURUSAN_TEACHER',
      departmentId: tkj.id,
    });
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: kajur.user.id,
      positionCode: 'COMMON_TEACHER',
    });

    expect(await assetIds(kajur)).toEqual(ids([a.mixed, a.tkjOnly]));
  });

  it('does not narrow a Kajur who is also an institution-level asset operator on general screens', async () => {
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: kajur.user.id,
      positionCode: 'WAKASEK_SARPRAS',
    });

    expect(await assetIds(kajur)).toEqual(ids(Object.values(a)));
  });

  it('follows the current posts: ending the Kajur post widens, a new one narrows, at the next call', async () => {
    expect(await assetIds(kajur)).toEqual(ids([a.mixed, a.tkjOnly]));

    await kajur.assignments[0].update({ isCurrent: false, endedAt: new Date() });
    expect(await assetIds(kajur)).toEqual(ids(Object.values(a)));

    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: kajur.user.id,
      positionCode: 'KAJUR',
      departmentId: tkr.id,
    });
    expect(await assetIds(kajur)).toEqual(ids([a.mixed, a.tkrOnly]));
  });

  it('never narrows a system-wide caller', async () => {
    expect(await assetIds(admin)).toEqual(expect.arrayContaining(ids(Object.values(a))));
  });
});

// --- registration in a department-bound REGISTER step -------------------------

/** A JURUSAN_TEACHER request of TKJ: Kepala Sekolah decides, the Kajur registers. */
async function registrationFor() {
  const definition = await models.WorkflowDefinition.create({
    institutionId: alpha.id,
    category: 'COMMON',
    requesterPositionCode: 'JURUSAN_TEACHER',
    version: 1,
    status: 'ACTIVE',
    publishedAt: new Date(),
  });
  for (const [index, [stepType, actor]] of [
    ['DECIDE', 'KEPALA_SEKOLAH'],
    ['REGISTER', 'KAJUR'],
  ].entries()) {
    await models.WorkflowDefinitionStep.create({
      definitionId: definition.id,
      sequence: index + 1,
      stepType,
      actorPositionCode: actor,
      procurementMode: null,
      skipIfRequesterIsActor: false,
    });
  }
  const teacher = await person(
    ['request:read', 'request:create', 'request:submit', 'request-item:create'],
    [['JURUSAN_TEACHER', tkj]]
  );
  const kepala = await person(['request:read', 'request-step:decide'], [['KEPALA_SEKOLAH']]);
  const created = await post(
    '/requests',
    { requesterAssignmentId: teacher.assignments[0].id, category: 'COMMON', title: 'Switch' },
    teacher
  );
  const itemId = (
    await post(
      `/requests/${created.body.data.id}/items`,
      { description: 'Switch', quantityRequested: 4 },
      teacher
    )
  ).body.data.id;
  const submitted = (await post(`/requests/${created.body.data.id}/submit`, {}, teacher)).body.data;
  const decided = await post(
    `/request-steps/${submitted.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    kepala
  );
  expect(decided.body.data.status).toBe('APPROVED');
  return { requestId: created.body.data.id, itemId };
}

describe('registration in a department-bound REGISTER step (P3)', () => {
  const register = (itemId, body, caller) =>
    post(`/request-items/${itemId}/register`, body, caller);
  const link = (itemId, assetUnitId, caller) =>
    post(`/request-items/${itemId}/units`, { assetUnitId }, caller);

  it('registers new units into the request’s department — never another, never none', async () => {
    const { itemId } = await registrationFor();
    const newAsset = { name: 'Switch', classificationId: LEAF, unitCount: 1 };

    for (const departmentId of [tkr.id, null]) {
      const refused = await register(itemId, { ...newAsset, departmentId }, kajur);
      expect(refused.status).toBe(400);
      expect(refused.body.error.details[0].field).toBe('departmentId');
    }
    const done = await register(itemId, newAsset, kajur);
    expect(done.status).toBe(201);
    const stored = await models.AssetUnit.findAll({
      where: { id: done.body.data.units.map((unit) => unit.id) },
    });
    expect(stored.map((unit) => unit.departmentId)).toEqual([tkj.id]);
  });

  it('offers only assets with a unit of the department, and links only its units', async () => {
    const { itemId } = await registrationFor();

    expect((await register(itemId, { assetId: a.tkrOnly.id, unitCount: 1 }, kajur)).status).toBe(
      404
    );
    expect((await register(itemId, { assetId: a.mixed.id, unitCount: 1 }, kajur)).status).toBe(201);
    expect((await link(itemId, u.tkr.id, kajur)).status).toBe(404);
    expect((await link(itemId, u.unassigned.id, kajur)).status).toBe(404);
    expect((await link(itemId, u.tkj.id, kajur)).status).toBe(201);
  });

  it('decides by the step’s position even for a Kajur who is also Sarpras', async () => {
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: kajur.user.id,
      positionCode: 'WAKASEK_SARPRAS',
    });
    const { itemId } = await registrationFor();

    // General screens: institution-wide (they operate as Sarpras there) …
    expect((await get(`/asset-units/${u.tkr.id}`, kajur)).status).toBe(200);
    // … but this registration is the Kajur's, for TKJ.
    const asset = await register(itemId, { assetId: a.tkrOnly.id, unitCount: 1 }, kajur);
    expect(asset.status).toBe(400);
    expect(asset.body.error.details[0].field).toBe('assetId');
    const unit = await link(itemId, u.tkr.id, kajur);
    expect(unit.status).toBe(400);
    expect(unit.body.error.details[0].field).toBe('assetUnitId');
    const moved = await register(
      itemId,
      { name: 'X', classificationId: LEAF, unitCount: 1, departmentId: tkr.id },
      kajur
    );
    expect(moved.status).toBe(400);
  });

  it('keeps a legacy link to another department’s unit read-only, and the unit unreachable', async () => {
    const { requestId, itemId } = await registrationFor();
    const legacy = await models.RequestItemUnit.create({
      requestItemId: itemId,
      assetUnitId: u.tkr.id,
      linkedBy: admin.user.id,
    });

    const links = (await get(`/request-items/${itemId}/units`, kajur)).body.data;
    expect(links).toEqual([
      expect.objectContaining({
        id: legacy.id,
        canUnlink: false,
        assetUnit: expect.objectContaining({ id: u.tkr.id, accessible: false }),
      }),
    ]);
    expect((await del(`/request-item-units/${legacy.id}`, kajur)).status).toBe(403);
    expect(await models.RequestItemUnit.count({ where: { id: legacy.id } })).toBe(1);
    expect((await get(`/asset-units/${u.tkr.id}`, kajur)).status).toBe(404);
    // The request itself stays readable, with the link in its figures.
    const detail = (await get(`/requests/${requestId}`, kajur)).body.data;
    expect(detail.items[0].quantityRegistered).toBe(1);
    expect(detail.unitRegistration.departmentFixed).toBe(true);
  });
});
