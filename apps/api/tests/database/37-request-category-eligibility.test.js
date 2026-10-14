import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  resetAssetCoreData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Requester-context category eligibility — UAT decision, 2026-09-28
 * (`requestGuidance.js` ELIGIBLE_CATEGORIES).
 *
 * A request made as a Jurusan teacher may be COMMON or JURUSAN only; KBM and
 * EKSKUL are refused on create, on a draft's change of category, and at
 * submission (a draft saved before the rule). Every other context is unchanged —
 * in particular the teacher of common subjects keeps all four. The categories
 * themselves, the typical-category guidance and `DEC-F` (a workflow must exist
 * to submit) are untouched.
 */

const V1 = '/api/v1';
const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request:submit',
  'request-item:create',
];

let alpha;
let tkj;

const send = (method, path, body, caller) => {
  const call = api()
    [method](`${V1}${path}`)
    .set(...caller.auth);
  return body === undefined ? call : call.send(body);
};
const get = (path, caller) => send('get', path, undefined, caller);
const post = (path, body, caller) => send('post', path, body ?? {}, caller);
const patch = (path, body, caller) => send('patch', path, body, caller);

async function requester(position, department = null) {
  const caller = await createCaller({ permissions: REQUESTER, institutionId: alpha.id });
  const assignment = await models.PositionAssignment.create({
    institutionId: alpha.id,
    userId: caller.user.id,
    positionCode: position,
    departmentId: department?.id ?? null,
  });
  return { ...caller, assignment };
}

const draft = (caller, category) =>
  post(
    '/requests',
    { requesterAssignmentId: caller.assignment.id, category, title: 'Alat' },
    caller
  );

/** An ACTIVE workflow with one decision and the registration step. */
async function workflow(category, requesterPositionCode) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: alpha.id,
    category,
    requesterPositionCode,
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
  return definition;
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  tkj = await models.Department.create({ code: 'TKJ', name: 'TKJ', institutionId: alpha.id });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

describe('a Jurusan teacher requests COMMON or JURUSAN only', () => {
  it.each(['KBM', 'EKSKUL'])('refuses %s on create, naming the category', async (category) => {
    const teacher = await requester('JURUSAN_TEACHER', tkj);

    const response = await draft(teacher, category);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0]).toEqual(expect.objectContaining({ field: 'category' }));
    expect(response.body.error.details[0].issue).toMatch(/COMMON, JURUSAN/);
    expect(await models.Request.count()).toBe(0);
  });

  it.each(['COMMON', 'JURUSAN'])('accepts %s', async (category) => {
    const teacher = await requester('JURUSAN_TEACHER', tkj);

    expect((await draft(teacher, category)).status).toBe(201);
  });

  it('refuses changing a draft to KBM, and leaves it as it was', async () => {
    const teacher = await requester('JURUSAN_TEACHER', tkj);
    const { id } = (await draft(teacher, 'COMMON')).body.data;

    const response = await patch(`/requests/${id}`, { category: 'KBM' }, teacher);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('category');
    expect((await models.Request.findByPk(id)).category).toBe('COMMON');
  });

  it('refuses at submission a draft saved before the rule — even with a workflow', async () => {
    const teacher = await requester('JURUSAN_TEACHER', tkj);
    const { id } = (await draft(teacher, 'COMMON')).body.data;
    // As such a draft exists in the database: written before the rule.
    await models.Request.update({ category: 'KBM' }, { where: { id } });
    await post(`/requests/${id}/items`, { description: 'Alat', quantityRequested: 1 }, teacher);
    await workflow('KBM', 'JURUSAN_TEACHER');

    const response = await post(`/requests/${id}/submit`, {}, teacher);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('category');
    expect((await models.Request.findByPk(id)).status).toBe('DRAFT');
    // Still editable in every other respect.
    expect((await patch(`/requests/${id}`, { title: 'Alat baru' }, teacher)).status).toBe(200);
  });

  it('says which categories are eligible in the guidance', async () => {
    const teacher = await requester('JURUSAN_TEACHER', tkj);

    const { body } = await get('/requests/guidance', teacher);

    const [context] = body.data.contexts;
    expect(Object.fromEntries(context.categories.map((c) => [c.category, c.eligible]))).toEqual({
      COMMON: true,
      JURUSAN: true,
      KBM: false,
      EKSKUL: false,
    });
  });
});

/**
 * P2 (`IMPLEMENTATION_PLAN.md` §64.2): a teacher of common subjects requests
 * COMMON, KBM or EKSKUL — never JURUSAN. The same map, the same four checks.
 * `request.department_id` keeps its meaning: nothing here changes a
 * department rule, only which category may be chosen.
 */
describe('a teacher of common subjects requests COMMON, KBM or EKSKUL only', () => {
  it('may draft COMMON, KBM and EKSKUL', async () => {
    const teacher = await requester('COMMON_TEACHER');

    for (const category of ['COMMON', 'KBM', 'EKSKUL']) {
      expect((await draft(teacher, category)).status).toBe(201);
    }
  });

  it('refuses JURUSAN on create — even with a department supplied — naming the category', async () => {
    const teacher = await requester('COMMON_TEACHER');

    const response = await post(
      '/requests',
      {
        requesterAssignmentId: teacher.assignment.id,
        category: 'JURUSAN',
        title: 'Alat',
        departmentId: tkj.id,
      },
      teacher
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      {
        field: 'category',
        issue:
          'a request made as COMMON_TEACHER may be one of COMMON, KBM, EKSKUL; JURUSAN is not among them',
      },
    ]);
    expect(await models.Request.count()).toBe(0);
  });

  it('refuses changing a draft to JURUSAN, and leaves it as it was', async () => {
    const teacher = await requester('COMMON_TEACHER');
    const { id } = (await draft(teacher, 'COMMON')).body.data;

    const response = await patch(
      `/requests/${id}`,
      { category: 'JURUSAN', departmentId: tkj.id },
      teacher
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('category');
    const stored = await models.Request.findByPk(id);
    expect(stored.category).toBe('COMMON');
    expect(stored.departmentId).toBeNull();
  });

  it('refuses at submission a JURUSAN draft saved before the rule — even with a workflow', async () => {
    const teacher = await requester('COMMON_TEACHER');
    const { id } = (await draft(teacher, 'COMMON')).body.data;
    await models.Request.update({ category: 'JURUSAN', departmentId: tkj.id }, { where: { id } });
    await post(`/requests/${id}/items`, { description: 'Alat', quantityRequested: 1 }, teacher);
    // Written directly: publishing one is refused (`30-workflow-definitions`).
    await workflow('JURUSAN', 'COMMON_TEACHER');

    const detail = await get(`/requests/${id}`, teacher);
    expect(detail.body.data.submitBlockers).toEqual([
      expect.objectContaining({ code: 'CATEGORY_NOT_ELIGIBLE', fixedBy: 'REQUESTER' }),
    ]);
    const response = await post(`/requests/${id}/submit`, {}, teacher);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('category');
    expect((await models.Request.findByPk(id)).status).toBe('DRAFT');
    expect(await models.RequestStep.count()).toBe(0);
  });

  it('says JURUSAN is not eligible in the guidance', async () => {
    const teacher = await requester('COMMON_TEACHER');

    const { body } = await get('/requests/guidance', teacher);

    const [context] = body.data.contexts;
    expect(Object.fromEntries(context.categories.map((c) => [c.category, c.eligible]))).toEqual({
      COMMON: true,
      JURUSAN: false,
      KBM: true,
      EKSKUL: true,
    });
  });

  it('leaves a context that may request JURUSAN free to — Kepala Sekolah', async () => {
    const kepala = await requester('KEPALA_SEKOLAH');

    const response = await post(
      '/requests',
      {
        requesterAssignmentId: kepala.assignment.id,
        category: 'JURUSAN',
        title: 'Alat',
        departmentId: tkj.id,
      },
      kepala
    );

    expect(response.status).toBe(201);
  });

  it.each(['KBM', 'EKSKUL'])('submits %s under its workflow', async (category) => {
    const teacher = await requester('COMMON_TEACHER');
    await workflow(category, 'COMMON_TEACHER');
    const { id } = (await draft(teacher, category)).body.data;
    await post(`/requests/${id}/items`, { description: 'Alat', quantityRequested: 1 }, teacher);

    const response = await post(`/requests/${id}/submit`, {}, teacher);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('SUBMITTED');
  });
});
