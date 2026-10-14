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
const { REQUEST_CATEGORIES } = require('../../src/domain/requestCategories.js');
const {
  STEP_TYPES,
  PROCUREMENT_MODES,
  DEFINITION_STATUSES,
  WORKFLOW_TEMPLATES,
} = require('../../src/domain/workflowShape.js');
const { PIC_ALLOWED_PERMISSIONS } = require('../../src/auth/permissionCatalog.js');

/**
 * Workflow definitions — Phase 36 (`CR-014` §6.3 – §6.5), REQ-WF-001 – REQ-WF-004,
 * REQ-WF-006, `06-api.md` §12.2. Decisions D1–D5 of the Phase 36 plan.
 *
 *   THE LISTS     every CHECK admits exactly the JavaScript constant (`DEC-U`).
 *   THE KEY       one ACTIVE and one DRAFT per (institution, category, requester),
 *                 by the API's reasoned refusal and by the database backstop.
 *   THE RULES     step shape, a chosen actor, the department rule — at publish.
 *   VERSIONS      publish retires the previous version; published versions never
 *                 change; a new version copies steps; concurrency leaves one ACTIVE.
 *   THE BOUNDARY  scope (404), permissions (403), the PIC ceiling, D4.
 *   NOTHING MORE  no template is seeded; no position is resolved; no request exists.
 */

const V1 = '/api/v1';

const ALL = [
  'workflow-definition:read',
  'workflow-definition:create',
  'workflow-definition:update',
  'workflow-definition:publish',
];

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

const get = (path, caller = admin) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

const post = (path, body = {}, caller = admin) =>
  api()
    .post(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const put = (path, body, caller = admin) =>
  api()
    .put(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const create = (body, caller = admin) =>
  post('/workflow-definitions', { institutionId: alpha.id, ...body }, caller);

const setSteps = (id, steps, caller = admin) =>
  put(`/workflow-definitions/${id}/steps`, { steps }, caller);

const publish = (id, caller = admin) => post(`/workflow-definitions/${id}/publish`, {}, caller);

const newVersion = (id, caller = admin) => post(`/workflow-definitions/${id}/versions`, {}, caller);

const step = (sequence, stepType, actorPositionCode, extra = {}) => ({
  sequence,
  stepType,
  actorPositionCode,
  ...(stepType === 'PROCURE' ? { procurementMode: 'INTERNAL' } : {}),
  ...extra,
});

/** A valid, publishable step list for COMMON / COMMON_TEACHER. */
const SARPRAS_FLOW = [
  step(1, 'DECIDE', 'WAKASEK_SARPRAS'),
  step(2, 'PROCURE', 'WAKASEK_SARPRAS'),
  step(3, 'REGISTER', 'WAKASEK_SARPRAS'),
];

const COMMON_TEACHER = { category: 'COMMON', requesterPositionCode: 'COMMON_TEACHER' };

/** Creates a draft for the key, gives it valid steps and publishes it. */
async function activeDefinition(key = COMMON_TEACHER, steps = SARPRAS_FLOW, institution = alpha) {
  const draft = await create({ ...key, institutionId: institution.id });
  expect(draft.status).toBe(201);
  expect((await setSteps(draft.body.data.id, steps)).status).toBe(200);
  const published = await publish(draft.body.data.id);
  expect(published.status).toBe(200);
  return published.body.data;
}

/** The quoted literals inside a CHECK definition, as a sorted list. */
async function checkLiterals(name) {
  const [row] = await query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1`,
    [name]
  );
  return [...row.definition.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
}

const statusesOf = (key, institution = alpha) =>
  models.WorkflowDefinition.findAll({
    where: { institutionId: institution.id, ...key },
    order: [['version', 'ASC']],
  }).then((rows) => rows.map((row) => `v${row.version}:${row.status}`));

// ---------------------------------------------------------------------------

describe('the value lists do not drift (CR-014 DEC-U)', () => {
  it.each([
    ['chk_wf_def_category', REQUEST_CATEGORIES],
    ['chk_wf_def_requester', POSITION_CODES],
    ['chk_wf_step_actor', POSITION_CODES],
    ['chk_wf_def_status', DEFINITION_STATUSES],
    ['chk_wf_step_type', STEP_TYPES],
    ['chk_wf_step_mode', PROCUREMENT_MODES],
  ])('%s admits exactly the JavaScript constant', async (name, constant) => {
    expect(await checkLiterals(name)).toEqual([...constant].sort());
  });

  it('keeps the position CHECKs identical to the Phase 35 list', async () => {
    expect(await checkLiterals('chk_wf_def_requester')).toEqual(
      await checkLiterals('chk_pos_assign_position')
    );
  });
});

describe('the database backstop', () => {
  const insertDefinition = (status, version, extra = '') =>
    query(
      `INSERT INTO public.workflow_definitions
         (institution_id, category, requester_position_code, version, status, published_at${extra ? ', retired_at' : ''})
       VALUES ($1, 'COMMON', 'COMMON_TEACHER', $2, $3, ${status === 'DRAFT' ? 'NULL' : 'now()'}${extra})
       RETURNING id`,
      [alpha.id, version, status]
    );

  it('admits one ACTIVE per key (uq_wf_def_active)', async () => {
    await insertDefinition('ACTIVE', 1);

    await expect(insertDefinition('ACTIVE', 2)).rejects.toThrow(/uq_wf_def_active/);
  });

  it('admits one DRAFT per key (uq_wf_def_draft, decision D2)', async () => {
    await insertDefinition('DRAFT', 1);

    await expect(insertDefinition('DRAFT', 2)).rejects.toThrow(/uq_wf_def_draft/);
  });

  it('admits any number of RETIRED versions, but never a repeated version number', async () => {
    await insertDefinition('RETIRED', 1, ', now()');
    await insertDefinition('RETIRED', 2, ', now()');

    await expect(insertDefinition('DRAFT', 2)).rejects.toThrow(/uq_wf_def_version/);
  });

  it('refuses a published status without published_at, and RETIRED without retired_at', async () => {
    await expect(
      query(
        `INSERT INTO public.workflow_definitions
           (institution_id, category, requester_position_code, version, status)
         VALUES ($1, 'COMMON', 'COMMON_TEACHER', 1, 'ACTIVE')`,
        [alpha.id]
      )
    ).rejects.toThrow(/chk_wf_def_published/);
    await expect(insertDefinition('RETIRED', 1)).rejects.toThrow(/chk_wf_def_retired/);
  });

  it('ties the procurement mode to PROCURE steps, and admits a NULL actor (D1)', async () => {
    const [{ id }] = await insertDefinition('DRAFT', 1);
    const insertStep = (sequence, type, mode) =>
      query(
        `INSERT INTO public.workflow_definition_steps
           (definition_id, sequence, step_type, actor_position_code, procurement_mode)
         VALUES ($1, $2, $3, NULL, $4)`,
        [id, sequence, type, mode]
      );

    await insertStep(1, 'PROCURE', 'EXTERNAL');
    await insertStep(2, 'REGISTER', null);
    await expect(insertStep(3, 'PROCURE', null)).rejects.toThrow(/chk_wf_step_mode_use/);
    await expect(insertStep(3, 'DECIDE', 'INTERNAL')).rejects.toThrow(/chk_wf_step_mode_use/);
    await expect(insertStep(2, 'DECIDE', null)).rejects.toThrow(/uq_wf_step_sequence/);
  });

  it('refuses SARPRAS_STAFF, which awaits CR-014 Q4', async () => {
    await expect(
      query(
        `INSERT INTO public.workflow_definitions
           (institution_id, category, requester_position_code, version)
         VALUES ($1, 'COMMON', 'SARPRAS_STAFF', 1)`,
        [alpha.id]
      )
    ).rejects.toThrow(/chk_wf_def_requester/);
  });
});

describe('creating a draft (REQ-WF-001)', () => {
  it('creates an empty DRAFT version 1, reporting what publishing would refuse', async () => {
    const response = await create(COMMON_TEACHER);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      institutionId: alpha.id,
      category: 'COMMON',
      requesterPositionCode: 'COMMON_TEACHER',
      version: 1,
      status: 'DRAFT',
      steps: [],
      createdBy: admin.user.id,
      publishedAt: null,
    });
    expect(response.body.data.publishIssues.map((issue) => issue.field)).toEqual(['steps']);
  });

  it('seeds nothing: an institution has no workflow until an administrator creates one', async () => {
    const response = await get(`/workflow-definitions?institutionId=${alpha.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(await models.WorkflowDefinition.count()).toBe(0);
  });

  describe('which institution (decision D4)', () => {
    it('requires a system-wide creator to name the institution', async () => {
      const response = await post('/workflow-definitions', COMMON_TEACHER);

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('institutionId');
    });

    it('defaults an institution-scoped creator to their own institution', async () => {
      const scoped = await createCaller({ permissions: ALL, institutionId: alpha.id });

      const response = await post('/workflow-definitions', COMMON_TEACHER, scoped);

      expect(response.status).toBe(201);
      expect(response.body.data.institutionId).toBe(alpha.id);
    });

    it('refuses an institution-scoped creator naming another institution', async () => {
      const scoped = await createCaller({ permissions: ALL, institutionId: alpha.id });

      const response = await post(
        '/workflow-definitions',
        { ...COMMON_TEACHER, institutionId: beta.id },
        scoped
      );

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('institutionId');
      expect(await models.WorkflowDefinition.count()).toBe(0);
    });

    it('refuses an institution that does not exist or is deactivated', async () => {
      await beta.update({ isActive: false });

      const missing = await post('/workflow-definitions', {
        ...COMMON_TEACHER,
        institutionId: '00000000-0000-4000-8000-000000000000',
      });
      const inactive = await post('/workflow-definitions', {
        ...COMMON_TEACHER,
        institutionId: beta.id,
      });

      expect(missing.status).toBe(400);
      expect(inactive.status).toBe(400);
      expect(inactive.body.error.details[0].field).toBe('institutionId');
    });
  });

  it.each([
    [{ category: 'INVENTARIS', requesterPositionCode: 'COMMON_TEACHER' }, 'body.category'],
    [{ category: 'COMMON', requesterPositionCode: 'SARPRAS_STAFF' }, 'body.requesterPositionCode'],
    [{ ...COMMON_TEACHER, fallback: true }, 'body'],
  ])('refuses %o', async (body, field) => {
    const response = await create(body);

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
  });

  describe('one DRAFT per key (decision D2)', () => {
    it('refuses a second draft for the same key, naming the existing one', async () => {
      const first = await create(COMMON_TEACHER);

      const second = await create(COMMON_TEACHER);

      expect(second.status).toBe(409);
      expect(second.body.error.details[0].issue).toContain(first.body.data.id);
      expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:DRAFT']);
    });

    it('allows drafts for other keys and for the same key in another institution', async () => {
      await create(COMMON_TEACHER);

      expect(
        (await create({ category: 'KBM', requesterPositionCode: 'COMMON_TEACHER' })).status
      ).toBe(201);
      expect(
        (await create({ category: 'COMMON', requesterPositionCode: 'JURUSAN_TEACHER' })).status
      ).toBe(201);
      expect((await create({ ...COMMON_TEACHER, institutionId: beta.id })).status).toBe(201);
    });

    it('lets two concurrent creations for one key produce exactly one draft', async () => {
      const responses = await Promise.all([create(COMMON_TEACHER), create(COMMON_TEACHER)]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:DRAFT']);
    });

    it('offers no way to delete a draft', async () => {
      const draft = await create(COMMON_TEACHER);

      const response = await api()
        .delete(`${V1}/workflow-definitions/${draft.body.data.id}`)
        .set(...admin.auth);

      expect(response.status).toBe(404);
      expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:DRAFT']);
    });
  });
});

describe('templates (CR-014 §6.5)', () => {
  it('lists exactly the five confirmed flows', async () => {
    const response = await get('/workflow-definitions/templates');

    expect(response.status).toBe(200);
    expect(response.body.data.map((template) => template.key)).toEqual(
      WORKFLOW_TEMPLATES.map((template) => template.key)
    );
    expect(response.body.data).toHaveLength(5);
  });

  it('creates a DRAFT from a template, leaving the undecided actors empty', async () => {
    const response = await create({
      category: 'KBM',
      requesterPositionCode: 'COMMON_TEACHER',
      templateKey: 'KBM_COMMON_TEACHER',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('DRAFT');
    expect(
      response.body.data.steps.map((s) => [
        s.sequence,
        s.stepType,
        s.actorPositionCode,
        s.procurementMode,
        s.skipIfRequesterIsActor,
      ])
    ).toEqual([
      [1, 'DECIDE', 'WAKASEK_KURIKULUM', null, false],
      [2, 'DECIDE', 'KEPALA_SEKOLAH', null, false],
      [3, 'DECIDE', 'WAKASEK_SARPRAS', null, false],
      [4, 'PROCURE', null, 'INTERNAL', false],
      [5, 'REGISTER', null, null, false],
    ]);
    expect(response.body.data.publishIssues.map((issue) => issue.field)).toEqual([
      'steps.3.actorPositionCode',
      'steps.4.actorPositionCode',
    ]);
  });

  it('keeps the JURUSAN template external, and its acquisition actor undecided (Q3)', async () => {
    const response = await create({
      category: 'JURUSAN',
      requesterPositionCode: 'KAJUR',
      templateKey: 'JURUSAN_KAJUR',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.steps[1]).toMatchObject({
      stepType: 'PROCURE',
      procurementMode: 'EXTERNAL',
      actorPositionCode: null,
    });
  });

  it('refuses a template for another key, and an unknown template', async () => {
    const mismatched = await create({ ...COMMON_TEACHER, templateKey: 'KBM_COMMON_TEACHER' });
    const unknown = await create({ ...COMMON_TEACHER, templateKey: 'EVERYTHING' });

    expect(mismatched.status).toBe(400);
    expect(mismatched.body.error.details[0].field).toBe('templateKey');
    expect(unknown.status).toBe(400);
    expect(await models.WorkflowDefinition.count()).toBe(0);
  });

  it('refuses to publish a template draft until its actors are chosen (D1)', async () => {
    const draft = await create({ ...COMMON_TEACHER, templateKey: 'COMMON_COMMON_TEACHER' });

    const refused = await publish(draft.body.data.id);

    expect(refused.status).toBe(400);
    expect(refused.body.error.details.map((detail) => detail.field)).toEqual([
      'steps.2.actorPositionCode',
      'steps.3.actorPositionCode',
    ]);
    expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:DRAFT']);

    // An administrator decides the actor — here, for the test only.
    const steps = draft.body.data.steps.map(({ id, ...rest }) => ({
      ...rest,
      actorPositionCode: rest.actorPositionCode ?? 'WAKASEK_SARPRAS',
    }));
    expect((await setSteps(draft.body.data.id, steps)).status).toBe(200);
    expect((await publish(draft.body.data.id)).status).toBe(200);
  });
});

describe('editing a draft’s steps', () => {
  let draftId;

  beforeEach(async () => {
    draftId = (await create(COMMON_TEACHER)).body.data.id;
  });

  it('replaces the ordered step list', async () => {
    await setSteps(draftId, SARPRAS_FLOW);

    const response = await setSteps(draftId, [
      step(1, 'DECIDE', 'KEPALA_SEKOLAH', { skipIfRequesterIsActor: true }),
      step(2, 'REGISTER', 'WAKASEK_SARPRAS'),
    ]);

    expect(response.status).toBe(200);
    expect(response.body.data.steps).toMatchObject([
      {
        sequence: 1,
        stepType: 'DECIDE',
        actorPositionCode: 'KEPALA_SEKOLAH',
        skipIfRequesterIsActor: true,
      },
      { sequence: 2, stepType: 'REGISTER', procurementMode: null, skipIfRequesterIsActor: false },
    ]);
    expect(await models.WorkflowDefinitionStep.count({ where: { definitionId: draftId } })).toBe(2);
    expect(response.body.data.publishIssues).toEqual([]);
  });

  it('defaults self-skip to off (REQ-WF-006)', async () => {
    const response = await setSteps(draftId, [
      { sequence: 1, stepType: 'REGISTER', actorPositionCode: 'WAKASEK_SARPRAS' },
    ]);

    expect(response.body.data.steps[0].skipIfRequesterIsActor).toBe(false);
  });

  it('saves an incomplete arrangement; the shape is checked at publication', async () => {
    const response = await setSteps(draftId, [
      step(1, 'REGISTER', null),
      step(2, 'DECIDE', 'KEPALA_SEKOLAH'),
    ]);

    expect(response.status).toBe(200);
    expect(response.body.data.publishIssues.length).toBeGreaterThan(0);
  });

  it.each([
    [
      'a gap in the numbering',
      [step(1, 'DECIDE', 'KEPALA_SEKOLAH'), step(3, 'REGISTER', 'KAJUR')],
      'steps.1.sequence',
    ],
    [
      'a PROCURE without a mode',
      [{ sequence: 1, stepType: 'PROCURE', actorPositionCode: null }],
      'steps.0.procurementMode',
    ],
    [
      'a mode on a DECIDE step',
      [{ sequence: 1, stepType: 'DECIDE', actorPositionCode: null, procurementMode: 'INTERNAL' }],
      'steps.0.procurementMode',
    ],
    [
      'an unknown step type',
      [{ sequence: 1, stepType: 'NOTIFY', actorPositionCode: null }],
      'body.steps.0.stepType',
    ],
    [
      'a condition',
      [{ ...step(1, 'REGISTER', 'KAJUR'), condition: "category = 'KBM'" }],
      'body.steps.0',
    ],
    [
      'two actors',
      [{ ...step(1, 'REGISTER', 'KAJUR'), actorPositionCodes: ['KAJUR', 'TOOLMAN'] }],
      'body.steps.0',
    ],
    [
      'SARPRAS_STAFF (Q4)',
      [step(1, 'REGISTER', 'SARPRAS_STAFF')],
      'body.steps.0.actorPositionCode',
    ],
  ])('refuses %s', async (_, steps, field) => {
    const response = await setSteps(draftId, steps);

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
    expect(await models.WorkflowDefinitionStep.count({ where: { definitionId: draftId } })).toBe(0);
  });

  it('refuses more than twenty steps', async () => {
    const steps = Array.from({ length: 21 }, (_, index) =>
      step(index + 1, 'DECIDE', 'KEPALA_SEKOLAH')
    );

    expect((await setSteps(draftId, steps)).status).toBe(400);
  });
});

describe('publishing (REQ-WF-002, REQ-WF-004)', () => {
  it('activates a valid draft and records who published it', async () => {
    const draft = await create(COMMON_TEACHER);
    await setSteps(draft.body.data.id, SARPRAS_FLOW);

    const response = await publish(draft.body.data.id);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      status: 'ACTIVE',
      publishedBy: admin.user.id,
      retiredAt: null,
    });
    expect(response.body.data.publishedAt).toBeTruthy();
    expect(response.body.data).not.toHaveProperty('publishIssues');
  });

  it('refuses a malformed shape, naming each failing step', async () => {
    const draft = await create(COMMON_TEACHER);
    await setSteps(draft.body.data.id, [
      step(1, 'PROCURE', 'WAKASEK_SARPRAS'),
      step(2, 'DECIDE', 'KEPALA_SEKOLAH'),
      step(3, 'REGISTER', 'WAKASEK_SARPRAS'),
    ]);

    const response = await publish(draft.body.data.id);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { field: 'steps.1.stepType', issue: expect.stringMatching(/before the PROCURE/) },
    ]);
    expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:DRAFT']);
  });

  it('refuses an empty draft', async () => {
    const draft = await create(COMMON_TEACHER);

    expect((await publish(draft.body.data.id)).status).toBe(400);
  });

  it('refuses a department-bound actor where the request need not have a department', async () => {
    const draft = await create(COMMON_TEACHER);
    await setSteps(draft.body.data.id, [
      step(1, 'DECIDE', 'KAJUR'),
      step(2, 'REGISTER', 'WAKASEK_SARPRAS'),
    ]);

    const response = await publish(draft.body.data.id);

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      { field: 'steps.0.actorPositionCode', issue: expect.stringMatching(/REQ-WF-004/) },
    ]);
  });

  it.each([
    [{ category: 'COMMON', requesterPositionCode: 'JURUSAN_TEACHER' }, 'KAJUR'],
    [{ category: 'JURUSAN', requesterPositionCode: 'KAJUR' }, 'TOOLMAN'],
    // A JURUSAN request from a context without a department — one that may
    // make it (P2: never a teacher of common subjects).
    [{ category: 'JURUSAN', requesterPositionCode: 'KEPALA_SEKOLAH' }, 'JURUSAN_TEACHER'],
  ])('allows a department-bound actor for %o', async (key, actor) => {
    const draft = await create(key);
    await setSteps(draft.body.data.id, [step(1, 'DECIDE', actor), step(2, 'REGISTER', actor)]);

    expect((await publish(draft.body.data.id)).status).toBe(200);
  });

  /**
   * P2 (`IMPLEMENTATION_PLAN.md` §64.2): a process for a request its requester
   * may never make is refused — at creation, and at publication for a draft
   * that exists anyway (written before the rule). One map decides both.
   */
  it.each([
    ['JURUSAN', 'COMMON_TEACHER'],
    ['KBM', 'JURUSAN_TEACHER'],
    ['EKSKUL', 'JURUSAN_TEACHER'],
  ])('refuses to create a draft for %s requested as %s', async (category, position) => {
    const response = await create({ category, requesterPositionCode: position });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      { field: 'category', issue: expect.stringMatching(/no request could ever use this process/) },
    ]);
    expect(await models.WorkflowDefinition.count()).toBe(0);
  });

  it('refuses to publish such a draft written before the rule, naming the category', async () => {
    const legacy = await models.WorkflowDefinition.create({
      institutionId: alpha.id,
      category: 'JURUSAN',
      requesterPositionCode: 'COMMON_TEACHER',
      version: 1,
      status: 'DRAFT',
    });
    await models.WorkflowDefinitionStep.create({
      definitionId: legacy.id,
      sequence: 1,
      stepType: 'REGISTER',
      actorPositionCode: 'WAKASEK_SARPRAS',
      procurementMode: null,
      skipIfRequesterIsActor: false,
    });

    const response = await publish(legacy.id);

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      {
        field: 'category',
        issue: expect.stringMatching(/COMMON_TEACHER may be one of COMMON, KBM, EKSKUL/),
      },
    ]);
    expect((await models.WorkflowDefinition.findByPk(legacy.id)).status).toBe('DRAFT');
    // The editor is told before anyone tries.
    const detail = await get(`/workflow-definitions/${legacy.id}`);
    expect(detail.body.data.publishIssues).toEqual([
      expect.objectContaining({ field: 'category' }),
    ]);
  });

  it('says which categories each requester position may request at all', async () => {
    const response = await get('/workflow-definitions/eligibility');

    expect(response.status).toBe(200);
    expect(response.body.data.categoriesByPosition).toMatchObject({
      COMMON_TEACHER: ['COMMON', 'KBM', 'EKSKUL'],
      JURUSAN_TEACHER: ['COMMON', 'JURUSAN'],
      KAJUR: REQUEST_CATEGORIES,
      KEPALA_SEKOLAH: REQUEST_CATEGORIES,
    });
    expect(Object.keys(response.body.data.categoriesByPosition).sort()).toEqual(
      [...POSITION_CODES].sort()
    );
  });

  it('never resolves an actor: publishing needs no holder of any position', async () => {
    expect(await models.PositionAssignment.count()).toBe(0);

    await activeDefinition();

    expect(await models.PositionAssignment.count()).toBe(0);
  });
});

describe('versions (REQ-WF-003)', () => {
  it('copies a published version’s steps into a new DRAFT, leaving the source unchanged', async () => {
    const v1 = await activeDefinition();

    const response = await newVersion(v1.id);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ version: 2, status: 'DRAFT' });
    const shape = (steps) =>
      steps.map(
        ({ sequence, stepType, actorPositionCode, procurementMode, skipIfRequesterIsActor }) => ({
          sequence,
          stepType,
          actorPositionCode,
          procurementMode,
          skipIfRequesterIsActor,
        })
      );
    expect(shape(response.body.data.steps)).toEqual(shape(v1.steps));
    // Copies, not shared rows.
    const v1Ids = new Set(v1.steps.map((s) => s.id));
    expect(response.body.data.steps.some((s) => v1Ids.has(s.id))).toBe(false);

    expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:ACTIVE', 'v2:DRAFT']);
  });

  it('publishing the new version retires the previous one', async () => {
    const v1 = await activeDefinition();
    const v2 = (await newVersion(v1.id)).body.data;
    await setSteps(v2.id, [
      step(1, 'DECIDE', 'KEPALA_SEKOLAH'),
      ...SARPRAS_FLOW.map((s) => ({ ...s, sequence: s.sequence + 1 })),
    ]);

    expect((await publish(v2.id)).status).toBe(200);

    expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:RETIRED', 'v2:ACTIVE']);
    const retired = (await get(`/workflow-definitions/${v1.id}`)).body.data;
    expect(retired.retiredAt).toBeTruthy();
    expect(retired.steps).toHaveLength(3);
  });

  it('refuses a new version while a draft exists (D2)', async () => {
    const v1 = await activeDefinition();
    await newVersion(v1.id);

    const second = await newVersion(v1.id);
    const viaCreate = await create(COMMON_TEACHER);

    expect(second.status).toBe(409);
    expect(viaCreate.status).toBe(409);
    expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:ACTIVE', 'v2:DRAFT']);
  });

  it('refuses to copy a draft', async () => {
    const draft = await create(COMMON_TEACHER);

    expect((await newVersion(draft.body.data.id)).status).toBe(409);
  });

  it('creates a new version from a RETIRED one too', async () => {
    const v1 = await activeDefinition();
    const v2 = (await newVersion(v1.id)).body.data;
    await publish(v2.id);

    const v3 = await newVersion(v1.id);

    expect(v3.status).toBe(201);
    expect(v3.body.data.version).toBe(3);
  });

  describe('ACTIVE and RETIRED definitions are immutable', () => {
    it('refuses to change an ACTIVE definition’s steps', async () => {
      const v1 = await activeDefinition();

      const response = await setSteps(v1.id, [step(1, 'REGISTER', 'KEPALA_SEKOLAH')]);

      expect(response.status).toBe(409);
      expect(response.body.error.details[0].issue).toMatch(/new version/);
      expect((await get(`/workflow-definitions/${v1.id}`)).body.data.steps).toEqual(v1.steps);
    });

    it('refuses to change a RETIRED definition’s steps, or to publish it again', async () => {
      const v1 = await activeDefinition();
      const v2 = (await newVersion(v1.id)).body.data;
      await publish(v2.id);

      expect((await setSteps(v1.id, [step(1, 'REGISTER', 'KEPALA_SEKOLAH')])).status).toBe(409);
      expect((await publish(v1.id)).status).toBe(409);
      expect((await publish(v2.id)).status).toBe(409);
      expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:RETIRED', 'v2:ACTIVE']);
    });

    it('offers no PATCH on a definition', async () => {
      const v1 = await activeDefinition();

      const response = await api()
        .patch(`${V1}/workflow-definitions/${v1.id}`)
        .set(...admin.auth)
        .send({ category: 'KBM' });

      expect(response.status).toBe(404);
      expect((await get(`/workflow-definitions/${v1.id}`)).body.data.category).toBe('COMMON');
    });
  });

  describe('concurrency', () => {
    it('publishing one draft twice at once activates it once', async () => {
      const draft = await create(COMMON_TEACHER);
      await setSteps(draft.body.data.id, SARPRAS_FLOW);

      const responses = await Promise.all([
        publish(draft.body.data.id),
        publish(draft.body.data.id),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:ACTIVE']);
    });

    it('leaves exactly one ACTIVE when a new version is published concurrently', async () => {
      const v1 = await activeDefinition();
      const v2 = (await newVersion(v1.id)).body.data;

      await Promise.all([publish(v2.id), publish(v2.id), publish(v2.id)]);

      expect(await statusesOf(COMMON_TEACHER)).toEqual(['v1:RETIRED', 'v2:ACTIVE']);
      const [{ count }] = await query(
        `SELECT count(*)::int AS count FROM public.workflow_definitions
          WHERE institution_id = $1 AND status = 'ACTIVE'`,
        [alpha.id]
      );
      expect(count).toBe(1);
    });

    it('never lets a step edit land on a version that was published meanwhile', async () => {
      const draft = await create(COMMON_TEACHER);
      await setSteps(draft.body.data.id, SARPRAS_FLOW);

      const [published, edited] = await Promise.all([
        publish(draft.body.data.id),
        setSteps(draft.body.data.id, [step(1, 'REGISTER', 'KEPALA_SEKOLAH')]),
      ]);

      const final = (await get(`/workflow-definitions/${draft.body.data.id}`)).body.data;
      expect(final.status).toBe('ACTIVE');
      // Either the edit went first and was then published, or it was refused.
      if (edited.status === 200) {
        expect(published.status).toBe(200);
        expect(final.steps).toHaveLength(1);
      } else {
        expect(edited.status).toBe(409);
        expect(final.steps).toHaveLength(3);
      }
    });
  });
});

describe('reading', () => {
  it('lists definitions with filters, without their steps', async () => {
    await activeDefinition();
    await create({ category: 'KBM', requesterPositionCode: 'COMMON_TEACHER' });

    const all = await get(`/workflow-definitions?institutionId=${alpha.id}`);
    const active = await get(`/workflow-definitions?institutionId=${alpha.id}&status=ACTIVE`);
    const kbm = await get(`/workflow-definitions?institutionId=${alpha.id}&category=KBM`);

    expect(all.body.meta.total).toBe(2);
    expect(active.body.data.map((row) => row.category)).toEqual(['COMMON']);
    expect(active.body.data[0]).toMatchObject({ stepCount: 3 });
    expect(active.body.data[0]).not.toHaveProperty('steps');
    expect(kbm.body.data.map((row) => row.status)).toEqual(['DRAFT']);
  });

  it('refuses an unknown filter value', async () => {
    expect((await get('/workflow-definitions?status=ARCHIVED')).status).toBe(400);
    expect((await get('/workflow-definitions?category=INVENTARIS')).status).toBe(400);
  });

  it('answers 404 for an unknown id', async () => {
    expect((await get('/workflow-definitions/00000000-0000-4000-8000-000000000000')).status).toBe(
      404
    );
  });
});

describe('scope and permissions', () => {
  it('answers 404 across institutions, on every path', async () => {
    const foreign = await activeDefinition(COMMON_TEACHER, SARPRAS_FLOW, beta);
    const foreignDraft = (
      await create({ ...COMMON_TEACHER, category: 'KBM', institutionId: beta.id })
    ).body.data;
    const scoped = await createCaller({ permissions: ALL, institutionId: alpha.id });

    expect((await get(`/workflow-definitions/${foreign.id}`, scoped)).status).toBe(404);
    expect((await setSteps(foreignDraft.id, SARPRAS_FLOW, scoped)).status).toBe(404);
    expect((await publish(foreignDraft.id, scoped)).status).toBe(404);
    expect((await newVersion(foreign.id, scoped)).status).toBe(404);

    const listed = await get('/workflow-definitions', scoped);
    expect(listed.body.data).toEqual([]);
    const filtered = await get(`/workflow-definitions?institutionId=${beta.id}`, scoped);
    expect(filtered.body.data).toEqual([]);
  });

  it('lets an institution administrator run the whole cycle in their own institution', async () => {
    const scoped = await createCaller({ permissions: ALL, institutionId: alpha.id });

    const draft = await post('/workflow-definitions', COMMON_TEACHER, scoped);
    expect((await setSteps(draft.body.data.id, SARPRAS_FLOW, scoped)).status).toBe(200);
    expect((await publish(draft.body.data.id, scoped)).status).toBe(200);
    expect((await newVersion(draft.body.data.id, scoped)).status).toBe(201);
  });

  it('requires the matching code for each action', async () => {
    const v1 = await activeDefinition();
    const draft = (await create({ category: 'KBM', requesterPositionCode: 'COMMON_TEACHER' })).body
      .data;
    const reader = await createCaller({
      permissions: ['workflow-definition:read'],
      institutionId: alpha.id,
    });
    const nobody = await createCaller({ institutionId: alpha.id });

    expect((await get('/workflow-definitions', nobody)).status).toBe(403);
    expect((await get('/workflow-definitions/templates', nobody)).status).toBe(403);
    expect((await get(`/workflow-definitions/${v1.id}`, nobody)).status).toBe(403);

    expect((await get(`/workflow-definitions/${v1.id}`, reader)).status).toBe(200);
    expect((await post('/workflow-definitions', COMMON_TEACHER, reader)).status).toBe(403);
    expect((await newVersion(v1.id, reader)).status).toBe(403);
    expect((await setSteps(draft.id, SARPRAS_FLOW, reader)).status).toBe(403);
    expect((await publish(draft.id, reader)).status).toBe(403);
  });

  it('keeps update and publish separate', async () => {
    const draft = (await create(COMMON_TEACHER)).body.data;
    const editor = await createCaller({
      permissions: ['workflow-definition:read', 'workflow-definition:update'],
      institutionId: alpha.id,
    });

    expect((await setSteps(draft.id, SARPRAS_FLOW, editor)).status).toBe(200);
    expect((await publish(draft.id, editor)).status).toBe(403);
  });

  it('refuses a PIC-scoped caller even when the codes are granted (CR-004 ceiling)', async () => {
    const v1 = await activeDefinition();
    const pic = await createCaller({
      permissions: ALL,
      institutionId: alpha.id,
      isPicScoped: true,
    });

    expect((await get('/workflow-definitions', pic)).status).toBe(403);
    expect((await get('/workflow-definitions/templates', pic)).status).toBe(403);
    expect((await get(`/workflow-definitions/${v1.id}`, pic)).status).toBe(403);
    expect((await post('/workflow-definitions', COMMON_TEACHER, pic)).status).toBe(403);
    expect((await newVersion(v1.id, pic)).status).toBe(403);
  });

  it('leaves the PIC ceiling unchanged (DEC-P)', () => {
    expect(PIC_ALLOWED_PERMISSIONS.size).toBe(30);
    for (const code of ALL) expect(PIC_ALLOWED_PERMISSIONS.has(code)).toBe(false);
  });

  it('grants the codes to System Admin through the seeder', async () => {
    const rows = await query(
      `SELECT rp.permission_code AS code FROM public.role_permissions rp
         JOIN ref.roles r ON r.id = rp.role_id
        WHERE r.name = 'System Admin' AND rp.permission_code LIKE 'workflow-definition:%'
        ORDER BY rp.permission_code`
    );

    expect(rows.map((row) => row.code)).toEqual([...ALL].sort());
  });
});

describe('audit (decision D3)', () => {
  const auditFor = (entityType, entityId) =>
    models.AuditLog.findAll({
      where: { entityType, entityId: String(entityId) },
      order: [['timestamp', 'ASC']],
    });

  it('records the definition and each of its steps, with the actor', async () => {
    const draft = (await create({ ...COMMON_TEACHER, templateKey: 'COMMON_COMMON_TEACHER' })).body
      .data;

    const [created] = await auditFor('WorkflowDefinition', draft.id);
    expect(created).toMatchObject({ action: 'CREATE', actorId: admin.user.id });

    for (const s of draft.steps) {
      const [entry] = await auditFor('WorkflowDefinitionStep', s.id);
      expect(entry).toMatchObject({ action: 'CREATE', actorId: admin.user.id });
    }
  });

  it('records replaced steps as deleted and created, and publication as a change', async () => {
    const draft = (await create(COMMON_TEACHER)).body.data;
    const first = (await setSteps(draft.id, SARPRAS_FLOW)).body.data;
    const second = (await setSteps(draft.id, [step(1, 'REGISTER', 'KEPALA_SEKOLAH')])).body.data;

    for (const s of first.steps) {
      const actions = (await auditFor('WorkflowDefinitionStep', s.id)).map((e) => e.action);
      expect(actions).toEqual(['CREATE', 'DELETE']);
    }
    expect(
      (await auditFor('WorkflowDefinitionStep', second.steps[0].id)).map((e) => e.action)
    ).toEqual(['CREATE']);

    await publish(draft.id);
    const entries = await auditFor('WorkflowDefinition', draft.id);
    const last = entries.at(-1);
    expect(last.actorId).toBe(admin.user.id);
    expect(last.newValues).toMatchObject({ status: 'ACTIVE', publishedBy: admin.user.id });
    expect(last.oldValues).toMatchObject({ status: 'DRAFT' });
  });

  it('records the retirement of the previous version', async () => {
    const v1 = await activeDefinition();
    const v2 = (await newVersion(v1.id)).body.data;
    await publish(v2.id);

    const last = (await auditFor('WorkflowDefinition', v1.id)).at(-1);
    expect(last.oldValues).toMatchObject({ status: 'ACTIVE' });
    expect(last.newValues).toMatchObject({ status: 'RETIRED' });
  });
});

describe('nothing beyond configuration', () => {
  // Since Phase 38 requests run workflows — but only by being SUBMITTED.
  // Configuring or publishing a definition never creates a request step.
  it('never creates a request step by configuring or publishing', async () => {
    await activeDefinition();

    expect(await models.RequestStep.count()).toBe(0);
  });
});

/**
 * Migration 050's `down()` refuses while definitions exist. Run against the cycle
 * database, by name, so the answer does not depend on which migration is latest.
 */
describe('rolling back migration 050', () => {
  const CYCLE = cycleDatabaseUrl();
  const NAME = '20260924010000-050-create-workflow-definitions.js';

  beforeAll(async () => {
    await migrate(CYCLE);
  });

  it('refuses while a workflow definition exists', async () => {
    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address)
       VALUES ('Cycle WF', 'CYCLEWF', 'Jl. C') RETURNING id`,
      [],
      CYCLE
    );
    await query(
      `INSERT INTO public.workflow_definitions
         (institution_id, category, requester_position_code, version)
       VALUES ($1, 'COMMON', 'COMMON_TEACHER', 1)`,
      [institution.id],
      CYCLE
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', NAME], CYCLE)).rejects.toThrow(
        /Migration 050 rollback refused/
      );

      const [{ count }] = await query(
        'SELECT count(*)::int AS count FROM public.workflow_definitions',
        [],
        CYCLE
      );
      expect(count).toBe(1);
    } finally {
      await query('DELETE FROM public.workflow_definitions', [], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }
  });

  it('rolls back and re-applies cleanly when empty', async () => {
    // Since Phase 37, `requests.workflow_definition_id` references this table,
    // so migrations 053, 052 and 051 must come off first.
    // Phase 41: receipts and close events reference links and requests, so
    // 055 first; Phase 40: `request_item_units` references `request_items`.
    // Migration 057: receipt confirmations reference requests, request documents
    // and receipts, so 057 comes off first (and is re-applied with the rest).
    // Migration 067 (§73): stock movements reference request items, and it
    // alters request_items — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261010010000-067-create-consumables.js'],
      CYCLE
    );
    // Migration 062: confirmation photos name receipts of 055 / 057 — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261005010000-062-add-receipt-unit-photos.js'],
      CYCLE
    );
    // Migration 060: it alters `request_items` — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261003010000-060-add-request-item-reference-url.js'],
      CYCLE
    );
    // Migration 059: revision notes reference steps and items, and it alters
    // requests and steps — off first.
    await runCli(
      ['db:migrate:undo', '--name', '20261002020000-059-create-request-revisions.js'],
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
    await runCli(
      ['db:migrate:undo', '--name', '20260929010000-055-create-receipts-and-close-events.js'],
      CYCLE
    );
    await runCli(
      ['db:migrate:undo', '--name', '20260928010000-054-create-request-item-units.js'],
      CYCLE
    );
    await runCli(
      ['db:migrate:undo', '--name', '20260927010000-053-create-request-documents.js'],
      CYCLE
    );
    await runCli(
      ['db:migrate:undo', '--name', '20260926010000-052-create-request-steps.js'],
      CYCLE
    );
    await runCli(['db:migrate:undo', '--name', '20260925010000-051-create-requests.js'], CYCLE);
    await runCli(['db:migrate:undo', '--name', NAME], CYCLE);

    const [gone] = await query(
      `SELECT to_regclass('public.workflow_definitions') AS defs,
              to_regclass('public.workflow_definition_steps') AS steps`,
      [],
      CYCLE
    );
    expect(gone).toEqual({ defs: null, steps: null });

    await migrate(CYCLE);

    const [back] = await query(
      `SELECT to_regclass('public.workflow_definitions')::text AS defs`,
      [],
      CYCLE
    );
    expect(back.defs).toBe('workflow_definitions');
  });
});
