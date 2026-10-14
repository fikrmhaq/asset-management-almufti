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
const { REQUEST_STATUSES } = require('../../src/domain/requestStatuses.js');
const { STEP_STATES } = require('../../src/domain/requestStepStates.js');

/**
 * Request Revision — REQ-REQUEST-018, migration 059 (`IMPLEMENTATION_PLAN.md`
 * §65). The matrix of the approved design, A – T:
 *
 *   RETURN      an ACTIVE decision's actor returns a SUBMITTED request with a
 *               reason and optional per-item notes; the rest of the cycle closes
 *   EDIT        the requester edits as in a DRAFT, but the category, and the
 *               department when a frozen step is department-bound, are fixed
 *   RESUBMIT    the same submit call; a new cycle copied from the newest one —
 *               never from the workflow definition — restarts at decision 1
 *   HISTORY     earlier cycles, reasons and notes are never rewritten
 *   NEEDED      RESUBMIT for the requester; DECIDE only for the first approver
 *   UPDATES     the return reaches the requester; the resubmission reaches every
 *               current DECIDE holder of the new cycle — and only that event
 *   BOUNDARY    approval stage only; authorization; cancellation; documents
 *   SCHEMA      constraints, existing rows as cycle 1, the guarded rollback
 */

const V1 = '/api/v1';
const MIGRATION = '20261002020000-059-create-request-revisions.js';

const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request:submit',
  'request:cancel',
  'request-item:create',
  'request-item:update',
  'request-item:delete',
  'request-document:create',
  'request-document:read',
  'request-document:delete',
];
const APPROVER = ['request:read', 'request-step:decide', 'request-document:read'];
const SARPRAS = [
  ...APPROVER,
  'request-step:complete',
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
  'request:oversee',
  'request:update',
  'request:cancel',
  'request:submit',
  'request-step:decide',
];

/** The intended ALM-1 COMMON flow: Sarpras, then the head, then acquisition. */
const FLOW = [
  ['DECIDE', 'WAKASEK_SARPRAS'],
  ['DECIDE', 'KEPALA_SEKOLAH'],
  ['PROCURE', 'WAKASEK_SARPRAS'],
  ['REGISTER', 'WAKASEK_SARPRAS'],
];

const LEAF = '117010101001';

let alpha;
let tkj;
let rpl;
let cast;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  tkj = await models.Department.create({ code: 'TKJ', name: 'TKJ', institutionId: alpha.id });
  rpl = await models.Department.create({ code: 'RPL', name: 'RPL', institutionId: alpha.id });
  cast = {
    teacher: await person(REQUESTER, [['COMMON_TEACHER']]),
    sarpras: await person(SARPRAS, [['WAKASEK_SARPRAS']]),
    kepala: await person(APPROVER, [['KEPALA_SEKOLAH']]),
    overseer: await person(OVERSEER),
    // Holds the decide permission but no position: never an actor.
    outsider: await person(APPROVER),
  };
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
  return { ...caller, assignment: assignments[0] };
}

async function workflow(
  steps,
  { category = 'COMMON', requester = 'COMMON_TEACHER', version = 1 } = {}
) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: alpha.id,
    category,
    requesterPositionCode: requester,
    version,
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

async function submitted({ requester = cast.teacher, body = {}, items = 2 } = {}) {
  const created = await post(
    '/requests',
    {
      requesterAssignmentId: requester.assignment.id,
      category: 'COMMON',
      title: 'Proyektor',
      ...body,
    },
    requester
  );
  expect(created.status).toBe(201);
  for (let i = 0; i < items; i += 1) {
    const item = await post(
      `/requests/${created.body.data.id}/items`,
      { description: `Barang ${i + 1}`, quantityRequested: 2 },
      requester
    );
    expect(item.status).toBe(201);
  }
  const response = await post(`/requests/${created.body.data.id}/submit`, {}, requester);
  expect(response.status).toBe(200);
  return response.body.data;
}

const detail = async (id, caller = cast.teacher) =>
  (await get(`/requests/${id}`, caller)).body.data;
const activeStep = (request) => request.steps.find((step) => step.state === 'ACTIVE');
const decide = (stepId, caller, body) => post(`/request-steps/${stepId}/decide`, body, caller);
const approve = (stepId, caller) => decide(stepId, caller, { decision: 'APPROVE' });
const revise = (stepId, caller, comment = 'Spesifikasi kurang jelas', itemNotes) =>
  decide(stepId, caller, {
    decision: 'REQUEST_REVISION',
    comment,
    ...(itemNotes ? { itemNotes } : {}),
  });
const resubmit = (id, caller = cast.teacher) => post(`/requests/${id}/submit`, {}, caller);

async function rows(requestId) {
  return (
    await models.RequestStep.findAll({
      where: { requestId },
      order: [
        ['cycle', 'ASC'],
        ['sequence', 'ASC'],
      ],
      raw: true,
    })
  ).map(
    (step) =>
      `${step.cycle}.${step.sequence}:${step.stepType}:${step.actorPositionCode}:${step.state}`
  );
}

/** The request returned by Sarpras at step 1 — cycle 1 — with notes on item 1. */
async function returned({ notes = true } = {}) {
  const request = await submitted();
  const items = request.items;
  const response = await revise(
    activeStep(request).id,
    cast.sarpras,
    'Spesifikasi kurang jelas',
    notes ? [{ requestItemId: items[0].id, note: 'Sebutkan merek dan tipe' }] : undefined
  );
  expect(response.status).toBe(200);
  return response.body.data;
}

const awaiting = async (caller) =>
  Object.fromEntries(
    (await get('/requests?awaiting=me&pageSize=100', caller)).body.data.map((row) => [
      row.id,
      row.actionsNeeded.map((entry) => entry.kind),
    ])
  );
const updated = async (caller) =>
  Object.fromEntries(
    (await get('/requests?updated=me&pageSize=100', caller)).body.data.map((row) => [
      row.id,
      row.updates.events.map((event) => event.kind),
    ])
  );

// ---------------------------------------------------------------------------

describe('the schema (migration 059)', () => {
  it('holds the status and step-state lists to the JavaScript constants', async () => {
    const literals = async (name) => {
      const [row] = await query(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1`,
        [name]
      );
      return [...row.definition.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
    };
    expect(await literals('chk_requests_status')).toEqual([...REQUEST_STATUSES].sort());
    expect(await literals('chk_request_steps_state')).toEqual([...STEP_STATES].sort());
    expect(REQUEST_STATUSES).toContain('REVISION_REQUESTED');
    expect(STEP_STATES).toContain('RETURNED');
  });

  it('gives a step written without a cycle cycle 1, and keeps (request, cycle, sequence) unique', async () => {
    await workflow(FLOW);
    const request = await submitted();
    expect(request.cycle).toBe(1);
    const [step] = await query(
      `SELECT cycle FROM public.request_steps WHERE request_id = $1 AND sequence = 1`,
      [request.id]
    );
    expect(step.cycle).toBe(1);
    await expect(
      query(
        `INSERT INTO public.request_steps (request_id, cycle, sequence, step_type,
           actor_position_code, skip_if_requester_is_actor)
         VALUES ($1, 1, 1, 'DECIDE', 'KEPALA_SEKOLAH', false)`,
        [request.id]
      )
    ).rejects.toThrow(/uq_request_steps_cycle_sequence/);
  });

  it('refuses a RETURNED step without its reason, without who acted, or that is not a decision (K)', async () => {
    await workflow(FLOW);
    const request = await submitted();
    const insert = (sequence, type, extra) =>
      query(
        `INSERT INTO public.request_steps (request_id, cycle, sequence, step_type,
           actor_position_code, skip_if_requester_is_actor, state, acted_by_user_id,
           acted_as_assignment_id, completed_at, comment)
         VALUES ($1, 9, $2, $3, 'WAKASEK_SARPRAS', false, 'RETURNED', $4, $5, now(), $6)`,
        [request.id, sequence, type, ...extra]
      );
    const actor = [cast.sarpras.user.id, cast.sarpras.assignment.id];
    await expect(insert(1, 'DECIDE', [...actor, null])).rejects.toThrow(
      /chk_request_steps_decision_comment/
    );
    await expect(insert(2, 'DECIDE', [null, null, 'Alasan'])).rejects.toThrow(
      /chk_request_steps_acted/
    );
    await expect(insert(3, 'PROCURE', [...actor, 'Alasan'])).rejects.toThrow(
      /chk_request_steps_returned_decide|chk_request_steps_mode/
    );
  });

  it('refuses to roll back while revision data exists, then rolls back and re-applies empty (P)', async () => {
    const CYCLE = cycleDatabaseUrl();
    await migrate(CYCLE);

    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('R', 'RVS', 'x') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-revisions', $1, 'Cycle', 'Revisions', $2) RETURNING id`,
      [`$2b$10$${'0'.repeat(53)}`, institution.id],
      CYCLE
    );
    const [assignment] = await query(
      `INSERT INTO public.position_assignments (institution_id, user_id, position_code)
       VALUES ($1, $2, 'COMMON_TEACHER') RETURNING id`,
      [institution.id, user.id],
      CYCLE
    );
    const [definition] = await query(
      `INSERT INTO public.workflow_definitions (institution_id, category, requester_position_code,
         version, status, published_at)
       VALUES ($1, 'COMMON', 'COMMON_TEACHER', 1, 'ACTIVE', now()) RETURNING id`,
      [institution.id],
      CYCLE
    );
    const [request] = await query(
      `INSERT INTO public.requests (institution_id, request_number, category, title,
         requester_user_id, requester_assignment_id, requester_position_code, status,
         workflow_definition_id)
       VALUES ($1, 'REQ/2026/0001', 'COMMON', 'T', $2, $3, 'COMMON_TEACHER',
               'REVISION_REQUESTED', $4) RETURNING id`,
      [institution.id, user.id, assignment.id, definition.id],
      CYCLE
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE)).rejects.toThrow(
        /Migration 059 rollback refused/
      );
    } finally {
      await query('DELETE FROM public.requests WHERE id = $1', [request.id], CYCLE);
      await query('DELETE FROM public.workflow_definitions WHERE id = $1', [definition.id], CYCLE);
      await query('DELETE FROM public.position_assignments WHERE id = $1', [assignment.id], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }

    await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);
    const [gone] = await query(
      `SELECT to_regclass('public.request_step_item_notes') AS notes,
              (SELECT count(*)::int FROM information_schema.columns
                WHERE table_name = 'request_steps' AND column_name = 'cycle') AS cycles`,
      [],
      CYCLE
    );
    expect(gone).toEqual({ notes: null, cycles: 0 });
    await migrate(CYCLE);
    const [back] = await query(
      `SELECT to_regclass('public.request_step_item_notes')::text AS notes`,
      [],
      CYCLE
    );
    expect(back.notes).toBe('request_step_item_notes');
  });
});

describe('requesting a revision (REQ-REQUEST-018)', () => {
  beforeEach(async () => {
    await workflow(FLOW);
  });

  it('returns the request from the first decision: RETURNED with its reason, the rest CLOSED (A)', async () => {
    const request = await returned();

    expect(request.status).toBe('REVISION_REQUESTED');
    expect(await rows(request.id)).toEqual([
      '1.1:DECIDE:WAKASEK_SARPRAS:RETURNED',
      '1.2:DECIDE:KEPALA_SEKOLAH:CLOSED',
      '1.3:PROCURE:WAKASEK_SARPRAS:CLOSED',
      '1.4:REGISTER:WAKASEK_SARPRAS:CLOSED',
    ]);
    expect(request.cycle).toBe(1);
    expect(request.revision).toMatchObject({
      cycle: 1,
      sequence: 1,
      actorPositionCode: 'WAKASEK_SARPRAS',
      reason: 'Spesifikasi kurang jelas',
      requestedBy: { id: cast.sarpras.user.id },
      actedAs: { id: cast.sarpras.assignment.id, positionCode: 'WAKASEK_SARPRAS' },
    });
    expect(request.revision.itemNotes).toEqual([
      expect.objectContaining({
        requestItemId: request.items[0].id,
        lineNo: 1,
        itemDescription: 'Barang 1',
        note: 'Sebutkan merek dan tipe',
      }),
    ]);
    expect(request.previousCycles).toEqual([]);
  });

  it('returns it from a later decision, keeping the earlier approval in its cycle (B)', async () => {
    const request = await submitted();
    expect((await approve(activeStep(request).id, cast.sarpras)).status).toBe(200);
    const atKepala = await detail(request.id);
    const response = await revise(activeStep(atKepala).id, cast.kepala, 'Anggaran terlalu besar');
    expect(response.status).toBe(200);

    expect(await rows(request.id)).toEqual([
      '1.1:DECIDE:WAKASEK_SARPRAS:APPROVED',
      '1.2:DECIDE:KEPALA_SEKOLAH:RETURNED',
      '1.3:PROCURE:WAKASEK_SARPRAS:CLOSED',
      '1.4:REGISTER:WAKASEK_SARPRAS:CLOSED',
    ]);
    expect(response.body.data.revision).toMatchObject({
      sequence: 2,
      reason: 'Anggaran terlalu besar',
      itemNotes: [],
    });
  });

  it('requires a reason; notes are optional, one per item of this request, with REQUEST_REVISION only (K, L)', async () => {
    const request = await submitted();
    const step = activeStep(request).id;
    const [first, second] = request.items;

    const noReason = await decide(step, cast.sarpras, { decision: 'REQUEST_REVISION' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].field).toBe('comment');

    const blank = await revise(step, cast.sarpras, '   ');
    expect(blank.status).toBe(400);

    const twice = await revise(step, cast.sarpras, 'x', [
      { requestItemId: first.id, note: 'a' },
      { requestItemId: first.id, note: 'b' },
    ]);
    expect(twice.status).toBe(400);

    const other = await submitted();
    const foreign = await revise(step, cast.sarpras, 'x', [
      { requestItemId: other.items[0].id, note: 'a' },
    ]);
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.details[0].field).toBe('itemNotes');

    const emptyNote = await revise(step, cast.sarpras, 'x', [
      { requestItemId: first.id, note: ' ' },
    ]);
    expect(emptyNote.status).toBe(400);

    const withApproval = await decide(step, cast.sarpras, {
      decision: 'APPROVE',
      itemNotes: [{ requestItemId: first.id, note: 'a' }],
    });
    expect(withApproval.status).toBe(400);

    // Nothing above changed anything.
    expect((await detail(request.id)).status).toBe('SUBMITTED');
    expect(await models.RequestStepItemNote.count()).toBe(0);

    const ok = await revise(step, cast.sarpras, 'Lengkapi', [
      { requestItemId: second.id, note: 'Jumlah 3' },
      { requestItemId: first.id, note: 'Merek?' },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body.data.revision.itemNotes.map((note) => note.lineNo)).toEqual([1, 2]);
  });

  it('is refused to anyone but the step’s current actor — oversight never substitutes (T)', async () => {
    const request = await submitted();
    const step = activeStep(request).id;

    expect((await revise(step, cast.outsider)).status).toBe(404);
    const overseer = await revise(step, cast.overseer);
    expect(overseer.status).toBe(403);
    // The next decision's holder is not this step's actor either.
    expect((await revise(step, cast.kepala)).status).toBe(404);
    expect((await detail(request.id)).status).toBe('SUBMITTED');
  });

  it('is an approval-stage action only: never once APPROVED, acquired or registered (M, N, O)', async () => {
    const request = await submitted({ items: 1 });
    const [first] = request.steps;
    await approve(first.id, cast.sarpras);
    const second = activeStep(await detail(request.id));
    await approve(second.id, cast.kepala);

    const approved = await detail(request.id);
    expect(approved.status).toBe('APPROVED');
    for (const [stepId, caller] of [
      [first.id, cast.sarpras],
      [second.id, cast.kepala],
    ]) {
      const response = await revise(stepId, caller);
      expect(response.status).toBe(409);
    }
    const procure = approved.steps.find((step) => step.stepType === 'PROCURE');
    expect((await revise(procure.id, cast.sarpras)).status).toBe(409);

    // Acquisition declared, then a unit registered: still never.
    expect((await post(`/request-steps/${procure.id}/complete`, {}, cast.sarpras)).status).toBe(
      200
    );
    const registered = await post(
      `/request-items/${approved.items[0].id}/register`,
      { name: 'Proyektor', classificationId: LEAF, unitCount: 1 },
      cast.sarpras
    );
    expect(registered.status).toBe(201);
    for (const [stepId, caller] of [
      [first.id, cast.sarpras],
      [second.id, cast.kepala],
    ]) {
      expect((await revise(stepId, caller)).status).toBe(409);
    }
    expect((await detail(request.id)).status).toBe('APPROVED');
  });
});

describe('editing during a revision (D4, D5, D6)', () => {
  beforeEach(async () => {
    await workflow(FLOW);
  });

  it('lets the requester edit the header and the items as in a draft', async () => {
    const request = await returned();
    const [first, second] = request.items;

    const header = await patch(
      `/requests/${request.id}`,
      { title: 'Proyektor ruang rapat', justification: 'Dipakai rapat', departmentId: tkj.id },
      cast.teacher
    );
    expect(header.status).toBe(200);
    expect(header.body.data).toMatchObject({
      title: 'Proyektor ruang rapat',
      departmentId: tkj.id,
    });

    expect(
      (
        await patch(
          `/request-items/${first.id}`,
          { quantityRequested: 3, specification: 'Epson EB-X51' },
          cast.teacher
        )
      ).status
    ).toBe(200);
    expect(
      (
        await post(
          `/requests/${request.id}/items`,
          { description: 'Layar', quantityRequested: 1 },
          cast.teacher
        )
      ).status
    ).toBe(201);
    expect((await del(`/request-items/${second.id}`, cast.teacher)).status).toBe(204);

    const after = await detail(request.id);
    expect(
      after.items.map((item) => [item.lineNo, item.description, item.quantityRequested])
    ).toEqual([
      [1, 'Barang 1', 3],
      [2, 'Layar', 1],
    ]);
    expect(after.actions).toMatchObject({
      edit: true,
      resubmit: true,
      submit: false,
      discard: false,
    });
  });

  it('keeps a note when its item is deleted: the link detaches, the snapshot stays, both audited (D6)', async () => {
    const request = await returned();
    const [first] = request.items;
    const note = await models.RequestStepItemNote.findOne({ where: { requestItemId: first.id } });

    expect((await del(`/request-items/${first.id}`, cast.teacher)).status).toBe(204);

    const kept = await models.RequestStepItemNote.findByPk(note.id);
    expect(kept).toMatchObject({
      requestItemId: null,
      lineNo: 1,
      itemDescription: 'Barang 1',
      note: 'Sebutkan merek dan tipe',
    });
    expect((await detail(request.id)).revision.itemNotes[0]).toMatchObject({
      requestItemId: null,
      itemDescription: 'Barang 1',
    });
    const audit = await models.AuditLog.findAll({
      where: { entityType: 'RequestStepItemNote', entityId: note.id },
      order: [['timestamp', 'ASC']],
    });
    expect(audit.map((entry) => entry.action)).toEqual(['CREATE', 'UPDATE']);
  });

  it('fixes the category: the frozen process belongs to it (D5)', async () => {
    const request = await returned();
    const same = await patch(
      `/requests/${request.id}`,
      { category: 'COMMON', title: 'T2' },
      cast.teacher
    );
    expect(same.status).toBe(200);

    const changed = await patch(`/requests/${request.id}`, { category: 'KBM' }, cast.teacher);
    expect(changed.status).toBe(409);
    expect(changed.body.error.details[0].field).toBe('category');
    expect((await detail(request.id)).category).toBe('COMMON');
  });

  it('fixes the department when a frozen step is department-bound — decided by the steps, not the requester (D5)', async () => {
    // A requester whose own position is NOT department-bound, on a process
    // with a Kajur decision: the department chooses that Kajur.
    await workflow(
      [
        ['DECIDE', 'KAJUR'],
        ['PROCURE', 'WAKASEK_SARPRAS'],
        ['REGISTER', 'WAKASEK_SARPRAS'],
      ],
      { category: 'JURUSAN', requester: 'WAKASEK_KURIKULUM' }
    );
    const wakakur = await person(REQUESTER, [['WAKASEK_KURIKULUM']]);
    const kajur = await person(APPROVER, [['KAJUR', tkj]]);
    const request = await submitted({
      requester: wakakur,
      body: { category: 'JURUSAN', departmentId: tkj.id },
    });
    expect((await revise(activeStep(request).id, kajur)).status).toBe(200);

    const moved = await patch(`/requests/${request.id}`, { departmentId: rpl.id }, wakakur);
    expect(moved.status).toBe(409);
    expect(moved.body.error.details[0].field).toBe('departmentId');
    expect(
      (await patch(`/requests/${request.id}`, { departmentId: tkj.id, title: 'Sama' }, wakakur))
        .status
    ).toBe(200);
  });

  it('keeps the uploader’s documents: deleting is DRAFT-only, uploading continues (D4)', async () => {
    const created = await post(
      '/requests',
      { requesterAssignmentId: cast.teacher.assignment.id, category: 'COMMON', title: 'P' },
      cast.teacher
    );
    const id = created.body.data.id;
    await post(`/requests/${id}/items`, { description: 'A', quantityRequested: 1 }, cast.teacher);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const upload = () =>
      api()
        .post(`${V1}/requests/${id}/documents`)
        .set(...cast.teacher.auth)
        .field('documentType', 'PROPOSAL')
        .attach('file', pdf, { filename: 'usulan.pdf', contentType: 'application/pdf' });
    const document = (await upload()).body.data;
    await post(`/requests/${id}/submit`, {}, cast.teacher);
    await revise(activeStep(await detail(id)).id, cast.sarpras);

    expect((await del(`/request-documents/${document.id}`, cast.teacher)).status).toBe(409);
    expect((await upload()).status).toBe(201);
  });

  it('is the requester’s alone: oversight changes only the destination (T)', async () => {
    const request = await returned();
    const overseer = await patch(`/requests/${request.id}`, { title: 'X' }, cast.overseer);
    expect(overseer.status).toBe(409);
    // An approver holds no request:update at all.
    const approver = await patch(`/requests/${request.id}`, { title: 'X' }, cast.sarpras);
    expect(approver.status).toBe(403);
    expect((await detail(request.id)).title).toBe('Proyektor');
  });
});

describe('resubmitting (D2): the same frozen snapshot, a new cycle', () => {
  beforeEach(async () => {
    await workflow(FLOW);
  });

  it('restarts the chain at decision 1, with nothing carried forward (C, D, F)', async () => {
    const request = await submitted();
    await approve(activeStep(request).id, cast.sarpras);
    await revise(activeStep(await detail(request.id)).id, cast.kepala, 'Kurangi jumlah');
    const before = await models.Request.findByPk(request.id);

    const response = await resubmit(request.id);
    expect(response.status).toBe(200);
    const after = response.body.data;

    expect(after.status).toBe('SUBMITTED');
    expect(after.cycle).toBe(2);
    expect(after.workflowDefinitionId).toBe(before.workflowDefinitionId);
    expect(after.submittedAt).toBe(before.submittedAt.toISOString());
    expect(after.steps.map((step) => `${step.cycle}.${step.sequence}:${step.state}`)).toEqual([
      '2.1:ACTIVE',
      '2.2:PENDING',
      '2.3:PENDING',
      '2.4:PENDING',
    ]);
    expect(after.revision).toBeNull();
    expect(after.cycleStartedAt).toBeTruthy();
    expect(after.previousCycles).toHaveLength(1);
    expect(after.previousCycles[0]).toMatchObject({
      cycle: 1,
      revision: { sequence: 2, reason: 'Kurangi jumlah', requestedBy: { id: cast.kepala.user.id } },
    });
    expect(after.previousCycles[0].steps.map((step) => step.state)).toEqual([
      'APPROVED',
      'RETURNED',
      'CLOSED',
      'CLOSED',
    ]);

    // The cycle-1 approval by Sarpras does not count: they decide again.
    expect((await approve(after.steps[0].id, cast.sarpras)).status).toBe(200);
    const atKepala = await detail(request.id);
    expect(activeStep(atKepala).sequence).toBe(2);
    expect((await approve(activeStep(atKepala).id, cast.kepala)).status).toBe(200);
    const approved = await detail(request.id);
    expect(approved.status).toBe('APPROVED');
    expect(approved.steps.map((step) => step.state)).toEqual([
      'APPROVED',
      'APPROVED',
      'ACTIVE',
      'ACTIVE',
    ]);
  });

  it('leaves every earlier cycle exactly as decided (E)', async () => {
    const request = await returned();
    const snapshot = async () =>
      models.RequestStep.findAll({
        where: { requestId: request.id, cycle: 1 },
        raw: true,
        order: [['sequence', 'ASC']],
      });
    const notes = async () => models.RequestStepItemNote.findAll({ raw: true });
    const [stepsBefore, notesBefore] = [await snapshot(), await notes()];

    await resubmit(request.id);
    const again = await detail(request.id);
    await revise(activeStep(again).id, cast.sarpras, 'Masih kurang');
    await resubmit(request.id);
    await approve(activeStep(await detail(request.id)).id, cast.sarpras);

    expect(await snapshot()).toEqual(stepsBefore);
    expect(await notes()).toEqual(expect.arrayContaining(notesBefore));
    expect(await rows(request.id)).toEqual([
      '1.1:DECIDE:WAKASEK_SARPRAS:RETURNED',
      '1.2:DECIDE:KEPALA_SEKOLAH:CLOSED',
      '1.3:PROCURE:WAKASEK_SARPRAS:CLOSED',
      '1.4:REGISTER:WAKASEK_SARPRAS:CLOSED',
      '2.1:DECIDE:WAKASEK_SARPRAS:RETURNED',
      '2.2:DECIDE:KEPALA_SEKOLAH:CLOSED',
      '2.3:PROCURE:WAKASEK_SARPRAS:CLOSED',
      '2.4:REGISTER:WAKASEK_SARPRAS:CLOSED',
      '3.1:DECIDE:WAKASEK_SARPRAS:APPROVED',
      '3.2:DECIDE:KEPALA_SEKOLAH:ACTIVE',
      '3.3:PROCURE:WAKASEK_SARPRAS:PENDING',
      '3.4:REGISTER:WAKASEK_SARPRAS:PENDING',
    ]);
    const shown = await detail(request.id);
    expect(shown.previousCycles.map((cycle) => [cycle.cycle, cycle.revision.reason])).toEqual([
      [1, 'Spesifikasi kurang jelas'],
      [2, 'Masih kurang'],
    ]);
  });

  it('never re-reads the definition: a new version, or a retired one, changes nothing (G)', async () => {
    const request = await returned();
    const v1 = await models.WorkflowDefinition.findByPk(
      (await models.Request.findByPk(request.id)).workflowDefinitionId
    );
    await v1.update({ status: 'RETIRED', retiredAt: new Date() });
    const v2 = await workflow(
      [
        ['DECIDE', 'WAKASEK_SARPRAS'],
        ['DECIDE', 'KEPALA_SEKOLAH'],
        ['DECIDE', 'WAKASEK_KESISWAAN'],
        ...FLOW.slice(2),
      ],
      { version: 2 }
    );

    const response = await resubmit(request.id);
    expect(response.status).toBe(200);
    expect(response.body.data.workflowDefinitionId).toBe(v1.id);
    expect(response.body.data.steps.map((step) => step.actorPositionCode)).toEqual([
      'WAKASEK_SARPRAS',
      'KEPALA_SEKOLAH',
      'WAKASEK_SARPRAS',
      'WAKASEK_SARPRAS',
    ]);
    // A new request does take the new version.
    expect((await submitted()).workflowDefinitionId).toBe(v2.id);
  });

  it('applies the submission blockers but never "no process configured" (D2)', async () => {
    const request = await returned();
    await models.WorkflowDefinition.update(
      { status: 'RETIRED', retiredAt: new Date() },
      { where: {} }
    );

    // Every item removed: blocked, and listed on the detail.
    for (const item of request.items) await del(`/request-items/${item.id}`, cast.teacher);
    const blocked = await detail(request.id);
    expect(blocked.submitBlockers.map((blocker) => blocker.code)).toEqual(['NO_ITEMS']);
    expect(blocked.actionsNeeded).toEqual([{ kind: 'RESUBMIT', blocked: true }]);
    const refused = await resubmit(request.id);
    expect(refused.status).toBe(400);
    expect(refused.body.error.details[0].field).toBe('items');

    await post(
      `/requests/${request.id}/items`,
      { description: 'Ganti', quantityRequested: 1 },
      cast.teacher
    );
    expect((await detail(request.id)).submitBlockers).toEqual([]);
    expect((await resubmit(request.id)).status).toBe(200);
  });

  it('needs no detectable change (Q2e), and is the requester’s alone (T)', async () => {
    const request = await returned();
    expect((await resubmit(request.id, cast.overseer)).status).toBe(403);
    expect((await resubmit(request.id, cast.sarpras)).status).toBe(403);
    expect((await resubmit(request.id)).status).toBe(200);
    expect((await resubmit(request.id)).status).toBe(409);
  });

  it('refuses an earlier cycle’s step for good (D8)', async () => {
    const request = await returned();
    const old = request.steps[0].id;
    await resubmit(request.id);
    const response = await approve(old, cast.sarpras);
    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toMatch(/earlier approval cycle/);
  });
});

describe('cancelling a returned request (D3)', () => {
  beforeEach(async () => {
    await workflow(FLOW);
  });

  it('is allowed to the requester with a reason', async () => {
    const request = await returned();
    expect((await post(`/requests/${request.id}/cancel`, {}, cast.teacher)).status).toBe(400);
    const response = await post(
      `/requests/${request.id}/cancel`,
      { reason: 'Tidak jadi' },
      cast.teacher
    );
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('CANCELLED');
    // The returned cycle is untouched by the ending.
    expect(await rows(request.id)).toEqual([
      '1.1:DECIDE:WAKASEK_SARPRAS:RETURNED',
      '1.2:DECIDE:KEPALA_SEKOLAH:CLOSED',
      '1.3:PROCURE:WAKASEK_SARPRAS:CLOSED',
      '1.4:REGISTER:WAKASEK_SARPRAS:CLOSED',
    ]);
    expect((await resubmit(request.id)).status).toBe(409);
  });

  it('is allowed with oversight, not to an approver', async () => {
    const request = await returned();
    expect((await detail(request.id, cast.overseer)).actions.cancel).toBe(true);
    expect(
      (await post(`/requests/${request.id}/cancel`, { reason: 'x' }, cast.sarpras)).status
    ).toBe(403);
    const response = await post(
      `/requests/${request.id}/cancel`,
      { reason: 'Dobel' },
      cast.overseer
    );
    expect(response.status).toBe(200);
  });
});

describe('Action Needed (P5) through a revision', () => {
  beforeEach(async () => {
    await workflow(FLOW);
  });

  it('asks the requester to resubmit, and no approver to decide, while returned (J)', async () => {
    const request = await returned();

    expect((await detail(request.id)).actionsNeeded).toEqual([
      { kind: 'RESUBMIT', blocked: false },
    ]);
    expect(await awaiting(cast.teacher)).toEqual({ [request.id]: ['RESUBMIT'] });
    expect(await awaiting(cast.sarpras)).toEqual({});
    expect(await awaiting(cast.kepala)).toEqual({});
    expect((await get('/requests/attention', cast.teacher)).body.data.actionNeeded).toBe(1);
    expect((await get('/requests/attention', cast.sarpras)).body.data.actionNeeded).toBe(0);
  });

  it('asks only the first approver after resubmission, then the next in turn (I)', async () => {
    const request = await returned();
    await resubmit(request.id);

    expect(await awaiting(cast.teacher)).toEqual({});
    expect(await awaiting(cast.sarpras)).toEqual({ [request.id]: ['DECIDE'] });
    expect(await awaiting(cast.kepala)).toEqual({});

    await approve(activeStep(await detail(request.id)).id, cast.sarpras);
    expect(await awaiting(cast.sarpras)).toEqual({});
    expect(await awaiting(cast.kepala)).toEqual({ [request.id]: ['DECIDE'] });
    expect((await get('/requests/attention', cast.kepala)).body.data.actionNeeded).toBe(1);
  });
});

describe('Request Updates (P6) and the narrow visibility exception (D10)', () => {
  beforeEach(async () => {
    await workflow(FLOW);
  });

  it('tells the requester of the revision request', async () => {
    const request = await returned();
    const events = (await detail(request.id)).unseenUpdates.events;
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'STEP_DECIDED',
        detail: 'RETURNED',
        extra: 'WAKASEK_SARPRAS',
        by: expect.objectContaining({ id: cast.sarpras.user.id }),
      }),
    ]);
  });

  it('tells every DECIDE holder of the restarted chain of the resubmission — including one who never acted (H)', async () => {
    const request = await returned();
    // Returned at step 1: the Kepala never saw it, and cannot yet.
    expect((await get(`/requests/${request.id}`, cast.kepala)).status).toBe(404);

    await resubmit(request.id);

    expect(await updated(cast.kepala)).toEqual({ [request.id]: ['REQUEST_RESUBMITTED'] });
    expect(await updated(cast.sarpras)).toEqual({
      [request.id]: expect.arrayContaining(['REQUEST_RESUBMITTED']),
    });
    // The requester's own act is never an update to them.
    expect((await detail(request.id)).unseenUpdates.events.map((e) => e.kind)).not.toContain(
      'REQUEST_RESUBMITTED'
    );

    const asKepala = await get(`/requests/${request.id}`, cast.kepala);
    expect(asKepala.status).toBe(200);
    expect(asKepala.body.data.unseenUpdates.events).toEqual([
      expect.objectContaining({
        kind: 'REQUEST_RESUBMITTED',
        by: expect.objectContaining({ id: cast.teacher.user.id }),
      }),
    ]);
    // Update, never action: the Kepala's step is not open.
    expect(asKepala.body.data.actionsNeeded).toEqual([]);
    expect((await get('/requests/attention', cast.kepala)).body.data).toEqual({
      actionNeeded: 0,
      updated: 1,
    });
  });

  it('gives that holder the resubmission only — not the request’s other events', async () => {
    const request = await returned();
    await resubmit(request.id);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const added = await api()
      .post(`${V1}/requests/${request.id}/documents`)
      .set(...cast.teacher.auth)
      .field('documentType', 'SUPPORTING')
      .attach('file', pdf, { filename: 'lampiran.pdf', contentType: 'application/pdf' });
    expect(added.status).toBe(201);

    expect(await updated(cast.kepala)).toEqual({ [request.id]: ['REQUEST_RESUBMITTED'] });
    // Sarpras is the active actor, so involved: they see both.
    expect((await updated(cast.sarpras))[request.id]).toEqual(
      expect.arrayContaining(['DOCUMENT_ADDED', 'REQUEST_RESUBMITTED'])
    );
  });

  it('lapses with the position, and never reaches a holder of no DECIDE step', async () => {
    const request = await returned();
    await resubmit(request.id);
    const kesiswaan = await person(APPROVER, [['WAKASEK_KESISWAAN']]);
    expect((await get(`/requests/${request.id}`, kesiswaan)).status).toBe(404);
    expect(await updated(kesiswaan)).toEqual({});

    await models.PositionAssignment.update(
      { isCurrent: false, endedAt: new Date() },
      { where: { userId: cast.kepala.user.id } }
    );
    expect((await get(`/requests/${request.id}`, cast.kepala)).status).toBe(404);
    expect(await updated(cast.kepala)).toEqual({});
  });
});

describe('requests outside any revision are unchanged (P, Q)', () => {
  beforeEach(async () => {
    await workflow(FLOW);
  });

  it('keeps another running request on cycle 1, untouched', async () => {
    const bystander = await submitted();
    const before = await rows(bystander.id);
    const request = await returned();
    await resubmit(request.id);

    expect(await rows(bystander.id)).toEqual(before);
    expect(before.every((row) => row.startsWith('1.'))).toBe(true);
    const shown = await detail(bystander.id);
    expect(shown).toMatchObject({ cycle: 1, revision: null, previousCycles: [] });
  });

  it('still rejects with a comment and ends the request', async () => {
    const request = await submitted();
    const response = await decide(activeStep(request).id, cast.sarpras, {
      decision: 'REJECT',
      comment: 'Tidak ada anggaran',
    });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('REJECTED');
    expect(response.body.data.actions.resubmit).toBe(false);
  });
});
