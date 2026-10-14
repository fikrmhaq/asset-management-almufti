import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

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
 * Receipt confirmation — migration 057 (UAT decision, 2026-09-28;
 * `IMPLEMENTATION_PLAN.md` §63). Extends REQ-REQUEST-011 (receipt).
 *
 *   SCHEMA     the confirmation table; the intended place is one snapshot, and
 *              placement is asked only against it; a CONFIRMATION_PHOTO always
 *              and only belongs to a confirmation.
 *   RECEIVE    one multipart request: units, date, placement, description and
 *              1–5 JPG/PNG photos — all or nothing, files included.
 *   SNAPSHOT   a later change of destination, or a rename, rewrites nothing.
 *   REVERSAL   the confirmation and photos stay; superseded once every receipt
 *              is reversed; receiving again makes a new one.
 *   PHOTOS     immutable evidence: never deleted, never uploaded on their own,
 *              not in the generic documents list, readable by id.
 *   HISTORY    a Phase 41 receipt without a confirmation stays valid.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

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
];
const OVERSEER = [
  'request:read',
  'request:update',
  'request:oversee',
  'request-receipt:reverse',
  'request-item-unit:read',
  'request-document:read',
  'request-document:delete',
];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const photo = (name = 'bukti.png', mime = 'image/png', body = PNG) => ({ name, mime, body });

let alpha;
const createdRequests = new Set();

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
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
const patch = (url, body, caller) => call('patch', url, body, caller);
const del = (url, caller) => call('delete', url, undefined, caller);

const shardOf = (requestId) => path.join(storage.storageRoot(), 'requests', requestId);
const filesOf = (requestId) =>
  fs.existsSync(shardOf(requestId)) ? fs.readdirSync(shardOf(requestId)) : [];

async function person(permissions, positions = []) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: alpha.id,
  });
  for (const position of positions) {
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: caller.user.id,
      positionCode: position,
    });
  }
  const assignment = await models.PositionAssignment.findOne({ where: { userId: caller.user.id } });
  return { ...caller, assignment };
}

const location = (name) =>
  models.Location.create({ name, classificationId: LEAF, institutionId: alpha.id });

async function workflow() {
  const definition = await models.WorkflowDefinition.create({
    institutionId: alpha.id,
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

/** An APPROVED request with one item of `quantity`, `count` units registered. */
async function registeredRequest({ quantity = 3, count = 3, destination = null } = {}) {
  await workflow();
  const teacher = await person(REQUESTER, ['COMMON_TEACHER']);
  const kepala = await person(APPROVER, ['KEPALA_SEKOLAH']);
  const sarpras = await person(REGISTRAR, ['WAKASEK_SARPRAS']);
  const overseer = await person(OVERSEER);

  const created = await post(
    '/requests',
    {
      requesterAssignmentId: teacher.assignment.id,
      category: 'COMMON',
      title: 'Laptop',
      ...(destination ? { destinationLocationId: destination.id } : {}),
    },
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
  return { id, itemId, units, teacher, overseer };
}

/** `POST /requests/:id/receive`, multipart. */
function receive(requestId, fields, caller, photos = [photo()]) {
  const pending = api()
    .post(`${V1}/requests/${requestId}/receive`)
    .set(...caller.auth);
  const all = { receivedOn: businessDate(), description: 'Sudah diterima', ...fields };
  for (const [key, value] of Object.entries(all)) {
    if (value === undefined) continue;
    for (const entry of [value].flat()) pending.field(key, String(entry));
  }
  for (const { name, mime, body } of photos) {
    pending.attach('photos', body, { filename: name, contentType: mime });
  }
  return pending;
}

const detail = async (requestId, caller) => (await get(`/requests/${requestId}`, caller)).body.data;
const counts = async () => ({
  confirmations: await models.RequestReceiptConfirmation.count(),
  receipts: await models.RequestItemUnitReceipt.count(),
  photos: await models.RequestDocument.count({ where: { documentType: 'CONFIRMATION_PHOTO' } }),
});

// ---------------------------------------------------------------------------

describe('the schema (migration 057)', () => {
  it('ties placement to the destination snapshot, and a photo to its confirmation', async () => {
    const lab = await location('Lab TKJ');
    const { id, teacher } = await registeredRequest({ destination: lab });
    const insert = (placement, destinationId, name, description = 'x') =>
      query(
        `INSERT INTO public.request_receipt_confirmations
           (request_id, placement, description, destination_location_id, destination_name, confirmed_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [id, placement, description, destinationId, name, teacher.user.id]
      );

    await expect(insert('AT_INTENDED_PLACE', null, null)).rejects.toThrow(/chk_rrc_destination/);
    await expect(insert(null, lab.id, 'Lab TKJ')).rejects.toThrow(/chk_rrc_destination/);
    await expect(insert('SOMEWHERE', lab.id, 'Lab TKJ')).rejects.toThrow(/chk_rrc_placement/);
    await expect(insert('AT_INTENDED_PLACE', lab.id, 'Lab TKJ', '  ')).rejects.toThrow(
      /chk_rrc_description/
    );
    const [ok] = await insert(null, null, null);

    const document = (type, confirmationId) =>
      query(
        `INSERT INTO public.request_documents (request_id, document_type, file_name, file_type,
           file_size, storage_reference, uploaded_by, receipt_confirmation_id)
         VALUES ($1, $2, 'a.png', 'image/png', 1, 'requests/x/a.png', $3, $4)`,
        [id, type, teacher.user.id, confirmationId]
      );
    await expect(document('CONFIRMATION_PHOTO', null)).rejects.toThrow(
      /chk_request_documents_confirmation/
    );
    await expect(document('SUPPORTING', ok.id)).rejects.toThrow(
      /chk_request_documents_confirmation/
    );
    await document('CONFIRMATION_PHOTO', ok.id);
  });
});

describe('receive with a confirmation', () => {
  it('records one confirmation for units received together, with its photos and a snapshot', async () => {
    const lab = await location('Lab TKJ');
    const { id, itemId, units, teacher } = await registeredRequest({ destination: lab });

    const response = await receive(
      id,
      {
        assetUnitIds: [units[0], units[1]],
        placement: 'AT_INTENDED_PLACE',
        description: '  Dua laptop sudah di lab  ',
      },
      teacher,
      [photo('depan.png'), photo('samping.jpg', 'image/jpeg', JPG)]
    );

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('PARTIALLY_FULFILLED');
    const [confirmation] = response.body.data.receiptConfirmations;
    expect(response.body.data.receiptConfirmations).toHaveLength(1);
    expect(confirmation).toMatchObject({
      placement: 'AT_INTENDED_PLACE',
      description: 'Dua laptop sudah di lab',
      destination: { id: lab.id, name: 'Lab TKJ' },
      receivedOn: businessDate(),
      confirmedBy: { id: teacher.user.id },
      state: 'ACTIVE',
    });
    expect(confirmation.units.map((unit) => unit.assetUnitId).sort()).toEqual(
      [units[0], units[1]].sort()
    );
    expect(confirmation.units.every((unit) => unit.reversed === false)).toBe(true);
    expect(confirmation.photos.map((p) => p.fileName).sort()).toEqual(['depan.png', 'samping.jpg']);

    // Each receipt points at it; the photos are CONFIRMATION_PHOTO documents
    // of the requester, and the files are on disk.
    const receipts = await models.RequestItemUnitReceipt.findAll();
    expect(receipts.map((r) => r.receiptConfirmationId)).toEqual([
      confirmation.id,
      confirmation.id,
    ]);
    expect(receipts.every((r) => r.note === null)).toBe(true);
    const photos = await models.RequestDocument.findAll({ where: { requestId: id } });
    expect(photos).toHaveLength(2);
    expect(
      photos.every(
        (p) =>
          p.documentType === 'CONFIRMATION_PHOTO' &&
          p.receiptConfirmationId === confirmation.id &&
          p.uploadedBy === teacher.user.id
      )
    ).toBe(true);
    expect(filesOf(id)).toHaveLength(2);

    // The unit list names the confirmation on each receipt.
    const links = (await get(`/request-items/${itemId}/units`, teacher)).body.data;
    const received = links.filter((link) => link.receipt);
    expect(received.map((link) => link.receipt.confirmationId)).toEqual([
      confirmation.id,
      confirmation.id,
    ]);
  });

  // Amended by REQ-REQUEST-024: `AT_INTENDED_PLACE` now places an unplaced unit
  // (`49-receipt-placement.test.js`); nothing else about the unit changes.
  it('never changes a unit’s lifecycle, condition, department or PIC — only places it', async () => {
    const lab = await location('Lab TKJ');
    const { id, units, teacher } = await registeredRequest({
      destination: lab,
      quantity: 1,
      count: 1,
    });
    const before = await models.AssetUnit.findByPk(units[0], { raw: true });

    expect(
      (await receive(id, { assetUnitIds: units, placement: 'AT_INTENDED_PLACE' }, teacher)).status
    ).toBe(200);

    const after = await models.AssetUnit.findByPk(units[0], { raw: true });
    const unchanged = ({ currentLocationId, updatedAt, updatedBy, ...rest }) => rest;
    expect(unchanged(after)).toEqual(unchanged(before));
    expect(after.currentLocationId).toBe(lab.id);
    expect(await models.AssetUnitLocation.count({ where: { assetUnitId: units[0] } })).toBe(1);
  });

  it('asks placement exactly when the request has an intended place', async () => {
    const lab = await location('Lab TKJ');
    const withPlace = await registeredRequest({ destination: lab, quantity: 1, count: 1 });

    const missing = await receive(withPlace.id, { all: true }, withPlace.teacher);
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].field).toBe('placement');
    expect(
      (
        await receive(
          withPlace.id,
          { all: true, placement: 'NOT_AT_INTENDED_PLACE', description: 'Masih di gudang' },
          withPlace.teacher
        )
      ).body.data.receiptConfirmations[0]
    ).toMatchObject({ placement: 'NOT_AT_INTENDED_PLACE', description: 'Masih di gudang' });

    await resetAssetCoreData();
    await resetOrganizationData();
    alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
    const noPlace = await registeredRequest({ quantity: 1, count: 1 });

    const given = await receive(
      noPlace.id,
      { all: true, placement: 'AT_INTENDED_PLACE' },
      noPlace.teacher
    );
    expect(given.status).toBe(400);
    expect(given.body.error.details[0].field).toBe('placement');
    const ok = await receive(noPlace.id, { all: true }, noPlace.teacher);
    expect(ok.status).toBe(200);
    expect(ok.body.data.receiptConfirmations[0]).toMatchObject({
      placement: null,
      destination: null,
    });
  });

  it('refuses without a description, with a note, or with an unknown placement', async () => {
    const { id, teacher } = await registeredRequest({ quantity: 1, count: 1 });

    const blank = await receive(id, { all: true, description: '   ' }, teacher);
    expect(blank.status).toBe(400);
    expect(blank.body.error.details[0].field).toBe('body.description');
    expect((await receive(id, { all: true, note: 'x' }, teacher)).status).toBe(400);
    expect((await receive(id, { all: true, placement: 'DI_LAB' }, teacher)).status).toBe(400);
    expect(await counts()).toEqual({ confirmations: 0, receipts: 0, photos: 0 });
  });

  it('requires 1–5 JPG or PNG photos, and writes nothing otherwise', async () => {
    const { id, teacher } = await registeredRequest({ quantity: 1, count: 1 });
    const refused = async (photos) => {
      const response = await receive(id, { all: true }, teacher, photos);
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('photos');
    };

    await refused([]);
    await refused(Array.from({ length: 6 }, (_, i) => photo(`p${i}.png`)));
    await refused([photo('scan.pdf', 'application/pdf', PDF)]);
    // A PDF by name is not an image, whatever the type claims.
    await refused([photo('scan.pdf', 'image/png')]);
    await refused([photo('ok.png'), photo('scan.pdf', 'application/pdf', PDF)]);

    expect(await counts()).toEqual({ confirmations: 0, receipts: 0, photos: 0 });
    expect(filesOf(id)).toEqual([]);

    const five = await receive(
      id,
      { all: true },
      teacher,
      Array.from({ length: 5 }, (_, i) => photo(`p${i}.png`))
    );
    expect(five.status).toBe(200);
    expect(five.body.data.receiptConfirmations[0].photos).toHaveLength(5);
  });

  it('is all or nothing: a unit refusal leaves no confirmation, receipt, photo or file', async () => {
    const { id, units, teacher } = await registeredRequest({ quantity: 2, count: 2 });
    await receive(id, { assetUnitIds: [units[0]] }, teacher);
    const before = await counts();
    const filesBefore = filesOf(id).length;

    const response = await receive(id, { assetUnitIds: [units[0], units[1]] }, teacher, [
      photo('a.png'),
      photo('b.png'),
    ]);

    expect(response.status).toBe(409);
    expect(await counts()).toEqual(before);
    expect(filesOf(id)).toHaveLength(filesBefore);
  });

  it('refuses anyone but the requester, oversight included', async () => {
    const { id, overseer } = await registeredRequest({ quantity: 1, count: 1 });
    const withCode = await person([...OVERSEER, 'request:receive']);

    expect((await receive(id, { all: true }, withCode)).status).toBe(403);
    expect((await receive(id, { all: true }, overseer)).status).toBe(403);
    expect(await counts()).toEqual({ confirmations: 0, receipts: 0, photos: 0 });
  });
});

describe('the destination snapshot', () => {
  it('keeps the place confirmed against when the destination changes or is renamed', async () => {
    const lab = await location('Lab TKJ');
    const workshop = await location('Bengkel');
    const { id, units, teacher, overseer } = await registeredRequest({
      destination: lab,
      quantity: 2,
      count: 2,
    });
    await receive(id, { assetUnitIds: [units[0]], placement: 'AT_INTENDED_PLACE' }, teacher);

    const moved = await patch(`/requests/${id}`, { destinationLocationId: workshop.id }, overseer);
    expect(moved.status).toBe(200);
    await lab.update({ name: 'Lab TKJ (lama)' });

    const after = await detail(id, teacher);
    expect(after.destination).toMatchObject({ id: workshop.id });
    expect(after.receiptConfirmations[0].destination).toEqual({ id: lab.id, name: 'Lab TKJ' });

    // The next confirmation is against the new place.
    const next = await receive(id, { all: true, placement: 'NOT_AT_INTENDED_PLACE' }, teacher);
    expect(next.body.data.receiptConfirmations[1].destination).toEqual({
      id: workshop.id,
      name: 'Bengkel',
    });
  });
});

describe('reversal and correction', () => {
  it('keeps the confirmation and its photos; superseded only once every receipt is reversed', async () => {
    // Three requested, two registered: receiving both leaves the request open,
    // so its receipts can still be reversed (Q2c).
    const { id, units, teacher, overseer } = await registeredRequest({ quantity: 3, count: 2 });
    const first = (await receive(id, { all: true, description: 'Salah foto' }, teacher)).body.data
      .receiptConfirmations[0];
    const [r1, r2] = first.units.map((unit) => unit.receiptId);

    await post(`/request-receipts/${r1}/reverse`, { reason: 'Foto salah' }, overseer);
    let current = (await detail(id, teacher)).receiptConfirmations[0];
    expect(current.state).toBe('ACTIVE');
    expect(current.units.find((unit) => unit.receiptId === r1).reversed).toBe(true);

    await post(`/request-receipts/${r2}/reverse`, { reason: 'Foto salah' }, overseer);
    current = (await detail(id, teacher)).receiptConfirmations[0];
    expect(current.state).toBe('SUPERSEDED');
    expect(current.photos).toHaveLength(1);
    expect(filesOf(id)).toHaveLength(1);

    // Receiving again makes a new confirmation; the old one stays as it was.
    const again = await receive(id, { assetUnitIds: units, description: 'Foto benar' }, teacher);
    expect(again.status).toBe(200);
    const confirmations = again.body.data.receiptConfirmations;
    expect(confirmations.map((c) => [c.description, c.state])).toEqual([
      ['Salah foto', 'SUPERSEDED'],
      ['Foto benar', 'ACTIVE'],
    ]);
    expect(filesOf(id)).toHaveLength(2);
  });
});

describe('confirmation photos', () => {
  it('are not in the documents list, but are readable and downloadable by id', async () => {
    const { id, teacher } = await registeredRequest({ quantity: 1, count: 1 });
    const photoId = (await receive(id, { all: true }, teacher)).body.data.receiptConfirmations[0]
      .photos[0].id;

    const listed = await get(`/requests/${id}/documents`, teacher);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([]);

    const meta = await get(`/request-documents/${photoId}`, teacher);
    expect(meta.body.data).toMatchObject({ documentType: 'CONFIRMATION_PHOTO', canDelete: false });
    const bytes = await get(`/request-documents/${photoId}?download=true`, teacher)
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(bytes.status).toBe(200);
    expect(Buffer.compare(bytes.body, PNG)).toBe(0);
  });

  it('can never be deleted — not by the requester, not with oversight', async () => {
    const { id, teacher, overseer } = await registeredRequest({ quantity: 1, count: 1 });
    const photoId = (await receive(id, { all: true }, teacher)).body.data.receiptConfirmations[0]
      .photos[0].id;

    expect((await del(`/request-documents/${photoId}`, teacher)).status).toBe(409);
    expect((await del(`/request-documents/${photoId}`, overseer)).status).toBe(409);
    expect(await models.RequestDocument.count({ where: { id: photoId } })).toBe(1);
    expect(filesOf(id)).toHaveLength(1);
  });

  it('cannot be uploaded on their own', async () => {
    const { id, teacher } = await registeredRequest({ quantity: 1, count: 1 });
    const response = await api()
      .post(`${V1}/requests/${id}/documents`)
      .set(...teacher.auth)
      .field('documentType', 'CONFIRMATION_PHOTO')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('body.documentType');
  });
});

describe('Phase 41 history', () => {
  it('keeps a receipt without a confirmation valid, with its note', async () => {
    const { id, itemId, teacher, overseer } = await registeredRequest({ quantity: 2, count: 2 });
    const link = await models.RequestItemUnit.findOne();
    await query(
      `INSERT INTO public.request_item_unit_receipts (request_item_unit_id, received_on, recorded_by, note)
       VALUES ($1, CURRENT_DATE, $2, 'Diterima (lama)')`,
      [link.id, teacher.user.id]
    );

    const units = (await get(`/request-items/${itemId}/units`, teacher)).body.data;
    const old = units.find((row) => row.id === link.id).receipt;
    expect(old).toMatchObject({ note: 'Diterima (lama)', confirmationId: null });
    expect((await detail(id, teacher)).receiptConfirmations).toEqual([]);

    // It can still be reversed, and the other unit received with a confirmation.
    expect(
      (await post(`/request-receipts/${old.id}/reverse`, { reason: 'Uji' }, overseer)).status
    ).toBe(200);
    expect((await receive(id, { all: true }, teacher)).body.data.receiptConfirmations).toHaveLength(
      1
    );
  });
});

describe('rolling back migration 057', () => {
  const CYCLE = cycleDatabaseUrl();
  const NAME = '20261001010000-057-create-receipt-confirmations.js';

  beforeAll(async () => {
    await migrate(CYCLE);
  });

  it('refuses while a confirmation exists, then rolls back and re-applies when empty', async () => {
    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('Cycle R', 'CYCLER', 'Jl. R') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-confirm', $1, 'Cycle', 'Confirm', $2) RETURNING id`,
      [`$2b$10$${'0'.repeat(53)}`, institution.id],
      CYCLE
    );
    const [assignment] = await query(
      `INSERT INTO public.position_assignments (institution_id, user_id, position_code)
       VALUES ($1, $2, 'COMMON_TEACHER') RETURNING id`,
      [institution.id, user.id],
      CYCLE
    );
    const [request] = await query(
      `INSERT INTO public.requests (institution_id, request_number, category, title,
         requester_user_id, requester_assignment_id, requester_position_code)
       VALUES ($1, 'REQ/2026/0001', 'COMMON', 'T', $2, $3, 'COMMON_TEACHER') RETURNING id`,
      [institution.id, user.id, assignment.id],
      CYCLE
    );
    await query(
      `INSERT INTO public.request_receipt_confirmations (request_id, description, confirmed_by)
       VALUES ($1, 'x', $2)`,
      [request.id, user.id],
      CYCLE
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', NAME], CYCLE)).rejects.toThrow(
        /Migration 057 rollback refused/
      );
    } finally {
      await query('DELETE FROM public.request_receipt_confirmations', [], CYCLE);
      await query('DELETE FROM public.requests', [], CYCLE);
      await query('DELETE FROM public.position_assignments', [], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }

    // Migration 062: confirmation photos name receipts of 055 / 057 — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261005010000-062-add-receipt-unit-photos.js'],
      CYCLE
    );
    await runCli(['db:migrate:undo', '--name', NAME], CYCLE);
    const [gone] = await query(
      `SELECT to_regclass('public.request_receipt_confirmations') AS t,
              (SELECT character_maximum_length FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'request_documents'
                  AND column_name = 'document_type') AS len,
              (SELECT count(*)::int FROM information_schema.columns
                WHERE table_schema = 'public' AND column_name = 'receipt_confirmation_id') AS cols`,
      [],
      CYCLE
    );
    expect(gone).toEqual({ t: null, len: 12, cols: 0 });

    await migrate(CYCLE);
    const [back] = await query(
      `SELECT to_regclass('public.request_receipt_confirmations')::text AS t`,
      [],
      CYCLE
    );
    expect(back.t).toBe('request_receipt_confirmations');
  });
});
