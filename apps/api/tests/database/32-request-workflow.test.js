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
const { POSITION_CODES } = require('../../src/domain/schoolPositions.js');
const { STEP_TYPES } = require('../../src/domain/workflowShape.js');
const { STEP_STATES } = require('../../src/domain/requestStepStates.js');
const { PIC_ALLOWED_PERMISSIONS } = require('../../src/auth/permissionCatalog.js');

/**
 * Request workflow execution — Phase 38 (`CR-014` §6.1 – §6.4, §10.2),
 * REQ-WF-005 – REQ-WF-007, REQ-REQUEST-007 – REQ-REQUEST-009, REQ-REQUEST-013,
 * REQ-REQUEST-015. Decisions G1 – G4 and F1 – F10.
 *
 *   SUBMISSION   E9 / F8 re-checks, exact match with no fallback, the snapshot.
 *   THE MODEL    one ACTIVE DECIDE; the fulfilment steps open together, in the
 *                approving transaction (G4); PROCURE and REGISTER independent.
 *   ACTORS       live resolution, department scope, vacancy, handover; the actor
 *                check is never satisfied by oversight.
 *   SELF-SKIP    DECIDE only, once, at activation; never when vacant.
 *   ENDINGS      reject, cancel, discard — unfinished steps CLOSED, never DONE.
 *   VISIBILITY   current actor on an ACTIVE step; recorded former actor (F9).
 *   BOUNDARY     permissions, the PIC ceiling, audit, direct registration.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request:submit',
  'request:cancel',
  'request-item:create',
  'request-item:update',
  'request-item:delete',
];
const APPROVER = ['request:read', 'request-step:decide'];
const PROCURER = ['request:read', 'request-step:complete'];
const OVERSEER = ['request:read', 'request:update', 'request:cancel', 'request:oversee'];

let admin;
let alpha;
let beta;
let tkj;
let rpl;

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
  rpl = await models.Department.create({ code: 'RPL', name: 'RPL', institutionId: alpha.id });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

// --- helpers ----------------------------------------------------------------

const call = (method, path, body, caller) => {
  const request = api()
    [method](`${V1}${path}`)
    .set(...caller.auth);
  return body === undefined ? request : request.send(body);
};
const get = (path, caller) => call('get', path, undefined, caller);
const post = (path, body, caller) => call('post', path, body ?? {}, caller);
const patch = (path, body, caller) => call('patch', path, body, caller);

async function hold(user, position, { department = null, institution = alpha } = {}) {
  return models.PositionAssignment.create({
    institutionId: institution.id,
    userId: user.id,
    positionCode: position,
    departmentId: department?.id ?? null,
  });
}

/** A caller with `permissions`, holding each `[position, department?]` given. */
async function person(permissions, positions = [], { institution = alpha } = {}) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: institution.id,
  });
  const assignments = [];
  for (const [position, department] of positions) {
    assignments.push(await hold(caller.user, position, { department, institution }));
  }
  return { ...caller, assignments, assignment: assignments[0] };
}

/** An ACTIVE definition written directly — Phase 36 behaviour is not under test. */
async function workflow(
  steps,
  { category = 'COMMON', requester = 'COMMON_TEACHER', institution = alpha } = {}
) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: institution.id,
    category,
    requesterPositionCode: requester,
    version: 1,
    status: 'ACTIVE',
    publishedAt: new Date(),
  });
  for (const [index, [stepType, actor, extra = {}]] of steps.entries()) {
    await models.WorkflowDefinitionStep.create({
      definitionId: definition.id,
      sequence: index + 1,
      stepType,
      actorPositionCode: actor,
      procurementMode: stepType === 'PROCURE' ? (extra.mode ?? 'INTERNAL') : null,
      skipIfRequesterIsActor: extra.selfSkip ?? false,
    });
  }
  return definition;
}

async function draftFor(requester, body = {}, { items = 1 } = {}) {
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
    await post(
      `/requests/${created.body.data.id}/items`,
      { description: `Barang ${i + 1}`, quantityRequested: 2 },
      requester
    );
  }
  return created.body.data;
}

const submit = (id, caller) => post(`/requests/${id}/submit`, {}, caller);
const decide = (stepId, caller, decision = 'APPROVE', comment) =>
  post(`/request-steps/${stepId}/decide`, { decision, ...(comment ? { comment } : {}) }, caller);
const complete = (stepId, caller, note) =>
  post(`/request-steps/${stepId}/complete`, note ? { note } : {}, caller);
const cancel = (id, caller, reason = 'Tidak jadi') =>
  post(`/requests/${id}/cancel`, { reason }, caller);

const stepsOf = async (requestId) =>
  (await models.RequestStep.findAll({ where: { requestId }, order: [['sequence', 'ASC']] })).map(
    (step) => `${step.sequence}:${step.stepType}:${step.state}`
  );

const statusOf = async (requestId) => (await models.Request.findByPk(requestId)).status;

async function checkLiterals(name) {
  const [row] = await query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1`,
    [name]
  );
  return [...row.definition.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
}

/** The standard flow: two decisions, then acquisition and registration. */
const FLOW = [
  ['DECIDE', 'KEPALA_SEKOLAH'],
  ['DECIDE', 'WAKASEK_SARPRAS'],
  ['PROCURE', 'WAKASEK_SARPRAS'],
  ['REGISTER', 'WAKASEK_SARPRAS'],
];

/** A submitted request on FLOW with its cast. */
async function running() {
  await workflow(FLOW);
  const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
  const kepala = await person(APPROVER, [['KEPALA_SEKOLAH']]);
  const sarpras = await person([...APPROVER, 'request-step:complete'], [['WAKASEK_SARPRAS']]);
  const request = await draftFor(teacher);
  const submitted = await submit(request.id, teacher);
  expect(submitted.status).toBe(200);
  return { teacher, kepala, sarpras, request: submitted.body.data };
}

// ---------------------------------------------------------------------------

describe('the value lists and the schema (DEC-U, F7)', () => {
  it.each([
    ['chk_request_steps_state', STEP_STATES],
    ['chk_request_steps_type', STEP_TYPES],
    ['chk_request_steps_actor', POSITION_CODES],
    ['chk_request_steps_mode', ['PROCURE', 'INTERNAL', 'EXTERNAL']],
  ])('%s admits exactly the JavaScript constant', async (name, constant) => {
    expect(await checkLiterals(name)).toEqual([...constant].sort());
  });

  it('holds one ACTIVE DECIDE per request, and records who acted (F7)', async () => {
    const { request } = await running();
    const insert = (sequence, type, state, extra = '') =>
      query(
        `INSERT INTO public.request_steps
           (request_id, sequence, step_type, actor_position_code, skip_if_requester_is_actor,
            state${extra ? ', ' + extra.split('=')[0] : ''})
         VALUES ($1, $2, $3, 'KEPALA_SEKOLAH', false, $4${extra ? ', ' + extra.split('=')[1] : ''})`,
        [request.id, sequence, type, state]
      );

    await expect(insert(9, 'DECIDE', 'ACTIVE', 'activated_at=now()')).rejects.toThrow(
      /uq_request_steps_one_active_decision/
    );
    await expect(insert(10, 'DECIDE', 'APPROVED', 'completed_at=now()')).rejects.toThrow(
      /chk_request_steps_acted/
    );
    await expect(insert(11, 'DECIDE', 'CLOSED')).rejects.toThrow(/chk_request_steps_finished/);
    await expect(insert(12, 'REGISTER', 'ACTIVE')).rejects.toThrow(/chk_request_steps_activated/);
  });
});

describe('submission (REQ-REQUEST-007)', () => {
  it('copies the ACTIVE definition exactly and opens the first decision', async () => {
    const definition = await workflow(FLOW);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);

    const response = await submit(draft.id, teacher);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      status: 'SUBMITTED',
      workflowDefinitionId: definition.id,
    });
    expect(response.body.data.submittedAt).toBeTruthy();
    expect(
      response.body.data.steps.map((s) => [
        s.sequence,
        s.stepType,
        s.actorPositionCode,
        s.procurementMode,
        s.state,
      ])
    ).toEqual([
      [1, 'DECIDE', 'KEPALA_SEKOLAH', null, 'ACTIVE'],
      [2, 'DECIDE', 'WAKASEK_SARPRAS', null, 'PENDING'],
      [3, 'PROCURE', 'WAKASEK_SARPRAS', 'INTERNAL', 'PENDING'],
      [4, 'REGISTER', 'WAKASEK_SARPRAS', null, 'PENDING'],
    ]);
  });

  it('refuses with 409 when no process is configured, writing nothing', async () => {
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);

    const response = await submit(draft.id, teacher);

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toMatch(/no process is configured/);
    expect(await statusOf(draft.id)).toBe('DRAFT');
    expect(await models.RequestStep.count()).toBe(0);
  });

  it('never falls back to another institution’s, context’s, category’s or version’s definition', async () => {
    await workflow(FLOW, { institution: beta });
    await workflow(FLOW, { requester: 'JURUSAN_TEACHER' });
    await workflow(FLOW, { category: 'KBM' });
    const retired = await workflow(FLOW);
    await retired.update({ status: 'RETIRED', retiredAt: new Date() });
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);

    expect((await submit(draft.id, teacher)).status).toBe(409);
    expect(await statusOf(draft.id)).toBe('DRAFT');
  });

  it('re-checks that the requester context is still current (E9)', async () => {
    await workflow(FLOW);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);
    await teacher.assignment.update({ isCurrent: false, endedAt: new Date() });

    const response = await submit(draft.id, teacher);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0]).toMatchObject({
      field: 'requesterAssignmentId',
      issue: expect.stringMatching(/no longer current/),
    });
    expect(await statusOf(draft.id)).toBe('DRAFT');
    expect(await models.RequestStep.count()).toBe(0);
  });

  it.each([
    ['no item', 'items'],
    ['a deactivated department', 'departmentId'],
    ['a deactivated destination', 'destinationLocationId'],
  ])('re-checks the draft: refuses %s (F8)', async (_, field) => {
    await workflow(FLOW);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const lab = await models.Location.create({
      name: 'Lab',
      classificationId: LEAF,
      institutionId: alpha.id,
    });
    const draft = await draftFor(
      teacher,
      { departmentId: rpl.id, destinationLocationId: lab.id },
      { items: field === 'items' ? 0 : 1 }
    );
    if (field === 'departmentId') await rpl.update({ isActive: false });
    if (field === 'destinationLocationId') await lab.update({ isActive: false });

    const response = await submit(draft.id, teacher);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe(field);
  });

  it('submits only the requester’s own DRAFT', async () => {
    const { teacher, request } = await running();
    const other = await person([...REQUESTER, 'request:oversee'], [['COMMON_TEACHER']]);

    expect((await submit(request.id, teacher)).status).toBe(409);
    expect((await submit(request.id, other)).status).toBe(403);
  });

  it('keeps a running request on its snapshot when a new version is published (BR-029)', async () => {
    const { request } = await running();
    const v1 = await models.WorkflowDefinition.findByPk(request.workflowDefinitionId);
    await v1.update({ status: 'RETIRED', retiredAt: new Date() });
    await models.WorkflowDefinition.create({
      institutionId: alpha.id,
      category: 'COMMON',
      requesterPositionCode: 'COMMON_TEACHER',
      version: 2,
      status: 'ACTIVE',
      publishedAt: new Date(),
    });

    expect(await stepsOf(request.id)).toEqual([
      '1:DECIDE:ACTIVE',
      '2:DECIDE:PENDING',
      '3:PROCURE:PENDING',
      '4:REGISTER:PENDING',
    ]);
    expect((await models.Request.findByPk(request.id)).workflowDefinitionId).toBe(v1.id);
  });
});

/**
 * P1 (`IMPLEMENTATION_PLAN.md` §64): the detail lists every blocker the
 * submission would refuse on, from the same code — the submission itself still
 * refuses on the first, unchanged (the block above).
 */
describe('submit blockers on the detail (P1)', () => {
  const detailOf = async (id, caller) => (await get(`/requests/${id}`, caller)).body.data;

  it('is empty for a submittable draft, and Submit then succeeds', async () => {
    await workflow(FLOW);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);

    const detail = await detailOf(draft.id, teacher);
    expect(detail.actions.submit).toBe(true);
    expect(detail.submitBlockers).toEqual([]);
    expect((await submit(draft.id, teacher)).status).toBe(200);
  });

  it('lists a missing item for the requester, and clears it once an item is added', async () => {
    await workflow(FLOW);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher, {}, { items: 0 });

    expect((await detailOf(draft.id, teacher)).submitBlockers).toEqual([
      {
        code: 'NO_ITEMS',
        field: 'items',
        message: 'A request needs at least one item',
        fixedBy: 'REQUESTER',
      },
    ]);
    await post(
      `/requests/${draft.id}/items`,
      { description: 'Kabel', quantityRequested: 1 },
      teacher
    );
    expect((await detailOf(draft.id, teacher)).submitBlockers).toEqual([]);
  });

  it('lists a missing workflow as the administrator’s, beside the requester’s own', async () => {
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher, {}, { items: 0 });

    const { submitBlockers } = await detailOf(draft.id, teacher);
    expect(submitBlockers.map((b) => [b.code, b.fixedBy])).toEqual([
      ['NO_ITEMS', 'REQUESTER'],
      ['NO_WORKFLOW', 'ADMINISTRATOR'],
    ]);
    // The submission refuses on the first, as it always has.
    const refused = await submit(draft.id, teacher);
    expect(refused.status).toBe(400);
    expect(refused.body.error.details[0].field).toBe('items');
  });

  it('lists an ineligible category instead of a missing workflow', async () => {
    await workflow(FLOW, { requester: 'JURUSAN_TEACHER', category: 'KBM' });
    const teacher = await person(REQUESTER, [['JURUSAN_TEACHER', tkj]]);
    const draft = await draftFor(teacher);
    // A draft saved before the rule existed: written directly.
    await models.Request.update({ category: 'KBM' }, { where: { id: draft.id } });

    expect((await detailOf(draft.id, teacher)).submitBlockers).toEqual([
      expect.objectContaining({
        code: 'CATEGORY_NOT_ELIGIBLE',
        field: 'category',
        fixedBy: 'REQUESTER',
      }),
    ]);
    expect((await submit(draft.id, teacher)).body.error.message).toBe(
      'This category cannot be requested in this capacity'
    );
  });

  it('lists an ended context, a deactivated department and a deactivated destination', async () => {
    await workflow(FLOW);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const lab = await models.Location.create({
      name: 'Lab',
      classificationId: LEAF,
      institutionId: alpha.id,
    });
    const draft = await draftFor(teacher, { departmentId: rpl.id, destinationLocationId: lab.id });
    await rpl.update({ isActive: false });
    await lab.update({ isActive: false });
    await teacher.assignment.update({ isCurrent: false, endedAt: new Date() });

    expect((await detailOf(draft.id, teacher)).submitBlockers.map((b) => b.code)).toEqual([
      'REQUESTER_CONTEXT_ENDED',
      'DEPARTMENT_INACTIVE',
      'DESTINATION_INACTIVE',
    ]);
  });

  it('never makes documents or a destination a blocker', async () => {
    await workflow(FLOW);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);

    const detail = await detailOf(draft.id, teacher);
    expect(detail.destinationLocationId).toBeNull();
    expect(detail.submitBlockers).toEqual([]);
  });

  it('is absent where Submit is not offered: another user, or a submitted request', async () => {
    const { teacher, request } = await running();
    const other = await person([...REQUESTER, 'request:oversee'], [['COMMON_TEACHER']]);

    expect((await detailOf(request.id, teacher)).submitBlockers).toBeUndefined();
    expect((await detailOf(request.id, other)).submitBlockers).toBeUndefined();
  });
});

describe('the execution model (G1 – G4)', () => {
  it('runs decisions in order, then opens PROCURE and REGISTER in the approving call (G4)', async () => {
    const { kepala, sarpras, request } = await running();
    const step = (n) => request.steps[n - 1].id;

    // Not yet open — and the Wakasek Sarpras cannot even see the request until
    // their step is ACTIVE (F9), so the answer is 404.
    expect((await decide(step(2), sarpras)).status).toBe(404);
    expect((await decide(step(1), kepala)).status).toBe(200);
    expect(await stepsOf(request.id)).toEqual([
      '1:DECIDE:APPROVED',
      '2:DECIDE:ACTIVE',
      '3:PROCURE:PENDING',
      '4:REGISTER:PENDING',
    ]);

    const final = await decide(step(2), sarpras);

    // Committed together: every DECIDE finished AND the fulfilment steps open.
    expect(final.status).toBe(200);
    expect(final.body.data.status).toBe('APPROVED');
    expect(final.body.data.approvedAt).toBeTruthy();
    expect(await stepsOf(request.id)).toEqual([
      '1:DECIDE:APPROVED',
      '2:DECIDE:APPROVED',
      '3:PROCURE:ACTIVE',
      '4:REGISTER:ACTIVE',
    ]);
  });

  it('never leaves a committed state with every DECIDE finished and a fulfilment step PENDING', async () => {
    const { kepala, sarpras, request } = await running();
    await decide(request.steps[0].id, kepala);
    await decide(request.steps[1].id, sarpras);

    const [row] = await query(
      `SELECT count(*)::int AS stranded FROM public.requests r
        WHERE NOT EXISTS (SELECT 1 FROM public.request_steps s
                           WHERE s.request_id = r.id AND s.step_type = 'DECIDE'
                             AND s.state IN ('PENDING', 'ACTIVE'))
          AND EXISTS (SELECT 1 FROM public.request_steps s
                       WHERE s.request_id = r.id AND s.step_type <> 'DECIDE'
                         AND s.state = 'PENDING')
          AND r.status NOT IN ('REJECTED', 'CANCELLED')`
    );
    expect(row.stranded).toBe(0);
  });

  it('approves at submission when the definition has no decision', async () => {
    await workflow([
      ['PROCURE', 'WAKASEK_SARPRAS', { mode: 'EXTERNAL' }],
      ['REGISTER', 'WAKASEK_SARPRAS'],
    ]);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);

    const response = await submit(draft.id, teacher);

    expect(response.body.data.status).toBe('APPROVED');
    expect(await stepsOf(draft.id)).toEqual(['1:PROCURE:ACTIVE', '2:REGISTER:ACTIVE']);
    expect(response.body.data.steps[0].procurementMode).toBe('EXTERNAL');
  });

  it('opens REGISTER alone when there is no PROCURE', async () => {
    await workflow([
      ['DECIDE', 'KEPALA_SEKOLAH'],
      ['REGISTER', 'WAKASEK_SARPRAS'],
    ]);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const kepala = await person(APPROVER, [['KEPALA_SEKOLAH']]);
    const draft = await draftFor(teacher);
    const submitted = (await submit(draft.id, teacher)).body.data;

    await decide(submitted.steps[0].id, kepala);

    expect(await stepsOf(draft.id)).toEqual(['1:DECIDE:APPROVED', '2:REGISTER:ACTIVE']);
  });

  it('lets exactly one of two concurrent approvals of a step through', async () => {
    const { kepala, request } = await running();

    const responses = await Promise.all([
      decide(request.steps[0].id, kepala),
      decide(request.steps[0].id, kepala),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stepsOf(request.id)).toEqual([
      '1:DECIDE:APPROVED',
      '2:DECIDE:ACTIVE',
      '3:PROCURE:PENDING',
      '4:REGISTER:PENDING',
    ]);
  });
});

describe('decisions (REQ-REQUEST-008)', () => {
  it('records who approved, as which position', async () => {
    const { kepala, request } = await running();

    const response = await decide(request.steps[0].id, kepala, 'APPROVE', 'Setuju');

    const step = response.body.data.steps[0];
    expect(step).toMatchObject({
      state: 'APPROVED',
      actedByUserId: kepala.user.id,
      actedAs: { id: kepala.assignment.id, positionCode: 'KEPALA_SEKOLAH' },
      comment: 'Setuju',
    });
    expect(step.completedAt).toBeTruthy();
  });

  it('requires a comment to reject', async () => {
    const { kepala, request } = await running();

    const response = await decide(request.steps[0].id, kepala, 'REJECT');

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('comment');
  });

  it.each([1, 2])(
    'ends the request when decision %i rejects, closing the rest (F10)',
    async (n) => {
      const { kepala, sarpras, request } = await running();
      if (n === 2) await decide(request.steps[0].id, kepala);

      const response = await decide(
        request.steps[n - 1].id,
        n === 1 ? kepala : sarpras,
        'REJECT',
        'Tidak ada anggaran'
      );

      expect(response.body.data.status).toBe('REJECTED');
      expect(response.body.data.closedAt).toBeTruthy();
      const states = await stepsOf(request.id);
      expect(states[n - 1]).toBe(`${n}:DECIDE:REJECTED`);
      expect(states.slice(n)).toEqual(states.slice(n).map((s) => s.replace(/:[A-Z]+$/, ':CLOSED')));
      expect(states.some((s) => s.endsWith(':DONE'))).toBe(false);
    }
  );

  it('refuses a caller who holds the permission but is not the actor — oversight included (DEC-J)', async () => {
    const { request } = await running();
    const overseer = await person([...APPROVER, ...OVERSEER]);

    const response = await decide(request.steps[0].id, overseer);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.details[0].issue).toMatch(/not the actor of this step/);
  });

  it('refuses the actor who lacks the permission', async () => {
    const { kepala, request } = await running();
    // KEPALA_SEKOLAH is single-holder: end the fixture's before appointing another.
    await kepala.assignment.update({ isCurrent: false, endedAt: new Date() });
    const holderWithoutCode = await person(['request:read'], [['KEPALA_SEKOLAH']]);

    expect((await get(`/requests/${request.id}`, holderWithoutCode)).status).toBe(200);
    expect((await decide(request.steps[0].id, holderWithoutCode)).status).toBe(403);
  });

  it('lets a requester who holds the position decide normally when self-skip is off (Q7 default)', async () => {
    await workflow(FLOW);
    const teacher = await person(REQUESTER.concat('request-step:decide'), [
      ['COMMON_TEACHER'],
      ['KEPALA_SEKOLAH'],
    ]);
    const draft = await draftFor(teacher);
    const submitted = (await submit(draft.id, teacher)).body.data;

    expect(submitted.steps[0]).toMatchObject({ state: 'ACTIVE', canAct: true });
    const response = await decide(submitted.steps[0].id, teacher);

    expect(response.body.data.steps[0]).toMatchObject({
      state: 'APPROVED',
      actedByUserId: teacher.user.id,
    });
  });
});

describe('actors (REQ-WF-005, BR-030)', () => {
  it('shows a vacant step, never skips it, and unblocks it when a holder is assigned', async () => {
    await workflow([
      ['DECIDE', 'WAKASEK_KURIKULUM', { selfSkip: true }],
      ['REGISTER', 'WAKASEK_SARPRAS'],
    ]);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);
    const submitted = (await submit(draft.id, teacher)).body.data;

    expect(submitted.steps[0]).toMatchObject({ state: 'ACTIVE', vacant: true, resolvedActors: [] });

    const kurikulum = await person(APPROVER, [['WAKASEK_KURIKULUM']]);
    const detail = (await get(`/requests/${draft.id}`, kurikulum)).body.data;
    expect(detail.steps[0]).toMatchObject({ vacant: false, canAct: true });
    expect(detail.steps[0].resolvedActors.map((a) => a.userId)).toEqual([kurikulum.user.id]);

    expect((await decide(submitted.steps[0].id, kurikulum)).status).toBe(200);
  });

  it('follows a handover immediately', async () => {
    const { kepala, request } = await running();
    await kepala.assignment.update({ isCurrent: false, endedAt: new Date() });
    const successor = await person(APPROVER, [['KEPALA_SEKOLAH']]);

    expect((await decide(request.steps[0].id, kepala)).status).toBe(404);
    expect((await decide(request.steps[0].id, successor)).status).toBe(200);
  });

  it('does not count a deactivated user as a holder', async () => {
    const { kepala, request, teacher } = await running();
    await kepala.user.update({ isActive: false });

    const detail = (await get(`/requests/${request.id}`, teacher)).body.data;

    expect(detail.steps[0]).toMatchObject({ vacant: true, resolvedActors: [] });
  });

  it('resolves a department-bound actor within the request’s department only', async () => {
    await workflow(
      [
        ['DECIDE', 'KAJUR'],
        ['REGISTER', 'WAKASEK_SARPRAS'],
      ],
      { requester: 'JURUSAN_TEACHER' }
    );
    const teacher = await person(REQUESTER, [['JURUSAN_TEACHER', tkj]]);
    const kajurRpl = await person(APPROVER, [['KAJUR', rpl]]);
    const kajurTkj = await person(APPROVER, [['KAJUR', tkj]]);
    const draft = await draftFor(teacher);
    const submitted = (await submit(draft.id, teacher)).body.data;

    expect((await decide(submitted.steps[0].id, kajurRpl)).status).toBe(404);
    expect((await decide(submitted.steps[0].id, kajurTkj)).status).toBe(200);
  });

  it('does not let another institution’s holder act', async () => {
    const { request } = await running();
    const foreign = await person(APPROVER, [['KEPALA_SEKOLAH']], { institution: beta });

    expect((await decide(request.steps[0].id, foreign)).status).toBe(404);
  });
});

describe('self-skip (REQ-WF-006, F1, F2)', () => {
  it('skips a DECIDE whose flag is set when the requester holds the position', async () => {
    await workflow([
      ['DECIDE', 'KEPALA_SEKOLAH', { selfSkip: true }],
      ['DECIDE', 'WAKASEK_SARPRAS'],
      ['REGISTER', 'WAKASEK_SARPRAS'],
    ]);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER'], ['KEPALA_SEKOLAH']]);
    const draft = await draftFor(teacher);

    const submitted = (await submit(draft.id, teacher)).body.data;

    expect(submitted.steps[0]).toMatchObject({
      state: 'SKIPPED',
      skipReason: 'SELF',
      actedByUserId: null,
    });
    expect(submitted.steps[1].state).toBe('ACTIVE');
  });

  it('approves at submission when every DECIDE is self-skipped (G4)', async () => {
    await workflow([
      ['DECIDE', 'KEPALA_SEKOLAH', { selfSkip: true }],
      ['PROCURE', 'WAKASEK_SARPRAS'],
      ['REGISTER', 'WAKASEK_SARPRAS'],
    ]);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER'], ['KEPALA_SEKOLAH']]);
    const draft = await draftFor(teacher);

    const submitted = (await submit(draft.id, teacher)).body.data;

    expect(submitted.status).toBe('APPROVED');
    expect(await stepsOf(draft.id)).toEqual([
      '1:DECIDE:SKIPPED',
      '2:PROCURE:ACTIVE',
      '3:REGISTER:ACTIVE',
    ]);
  });

  it('does not skip when the flag is set but the requester does not hold the position', async () => {
    await workflow([
      ['DECIDE', 'KEPALA_SEKOLAH', { selfSkip: true }],
      ['REGISTER', 'WAKASEK_SARPRAS'],
    ]);
    await person(APPROVER, [['KEPALA_SEKOLAH']]);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);

    expect((await submit(draft.id, teacher)).body.data.steps[0].state).toBe('ACTIVE');
  });

  it('never skips PROCURE or REGISTER, whatever their flag (F1)', async () => {
    await workflow([
      ['PROCURE', 'KEPALA_SEKOLAH', { selfSkip: true }],
      ['REGISTER', 'KEPALA_SEKOLAH', { selfSkip: true }],
    ]);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER'], ['KEPALA_SEKOLAH']]);
    const draft = await draftFor(teacher);

    await submit(draft.id, teacher);

    expect(await stepsOf(draft.id)).toEqual(['1:PROCURE:ACTIVE', '2:REGISTER:ACTIVE']);
  });

  it('evaluates once, at activation: a later assignment never turns an ACTIVE step into SKIPPED (F2)', async () => {
    await workflow([
      ['DECIDE', 'KEPALA_SEKOLAH'],
      ['DECIDE', 'WAKASEK_SARPRAS', { selfSkip: true }],
      ['REGISTER', 'WAKASEK_SARPRAS'],
    ]);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const kepala = await person(APPROVER, [['KEPALA_SEKOLAH']]);
    const draft = await draftFor(teacher);
    const submitted = (await submit(draft.id, teacher)).body.data;
    await decide(submitted.steps[0].id, kepala);
    expect(await stepsOf(draft.id)).toContain('2:DECIDE:ACTIVE');

    await hold(teacher.user, 'WAKASEK_SARPRAS');
    await get(`/requests/${draft.id}`, teacher);

    expect(await stepsOf(draft.id)).toContain('2:DECIDE:ACTIVE');
  });
});

describe('acquisition completion (REQ-REQUEST-009, BR-031, G2)', () => {
  async function approved() {
    const cast = await running();
    await decide(cast.request.steps[0].id, cast.kepala);
    await decide(cast.request.steps[1].id, cast.sarpras);
    return cast;
  }

  it('completes PROCURE only — REGISTER stays open, the request stays APPROVED (scenario 2)', async () => {
    const { sarpras, request } = await approved();
    const before = await models.Request.findByPk(request.id);

    const response = await complete(request.steps[2].id, sarpras, 'Barang sudah dibeli');

    expect(response.status).toBe(200);
    expect(response.body.data.steps[2]).toMatchObject({
      state: 'DONE',
      actedByUserId: sarpras.user.id,
      comment: 'Barang sudah dibeli',
    });
    expect(await stepsOf(request.id)).toEqual([
      '1:DECIDE:APPROVED',
      '2:DECIDE:APPROVED',
      '3:PROCURE:DONE',
      '4:REGISTER:ACTIVE',
    ]);
    const after = await models.Request.findByPk(request.id);
    expect(after.status).toBe('APPROVED');
    expect(after.approvedAt.getTime()).toBe(before.approvedAt.getTime());
    expect(after.closedAt).toBeNull();
  });

  it('refuses a second declaration, a non-actor, and a PROCURE not yet open', async () => {
    const cast = await running();
    // Not open yet; the Wakasek Sarpras is not yet an actor, so cannot see it (F9).
    expect((await complete(cast.request.steps[2].id, cast.sarpras)).status).toBe(404);

    await decide(cast.request.steps[0].id, cast.kepala);
    await decide(cast.request.steps[1].id, cast.sarpras);
    const overseer = await person([...PROCURER, ...OVERSEER]);

    expect((await complete(cast.request.steps[2].id, overseer)).status).toBe(403);
    expect((await complete(cast.request.steps[2].id, cast.sarpras)).status).toBe(200);
    expect((await complete(cast.request.steps[2].id, cast.sarpras)).status).toBe(409);
  });

  it('offers no way to complete REGISTER or a DECIDE through the acquisition action', async () => {
    const { sarpras, request } = await approved();

    expect((await complete(request.steps[3].id, sarpras)).status).toBe(409);
    expect((await complete(request.steps[0].id, sarpras)).status).toBe(409);
    expect(await stepsOf(request.id)).toContain('4:REGISTER:ACTIVE');
  });
});

describe('cancel and discard (REQ-REQUEST-013, F3 – F5, F10)', () => {
  it('lets the requester discard their own DRAFT — no workflow, no steps (F3)', async () => {
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);

    const response = await cancel(draft.id, teacher, 'Salah input');

    expect(response.body.data).toMatchObject({
      status: 'CANCELLED',
      workflowDefinitionId: null,
      closeReason: 'Salah input',
      steps: [],
    });
  });

  it('requires a non-empty reason (F5)', async () => {
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);

    expect((await cancel(draft.id, teacher, '')).status).toBe(400);
    expect((await cancel(draft.id, teacher, '   ')).status).toBe(400);
    expect(await statusOf(draft.id)).toBe('DRAFT');
  });

  it('lets the requester cancel while SUBMITTED, closing every open step (scenario 6b)', async () => {
    const { teacher, request } = await running();

    const response = await cancel(request.id, teacher);

    expect(response.body.data.status).toBe('CANCELLED');
    expect(await stepsOf(request.id)).toEqual([
      '1:DECIDE:CLOSED',
      '2:DECIDE:CLOSED',
      '3:PROCURE:CLOSED',
      '4:REGISTER:CLOSED',
    ]);
  });

  it('refuses the requester once APPROVED — oversight required (F4)', async () => {
    const { teacher, kepala, sarpras, request } = await running();
    await decide(request.steps[0].id, kepala);
    await decide(request.steps[1].id, sarpras);

    const response = await cancel(request.id, teacher);

    expect(response.status).toBe(403);
    expect(await statusOf(request.id)).toBe('APPROVED');
  });

  it('lets oversight cancel an APPROVED request, keeping a declared acquisition DONE (scenario 6c)', async () => {
    const { kepala, sarpras, request } = await running();
    await decide(request.steps[0].id, kepala);
    await decide(request.steps[1].id, sarpras);
    await complete(request.steps[2].id, sarpras);
    const overseer = await person(OVERSEER);

    const response = await cancel(request.id, overseer, 'Anggaran dialihkan');

    expect(response.status).toBe(200);
    expect(await stepsOf(request.id)).toEqual([
      '1:DECIDE:APPROVED',
      '2:DECIDE:APPROVED',
      '3:PROCURE:DONE',
      '4:REGISTER:CLOSED',
    ]);
  });

  it('refuses another user’s request without oversight, and an ended request', async () => {
    const { teacher, kepala, request } = await running();
    await kepala.assignment.update({ isCurrent: false, endedAt: new Date() });
    // The current Kepala Sekolah sees the request (active actor) and holds
    // request:cancel — but it is not theirs, and they have no oversight.
    const actor = await person([...APPROVER, 'request:cancel'], [['KEPALA_SEKOLAH']]);

    expect((await get(`/requests/${request.id}`, actor)).status).toBe(200);
    expect((await cancel(request.id, actor)).status).toBe(403);

    await cancel(request.id, teacher);
    expect((await cancel(request.id, teacher)).status).toBe(409);
  });

  it('never lets oversight discard someone else’s DRAFT — it cannot even see it', async () => {
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const draft = await draftFor(teacher);
    const overseer = await person(OVERSEER);

    expect((await cancel(draft.id, overseer)).status).toBe(404);
  });
});

describe('visibility (REQ-REQUEST-015, F9)', () => {
  it('shows the current actor of an ACTIVE step, not the holder of a PENDING one', async () => {
    const { kepala, sarpras, request } = await running();

    expect((await get(`/requests/${request.id}`, kepala)).status).toBe(200);
    expect((await get(`/requests/${request.id}`, sarpras)).status).toBe(404);

    await decide(request.steps[0].id, kepala);

    expect((await get(`/requests/${request.id}`, sarpras)).status).toBe(200);
    // The Kepala Sekolah acted, so keeps visibility (former actor).
    expect((await get(`/requests/${request.id}`, kepala)).status).toBe(200);
  });

  it('keeps visibility for whoever acted after a handover; grants none to a later holder', async () => {
    const { kepala, request } = await running();
    await decide(request.steps[0].id, kepala);
    await kepala.assignment.update({ isCurrent: false, endedAt: new Date() });
    const successor = await person(APPROVER, [['KEPALA_SEKOLAH']]);

    expect((await get(`/requests/${request.id}`, kepala)).status).toBe(200);
    expect((await get(`/requests/${request.id}`, successor)).status).toBe(404);
  });

  it('withdraws visibility from a co-holder who did not act once another holder acts', async () => {
    await workflow(
      [
        ['DECIDE', 'COMMON_TEACHER'],
        ['REGISTER', 'WAKASEK_SARPRAS'],
      ],
      { requester: 'KEPALA_SEKOLAH' }
    );
    const kepala = await person(REQUESTER, [['KEPALA_SEKOLAH']]);
    const one = await person(APPROVER, [['COMMON_TEACHER']]);
    const two = await person(APPROVER, [['COMMON_TEACHER']]);
    const draft = await draftFor(kepala);
    const submitted = (await submit(draft.id, kepala)).body.data;

    expect((await get(`/requests/${draft.id}`, two)).status).toBe(200);
    await decide(submitted.steps[0].id, one);

    expect((await get(`/requests/${draft.id}`, one)).status).toBe(200);
    expect((await get(`/requests/${draft.id}`, two)).status).toBe(404);
  });

  it('keeps a DRAFT private even from its would-be actors', async () => {
    await workflow(FLOW);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const kepala = await person(APPROVER, [['KEPALA_SEKOLAH']]);
    const draft = await draftFor(teacher);

    expect((await get(`/requests/${draft.id}`, kepala)).status).toBe(404);
  });
});

describe('awaiting my action (F6)', () => {
  const awaiting = async (caller) =>
    (await get('/requests?awaiting=me', caller)).body.data.map((row) => row.id);

  it('lists a request for its current actor holding the step’s permission, and nobody else', async () => {
    const { kepala, sarpras, request } = await running();
    const holderWithoutCode = await person(['request:read'], []);
    const overseer = await person([...APPROVER, ...OVERSEER]);

    expect(await awaiting(kepala)).toEqual([request.id]);
    expect(await awaiting(sarpras)).toEqual([]);
    expect(await awaiting(overseer)).toEqual([]);
    expect(await awaiting(holderWithoutCode)).toEqual([]);
  });

  it('lists PROCURE for its actor with request-step:complete, and not REGISTER in Phase 38', async () => {
    await workflow([
      ['DECIDE', 'KEPALA_SEKOLAH'],
      ['PROCURE', 'WAKASEK_SARPRAS'],
      ['REGISTER', 'WAKASEK_KURIKULUM'],
    ]);
    const teacher = await person(REQUESTER, [['COMMON_TEACHER']]);
    const kepala = await person(APPROVER, [['KEPALA_SEKOLAH']]);
    const procurer = await person(PROCURER, [['WAKASEK_SARPRAS']]);
    const registrar = await person([...APPROVER, ...PROCURER], [['WAKASEK_KURIKULUM']]);
    const draft = await draftFor(teacher);
    const submitted = (await submit(draft.id, teacher)).body.data;
    await decide(submitted.steps[0].id, kepala);

    expect(await awaiting(procurer)).toEqual([draft.id]);
    expect(await awaiting(registrar)).toEqual([]);
  });
});

describe('the destination after submission', () => {
  it('lets oversight change the destination only, audited', async () => {
    const { request } = await running();
    const lab = await models.Location.create({
      name: 'Lab',
      classificationId: LEAF,
      institutionId: alpha.id,
    });
    const overseer = await person(OVERSEER);

    const response = await patch(
      `/requests/${request.id}`,
      { destinationLocationId: lab.id },
      overseer
    );

    expect(response.status).toBe(200);
    expect(response.body.data.destinationLocationId).toBe(lab.id);
    const [entry] = await models.AuditLog.findAll({
      where: { entityType: 'Request', entityId: request.id, actorId: overseer.user.id },
    });
    expect(entry.newValues).toMatchObject({ destinationLocationId: lab.id });
  });

  it('refuses the requester without oversight, other fields, and an ended request', async () => {
    const { teacher, request } = await running();
    const overseer = await person(OVERSEER);

    expect(
      (await patch(`/requests/${request.id}`, { destinationLocationId: null }, teacher)).status
    ).toBe(403);
    expect((await patch(`/requests/${request.id}`, { title: 'x' }, overseer)).status).toBe(409);

    await cancel(request.id, teacher);
    expect(
      (await patch(`/requests/${request.id}`, { destinationLocationId: null }, overseer)).status
    ).toBe(409);
  });
});

describe('permissions and the PIC ceiling', () => {
  it('requires request:submit, request:cancel, request-step:decide and request-step:complete', async () => {
    await workflow(FLOW);
    const teacher = await person(
      REQUESTER.filter((code) => !['request:submit', 'request:cancel'].includes(code)),
      [['COMMON_TEACHER']]
    );
    const kepala = await person(['request:read'], [['KEPALA_SEKOLAH']]);
    const draft = await draftFor(teacher);

    expect((await submit(draft.id, teacher)).status).toBe(403);
    expect((await cancel(draft.id, teacher)).status).toBe(403);
    expect(
      (await post(`/request-steps/${draft.id}/decide`, { decision: 'APPROVE' }, kepala)).status
    ).toBe(403);
    expect((await post(`/request-steps/${draft.id}/complete`, {}, kepala)).status).toBe(403);
  });

  it('refuses a PIC-scoped caller even with the codes granted', async () => {
    const { request } = await running();
    const pic = await createCaller({
      permissions: [...new Set([...REQUESTER, ...APPROVER, ...PROCURER, 'request:oversee'])],
      institutionId: alpha.id,
      isPicScoped: true,
    });

    expect((await get(`/requests/${request.id}`, pic)).status).toBe(403);
    expect((await decide(request.steps[0].id, pic)).status).toBe(403);
    expect((await cancel(request.id, pic)).status).toBe(403);
  });

  it('leaves the PIC ceiling unchanged', () => {
    expect(PIC_ALLOWED_PERMISSIONS.size).toBe(30);
    for (const code of [
      'request:submit',
      'request:cancel',
      'request-step:decide',
      'request-step:complete',
    ]) {
      expect(PIC_ALLOWED_PERMISSIONS.has(code)).toBe(false);
    }
  });
});

describe('audit', () => {
  it('records the snapshot, each state change and who made it', async () => {
    const { kepala, request } = await running();
    await decide(request.steps[0].id, kepala);

    const created = await models.AuditLog.count({
      where: {
        entityType: 'RequestStep',
        action: 'CREATE',
        entityId: request.steps.map((step) => step.id),
      },
    });
    const decision = await models.AuditLog.findAll({
      where: { entityType: 'RequestStep', entityId: request.steps[0].id, actorId: kepala.user.id },
    });

    expect(created).toBe(4);
    expect(decision.at(-1).newValues).toMatchObject({
      state: 'APPROVED',
      actedByUserId: kepala.user.id,
    });
  });
});

describe('nothing beyond Phase 38', () => {
  it('leaves direct registration unchanged while requests are running', async () => {
    await running();
    const asset = await post(
      '/assets',
      { name: 'Laptop', classificationId: LEAF, institutionId: alpha.id },
      admin
    );
    const unit = await post(`/assets/${asset.body.data.id}/units`, {}, admin);

    expect(asset.status).toBe(201);
    expect(unit.status).toBe(201);
  });

  it('never writes a workflow definition while executing', async () => {
    const { kepala, sarpras, request } = await running();
    const definition = await models.WorkflowDefinition.findByPk(request.workflowDefinitionId);
    await decide(request.steps[0].id, kepala);
    await decide(request.steps[1].id, sarpras);
    await complete(request.steps[2].id, sarpras);

    const after = await models.WorkflowDefinition.findByPk(definition.id);
    expect(after.updatedAt.getTime()).toBe(definition.updatedAt.getTime());
    expect(
      await models.WorkflowDefinitionStep.count({ where: { definitionId: definition.id } })
    ).toBe(4);
  });
});

/** Migration 052's `down()` refuses while steps exist (cycle database). */
describe('rolling back migration 052', () => {
  const CYCLE = cycleDatabaseUrl();
  const NAME = '20260926010000-052-create-request-steps.js';

  beforeAll(async () => {
    await migrate(CYCLE);
  });

  it('refuses while a step exists, then rolls back and re-applies when empty', async () => {
    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('Cycle S', 'CYCLES', 'Jl. C') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-steps', $1, 'Cycle', 'Steps', $2) RETURNING id`,
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
      `INSERT INTO public.request_steps (request_id, sequence, step_type, actor_position_code,
         skip_if_requester_is_actor) VALUES ($1, 1, 'DECIDE', 'KEPALA_SEKOLAH', false)`,
      [request.id],
      CYCLE
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', NAME], CYCLE)).rejects.toThrow(
        /Migration 052 rollback refused/
      );
    } finally {
      await query('DELETE FROM public.request_steps', [], CYCLE);
      await query('DELETE FROM public.requests', [], CYCLE);
      await query('DELETE FROM public.position_assignments', [], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }

    // Migration 059: revision notes reference steps, and it alters this table.
    await runCli(
      ['db:migrate:undo', '--name', '20261002020000-059-create-request-revisions.js'],
      CYCLE
    );
    await runCli(['db:migrate:undo', '--name', NAME], CYCLE);
    const [gone] = await query(`SELECT to_regclass('public.request_steps') AS steps`, [], CYCLE);
    expect(gone.steps).toBeNull();
    await migrate(CYCLE);
    const [back] = await query(
      `SELECT to_regclass('public.request_steps')::text AS steps`,
      [],
      CYCLE
    );
    expect(back.steps).toBe('request_steps');
  });
});
