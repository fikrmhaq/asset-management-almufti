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
const { ATTACHMENT_PURPOSES } = require('../../src/domain/attachmentPurposes.js');
const { businessDate } = require('../../src/domain/requestFulfilmentRules.js');

/**
 * Registration photos — REQ-REQUEST-020, migration 061
 * (`IMPLEMENTATION_PLAN.md` §67). The approved matrix, A – O:
 *
 *   PHOTOS      an ordinary Asset / Unit attachment with purpose
 *               REGISTRATION_PHOTO, through the existing upload endpoint: the
 *               asset's or exactly one unit's (A – E)
 *   AUTHORITY   attachment:create and the existing scope decide — Kajur / Toolman
 *               department scope included; nothing new (F – H)
 *   TARGET      only a unit linked to a request item, or an asset with one; never
 *               tied to the REGISTER step's state (D4)
 *   ISOLATION   a failed upload leaves the registration alone; receipt photos and
 *               request documents stay where they were (I – K)
 *   UNCHANGED   ordinary attachments, types, lifecycle (L, M)
 *   SCHEMA      the CHECK, existing rows NULL, the guarded rollback
 */

const V1 = '/api/v1';
const MIGRATION = '20261004010000-061-add-attachment-purpose.js';
const LEAF = '117010101001';
const PHOTO = 'REGISTRATION_PHOTO';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request:submit',
  'request:receive',
  'request-item:create',
  'request-item-unit:read',
  'request-document:read',
  'request-document:create',
];
const APPROVER = ['request:read', 'request-step:decide'];
const PROCURER = ['request:read', 'request-step:complete'];
const REGISTRAR = [
  'request:read',
  'request-item:register',
  'request-item-unit:read',
  'request-item-unit:create',
  'asset:create',
  'asset:read',
  'asset-unit:create',
  'asset-unit:read',
  'asset-unit:deactivate',
];
const ATTACH = ['attachment:create', 'attachment:read', 'attachment:delete'];

let admin;
let alpha;
let beta;
let tkj;
let tkr;
let cast;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
  tkj = await models.Department.create({ code: 'TKJ', name: 'TKJ', institutionId: alpha.id });
  tkr = await models.Department.create({ code: 'TKR', name: 'TKR', institutionId: alpha.id });
  cast = {
    teacher: await person(REQUESTER, [['COMMON_TEACHER']]),
    jurusanTeacher: await person(REQUESTER, [['JURUSAN_TEACHER', tkj]]),
    kepala: await person(APPROVER, [['KEPALA_SEKOLAH']]),
    // Sarpras acquires and registers COMMON requests; holds the attachment codes.
    sarpras: await person([...PROCURER, ...REGISTRAR, ...ATTACH], [['WAKASEK_SARPRAS']]),
    // Registers TKJ's requests — department-bound (P3).
    kajur: await person([...REGISTRAR, ...ATTACH], [['KAJUR', tkj]]),
    // Can see and decide, but holds no attachment code.
    viewer: await person([...APPROVER, 'asset:read', 'asset-unit:read']),
    // The attachment codes, in another institution.
    stranger: await person(['asset:read', 'asset-unit:read', ...ATTACH], [], beta),
  };
  await workflow('COMMON_TEACHER', 'WAKASEK_SARPRAS');
  await workflow('JURUSAN_TEACHER', 'KAJUR');
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
const get = (url, caller) => call('get', url, undefined, caller);
const post = (url, body, caller) => call('post', url, body ?? {}, caller);
const patch = (url, body, caller) => call('patch', url, body, caller);
const del = (url, caller) => call('delete', url, undefined, caller);

async function person(permissions, positions = [], institution = alpha) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: institution.id,
  });
  for (const [positionCode, department] of positions) {
    await models.PositionAssignment.create({
      institutionId: institution.id,
      userId: caller.user.id,
      positionCode,
      departmentId: department?.id ?? null,
    });
  }
  const assignment = await models.PositionAssignment.findOne({ where: { userId: caller.user.id } });
  return { ...caller, assignment };
}

/** DECIDE Kepala → PROCURE Sarpras → REGISTER `registrar`. */
async function workflow(requester, registrar) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: alpha.id,
    category: 'COMMON',
    requesterPositionCode: requester,
    version: 1,
    status: 'ACTIVE',
    publishedAt: new Date(),
  });
  const steps = [
    ['DECIDE', 'KEPALA_SEKOLAH'],
    ['PROCURE', 'WAKASEK_SARPRAS'],
    ['REGISTER', registrar],
  ];
  for (const [index, [stepType, actor]] of steps.entries()) {
    await models.WorkflowDefinitionStep.create({
      definitionId: definition.id,
      sequence: index + 1,
      stepType,
      actorPositionCode: actor,
      procurementMode: stepType === 'PROCURE' ? 'INTERNAL' : null,
      skipIfRequesterIsActor: false,
    });
  }
}

/** An APPROVED request with one item of `quantity`, REGISTER ACTIVE. */
async function approved({ requester = cast.teacher, quantity = 2 } = {}) {
  const created = await post(
    '/requests',
    { requesterAssignmentId: requester.assignment.id, category: 'COMMON', title: 'Kursi' },
    requester
  );
  expect(created.status).toBe(201);
  const item = await post(
    `/requests/${created.body.data.id}/items`,
    { description: 'Kursi lipat', quantityRequested: quantity },
    requester
  );
  expect(item.status).toBe(201);
  const submitted = await post(`/requests/${created.body.data.id}/submit`, {}, requester);
  expect(submitted.status).toBe(200);
  const decided = await post(
    `/request-steps/${submitted.body.data.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    cast.kepala
  );
  expect(decided.body.data.status).toBe('APPROVED');
  return { request: decided.body.data, itemId: item.body.data.id, requester };
}

const register = (itemId, body, caller) => post(`/request-items/${itemId}/register`, body, caller);
const newAsset = (unitCount, extra = {}) => ({
  name: 'Kursi lipat',
  classificationId: LEAF,
  unitCount,
  ...extra,
});

/** Registers `count` of the item's units under a new asset. */
async function registered({ caller = cast.sarpras, count = 2, ...options } = {}) {
  const context = await approved(options);
  const response = await register(context.itemId, newAsset(count), caller);
  expect(response.status).toBe(201);
  const units = response.body.data.units;
  return { ...context, units, assetId: units[0].assetId };
}

/** `POST /assets/:id/attachments`, multipart. */
function upload(
  assetId,
  caller,
  { unitId, purpose = PHOTO, name = 'foto.png', type = 'image/png', body = PNG } = {}
) {
  const pending = api()
    .post(`${V1}/assets/${assetId}/attachments`)
    .set(...caller.auth);
  if (unitId) pending.field('assetUnitId', unitId);
  if (purpose) pending.field('purpose', purpose);
  return pending.attach('file', body, { filename: name, contentType: type });
}

const listed = async (assetId, caller = admin) =>
  (await get(`/assets/${assetId}/attachments`, caller)).body.data;

/** A unit created directly — linked to no request item. */
async function directUnit({ assetId, departmentId = null } = {}) {
  let target = assetId;
  if (!target) {
    const asset = await post(
      '/assets',
      { name: 'Meja', classificationId: LEAF, institutionId: alpha.id },
      admin
    );
    expect(asset.status).toBe(201);
    target = asset.body.data.id;
  }
  const unit = await post(`/assets/${target}/units`, { departmentId }, admin);
  expect(unit.status).toBe(201);
  return unit.body.data;
}

// ---------------------------------------------------------------------------

describe('registration photos on the asset and its units (REQ-REQUEST-020, A – E)', () => {
  it('registers as before, then takes a photo of the asset itself (A, B)', async () => {
    const { assetId, units, itemId } = await registered();
    expect(await models.RequestItemUnit.count({ where: { requestItemId: itemId } })).toBe(2);

    const response = await upload(assetId, cast.sarpras);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      assetId,
      assetUnitId: null,
      purpose: PHOTO,
      fileType: 'image/png',
      uploadedBy: cast.sarpras.user.id,
    });
    expect(units).toHaveLength(2);
  });

  it('takes a photo of exactly one unit — never its sibling (C, D)', async () => {
    const { assetId, units } = await registered();
    const [first, second] = units;

    const response = await upload(assetId, cast.sarpras, {
      unitId: first.id,
      name: 'unit.jpg',
      type: 'image/jpeg',
      body: JPG,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ assetUnitId: first.id, purpose: PHOTO });
    const rows = await listed(assetId);
    expect(rows.filter((row) => row.assetUnitId === first.id)).toHaveLength(1);
    expect(rows.filter((row) => row.assetUnitId === second.id)).toHaveLength(0);
    expect(await models.Attachment.count()).toBe(1);
  });

  it('keeps an asset’s photo on that asset only (E)', async () => {
    const one = await registered();
    const two = await registered();

    await upload(one.assetId, cast.sarpras);

    expect(await listed(one.assetId)).toHaveLength(1);
    expect(await listed(two.assetId)).toHaveLength(0);
  });

  it('takes a photo of a unit registered under an existing asset, and of a linked existing unit', async () => {
    const { assetId, itemId } = await registered({ count: 1, quantity: 3 });
    const more = await register(itemId, { assetId, unitCount: 1 }, cast.sarpras);
    expect(more.status).toBe(201);
    const existing = await directUnit({ assetId });
    expect(
      (await post(`/request-items/${itemId}/units`, { assetUnitId: existing.id }, cast.sarpras))
        .status
    ).toBe(201);

    expect(
      (await upload(assetId, cast.sarpras, { unitId: more.body.data.units[0].id })).status
    ).toBe(201);
    expect((await upload(assetId, cast.sarpras, { unitId: existing.id })).status).toBe(201);
  });

  it('still takes photos once the last unit closed REGISTER (D4)', async () => {
    const { assetId, units, request } = await registered({ count: 2, quantity: 2 });
    const [step] = await query(
      `SELECT state FROM public.request_steps WHERE request_id = $1 AND step_type = 'REGISTER'`,
      [request.id]
    );
    expect(step.state).toBe('DONE');

    expect((await upload(assetId, cast.sarpras, { unitId: units[1].id })).status).toBe(201);
    expect((await upload(assetId, cast.sarpras)).status).toBe(201);
  });

  it('records the photo in the attachment audit, with its purpose and the actor', async () => {
    const { assetId, units } = await registered();
    const { id } = (await upload(assetId, cast.sarpras, { unitId: units[0].id })).body.data;

    const [entry] = await models.AuditLog.findAll({
      where: { entityType: 'Attachment', entityId: id },
    });
    expect(entry).toMatchObject({ action: 'CREATE', actorId: cast.sarpras.user.id });
    expect(entry.newValues).toMatchObject({ purpose: PHOTO, assetUnitId: units[0].id });
  });
});

describe('authority — the existing attachment rules decide (F – H)', () => {
  it('refuses a caller without attachment:create, and another institution', async () => {
    const { assetId, units } = await registered();
    const plainRegistrar = await person(REGISTRAR);

    expect((await upload(assetId, cast.viewer, { unitId: units[0].id })).status).toBe(403);
    expect((await upload(assetId, plainRegistrar)).status).toBe(403);
    expect((await upload(assetId, cast.stranger, { unitId: units[0].id })).status).toBe(404);
    expect(await models.Attachment.count()).toBe(0);
  });

  it('holds a Kajur registrar to their department (G)', async () => {
    // TKJ's request, registered by the Kajur: a new asset whose units are all TKJ.
    const own = await registered({ caller: cast.kajur, requester: cast.jurusanTeacher });
    expect(own.units.every((unit) => unit.departmentId === tkj.id)).toBe(true);
    expect((await upload(own.assetId, cast.kajur, { unitId: own.units[0].id })).status).toBe(201);
    expect((await upload(own.assetId, cast.kajur)).status).toBe(201);

    // The same asset gains a TKR unit — linked to a COMMON request by Sarpras.
    const common = await approved({ quantity: 1 });
    const tkrUnit = await directUnit({ assetId: own.assetId, departmentId: tkr.id });
    expect(
      (
        await post(
          `/request-items/${common.itemId}/units`,
          { assetUnitId: tkrUnit.id },
          cast.sarpras
        )
      ).status
    ).toBe(201);

    // A registered TKR unit is out of reach; the now-shared asset is no longer theirs to photograph.
    expect((await upload(own.assetId, cast.kajur, { unitId: tkrUnit.id })).status).toBe(404);
    expect((await upload(own.assetId, cast.kajur)).status).toBe(403);
    expect((await upload(own.assetId, cast.kajur, { unitId: own.units[1].id })).status).toBe(201);
    // Sarpras is not narrowed.
    expect((await upload(own.assetId, cast.sarpras, { unitId: tkrUnit.id })).status).toBe(201);
  });

  it('leaves ordinary attachment authorization as it was (H)', async () => {
    const own = await registered({ caller: cast.kajur, requester: cast.jurusanTeacher });
    const tkrUnit = await directUnit({ assetId: own.assetId, departmentId: tkr.id });
    const ordinary = { purpose: null, name: 'nota.pdf', type: 'application/pdf', body: PDF };

    expect((await upload(own.assetId, cast.kajur, ordinary)).status).toBe(403);
    expect(
      (await upload(own.assetId, cast.kajur, { ...ordinary, unitId: tkrUnit.id })).status
    ).toBe(404);
    expect(
      (await upload(own.assetId, cast.kajur, { ...ordinary, unitId: own.units[0].id })).status
    ).toBe(201);
    expect((await upload(own.assetId, cast.viewer, ordinary)).status).toBe(403);
  });
});

describe('the target must be registered against a request item', () => {
  it('refuses a unit linked to no request item, and an asset with no such unit', async () => {
    const unit = await directUnit();

    const onUnit = await upload(unit.assetId, cast.sarpras, { unitId: unit.id });
    const onAsset = await upload(unit.assetId, cast.sarpras);

    for (const response of [onUnit, onAsset]) {
      expect(response.status).toBe(400);
      expect(response.body.error.details).toEqual([expect.objectContaining({ field: 'purpose' })]);
    }
    expect(await models.Attachment.count()).toBe(0);
    // The same targets still take an ordinary file.
    expect(
      (await upload(unit.assetId, cast.sarpras, { unitId: unit.id, purpose: null })).status
    ).toBe(201);
  });

  it('refuses an unlinked unit of an asset that does have a registered unit', async () => {
    const { assetId } = await registered();
    const loose = await directUnit({ assetId });

    expect((await upload(assetId, cast.sarpras, { unitId: loose.id })).status).toBe(400);
    expect((await upload(assetId, cast.sarpras)).status).toBe(201);
  });

  it('refuses an unknown purpose', async () => {
    const { assetId } = await registered();
    const response = await upload(assetId, cast.sarpras, { purpose: 'RECEIPT_PHOTO' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('body.purpose');
  });
});

describe('isolation (I – K)', () => {
  it('leaves a successful registration untouched when a photo is refused (I)', async () => {
    const { assetId, units, itemId, request } = await registered({ count: 1, quantity: 2 });
    const before = {
      links: await models.RequestItemUnit.count({ where: { requestItemId: itemId } }),
      units: await models.AssetUnit.count({ where: { assetId } }),
    };

    for (const options of [
      { unitId: units[0].id, name: 'nota.pdf', type: 'application/pdf', body: PDF },
      { unitId: units[0].id, name: 'x.exe', type: 'application/x-msdownload', body: PDF },
    ]) {
      expect((await upload(assetId, cast.sarpras, options)).status).toBe(400);
    }

    expect({
      links: await models.RequestItemUnit.count({ where: { requestItemId: itemId } }),
      units: await models.AssetUnit.count({ where: { assetId } }),
    }).toEqual(before);
    expect(await models.Attachment.count()).toBe(0);
    const [step] = await query(
      `SELECT state FROM public.request_steps WHERE request_id = $1 AND step_type = 'REGISTER'`,
      [request.id]
    );
    expect(step.state).toBe('ACTIVE');
    // Registration carries on.
    expect((await register(itemId, newAsset(1), cast.sarpras)).status).toBe(201);
  });

  it('keeps receipt photos in request documents, and registration photos out of them (J)', async () => {
    const { request, units, assetId, requester } = await registered({ count: 1, quantity: 1 });
    await upload(assetId, cast.sarpras, { unitId: units[0].id });

    const received = api()
      .post(`${V1}/requests/${request.id}/receive`)
      .set(...requester.auth)
      .field('receivedOn', businessDate())
      .field('description', 'Sudah diterima')
      .field('all', 'true')
      .attach('photos', PNG, { filename: 'terima.png', contentType: 'image/png' });
    expect((await received).status).toBe(200);

    expect(
      await models.RequestDocument.count({ where: { documentType: 'CONFIRMATION_PHOTO' } })
    ).toBe(1);
    expect(await models.Attachment.count()).toBe(1);
    expect((await models.Attachment.findOne()).purpose).toBe(PHOTO);
  });

  it('keeps request documents apart from the asset’s attachments (K)', async () => {
    const { request, assetId, requester } = await registered();
    const document = await api()
      .post(`${V1}/requests/${request.id}/documents`)
      .set(...requester.auth)
      .field('documentType', 'SUPPORTING')
      .attach('file', PDF, { filename: 'lampiran.pdf', contentType: 'application/pdf' });
    expect(document.status).toBe(201);
    await upload(assetId, cast.sarpras);

    expect(await models.RequestDocument.count()).toBe(1);
    expect((await listed(assetId)).map((row) => row.purpose)).toEqual([PHOTO]);
  });
});

describe('ordinary attachments and the lifecycle (L, M)', () => {
  it('still takes PDF, DOCX and XLSX without a purpose, on the asset and on a unit (L)', async () => {
    const { assetId, units } = await registered();
    const files = [
      ['nota.pdf', 'application/pdf'],
      ['spek.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['daftar.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ];

    for (const [name, type] of files) {
      const onAsset = await upload(assetId, cast.sarpras, { purpose: null, name, type, body: PDF });
      const onUnit = await upload(assetId, cast.sarpras, {
        purpose: null,
        unitId: units[0].id,
        name,
        type,
        body: PDF,
      });
      expect([onAsset.status, onUnit.status]).toEqual([201, 201]);
      expect(onAsset.body.data.purpose).toBeNull();
    }
    expect(await listed(assetId)).toHaveLength(6);
  });

  it('keeps a registration photo through deactivation, and deletes it like any file (L)', async () => {
    const { assetId, units } = await registered();
    const photo = (await upload(assetId, cast.sarpras, { unitId: units[0].id })).body.data;

    const deactivated = await post(`/asset-units/${units[0].id}/deactivate`, {}, cast.sarpras);
    expect(deactivated.status).toBe(200);
    expect((await get(`/attachments/${photo.id}`, cast.sarpras)).body.data).toMatchObject({
      id: photo.id,
      purpose: PHOTO,
    });

    expect((await del(`/attachments/${photo.id}`, cast.sarpras)).status).toBe(204);
    expect(await models.Attachment.count()).toBe(0);
    const actions = (
      await models.AuditLog.findAll({
        where: { entityType: 'Attachment', entityId: photo.id },
        order: [['timestamp', 'ASC']],
      })
    ).map((entry) => entry.action);
    expect(actions).toEqual(['CREATE', 'DELETE']);
  });

  it('accepts JPG and PNG only — by type AND by extension (M)', async () => {
    const { assetId, units } = await registered();
    const unitId = units[0].id;
    const refused = [
      { name: 'nota.pdf', type: 'application/pdf', body: PDF },
      {
        name: 'spek.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      { name: 'foto.png', type: 'application/pdf', body: PDF },
      { name: 'foto.pdf', type: 'image/png' },
      { name: 'foto.gif', type: 'image/gif' },
    ];

    for (const options of refused) {
      const response = await upload(assetId, cast.sarpras, { unitId, ...options });
      expect(response.status, options.name).toBe(400);
      expect(response.body.error.details[0]).toMatchObject({
        field: 'file',
        issue: 'must be one of: image/jpeg, image/png',
      });
    }
    expect(
      (
        await upload(assetId, cast.sarpras, {
          unitId,
          name: 'a.jpeg',
          type: 'image/jpeg',
          body: JPG,
        })
      ).status
    ).toBe(201);
  });

  it('applies the existing size limit (M)', async () => {
    const { assetId, units } = await registered();
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0);

    const response = await upload(assetId, cast.sarpras, { unitId: units[0].id, body: big });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/at most 10 MB/);
  });
});

describe('the schema (migration 061)', () => {
  it('holds the purposes to the JavaScript constant, and a registration photo to JPG / PNG', async () => {
    const [row] = await query(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname = 'chk_attachments_purpose'`
    );
    expect([...row.definition.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort()).toEqual(
      [...ATTACHMENT_PURPOSES].sort()
    );

    const { assetId } = await registered();
    const insert = (purpose, fileType) =>
      query(
        `INSERT INTO public.attachments (asset_id, file_name, file_type, file_size,
           storage_reference, uploaded_by, purpose)
         VALUES ($1, 'f', $2, 1, 'x/y', $3, $4)`,
        [assetId, fileType, admin.user.id, purpose]
      );
    await expect(insert('RECEIPT_PHOTO', 'image/png')).rejects.toThrow(/chk_attachments_purpose/);
    await expect(insert(PHOTO, 'application/pdf')).rejects.toThrow(/chk_attachments_purpose/);
    await expect(insert(null, 'application/pdf')).resolves.toBeDefined();
    await expect(insert(PHOTO, 'image/jpeg')).resolves.toBeDefined();
  });

  it('leaves existing attachments NULL, and refuses to roll back while a photo exists', async () => {
    const CYCLE = cycleDatabaseUrl();
    await migrate(CYCLE);
    await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);

    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('P', 'PHT', 'x') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-photos', $1, 'Cycle', 'Photos', $2) RETURNING id`,
      [`$2b$10$${'0'.repeat(53)}`, institution.id],
      CYCLE
    );
    // The cycle database is migrated but not seeded: a throwaway classification.
    await query(
      `INSERT INTO ref.asset_classifications (id, name) VALUES ('999999999061', 'Cycle 061')`,
      [],
      CYCLE
    );
    const [asset] = await query(
      `INSERT INTO public.assets (name, classification_id, institution_id)
       VALUES ('Meja', '999999999061', $1) RETURNING id`,
      [institution.id],
      CYCLE
    );
    const [file] = await query(
      `INSERT INTO public.attachments (asset_id, file_name, file_type, file_size,
         storage_reference, uploaded_by)
       VALUES ($1, 'f.png', 'image/png', 1, 'x/y', $2) RETURNING id`,
      [asset.id, user.id],
      CYCLE
    );

    try {
      await migrate(CYCLE);
      const [existing] = await query(
        'SELECT purpose FROM public.attachments WHERE id = $1',
        [file.id],
        CYCLE
      );
      expect(existing.purpose).toBeNull();

      await query(
        `UPDATE public.attachments SET purpose = $1 WHERE id = $2`,
        [PHOTO, file.id],
        CYCLE
      );
      await expect(runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE)).rejects.toThrow(
        /Migration 061 rollback refused/
      );

      await query('UPDATE public.attachments SET purpose = NULL', [], CYCLE);
      await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);
      const [gone] = await query(
        `SELECT count(*)::int AS columns FROM information_schema.columns
          WHERE table_name = 'attachments' AND column_name = 'purpose'`,
        [],
        CYCLE
      );
      expect(gone.columns).toBe(0);
    } finally {
      await migrate(CYCLE);
      await query('DELETE FROM public.attachments WHERE id = $1', [file.id], CYCLE);
      await query('DELETE FROM public.assets WHERE id = $1', [asset.id], CYCLE);
      await query(`DELETE FROM ref.asset_classifications WHERE id = '999999999061'`, [], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }
  });
});

describe('nothing else moves', () => {
  it('ties no photo to the request item, and leaves the request as registered', async () => {
    const { assetId, units, request } = await registered();
    await upload(assetId, cast.sarpras, { unitId: units[0].id });
    await upload(assetId, cast.sarpras);

    const after = (await get(`/requests/${request.id}`, cast.sarpras)).body.data;
    expect(after.items[0].quantityRegistered).toBe(2);
    expect(JSON.stringify(after)).not.toContain(PHOTO);
    const columns = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('request_items', 'request_item_units') AND column_name LIKE '%photo%'`
    );
    expect(columns).toEqual([]);
    // The unit detail is unchanged by a photo.
    expect(
      (await patch(`/asset-units/${units[0].id}`, { description: 'Kursi A' }, admin)).status
    ).toBe(200);
  });
});
