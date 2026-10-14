import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import {
  api,
  models,
  createCaller,
  resetAssetCoreData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { cycleDatabaseUrl, migrate, query, runCli, seed } from './helpers/db.js';

const require = createRequire(import.meta.url);
const { businessDate } = require('../../src/domain/requestFulfilmentRules.js');
const storage = require('../../src/services/storage.js');

/**
 * Receipt photos per received unit — REQ-REQUEST-022, migration 062
 * (`IMPLEMENTATION_PLAN.md` §69). A confirmation photo (057) may name ONE unit
 * received in the same Record Receipt; the server links it to that unit's new
 * receipt. Never a registration photo, never an attachment.
 *
 *   ASSOCIATION  each unit photo on its own unit's new receipt; general photos
 *                none; one confirmation for all; siblings isolated
 *   VALIDATION   1–5 in total; JPG / PNG; 10 MB; a unit photo only for a unit
 *                received HERE (named units and `all` alike) — otherwise the
 *                whole call is refused, nothing written, no file left
 *   AUTHORITY    the requester with request:receive, as before
 *   LIFECYCLE    reversal keeps the photos where they were; a new receipt gets a
 *                new confirmation and its own photos; Phase 41 receipts untouched
 *   SCHEMA       the composite key, the CHECK, existing rows NULL, the rollback
 */

const V1 = '/api/v1';
const LEAF = '117010101001';
const MIGRATION = '20261005010000-062-add-receipt-unit-photos.js';

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
  'request-document:delete',
];
const APPROVER = ['request:read', 'request-step:decide'];
const REGISTRAR = [
  'request:read',
  'request-item:register',
  'request-item-unit:read',
  'request-item-unit:create',
  'asset:create',
  'asset:read',
  'asset-unit:create',
  'asset-unit:read',
  'request-document:read',
  'request-document:create',
];
const OVERSEER = [
  'request:read',
  'request:oversee',
  'request-receipt:reverse',
  'request-item-unit:read',
  'request-document:read',
];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const photo = (name = 'bukti.png', mime = 'image/png', body = PNG) => ({ name, mime, body });

let alpha;
let beta;
const createdRequests = new Set();
// One ACTIVE process per (institution, category, requester position).
const withWorkflow = new Set();
// The Kepala and the Sarpras of each institution — one current holder each.
let castOf = {};

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
  withWorkflow.clear();
  castOf = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  // The storage directory is shared with the development API.
  for (const id of createdRequests) fs.rmSync(shardOf(id), { recursive: true, force: true });
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
const del = (url, caller) => call('delete', url, undefined, caller);

const shardOf = (requestId) => path.join(storage.storageRoot(), 'requests', requestId);
const filesOf = (requestId) =>
  fs.existsSync(shardOf(requestId)) ? fs.readdirSync(shardOf(requestId)) : [];

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

async function workflow(institution = alpha) {
  if (withWorkflow.has(institution.id)) return;
  withWorkflow.add(institution.id);
  const definition = await models.WorkflowDefinition.create({
    institutionId: institution.id,
    category: 'COMMON',
    requesterPositionCode: 'COMMON_TEACHER',
    version: 1,
    status: 'ACTIVE',
    publishedAt: new Date(),
  });
  for (const [index, [stepType, actor]] of [
    ['DECIDE', 'KEPALA_SEKOLAH'],
    ['REGISTER', 'WAKASEK_SARPRAS'],
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
}

/** An APPROVED request, `count` units registered against one item of `quantity`. */
async function registeredRequest({ quantity = 3, count = 3, institution = alpha } = {}) {
  await workflow(institution);
  const teacher = await person(REQUESTER, [['COMMON_TEACHER']], institution);
  const cast = (castOf[institution.id] ??= {
    kepala: await person(APPROVER, [['KEPALA_SEKOLAH']], institution),
    sarpras: await person(REGISTRAR, [['WAKASEK_SARPRAS']], institution),
  });
  const { kepala, sarpras } = cast;

  const created = await post(
    '/requests',
    { requesterAssignmentId: teacher.assignment.id, category: 'COMMON', title: 'Laptop' },
    teacher
  );
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  createdRequests.add(id);
  await post(
    `/requests/${id}/items`,
    { description: 'Laptop', quantityRequested: quantity },
    teacher
  );
  const submitted = (await post(`/requests/${id}/submit`, {}, teacher)).body.data;
  const decided = await post(
    `/request-steps/${submitted.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    kepala
  );
  expect(decided.body.data.status).toBe('APPROVED');
  const itemId = decided.body.data.items[0].id;
  const registered = await post(
    `/request-items/${itemId}/register`,
    { name: 'Laptop', classificationId: LEAF, unitCount: count },
    sarpras
  );
  expect(registered.status).toBe(201);
  const units = registered.body.data.units.map((unit) => unit.id);
  return { id, itemId, units, teacher, sarpras };
}

/**
 * `POST /requests/:id/receive`, multipart: `general` photos under `photos`;
 * `unit` photos under `unitPhotos`, each naming its unit in `unitPhotoUnitIds`.
 */
function receive(requestId, fields, caller, { general = [photo()], unit = [] } = {}) {
  const pending = api()
    .post(`${V1}/requests/${requestId}/receive`)
    .set(...caller.auth);
  const all = { receivedOn: businessDate(), description: 'Sudah diterima', ...fields };
  for (const [key, value] of Object.entries(all)) {
    if (value === undefined) continue;
    for (const entry of [value].flat()) pending.field(key, String(entry));
  }
  for (const entry of unit) pending.field('unitPhotoUnitIds', entry.unitId);
  for (const { name, mime, body } of general) {
    pending.attach('photos', body, { filename: name, contentType: mime });
  }
  for (const { name, mime, body } of unit) {
    pending.attach('unitPhotos', body, { filename: name, contentType: mime });
  }
  return pending;
}
const unitPhoto = (unitId, name = `unit-${unitId.slice(0, 4)}.png`, mime, body) => ({
  unitId,
  ...photo(name, mime, body),
});

const counts = async () => ({
  confirmations: await models.RequestReceiptConfirmation.count(),
  receipts: await models.RequestItemUnitReceipt.count(),
  photos: await models.RequestDocument.count({ where: { documentType: 'CONFIRMATION_PHOTO' } }),
});
const photoRows = () =>
  models.RequestDocument.findAll({
    where: { documentType: 'CONFIRMATION_PHOTO' },
    order: [['fileName', 'ASC']],
  });
const receiptOf = async (unitId) =>
  models.RequestItemUnitReceipt.findOne({
    include: [{ association: 'link', where: { assetUnitId: unitId }, required: true }],
    order: [['recordedAt', 'DESC']],
  });

// ---------------------------------------------------------------------------

describe('each unit photo on its own unit’s new receipt (REQ-REQUEST-022)', () => {
  it('links two photos to unit A, one to unit B, and none from the general photo', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 2, count: 2 });
    const [a, b] = units;

    const response = await receive(id, { assetUnitIds: [a, b] }, teacher, {
      general: [photo('umum.png')],
      unit: [
        unitPhoto(a, 'a1.png'),
        unitPhoto(a, 'a2.jpg', 'image/jpeg', JPG),
        unitPhoto(b, 'b1.png'),
      ],
    });

    expect(response.status).toBe(200);
    const receiptA = await receiptOf(a);
    const receiptB = await receiptOf(b);
    const rows = await photoRows();
    expect(rows.map((row) => [row.fileName, row.requestItemUnitReceiptId])).toEqual([
      ['a1.png', receiptA.id],
      ['a2.jpg', receiptA.id],
      ['b1.png', receiptB.id],
      ['umum.png', null],
    ]);
    // One confirmation for everything.
    expect(new Set(rows.map((row) => row.receiptConfirmationId)).size).toBe(1);
    expect(receiptA.receiptConfirmationId).toBe(rows[0].receiptConfirmationId);
    expect(receiptB.receiptConfirmationId).toBe(rows[0].receiptConfirmationId);

    const [confirmation] = response.body.data.receiptConfirmations;
    const grouped = Object.fromEntries(
      confirmation.photos.map((p) => [p.fileName, [p.assetUnitId, p.receiptId]])
    );
    expect(grouped).toEqual({
      'umum.png': [null, null],
      'a1.png': [a, receiptA.id],
      'a2.jpg': [a, receiptA.id],
      'b1.png': [b, receiptB.id],
    });
    expect(confirmation.photos.find((p) => p.fileName === 'b1.png').inventoryCode).toEqual(
      expect.any(String)
    );
  });

  it('accepts unit photos alone — no general photo needed — and with `all`', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 3, count: 3 });

    const response = await receive(id, { all: true }, teacher, {
      general: [],
      unit: [unitPhoto(units[2], 'c.png')],
    });

    expect(response.status).toBe(200);
    const [row] = await photoRows();
    expect(row.requestItemUnitReceiptId).toBe((await receiptOf(units[2])).id);
    expect(await models.RequestItemUnitReceipt.count()).toBe(3);
  });

  it('keeps the existing general-only receipt exactly as it was', async () => {
    const { id, teacher } = await registeredRequest({ quantity: 1, count: 1 });

    const response = await receive(id, { all: true }, teacher);

    expect(response.status).toBe(200);
    const [row] = await photoRows();
    expect(row.requestItemUnitReceiptId).toBeNull();
    expect(response.body.data.receiptConfirmations[0].photos[0]).toMatchObject({
      assetUnitId: null,
      receiptId: null,
    });
  });

  it('audits a unit photo as a RequestDocument CREATE with its receipt link and actor', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 1, count: 1 });
    await receive(id, { all: true }, teacher, { general: [], unit: [unitPhoto(units[0])] });

    const [row] = await photoRows();
    const [entry] = await models.AuditLog.findAll({
      where: { entityType: 'RequestDocument', entityId: row.id },
    });
    expect(entry).toMatchObject({ action: 'CREATE', actorId: teacher.user.id });
    expect(entry.newValues).toMatchObject({
      documentType: 'CONFIRMATION_PHOTO',
      receiptConfirmationId: row.receiptConfirmationId,
      requestItemUnitReceiptId: (await receiptOf(units[0])).id,
    });
  });
});

describe('a unit photo only for a unit received here — else nothing is written', () => {
  const expectNothing = async (requestId) => {
    expect(await counts()).toEqual({ confirmations: 0, receipts: 0, photos: 0 });
    expect(filesOf(requestId)).toEqual([]);
  };

  it('refuses a unit not named in this receipt, and another request’s unit', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 2, count: 2 });
    const other = await registeredRequest({ quantity: 1, count: 1 });

    for (const target of [units[1], other.units[0]]) {
      const response = await receive(id, { assetUnitIds: [units[0]] }, teacher, {
        unit: [unitPhoto(target)],
      });
      expect(response.status).toBe(400);
      expect(response.body.error.details[0]).toMatchObject({ field: 'unitPhotoUnitIds' });
    }
    await expectNothing(id);
  });

  it('refuses, with `all`, a unit not pending here — received, unreceivable, another request’s', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 3, count: 3 });
    const other = await registeredRequest({ quantity: 1, count: 1 });
    expect((await receive(id, { assetUnitIds: [units[0]] }, teacher)).status).toBe(200);
    await models.AssetUnit.update({ isActive: false }, { where: { id: units[1] } });
    const before = await counts();
    const filesBefore = filesOf(id).length;

    for (const target of [units[0], units[1], other.units[0]]) {
      const response = await receive(id, { all: true }, teacher, {
        general: [],
        unit: [unitPhoto(target)],
      });
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('unitPhotoUnitIds');
    }
    expect(await counts()).toEqual(before);
    expect(filesOf(id)).toHaveLength(filesBefore);
  });

  it('refuses a named unit that is already received or disposed, as before', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 3, count: 3 });
    await receive(id, { assetUnitIds: [units[0]] }, teacher);
    await models.AssetUnit.update({ lifecycleState: 'DISPOSED' }, { where: { id: units[1] } });
    const before = await counts();
    const filesBefore = filesOf(id).length;

    for (const target of [units[0], units[1]]) {
      const response = await receive(id, { assetUnitIds: [target] }, teacher, {
        general: [],
        unit: [unitPhoto(target)],
      });
      expect(response.status).toBe(409);
    }
    expect(await counts()).toEqual(before);
    expect(filesOf(id)).toHaveLength(filesBefore);
  });

  it('refuses a unit named by anything but a UUID', async () => {
    const { id, teacher } = await registeredRequest({ quantity: 1, count: 1 });
    const response = await receive(id, { all: true }, teacher, {
      general: [],
      unit: [unitPhoto('not-a-unit-id-at-all')],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toMatch(/unitPhotoUnitIds/);
    await expectNothing(id);
  });

  it('is all or nothing once written: a failed unit photo row undoes receipts and files', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 2, count: 2 });
    const create = models.RequestDocument.create.bind(models.RequestDocument);
    // The confirmation, both receipts and the general photo row are already in
    // the transaction when the unit photo's row fails.
    vi.spyOn(models.RequestDocument, 'create').mockImplementation((values, options) =>
      values.requestItemUnitReceiptId
        ? Promise.reject(new Error('insert failed'))
        : create(values, options)
    );

    const response = await receive(id, { all: true }, teacher, {
      general: [photo('umum.png')],
      unit: [unitPhoto(units[1])],
    });

    expect(response.status).toBe(500);
    expect(models.RequestDocument.create).toHaveBeenCalledTimes(2);
    await expectNothing(id);
  });

  it('refuses unit photos and named units that do not pair up', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 1, count: 1 });
    const response = await api()
      .post(`${V1}/requests/${id}/receive`)
      .set(...teacher.auth)
      .field('receivedOn', businessDate())
      .field('description', 'x')
      .field('all', 'true')
      .field('unitPhotoUnitIds', units[0])
      .field('unitPhotoUnitIds', units[0])
      .attach('unitPhotos', PNG, { filename: 'a.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('unitPhotoUnitIds');
    await expectNothing(id);
  });

  it('holds 1–5 photos in TOTAL, general and unit together', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 2, count: 2 });
    const [a, b] = units;

    const none = await receive(id, { all: true }, teacher, { general: [] });
    const six = await receive(id, { all: true }, teacher, {
      general: [photo('g1.png'), photo('g2.png')],
      unit: [
        unitPhoto(a, 'a1.png'),
        unitPhoto(a, 'a2.png'),
        unitPhoto(b, 'b1.png'),
        unitPhoto(b, 'b2.png'),
      ],
    });
    for (const response of [none, six]) {
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('photos');
    }
    await expectNothing(id);

    const five = await receive(id, { all: true }, teacher, {
      general: [photo('g1.png')],
      unit: [
        unitPhoto(a, 'a1.png'),
        unitPhoto(a, 'a2.png'),
        unitPhoto(b, 'b1.png'),
        unitPhoto(b, 'b2.png'),
      ],
    });
    expect(five.status).toBe(200);
    expect(
      await models.RequestDocument.count({ where: { documentType: 'CONFIRMATION_PHOTO' } })
    ).toBe(5);
  });

  it('accepts JPG and PNG only, by type and extension, within 10 MB — for unit photos too', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 1, count: 1 });
    const unit = units[0];
    const refused = [
      unitPhoto(unit, 'scan.pdf', 'application/pdf', PDF),
      unitPhoto(unit, 'scan.pdf', 'image/png'),
      unitPhoto(unit, 'foto.png', 'application/pdf', PDF),
      unitPhoto(unit, 'foto.gif', 'image/gif'),
    ];

    for (const entry of refused) {
      const response = await receive(id, { all: true }, teacher, { general: [], unit: [entry] });
      expect(response.status, entry.name).toBe(400);
      expect(response.body.error.details[0].field).toBe('unitPhotos');
    }
    const big = await receive(id, { all: true }, teacher, {
      general: [],
      unit: [unitPhoto(unit, 'big.png', 'image/png', Buffer.alloc(10 * 1024 * 1024 + 1, 0))],
    });
    expect(big.status).toBe(400);
    expect(big.body.error.details[0].issue).toMatch(/at most 10 MB/);
    await expectNothing(id);
  });
});

describe('authority — the existing receive rules', () => {
  it('lets only the requester receive; Sarpras, Kajur and oversight do not substitute', async () => {
    const { id, units, sarpras } = await registeredRequest({ quantity: 1, count: 1 });
    const tkj = await models.Department.create({
      code: 'TKJ',
      name: 'TKJ',
      institutionId: alpha.id,
    });
    const kajur = await person(REGISTRAR, [['KAJUR', tkj]]);
    const overseer = await person([...OVERSEER, 'request:receive']);
    // Sarpras's codes plus request:receive — still not the requester.
    const sarprasWithCode = await person([...REGISTRAR, 'request:receive']);
    const stranger = await person(REQUESTER, [['COMMON_TEACHER']], beta);

    const options = { general: [], unit: [unitPhoto(units[0])] };
    expect((await receive(id, { all: true }, sarpras, options)).status).toBe(403);
    expect((await receive(id, { all: true }, kajur, options)).status).toBe(403);
    // Not involved in the request, so it is invisible to them: 404, as everywhere.
    expect((await receive(id, { all: true }, sarprasWithCode, options)).status).toBe(404);
    expect((await receive(id, { all: true }, overseer, options)).status).toBe(403);
    expect((await receive(id, { all: true }, stranger, options)).status).toBe(404);
    expect(await counts()).toEqual({ confirmations: 0, receipts: 0, photos: 0 });
  });
});

describe('the lifecycle', () => {
  it('keeps photos on their reversed receipts, and gives a new receipt its own', async () => {
    // Three required, two registered: the request stays open for reversal.
    const { id, units, teacher } = await registeredRequest({ quantity: 3, count: 2 });
    const [a, b] = units;
    const overseer = await person(OVERSEER);
    await receive(id, { assetUnitIds: [a, b] }, teacher, {
      general: [photo('umum-1.png')],
      unit: [unitPhoto(a, 'a-1.png'), unitPhoto(b, 'b-1.png')],
    });
    const firstA = await receiptOf(a);
    const firstB = await receiptOf(b);

    for (const receipt of [firstA, firstB]) {
      const reversed = await post(
        `/request-receipts/${receipt.id}/reverse`,
        { reason: 'Salah unit' },
        overseer
      );
      expect(reversed.status).toBe(200);
    }
    const afterReversal = (await get(`/requests/${id}`, teacher)).body.data.receiptConfirmations;
    expect(afterReversal[0].state).toBe('SUPERSEDED');
    expect(afterReversal[0].photos.map((p) => [p.fileName, p.receiptId]).sort()).toEqual(
      [
        ['a-1.png', firstA.id],
        ['b-1.png', firstB.id],
        ['umum-1.png', null],
      ].sort()
    );

    const again = await receive(id, { assetUnitIds: [a] }, teacher, {
      general: [],
      unit: [unitPhoto(a, 'a-2.png')],
    });
    expect(again.status).toBe(200);
    const secondA = await receiptOf(a);
    expect(secondA.id).not.toBe(firstA.id);
    const [first, second] = again.body.data.receiptConfirmations;
    expect(first.photos.map((p) => p.fileName).sort()).toEqual([
      'a-1.png',
      'b-1.png',
      'umum-1.png',
    ]);
    expect(second.photos.map((p) => [p.fileName, p.receiptId])).toEqual([['a-2.png', secondA.id]]);
    // The old photo never moved.
    const old = await models.RequestDocument.findOne({ where: { fileName: 'a-1.png' } });
    expect(old.requestItemUnitReceiptId).toBe(firstA.id);
    expect(old.receiptConfirmationId).toBe(first.id);
  });

  it('keeps photos undeletable, unlisted among documents, and readable by id', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 1, count: 1 });
    await receive(id, { all: true }, teacher, { general: [], unit: [unitPhoto(units[0])] });
    const [row] = await photoRows();

    expect((await del(`/request-documents/${row.id}`, teacher)).status).toBe(409);
    expect((await get(`/requests/${id}/documents`, teacher)).body.data).toEqual([]);
    expect((await get(`/request-documents/${row.id}`, teacher)).status).toBe(200);
  });

  it('leaves a Phase 41 receipt without a confirmation alone', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 2, count: 2 });
    const link = await models.RequestItemUnit.findOne({ where: { assetUnitId: units[0] } });
    await models.RequestItemUnitReceipt.create({
      requestItemUnitId: link.id,
      receivedOn: businessDate(),
      recordedBy: teacher.user.id,
      note: 'Phase 41',
    });

    const response = await receive(id, { assetUnitIds: [units[1]] }, teacher, {
      general: [],
      unit: [unitPhoto(units[1])],
    });

    expect(response.status).toBe(200);
    const legacy = await models.RequestItemUnitReceipt.findOne({ where: { note: 'Phase 41' } });
    expect(legacy.receiptConfirmationId).toBeNull();
    expect(response.body.data.receiptConfirmations).toHaveLength(1);
  });
});

describe('the schema (migration 062)', () => {
  it('ties a unit photo to a receipt of its own confirmation, and only a confirmation photo', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 2, count: 2 });
    await receive(id, { assetUnitIds: [units[0]] }, teacher);
    await receive(id, { assetUnitIds: [units[1]] }, teacher);
    const [first, second] = await models.RequestReceiptConfirmation.findAll({
      order: [['confirmedAt', 'ASC']],
    });
    const receiptOfFirst = await receiptOf(units[0]);
    const insert = (type, confirmationId, receiptId) =>
      query(
        `INSERT INTO public.request_documents (request_id, document_type, file_name, file_type,
           file_size, storage_reference, uploaded_by, receipt_confirmation_id,
           request_item_unit_receipt_id)
         VALUES ($1, $2, 'x.png', 'image/png', 1, 'x/y', $3, $4, $5)`,
        [id, type, teacher.user.id, confirmationId, receiptId]
      );

    await expect(insert('CONFIRMATION_PHOTO', second.id, receiptOfFirst.id)).rejects.toThrow(
      /fk_request_documents_receipt/
    );
    await expect(insert('SUPPORTING', null, receiptOfFirst.id)).rejects.toThrow(
      /chk_request_documents_receipt_photo/
    );
    await expect(insert('CONFIRMATION_PHOTO', first.id, receiptOfFirst.id)).resolves.toBeDefined();
  });

  it('leaves existing photos NULL, and refuses to roll back while a unit photo exists', async () => {
    const CYCLE = cycleDatabaseUrl();
    await migrate(CYCLE);
    await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);

    const one = async (sql, params) => (await query(sql, params, CYCLE))[0];
    const institution = await one(
      `INSERT INTO public.institutions (name, code, address) VALUES ('P', 'RUP', 'x') RETURNING id`
    );
    const user = await one(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-receipt-photos', $1, 'Cycle', 'Photos', $2) RETURNING id`,
      [`$2b$10$${'0'.repeat(53)}`, institution.id]
    );
    const assignment = await one(
      `INSERT INTO public.position_assignments (institution_id, user_id, position_code)
       VALUES ($1, $2, 'COMMON_TEACHER') RETURNING id`,
      [institution.id, user.id]
    );
    const request = await one(
      `INSERT INTO public.requests (institution_id, request_number, category, title,
         requester_user_id, requester_assignment_id, requester_position_code)
       VALUES ($1, 'REQ/2026/0001', 'COMMON', 'T', $2, $3, 'COMMON_TEACHER') RETURNING id`,
      [institution.id, user.id, assignment.id]
    );
    const item = await one(
      `INSERT INTO public.request_items (request_id, line_no, description, quantity_requested)
       VALUES ($1, 1, 'Laptop', 1) RETURNING id`,
      [request.id]
    );
    await query(
      `INSERT INTO ref.asset_classifications (id, name) VALUES ('999999999062', 'Cycle 062')`,
      [],
      CYCLE
    );
    const asset = await one(
      `INSERT INTO public.assets (name, classification_id, institution_id)
       VALUES ('Laptop', '999999999062', $1) RETURNING id`,
      [institution.id]
    );
    const unit = await one(
      `INSERT INTO public.asset_units (asset_id, inventory_code) VALUES ($1, 'CYC-062-1') RETURNING id`,
      [asset.id]
    );
    const link = await one(
      `INSERT INTO public.request_item_units (request_item_id, asset_unit_id, linked_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [item.id, unit.id, user.id]
    );
    const confirmation = await one(
      `INSERT INTO public.request_receipt_confirmations (request_id, description, confirmed_by)
       VALUES ($1, 'Diterima', $2) RETURNING id`,
      [request.id, user.id]
    );
    const receipt = await one(
      `INSERT INTO public.request_item_unit_receipts (request_item_unit_id, received_on,
         recorded_by, receipt_confirmation_id)
       VALUES ($1, CURRENT_DATE, $2, $3) RETURNING id`,
      [link.id, user.id, confirmation.id]
    );
    const document = await one(
      `INSERT INTO public.request_documents (request_id, document_type, file_name, file_type,
         file_size, storage_reference, uploaded_by, receipt_confirmation_id)
       VALUES ($1, 'CONFIRMATION_PHOTO', 'x.png', 'image/png', 1, 'x/y', $2, $3) RETURNING id`,
      [request.id, user.id, confirmation.id]
    );

    try {
      await migrate(CYCLE);
      const existing = await one(
        'SELECT request_item_unit_receipt_id FROM public.request_documents WHERE id = $1',
        [document.id]
      );
      expect(existing.request_item_unit_receipt_id).toBeNull();

      await query(
        'UPDATE public.request_documents SET request_item_unit_receipt_id = $1 WHERE id = $2',
        [receipt.id, document.id],
        CYCLE
      );
      await expect(runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE)).rejects.toThrow(
        /Migration 062 rollback refused/
      );

      await query(
        'UPDATE public.request_documents SET request_item_unit_receipt_id = NULL',
        [],
        CYCLE
      );
      await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);
      const gone = await one(
        `SELECT count(*)::int AS columns FROM information_schema.columns
          WHERE table_name = 'request_documents' AND column_name = 'request_item_unit_receipt_id'`
      );
      expect(gone.columns).toBe(0);
    } finally {
      await migrate(CYCLE);
      for (const [table, rowId] of [
        ['request_documents', document.id],
        ['request_item_unit_receipts', receipt.id],
        ['request_receipt_confirmations', confirmation.id],
        ['request_item_units', link.id],
        ['asset_units', unit.id],
        ['assets', asset.id],
        ['request_items', item.id],
        ['requests', request.id],
        ['position_assignments', assignment.id],
        ['users', user.id],
        ['institutions', institution.id],
      ]) {
        await query(`DELETE FROM public.${table} WHERE id = $1`, [rowId], CYCLE);
      }
      await query(`DELETE FROM ref.asset_classifications WHERE id = '999999999062'`, [], CYCLE);
    }
  });
});
