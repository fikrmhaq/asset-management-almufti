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
const { ALL_REQUEST_DOCUMENT_TYPES } = require('../../src/domain/requestDocumentTypes.js');
const { PIC_ALLOWED_PERMISSIONS } = require('../../src/auth/permissionCatalog.js');
const storage = require('../../src/services/storage.js');

/**
 * Request documents — Phase 39 (`CR-014` §9, §10.1, §10.2), REQ-REQUEST-014,
 * `06-api.md` §12.4; `IMPLEMENTATION_PLAN.md` §58.1 decisions H1 – H9.
 *
 *   SCHEMA      migration 053, the type list against its constant (DEC-U).
 *   UPLOAD      requester until terminal; the actor of ANY ACTIVE step (DECIDE,
 *               PROCURE, REGISTER); oversight until terminal. Nobody else — not a
 *               pending-step holder, not a former actor.
 *   VALIDATION  file, type, size, fields — and nothing written when refused.
 *   STORAGE     the `requests/{id}` shard; the compensating delete.
 *   READ        anyone who sees the request; metadata vs bytes.
 *   DELETE      uploader while DRAFT; oversight at any status.
 *   ISOLATION   a document changes nothing but itself (H9); none is mandatory.
 */

const V1 = '/api/v1';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

const DOCS = ['request-document:read', 'request-document:create', 'request-document:delete'];
const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request:submit',
  'request:cancel',
  'request-item:create',
  'request-item:update',
  'request-item:delete',
  ...DOCS,
];
const APPROVER = ['request:read', 'request-step:decide', ...DOCS];
const PROCURER = ['request:read', 'request-step:complete', ...DOCS];
const OVERSEER = ['request:read', 'request:oversee', ...DOCS];

/** DECIDE → PROCURE → REGISTER, each with a different actor. */
const FLOW = [
  ['DECIDE', 'KEPALA_SEKOLAH'],
  ['PROCURE', 'WAKASEK_SARPRAS'],
  ['REGISTER', 'WAKASEK_KESISWAAN'],
];

let alpha;
let beta;
/** Requests whose storage shards this file created — removed afterwards. */
const createdRequests = new Set();

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  // The test database is rebuilt every run, but the storage directory is shared
  // with the development API: leave no files behind.
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

function upload(
  requestId,
  caller,
  { type = 'SUPPORTING', title, name = 'doc.pdf', mime = 'application/pdf', body = PDF } = {}
) {
  const pending = api()
    .post(`${V1}/requests/${requestId}/documents`)
    .set(...caller.auth);
  // `type: null` sends no document type at all.
  if (type !== null) pending.field('documentType', type);
  if (title !== undefined) pending.field('title', title);
  return pending.attach('file', body, { filename: name, contentType: mime });
}

async function person(permissions, positions = [], { institution = alpha, picScoped } = {}) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: institution.id,
    ...(picScoped ? { isPicScoped: true } : {}),
  });
  const assignments = [];
  for (const position of positions) {
    assignments.push(
      await models.PositionAssignment.create({
        institutionId: institution.id,
        userId: caller.user.id,
        positionCode: position,
      })
    );
  }
  return { ...caller, assignment: assignments[0] };
}

async function workflow(steps, { institution = alpha } = {}) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: institution.id,
    category: 'COMMON',
    requesterPositionCode: 'COMMON_TEACHER',
    version: 1,
    status: 'ACTIVE',
    publishedAt: new Date(),
  });
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
  return definition;
}

async function draftFor(requester) {
  const created = await post(
    '/requests',
    { requesterAssignmentId: requester.assignment.id, category: 'COMMON', title: 'Proyektor' },
    requester
  );
  expect(created.status).toBe(201);
  createdRequests.add(created.body.data.id);
  await post(
    `/requests/${created.body.data.id}/items`,
    { description: 'Proyektor', quantityRequested: 2 },
    requester
  );
  return created.body.data;
}

/** A cast and a DRAFT on FLOW. */
async function cast() {
  await workflow(FLOW);
  const teacher = await person(REQUESTER, ['COMMON_TEACHER']);
  const kepala = await person(APPROVER, ['KEPALA_SEKOLAH']);
  const sarpras = await person(PROCURER, ['WAKASEK_SARPRAS']);
  // The REGISTER actor holds no registration permission at all: document upload
  // is all the actor rule gives them (H1).
  const registrar = await person(['request:read', ...DOCS], ['WAKASEK_KESISWAAN']);
  const overseer = await person(OVERSEER);
  const draft = await draftFor(teacher);
  return { teacher, kepala, sarpras, registrar, overseer, draft };
}

async function submitted() {
  const people = await cast();
  const response = await post(`/requests/${people.draft.id}/submit`, {}, people.teacher);
  expect(response.status).toBe(200);
  return { ...people, request: response.body.data };
}

/** Submitted, then approved: PROCURE and REGISTER both ACTIVE. */
async function approved() {
  const people = await submitted();
  const decided = await post(
    `/request-steps/${people.request.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    people.kepala
  );
  expect(decided.status).toBe(200);
  expect(decided.body.data.steps.map((step) => step.state)).toEqual([
    'APPROVED',
    'ACTIVE',
    'ACTIVE',
  ]);
  return { ...people, request: decided.body.data };
}

const shardOf = (requestId) => path.join(storage.storageRoot(), 'requests', requestId);
const filesIn = (requestId) =>
  fs.existsSync(shardOf(requestId)) ? fs.readdirSync(shardOf(requestId)) : [];
const documentCount = (requestId) => models.RequestDocument.count({ where: { requestId } });

async function checkLiterals(name) {
  const [row] = await query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1`,
    [name]
  );
  return [...row.definition.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
}

/** Everything a document must never change (H9). */
async function snapshot(requestId) {
  const request = await models.Request.findByPk(requestId, { raw: true });
  const steps = await models.RequestStep.findAll({
    where: { requestId },
    order: [['sequence', 'ASC']],
    raw: true,
  });
  const items = await models.RequestItem.findAll({
    where: { requestId },
    order: [['lineNo', 'ASC']],
    raw: true,
  });
  return {
    request,
    steps,
    items,
    assets: await models.Asset.count(),
    units: await models.AssetUnit.count(),
    attachments: await models.Attachment.count(),
  };
}

// ---------------------------------------------------------------------------

describe('the schema (migration 053, DEC-U)', () => {
  it('chk_request_documents_type admits exactly the JavaScript constant', async () => {
    expect(await checkLiterals('chk_request_documents_type')).toEqual(
      [...ALL_REQUEST_DOCUMENT_TYPES].sort()
    );
  });

  it('refuses an unknown type and an empty file', async () => {
    const { teacher, draft } = await cast();
    const insert = (type, size) =>
      query(
        `INSERT INTO public.request_documents
           (request_id, document_type, file_name, file_type, file_size, storage_reference, uploaded_by)
         VALUES ($1, $2, 'a.pdf', 'application/pdf', $3, 'requests/x/a.pdf', $4)`,
        [draft.id, type, size, teacher.user.id]
      );

    await expect(insert('RECEIVING', 10)).rejects.toThrow(/chk_request_documents_type/);
    await expect(insert('BAST', 0)).rejects.toThrow(/chk_request_documents_size/);
  });
});

describe('upload — who (H1)', () => {
  it('lets the requester upload to a DRAFT, and returns the document', async () => {
    const { teacher, draft } = await cast();
    const response = await upload(draft.id, teacher, { type: 'PROPOSAL', title: '  Proposal  ' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      requestId: draft.id,
      documentType: 'PROPOSAL',
      title: 'Proposal',
      fileName: 'doc.pdf',
      fileType: 'application/pdf',
      fileSize: PDF.length,
      uploadedBy: { id: teacher.user.id, username: teacher.user.username },
      canDelete: true,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/storageReference|requests[\\/]/);
  });

  it('stores a blank title as none', async () => {
    const { teacher, draft } = await cast();
    const response = await upload(draft.id, teacher, { title: '   ' });

    expect(response.status).toBe(201);
    expect(response.body.data.title).toBeNull();
  });

  it('lets the requester upload while SUBMITTED', async () => {
    const { teacher, request } = await submitted();
    expect((await upload(request.id, teacher)).status).toBe(201);
  });

  it('lets the requester upload while APPROVED', async () => {
    const { teacher, request } = await approved();
    expect((await upload(request.id, teacher)).status).toBe(201);
  });

  it('lets the current DECIDE actor upload, but not the holder of a PENDING step', async () => {
    const { kepala, sarpras, registrar, request } = await submitted();

    expect((await upload(request.id, kepala, { type: 'SUPPORTING' })).status).toBe(201);
    // Their steps are PENDING: they are not actors yet, and cannot even see it.
    expect((await upload(request.id, sarpras)).status).toBe(404);
    expect((await upload(request.id, registrar)).status).toBe(404);
  });

  it('lets the PROCURE and REGISTER actors upload once both are ACTIVE', async () => {
    const { sarpras, registrar, request } = await approved();

    expect((await upload(request.id, sarpras, { type: 'INVOICE' })).status).toBe(201);
    expect((await upload(request.id, registrar, { type: 'BAST' })).status).toBe(201);
  });

  it('gives the REGISTER actor document upload only — the step is untouched', async () => {
    const { registrar, request } = await approved();
    const register = request.steps[2];

    expect((await upload(request.id, registrar, { type: 'BAST' })).status).toBe(201);

    const step = await models.RequestStep.findByPk(register.id);
    expect(step.state).toBe('ACTIVE');
    expect(step.actedByUserId).toBeNull();
    expect(step.completedAt).toBeNull();
  });

  it('refuses a former actor: they may read, not upload', async () => {
    const { kepala, request } = await approved();

    expect((await get(`/requests/${request.id}/documents`, kepala)).status).toBe(200);
    const refused = await upload(request.id, kepala);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses the PROCURE actor once the acquisition is declared, while REGISTER stays open', async () => {
    const { sarpras, registrar, request } = await approved();
    const done = await post(`/request-steps/${request.steps[1].id}/complete`, {}, sarpras);
    expect(done.status).toBe(200);

    expect((await upload(request.id, sarpras)).status).toBe(403);
    expect((await upload(request.id, registrar)).status).toBe(201);
  });

  it('follows a handover immediately', async () => {
    const { kepala, request } = await submitted();
    await kepala.assignment.update({ isCurrent: false, endedAt: new Date() });
    const successor = await person(APPROVER, ['KEPALA_SEKOLAH']);

    // The old holder never acted, so the request is no longer theirs to see.
    expect((await upload(request.id, kepala)).status).toBe(404);
    expect((await upload(request.id, successor)).status).toBe(201);
  });

  it('lets oversight upload to another user’s submitted request', async () => {
    const { overseer, request } = await submitted();
    expect((await upload(request.id, overseer, { type: 'OTHER' })).status).toBe(201);
  });

  it('never exposes another user’s DRAFT to oversight', async () => {
    const { overseer, draft } = await cast();
    expect((await upload(draft.id, overseer)).status).toBe(404);
  });

  it('refuses a visible caller with the code who is none of requester, actor or overseer', async () => {
    const { kepala, request } = await approved();
    // Kepala is a former actor (visible) and holds `request-document:create`.
    expect((await upload(request.id, kepala)).status).toBe(403);
  });

  it('requires request-document:create, whatever the caller’s role in the request', async () => {
    await workflow(FLOW);
    const teacher = await person(
      REQUESTER.filter((code) => code !== 'request-document:create'),
      ['COMMON_TEACHER']
    );
    const draft = await draftFor(teacher);
    const overseer = await person(['request:read', 'request:oversee']);
    await post(`/requests/${draft.id}/submit`, {}, teacher);

    expect((await upload(draft.id, teacher)).status).toBe(403);
    expect((await upload(draft.id, overseer)).status).toBe(403);
  });

  it.each([
    ['REJECTED', 'reject'],
    ['CANCELLED', 'cancel'],
    ['CLOSED', 'set'],
    ['FULFILLED', 'set'],
  ])('refuses uploads to a %s request, for everyone (409)', async (status, how) => {
    const { teacher, kepala, overseer, request } = await submitted();
    if (how === 'reject') {
      await post(
        `/request-steps/${request.steps[0].id}/decide`,
        { decision: 'REJECT', comment: 'Tidak' },
        kepala
      );
    } else if (how === 'cancel') {
      await post(`/requests/${request.id}/cancel`, { reason: 'Tidak jadi' }, teacher);
    } else {
      // Reached only in Phase 41; set directly to prove the guard.
      await query(`UPDATE public.requests SET status = $1, closed_at = now() WHERE id = $2`, [
        status,
        request.id,
      ]);
    }
    expect(await models.Request.findByPk(request.id).then((r) => r.status)).toBe(status);

    for (const caller of [teacher, overseer]) {
      const refused = await upload(request.id, caller);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('CONFLICT');
    }
    expect(await documentCount(request.id)).toBe(0);
    expect(filesIn(request.id)).toEqual([]);
  });

  it('isolates institutions', async () => {
    const { request } = await submitted();
    const foreign = await person(OVERSEER, [], { institution: beta });
    expect((await upload(request.id, foreign)).status).toBe(404);
  });

  it('refuses a PIC-scoped caller on every endpoint, even with the codes', async () => {
    const { teacher, draft } = await cast();
    const document = (await upload(draft.id, teacher)).body.data;
    const pic = await person([...REQUESTER, 'request:oversee'], [], { picScoped: true });

    expect((await get(`/requests/${draft.id}/documents`, pic)).status).toBe(403);
    expect((await upload(draft.id, pic)).status).toBe(403);
    expect((await get(`/request-documents/${document.id}`, pic)).status).toBe(403);
    expect((await get(`/request-documents/${document.id}?download=true`, pic)).status).toBe(403);
    expect((await del(`/request-documents/${document.id}`, pic)).status).toBe(403);
  });
});

describe('upload — validation (REQ-FILE-004)', () => {
  it.each([
    ['a disallowed file type', { name: 'evil.exe', mime: 'application/x-msdownload' }, 'file'],
    ['a disallowed type behind an allowed name', { name: 'doc.pdf', mime: 'text/html' }, 'file'],
    ['no document type', { type: null }, 'body.documentType'],
    ['an unknown document type', { type: 'RECEIVING' }, 'body.documentType'],
    ['an over-long title', { title: 'x'.repeat(256) }, 'body.title'],
  ])('refuses %s with 400, writing nothing', async (_label, options, field) => {
    const { teacher, draft } = await cast();
    const response = await upload(draft.id, teacher, options);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
    expect(await documentCount(draft.id)).toBe(0);
    expect(filesIn(draft.id)).toEqual([]);
  });

  it('refuses a missing file', async () => {
    const { teacher, draft } = await cast();
    const response = await api()
      .post(`${V1}/requests/${draft.id}/documents`)
      .set(...teacher.auth)
      .field('documentType', 'SUPPORTING');

    expect(response.status).toBe(400);
    expect(await documentCount(draft.id)).toBe(0);
  });

  it('refuses a file over the size limit', async () => {
    const { teacher, draft } = await cast();
    const response = await upload(draft.id, teacher, {
      body: Buffer.alloc(10 * 1024 * 1024 + 1, 1),
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('file');
    expect(filesIn(draft.id)).toEqual([]);
  });

  it('writes no file for a refused caller', async () => {
    const { kepala, request } = await approved();
    expect((await upload(request.id, kepala)).status).toBe(403);
    expect(filesIn(request.id)).toEqual([]);
  });
});

describe('storage (H8)', () => {
  it('writes the file under the request’s shard, and reads the same bytes back', async () => {
    const { teacher, draft } = await cast();
    const created = await upload(draft.id, teacher, { name: 'scan.png', mime: 'image/png' });
    const row = await models.RequestDocument.findByPk(created.body.data.id);

    expect(row.storageReference.startsWith(`requests/${draft.id}/`)).toBe(true);
    expect(fs.readFileSync(storage.resolveStoredPath(row.storageReference))).toEqual(PDF);
  });

  it('removes the stored file when the row does not land', async () => {
    const { teacher, draft } = await cast();
    vi.spyOn(models.RequestDocument, 'create').mockRejectedValueOnce(new Error('insert failed'));

    const response = await upload(draft.id, teacher);

    expect(response.status).toBe(500);
    expect(await documentCount(draft.id)).toBe(0);
    expect(filesIn(draft.id)).toEqual([]);
  });
});

describe('read (REQ-REQUEST-015)', () => {
  it('lists newest first, with per-caller delete flags', async () => {
    const { teacher, kepala, overseer, request } = await submitted();
    await upload(request.id, teacher, { type: 'PROPOSAL' });
    await upload(request.id, kepala, { type: 'SUPPORTING' });

    const asTeacher = await get(`/requests/${request.id}/documents`, teacher);
    expect(asTeacher.status).toBe(200);
    expect(asTeacher.body.data.map((doc) => doc.documentType)).toEqual(['SUPPORTING', 'PROPOSAL']);
    expect(asTeacher.body.meta).toBeDefined();
    // Submitted: the uploader no longer deletes.
    expect(asTeacher.body.data.map((doc) => doc.canDelete)).toEqual([false, false]);

    const asOverseer = await get(`/requests/${request.id}/documents`, overseer);
    expect(asOverseer.body.data.map((doc) => doc.canDelete)).toEqual([true, true]);
  });

  it('answers metadata by default and the bytes with ?download=true', async () => {
    const { teacher, draft } = await cast();
    const created = (await upload(draft.id, teacher)).body.data;

    const metadata = await get(`/request-documents/${created.id}`, teacher);
    expect(metadata.status).toBe(200);
    expect(metadata.headers['content-type']).toMatch(/application\/json/);
    expect(metadata.body.data).toMatchObject({ id: created.id, documentType: 'SUPPORTING' });

    const file = await get(`/request-documents/${created.id}?download=true`, teacher)
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/application\/pdf/);
    expect(file.headers['content-disposition']).toBe('attachment; filename="doc.pdf"');
    expect(file.body).toEqual(PDF);
  });

  it('lets a former actor read, and hides everything from a later holder who never acted', async () => {
    const { teacher, kepala, request } = await approved();
    const document = (await upload(request.id, teacher)).body.data;

    await kepala.assignment.update({ isCurrent: false, endedAt: new Date() });
    const successor = await person(APPROVER, ['KEPALA_SEKOLAH']);

    expect((await get(`/request-documents/${document.id}`, kepala)).status).toBe(200);
    expect((await get(`/requests/${request.id}/documents`, successor)).status).toBe(404);
    expect((await get(`/request-documents/${document.id}`, successor)).status).toBe(404);
  });

  it('keeps a DRAFT’s documents private to the requester', async () => {
    const { teacher, overseer, draft } = await cast();
    const document = (await upload(draft.id, teacher)).body.data;

    expect((await get(`/requests/${draft.id}/documents`, overseer)).status).toBe(404);
    expect((await get(`/request-documents/${document.id}`, overseer)).status).toBe(404);
  });

  it('requires request-document:read', async () => {
    const { request } = await submitted();
    const reader = await person(['request:read', 'request:oversee']);

    expect((await get(`/requests/${request.id}/documents`, reader)).status).toBe(403);
  });

  it('answers 404 for an unknown document', async () => {
    const { teacher } = await cast();
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await get(`/request-documents/${missing}`, teacher)).status).toBe(404);
  });
});

describe('delete (H3)', () => {
  it('lets the uploader delete while DRAFT, and removes the file', async () => {
    const { teacher, draft } = await cast();
    const created = (await upload(draft.id, teacher)).body.data;
    const row = await models.RequestDocument.findByPk(created.id);

    const response = await del(`/request-documents/${created.id}`, teacher);

    expect(response.status).toBe(204);
    expect(await models.RequestDocument.findByPk(created.id)).toBeNull();
    expect(fs.existsSync(storage.resolveStoredPath(row.storageReference))).toBe(false);
  });

  it('refuses the uploader once the request is submitted (409)', async () => {
    const { teacher, draft } = await cast();
    const created = (await upload(draft.id, teacher)).body.data;
    await post(`/requests/${draft.id}/submit`, {}, teacher);

    const response = await del(`/request-documents/${created.id}`, teacher);

    expect(response.status).toBe(409);
    expect(await models.RequestDocument.findByPk(created.id)).not.toBeNull();
  });

  it('refuses the uploader after submission even as an active actor', async () => {
    const { kepala, request } = await submitted();
    const created = (await upload(request.id, kepala)).body.data;

    expect((await del(`/request-documents/${created.id}`, kepala)).status).toBe(409);
  });

  it('refuses someone else without oversight (403)', async () => {
    const { teacher, kepala, request } = await submitted();
    const created = (await upload(request.id, teacher)).body.data;

    const response = await del(`/request-documents/${created.id}`, kepala);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('lets oversight delete at any status, terminal included', async () => {
    const { teacher, overseer, request } = await submitted();
    const first = (await upload(request.id, teacher)).body.data;
    const second = (await upload(request.id, teacher, { type: 'BAST' })).body.data;

    expect((await del(`/request-documents/${first.id}`, overseer)).status).toBe(204);

    await query(
      `UPDATE public.requests SET status = 'FULFILLED', closed_at = now() WHERE id = $1`,
      [request.id]
    );
    expect((await del(`/request-documents/${second.id}`, overseer)).status).toBe(204);
    expect(await documentCount(request.id)).toBe(0);
  });

  it('requires request-document:delete, even for oversight', async () => {
    const { teacher, request } = await submitted();
    const created = (await upload(request.id, teacher)).body.data;
    const overseer = await person(['request:read', 'request:oversee', 'request-document:read']);

    expect((await del(`/request-documents/${created.id}`, overseer)).status).toBe(403);
  });

  it('still deletes the row when the file has already gone', async () => {
    const { teacher, draft } = await cast();
    const created = (await upload(draft.id, teacher)).body.data;
    const row = await models.RequestDocument.findByPk(created.id);
    fs.unlinkSync(storage.resolveStoredPath(row.storageReference));

    expect((await del(`/request-documents/${created.id}`, teacher)).status).toBe(204);
    expect(await models.RequestDocument.findByPk(created.id)).toBeNull();
  });
});

describe('the detail’s uploadDocument flag', () => {
  const flag = async (requestId, caller) =>
    (await get(`/requests/${requestId}`, caller)).body.data.actions.uploadDocument;

  it('follows the upload rule exactly', async () => {
    const { teacher, kepala, sarpras, registrar, overseer, request } = await approved();

    expect(await flag(request.id, teacher)).toBe(true);
    expect(await flag(request.id, sarpras)).toBe(true);
    expect(await flag(request.id, registrar)).toBe(true);
    expect(await flag(request.id, overseer)).toBe(true);
    // Former actor.
    expect(await flag(request.id, kepala)).toBe(false);

    // Once the request has ended, nobody may upload.
    await query(`UPDATE public.requests SET status = 'CLOSED', closed_at = now() WHERE id = $1`, [
      request.id,
    ]);
    expect(await flag(request.id, teacher)).toBe(false);
    expect(await flag(request.id, overseer)).toBe(false);
  });

  it('is false without the code', async () => {
    await workflow(FLOW);
    const teacher = await person(
      REQUESTER.filter((code) => code !== 'request-document:create'),
      ['COMMON_TEACHER']
    );
    const draft = await draftFor(teacher);
    expect(await flag(draft.id, teacher)).toBe(false);
  });
});

describe('isolation (H9) and no mandatory type (H6)', () => {
  it('changes nothing but the documents themselves', async () => {
    const { teacher, sarpras, registrar, overseer, request } = await approved();
    const before = await snapshot(request.id);

    const a = (await upload(request.id, teacher, { type: 'PROPOSAL' })).body.data;
    const b = (await upload(request.id, sarpras, { type: 'INVOICE' })).body.data;
    await upload(request.id, registrar, { type: 'BAST' });
    await upload(request.id, overseer, { type: 'RECEIPT' });
    await del(`/request-documents/${a.id}`, overseer);
    await del(`/request-documents/${b.id}`, overseer);

    expect(await snapshot(request.id)).toEqual(before);
    expect(await documentCount(request.id)).toBe(2);
  });

  it('submits with no documents, and with no proposal', async () => {
    const people = await cast();
    expect((await post(`/requests/${people.draft.id}/submit`, {}, people.teacher)).status).toBe(
      200
    );

    const other = await draftFor(people.teacher);
    await upload(other.id, people.teacher, { type: 'SUPPORTING' });
    expect((await post(`/requests/${other.id}/submit`, {}, people.teacher)).status).toBe(200);
  });

  it('declares acquisition with no documents, and it completes PROCURE only', async () => {
    const { sarpras, request } = await approved();
    const done = await post(`/request-steps/${request.steps[1].id}/complete`, {}, sarpras);

    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('APPROVED');
    expect(done.body.data.steps.map((step) => step.state)).toEqual(['APPROVED', 'DONE', 'ACTIVE']);
  });

  it('leaves asset attachments untouched', async () => {
    const { teacher, draft } = await cast();
    const before = await models.Attachment.count();
    await upload(draft.id, teacher);
    expect(await models.Attachment.count()).toBe(before);
  });
});

describe('audit and the PIC ceiling', () => {
  it('records create and delete, with the storage reference redacted', async () => {
    const { teacher, draft } = await cast();
    const created = (await upload(draft.id, teacher)).body.data;
    await del(`/request-documents/${created.id}`, teacher);

    const rows = await models.AuditLog.findAll({
      where: { entityType: 'RequestDocument', entityId: created.id },
      order: [['timestamp', 'ASC']],
    });
    expect(rows.map((row) => row.action)).toEqual(['CREATE', 'DELETE']);
    expect(rows.every((row) => row.actorId === teacher.user.id)).toBe(true);
    expect(rows[0].newValues).toMatchObject({
      documentType: 'SUPPORTING',
      storageReference: '[REDACTED]',
    });
  });

  it('adds no document code to the PIC ceiling', () => {
    expect(PIC_ALLOWED_PERMISSIONS.size).toBe(30);
    for (const code of DOCS) expect(PIC_ALLOWED_PERMISSIONS.has(code)).toBe(false);
  });
});

/** Migration 053's `down()` refuses while documents exist (cycle database). */
describe('rolling back migration 053', () => {
  const CYCLE = cycleDatabaseUrl();
  const NAME = '20260927010000-053-create-request-documents.js';

  beforeAll(async () => {
    await migrate(CYCLE);
  });

  it('refuses while a document exists, then rolls back and re-applies when empty', async () => {
    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('Cycle D', 'CYCLED', 'Jl. D') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-docs', $1, 'Cycle', 'Docs', $2) RETURNING id`,
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
      `INSERT INTO public.request_documents (request_id, document_type, file_name, file_type,
         file_size, storage_reference, uploaded_by)
       VALUES ($1, 'PROPOSAL', 'a.pdf', 'application/pdf', 10, 'requests/x/a.pdf', $2)`,
      [request.id, user.id],
      CYCLE
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', NAME], CYCLE)).rejects.toThrow(
        /Migration 053 rollback refused/
      );
    } finally {
      await query('DELETE FROM public.request_documents', [], CYCLE);
      await query('DELETE FROM public.requests', [], CYCLE);
      await query('DELETE FROM public.position_assignments', [], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }

    // Migration 057: receipt confirmations reference requests, request documents
    // and receipts, so 057 comes off first (and is re-applied with the rest).
    // Migration 062: confirmation photos name receipts of 055 / 057 — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261005010000-062-add-receipt-unit-photos.js'],
      CYCLE
    );
    // Migration 058 (P6): request views reference requests — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261002010000-058-create-request-views.js'],
      CYCLE
    );
    await runCli(
      ['db:migrate:undo', '--name', '20261001010000-057-create-receipt-confirmations.js'],
      CYCLE
    );
    await runCli(['db:migrate:undo', '--name', NAME], CYCLE);
    const [gone] = await query(`SELECT to_regclass('public.request_documents') AS docs`, [], CYCLE);
    expect(gone.docs).toBeNull();
    await migrate(CYCLE);
    const [back] = await query(
      `SELECT to_regclass('public.request_documents')::text AS docs`,
      [],
      CYCLE
    );
    expect(back.docs).toBe('request_documents');
  });
});
