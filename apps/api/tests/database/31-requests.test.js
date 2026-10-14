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
const { POSITION_CODES, requiresDepartment } = require('../../src/domain/schoolPositions.js');
const { REQUEST_CATEGORIES } = require('../../src/domain/requestCategories.js');
const { REQUEST_STATUSES } = require('../../src/domain/requestStatuses.js');
const { currentBusinessMonth } = require('../../src/domain/businessMonth.js');

/**
 * Request drafting — Phase 37 (`CR-014`), REQ-REQUEST-001 – REQ-REQUEST-006,
 * REQ-REQUEST-015. Decisions Q1 (working assumption) and E1–E9.
 *
 *   THE LISTS      every CHECK admits exactly the JavaScript constant (`DEC-U`).
 *   THE SCHEMA     JURUSAN department, definition-after-DRAFT, the E6 context
 *                  CHECKs, item quantities, no cascade.
 *   DRAFTING       own current context, snapshot, department and destination
 *                  rules, numbering, items and renumbering — and guidance NEVER
 *                  blocks a draft.
 *   VISIBILITY     a DRAFT is private to its requester (E1); oversight sees
 *                  submitted requests only; 404 otherwise.
 *   THE BOUNDARY   permissions, the PIC ceiling, audit, and nothing beyond
 *                  drafting (direct registration unchanged).
 */

const V1 = '/api/v1';
const LEAF = '117010101001';
const CLASS_PARENT = '132080141000';

const ALL = [
  'request:read',
  'request:create',
  'request:update',
  'request-item:create',
  'request-item:update',
  'request-item:delete',
];

let admin;
let alpha;
let beta;
let tkj;
let rpl;
let betaDept;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();

  admin = await createAdminCaller();

  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
  tkj = await models.Department.create({
    code: 'TKJ',
    name: 'Jurusan TKJ',
    institutionId: alpha.id,
  });
  rpl = await models.Department.create({
    code: 'RPL',
    name: 'Jurusan RPL',
    institutionId: alpha.id,
  });
  betaDept = await models.Department.create({
    code: 'TKJ',
    name: 'Beta TKJ',
    institutionId: beta.id,
  });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
});

// --- helpers ------------------------------------------------------------------

const send = (method, path, body, caller) => {
  const call = api()
    [method](`${V1}${path}`)
    .set(...caller.auth);
  return body === undefined ? call : call.send(body);
};
const get = (path, caller) => send('get', path, undefined, caller);
const post = (path, body, caller) => send('post', path, body ?? {}, caller);
const patch = (path, body, caller) => send('patch', path, body, caller);
const del = (path, caller) => send('delete', path, undefined, caller);

/** A caller holding `permissions` and a current school position. */
async function requester({
  institution = alpha,
  position = 'COMMON_TEACHER',
  department = null,
  permissions = ALL,
  ...rest
} = {}) {
  const caller = await createCaller({ permissions, institutionId: institution.id, ...rest });
  const assignment = await models.PositionAssignment.create({
    institutionId: institution.id,
    userId: caller.user.id,
    positionCode: position,
    departmentId: department?.id ?? null,
  });
  return { ...caller, assignment };
}

const draft = (caller, body = {}) =>
  post(
    '/requests',
    {
      requesterAssignmentId: caller.assignment.id,
      category: 'COMMON',
      title: 'Proyektor kelas',
      ...body,
    },
    caller
  );

const addItem = (caller, requestId, body = {}) =>
  post(
    `/requests/${requestId}/items`,
    { description: 'Proyektor', quantityRequested: 2, ...body },
    caller
  );

async function location(institution = alpha, name = 'Lab 1') {
  return models.Location.create({ name, classificationId: LEAF, institutionId: institution.id });
}

async function activeWorkflow(institution, category, requesterPositionCode) {
  return models.WorkflowDefinition.create({
    institutionId: institution.id,
    category,
    requesterPositionCode,
    version: 1,
    status: 'ACTIVE',
    publishedAt: new Date(),
  });
}

/** Simulates Phase 38 in the database only: a request that has left DRAFT. */
async function markSubmitted(requestId) {
  const request = await models.Request.findByPk(requestId);
  const definition =
    (await models.WorkflowDefinition.findOne({
      where: {
        institutionId: request.institutionId,
        category: request.category,
        requesterPositionCode: request.requesterPositionCode,
      },
    })) ??
    (await activeWorkflow(
      { id: request.institutionId },
      request.category,
      request.requesterPositionCode
    ));
  await query(
    `UPDATE public.requests SET status = 'SUBMITTED', workflow_definition_id = $2, submitted_at = now()
      WHERE id = $1`,
    [requestId, definition.id]
  );
}

async function checkLiterals(name) {
  const [row] = await query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1`,
    [name]
  );
  return [...row.definition.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
}

const year = () => currentBusinessMonth().year;

// ---------------------------------------------------------------------------

describe('the value lists do not drift (CR-014 DEC-U)', () => {
  it.each([
    ['chk_requests_category', REQUEST_CATEGORIES],
    ['chk_requests_requester', POSITION_CODES],
    ['chk_requests_status', REQUEST_STATUSES],
  ])('%s admits exactly the JavaScript constant', async (name, constant) => {
    expect(await checkLiterals(name)).toEqual([...constant].sort());
  });

  it('chk_requests_requester_department names exactly the department-bound positions (E6)', async () => {
    expect(await checkLiterals('chk_requests_requester_department')).toEqual(
      POSITION_CODES.filter((code) => requiresDepartment(code)).sort()
    );
  });
});

describe('the database backstop', () => {
  let user;
  let assignment;
  let kajur;

  beforeEach(async () => {
    const caller = await requester();
    user = caller.user;
    assignment = caller.assignment;
    kajur = await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: user.id,
      positionCode: 'KAJUR',
      departmentId: tkj.id,
    });
  });

  const insert = (overrides = {}) => {
    const row = {
      institution_id: alpha.id,
      request_number: `REQ/T/${Math.random()}`.slice(0, 32),
      category: 'COMMON',
      title: 'T',
      requester_user_id: user.id,
      requester_assignment_id: assignment.id,
      requester_position_code: 'COMMON_TEACHER',
      requester_department_id: null,
      department_id: null,
      status: 'DRAFT',
      workflow_definition_id: null,
      ...overrides,
    };
    const columns = Object.keys(row);
    return query(
      `INSERT INTO public.requests (${columns.join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row)
    );
  };

  it('requires a department on a JURUSAN request', async () => {
    await expect(insert({ category: 'JURUSAN' })).rejects.toThrow(
      /chk_requests_jurusan_department/
    );
  });

  it('requires a workflow once a request leaves DRAFT', async () => {
    await expect(insert({ status: 'SUBMITTED' })).rejects.toThrow(/chk_requests_definition/);
  });

  it('ties the context snapshot to department-bound positions (E6)', async () => {
    await expect(
      insert({ requester_assignment_id: kajur.id, requester_position_code: 'KAJUR' })
    ).rejects.toThrow(/chk_requests_requester_department/);
    await expect(insert({ requester_department_id: tkj.id })).rejects.toThrow(
      /chk_requests_requester_department/
    );
  });

  it('locks the department of a department-bound context (E6)', async () => {
    await expect(
      insert({
        requester_assignment_id: kajur.id,
        requester_position_code: 'KAJUR',
        requester_department_id: tkj.id,
        department_id: rpl.id,
      })
    ).rejects.toThrow(/chk_requests_department_locked/);
  });

  it('refuses a zero quantity, an over-cancellation and a negative price', async () => {
    const [{ id }] = await insert();
    const item = (overrides) =>
      query(
        `INSERT INTO public.request_items (request_id, line_no, description, quantity_requested,
           quantity_cancelled, estimated_unit_price)
         VALUES ($1, $2, 'x', $3, $4, $5)`,
        [
          id,
          overrides.line ?? 1,
          overrides.qty ?? 1,
          overrides.cancelled ?? 0,
          overrides.price ?? null,
        ]
      );

    await expect(item({ qty: 0 })).rejects.toThrow(/chk_request_items_quantity/);
    await expect(item({ qty: 2, cancelled: 3 })).rejects.toThrow(/chk_request_items_cancelled/);
    await expect(item({ price: -1 })).rejects.toThrow(/chk_request_items_price/);
  });

  it('does not cascade from a request to its items', async () => {
    const [{ id }] = await insert();
    await query(
      `INSERT INTO public.request_items (request_id, line_no, description, quantity_requested)
       VALUES ($1, 1, 'x', 1)`,
      [id]
    );

    await expect(query('DELETE FROM public.requests WHERE id = $1', [id])).rejects.toThrow(
      /fk_request_items_request/
    );
  });
});

describe('creating a DRAFT (REQ-REQUEST-001 – REQ-REQUEST-003)', () => {
  it('creates a numbered DRAFT recording the requester context', async () => {
    const teacher = await requester();

    const response = await draft(teacher, { justification: 'Kelas X', neededBy: '2026-12-01' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      institutionId: alpha.id,
      requestNumber: `REQ/${year()}/0001`,
      status: 'DRAFT',
      category: 'COMMON',
      title: 'Proyektor kelas',
      justification: 'Kelas X',
      neededBy: '2026-12-01',
      requesterUserId: teacher.user.id,
      requesterAssignmentId: teacher.assignment.id,
      requesterAssignmentCurrent: true,
      requesterPositionCode: 'COMMON_TEACHER',
      requesterDepartmentId: null,
      departmentId: null,
      workflowDefinitionId: null,
      items: [],
    });
  });

  it('numbers per institution, in order, and never repeats under concurrency (E7)', async () => {
    const one = await requester();
    const two = await requester();
    const other = await requester({ institution: beta });

    const responses = await Promise.all([
      draft(one),
      draft(two),
      draft(one),
      draft(two),
      draft(one),
    ]);
    const numbers = responses.map((response) => response.body.data.requestNumber).sort();

    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(numbers).toEqual([1, 2, 3, 4, 5].map((n) => `REQ/${year()}/000${n}`));
    expect((await draft(other)).body.data.requestNumber).toBe(`REQ/${year()}/0001`);
  });

  it('refuses a context that is not the caller’s own', async () => {
    const teacher = await requester();
    const someoneElse = await requester();

    const response = await post(
      '/requests',
      { requesterAssignmentId: someoneElse.assignment.id, category: 'COMMON', title: 'x' },
      teacher
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('requesterAssignmentId');
  });

  it('refuses an assignment that has ended', async () => {
    const teacher = await requester();
    await teacher.assignment.update({ isCurrent: false, endedAt: new Date() });

    const response = await draft(teacher);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/ended/);
  });

  it('allows a category with no active workflow — guidance never blocks a draft', async () => {
    const teacher = await requester();
    expect(await models.WorkflowDefinition.count()).toBe(0);

    for (const category of ['COMMON', 'KBM', 'EKSKUL']) {
      expect((await draft(teacher, { category })).status).toBe(201);
    }
  });

  it('allows an unusual category for the context', async () => {
    const kepala = await requester({ position: 'KEPALA_SEKOLAH' });

    const response = await draft(kepala, { category: 'JURUSAN', departmentId: tkj.id });

    expect(response.status).toBe(201);
    expect(response.body.data.category).toBe('JURUSAN');
  });

  it.each([
    [{ status: 'SUBMITTED' }, 'body'],
    [{ workflowDefinitionId: '00000000-0000-4000-8000-000000000000' }, 'body'],
    [{ category: 'INVENTARIS' }, 'body.category'],
    [{ title: '' }, 'body.title'],
    [{ neededBy: '2026-02-30' }, 'body.neededBy'],
  ])('refuses %o', async (body, field) => {
    const teacher = await requester();

    const response = await draft(teacher, body);

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
  });
});

describe('the department (REQ-REQUEST-004)', () => {
  it('takes the department of a department-bound context, and locks it', async () => {
    const jurusanTeacher = await requester({ position: 'JURUSAN_TEACHER', department: tkj });

    const created = await draft(jurusanTeacher);
    const other = await draft(jurusanTeacher, { departmentId: rpl.id });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      requesterDepartmentId: tkj.id,
      departmentId: tkj.id,
      department: { code: 'TKJ' },
    });
    expect(other.status).toBe(400);
    expect(other.body.error.details[0].field).toBe('departmentId');
  });

  it('requires a department for JURUSAN from a context without one', async () => {
    // A context without a department that may request JURUSAN — since P2
    // (§64.2) never a teacher of common subjects (`37-request-category-eligibility`).
    const teacher = await requester({ position: 'WAKASEK_SARPRAS' });

    const missing = await draft(teacher, { category: 'JURUSAN' });
    const given = await draft(teacher, { category: 'JURUSAN', departmentId: rpl.id });

    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].field).toBe('departmentId');
    expect(given.status).toBe(201);
    expect(given.body.data.departmentId).toBe(rpl.id);
  });

  it('keeps the department optional otherwise, but refuses a foreign or inactive one', async () => {
    const teacher = await requester();
    await rpl.update({ isActive: false });

    expect((await draft(teacher)).body.data.departmentId).toBeNull();
    expect((await draft(teacher, { departmentId: betaDept.id })).status).toBe(400);
    expect((await draft(teacher, { departmentId: rpl.id })).status).toBe(400);
  });
});

describe('the destination (REQ-REQUEST-005)', () => {
  it('accepts an active location of the institution, as intent only', async () => {
    const teacher = await requester();
    const lab = await location();

    const response = await draft(teacher, { destinationLocationId: lab.id });

    expect(response.status).toBe(201);
    // `isActive`: REQ-REQUEST-024 — receipt warns when it would place nothing.
    expect(response.body.data.destination).toEqual({ id: lab.id, name: 'Lab 1', isActive: true });
  });

  it('refuses a location of another institution, or a deactivated one', async () => {
    const teacher = await requester();
    const foreign = await location(beta);
    const closed = await location(alpha, 'Gudang lama');
    await closed.update({ isActive: false });

    for (const id of [foreign.id, closed.id]) {
      const response = await draft(teacher, { destinationLocationId: id });
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('destinationLocationId');
    }
  });
});

describe('editing a DRAFT (E3, E9)', () => {
  it('lets the requester change every field but the context', async () => {
    const teacher = await requester();
    const lab = await location();
    const { id } = (await draft(teacher)).body.data;

    const response = await patch(
      `/requests/${id}`,
      {
        title: 'Proyektor lab',
        category: 'KBM',
        destinationLocationId: lab.id,
        neededBy: '2026-11-01',
        justification: 'Praktikum',
      },
      teacher
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'Proyektor lab',
      category: 'KBM',
      destinationLocationId: lab.id,
      neededBy: '2026-11-01',
    });

    const cleared = await patch(`/requests/${id}`, { destinationLocationId: null }, teacher);
    expect(cleared.body.data.destinationLocationId).toBeNull();

    const context = await patch(
      `/requests/${id}`,
      { requesterAssignmentId: teacher.assignment.id },
      teacher
    );
    expect(context.status).toBe(400);
  });

  it('re-checks the department rules on every change', async () => {
    // May request JURUSAN, so the refusal below is the department rule's (P2).
    const teacher = await requester({ position: 'WAKASEK_SARPRAS' });
    const kajur = await requester({ position: 'KAJUR', department: tkj });
    const common = (await draft(teacher)).body.data;
    const bound = (await draft(kajur)).body.data;

    expect((await patch(`/requests/${common.id}`, { category: 'JURUSAN' }, teacher)).status).toBe(
      400
    );
    expect((await patch(`/requests/${bound.id}`, { departmentId: rpl.id }, kajur)).status).toBe(
      400
    );
    expect((await patch(`/requests/${bound.id}`, { category: 'JURUSAN' }, kajur)).status).toBe(200);
  });

  it('keeps the snapshot, and the draft editable, after the assignment ends (E9)', async () => {
    const jurusanTeacher = await requester({ position: 'JURUSAN_TEACHER', department: tkj });
    const { id } = (await draft(jurusanTeacher)).body.data;
    await jurusanTeacher.assignment.update({ isCurrent: false, endedAt: new Date() });

    const response = await patch(`/requests/${id}`, { title: 'Masih draf' }, jurusanTeacher);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      requesterPositionCode: 'JURUSAN_TEACHER',
      requesterDepartmentId: tkj.id,
      departmentId: tkj.id,
      requesterAssignmentCurrent: false,
      title: 'Masih draf',
    });
  });

  it('refuses to edit a request that has left DRAFT', async () => {
    const teacher = await requester();
    const { id } = (await draft(teacher)).body.data;
    await markSubmitted(id);

    const response = await patch(`/requests/${id}`, { title: 'Late' }, teacher);

    expect(response.status).toBe(409);
  });

  it('never lets anyone else edit a DRAFT, nor anything but the destination later (E3)', async () => {
    const teacher = await requester();
    const overseer = await createCaller({
      permissions: [...ALL, 'request:oversee'],
      institutionId: alpha.id,
    });
    const { id } = (await draft(teacher)).body.data;

    expect((await patch(`/requests/${id}`, { title: 'x' }, overseer)).status).toBe(404);

    // Since Phase 38 oversight may change the destination of a submitted
    // request — and nothing else (`32-request-workflow` covers it in full).
    await markSubmitted(id);
    expect((await patch(`/requests/${id}`, { title: 'x' }, overseer)).status).toBe(409);
    expect((await patch(`/requests/${id}`, { destinationLocationId: null }, overseer)).status).toBe(
      200
    );
  });
});

describe('items (REQ-REQUEST-006, Q1, E8)', () => {
  it('adds numbered lines with whole-number quantities, and reports required', async () => {
    const teacher = await requester();
    const unit = await models.MeasurementUnit.create({ name: 'unit' });
    const { id } = (await draft(teacher)).body.data;

    const first = await addItem(teacher, id, {
      measurementUnitId: unit.id,
      estimatedUnitPrice: 4500000,
      classificationId: LEAF,
      specification: '3000 lumen',
    });
    const second = await addItem(teacher, id, { description: 'Layar', quantityRequested: 1 });

    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      lineNo: 1,
      quantityRequested: 2,
      quantityCancelled: 0,
      quantityRequired: 2,
      measurementUnit: { id: unit.id, name: 'unit' },
      classificationId: LEAF,
    });
    expect(second.body.data.lineNo).toBe(2);

    const detail = await get(`/requests/${id}`, teacher);
    expect(detail.body.data.items.map((item) => item.lineNo)).toEqual([1, 2]);
    // E5: no registered or received figure existed before Phases 40 / 41.
    // Phase 40 adds the registered count (links, D4); receipt stays Phase 41.
    expect(detail.body.data.items[0].quantityRegistered).toBe(0);
    // Phase 41: received counts receipts only — none on a draft.
    expect(detail.body.data.items[0].quantityReceived).toBe(0);
  });

  it.each([
    [{ quantityRequested: 0 }, 'body.quantityRequested'],
    [{ quantityRequested: 1.5 }, 'body.quantityRequested'],
    [{ quantityRequested: -3 }, 'body.quantityRequested'],
    [{ quantityCancelled: 1 }, 'body'],
    [{ unitOfMeasure: 'metre', quantity: 12.5 }, 'body'],
    [{ estimatedUnitPrice: -1 }, 'body.estimatedUnitPrice'],
    [{ description: '' }, 'body.description'],
  ])('refuses %o', async (body, field) => {
    const teacher = await requester();
    const { id } = (await draft(teacher)).body.data;

    const response = await addItem(teacher, id, body);

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((detail) => detail.field)).toContain(field);
  });

  it('refuses an unknown measurement unit, and another institution’s classification', async () => {
    const teacher = await requester();
    const { id } = (await draft(teacher)).body.data;
    const owned = await post(
      '/classifications',
      { parentId: CLASS_PARENT, name: 'Milik Beta', institutionId: beta.id },
      admin
    );
    expect(owned.status).toBe(201);

    const unit = await addItem(teacher, id, {
      measurementUnitId: '00000000-0000-4000-8000-000000000000',
    });
    const foreign = await addItem(teacher, id, { classificationId: owned.body.data.id });

    expect(unit.status).toBe(400);
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.details[0].field).toBe('classificationId');

    await models.AssetClassification.destroy({ where: { origin: 3 } });
  });

  it('edits a line, and never lets quantityCancelled be written', async () => {
    const teacher = await requester();
    const { id } = (await draft(teacher)).body.data;
    const item = (await addItem(teacher, id)).body.data;

    const edited = await patch(`/request-items/${item.id}`, { quantityRequested: 5 }, teacher);
    const cancelled = await patch(`/request-items/${item.id}`, { quantityCancelled: 1 }, teacher);

    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ quantityRequested: 5, quantityRequired: 5 });
    expect(cancelled.status).toBe(400);
  });

  it('renumbers the remaining lines after a deletion (E8)', async () => {
    const teacher = await requester();
    const { id } = (await draft(teacher)).body.data;
    const lines = [];
    for (const description of ['A', 'B', 'C', 'D']) {
      lines.push((await addItem(teacher, id, { description })).body.data);
    }

    expect((await del(`/request-items/${lines[1].id}`, teacher)).status).toBe(204);

    const after = (await get(`/requests/${id}`, teacher)).body.data.items;
    expect(after.map((item) => [item.lineNo, item.description])).toEqual([
      [1, 'A'],
      [2, 'C'],
      [3, 'D'],
    ]);
    expect((await addItem(teacher, id, { description: 'E' })).body.data.lineNo).toBe(4);
  });

  it('allows item changes only on the requester’s own DRAFT', async () => {
    const teacher = await requester();
    const colleague = await requester();
    const { id } = (await draft(teacher)).body.data;
    const item = (await addItem(teacher, id)).body.data;

    expect((await addItem(colleague, id)).status).toBe(404);
    expect((await patch(`/request-items/${item.id}`, { description: 'x' }, colleague)).status).toBe(
      404
    );
    expect((await del(`/request-items/${item.id}`, colleague)).status).toBe(404);

    await markSubmitted(id);
    expect((await addItem(teacher, id)).status).toBe(409);
    expect((await patch(`/request-items/${item.id}`, { description: 'x' }, teacher)).status).toBe(
      409
    );
    expect((await del(`/request-items/${item.id}`, teacher)).status).toBe(409);
  });
});

describe('visibility (REQ-REQUEST-015, E1, E4)', () => {
  it('keeps a DRAFT private to its requester — oversight and system-wide roles included', async () => {
    const teacher = await requester();
    const overseer = await createCaller({
      permissions: [...ALL, 'request:oversee'],
      institutionId: alpha.id,
    });
    const colleague = await requester();
    const { id } = (await draft(teacher)).body.data;

    for (const caller of [overseer, admin, colleague]) {
      expect((await get(`/requests/${id}`, caller)).status).toBe(404);
      expect((await get('/requests', caller)).body.data.map((row) => row.id)).not.toContain(id);
    }
    expect((await get(`/requests/${id}`, teacher)).status).toBe(200);
  });

  it('shows oversight a submitted request of its own institution only', async () => {
    const teacher = await requester();
    const betaTeacher = await requester({ institution: beta });
    const overseer = await createCaller({
      permissions: [...ALL, 'request:oversee'],
      institutionId: alpha.id,
    });
    const colleague = await requester();
    const mine = (await draft(teacher)).body.data;
    const theirs = (await draft(betaTeacher)).body.data;
    await markSubmitted(mine.id);
    await markSubmitted(theirs.id);

    expect((await get(`/requests/${mine.id}`, overseer)).status).toBe(200);
    expect((await get(`/requests/${theirs.id}`, overseer)).status).toBe(404);
    expect((await get(`/requests/${mine.id}`, colleague)).status).toBe(404);
    expect((await get(`/requests/${theirs.id}`, admin)).status).toBe(200);

    const listed = (await get('/requests', overseer)).body.data.map((row) => row.id);
    expect(listed).toEqual([mine.id]);
  });

  it('lists the caller’s own requests with filters, and `mine`', async () => {
    const teacher = await requester();
    await draft(teacher, { category: 'KBM' });
    await draft(teacher);

    const all = await get('/requests', teacher);
    const kbm = await get('/requests?category=KBM', teacher);
    const mine = await get('/requests?mine=true', teacher);

    expect(all.body.meta.total).toBe(2);
    expect(kbm.body.data.map((row) => row.category)).toEqual(['KBM']);
    expect(mine.body.meta.total).toBe(2);
    expect(all.body.data[0]).toHaveProperty('itemCount', 0);
  });
});

describe('guidance — informational only', () => {
  it('describes each current context without refusing anything', async () => {
    const teacher = await requester();
    await models.PositionAssignment.create({
      institutionId: alpha.id,
      userId: teacher.user.id,
      positionCode: 'JURUSAN_TEACHER',
      departmentId: tkj.id,
    });
    const lab = await location();
    await models.LocationPicAssignment.create({ locationId: lab.id, userId: teacher.user.id });
    await activeWorkflow(alpha, 'KBM', 'COMMON_TEACHER');

    const response = await get('/requests/guidance', teacher);

    expect(response.status).toBe(200);
    const [common, jurusan] = response.body.data.contexts;
    expect(common).toMatchObject({
      positionCode: 'COMMON_TEACHER',
      departmentRule: 'OPTIONAL',
      typicalCategories: ['COMMON', 'KBM', 'EKSKUL'],
      defaultDestinations: [{ id: lab.id, name: 'Lab 1' }],
    });
    expect(
      Object.fromEntries(common.categories.map((c) => [c.category, c.processConfigured]))
    ).toEqual({
      COMMON: false,
      JURUSAN: false,
      KBM: true,
      EKSKUL: false,
    });
    expect(jurusan).toMatchObject({
      positionCode: 'JURUSAN_TEACHER',
      departmentRule: 'LOCKED',
      department: { id: tkj.id },
    });

    // Not configured is still draftable.
    expect((await draft(teacher, { category: 'EKSKUL' })).status).toBe(201);
  });

  it('returns no context to a caller holding no current position', async () => {
    const nobody = await createCaller({ permissions: ALL, institutionId: alpha.id });

    const response = await get('/requests/guidance', nobody);

    expect(response.body.data.contexts).toEqual([]);
  });
});

describe('permissions and the PIC ceiling (E2)', () => {
  it('requires the matching code for each action', async () => {
    const teacher = await requester();
    const { id } = (await draft(teacher)).body.data;
    const item = (await addItem(teacher, id)).body.data;
    const without = (code) => requester({ permissions: ALL.filter((granted) => granted !== code) });

    const noRead = await without('request:read');
    expect((await get('/requests', noRead)).status).toBe(403);

    const noCreate = await without('request:create');
    expect((await draft(noCreate)).status).toBe(403);
    expect((await get('/requests/guidance', noCreate)).status).toBe(403);

    // The remaining checks run on the requester's own draft, so a 403 can only
    // come from the missing code.
    for (const [code, call] of [
      ['request:update', (c) => patch(`/requests/${id}`, { title: 'x' }, c)],
      ['request-item:create', (c) => addItem(c, id)],
      ['request-item:update', (c) => patch(`/request-items/${item.id}`, { description: 'x' }, c)],
      ['request-item:delete', (c) => del(`/request-items/${item.id}`, c)],
    ]) {
      const role = await models.Role.findByPk(teacher.role.id);
      await models.RolePermission.destroy({ where: { roleId: role.id, permissionCode: code } });
      expect((await call(teacher)).status).toBe(403);
      await models.RolePermission.create({ roleId: role.id, permissionCode: code });
    }
  });

  it('refuses a PIC-scoped caller even when the codes are granted (CR-004 ceiling)', async () => {
    const pic = await requester({
      permissions: [...ALL, 'request:oversee'],
      isPicScoped: true,
    });

    expect((await get('/requests', pic)).status).toBe(403);
    expect((await get('/requests/guidance', pic)).status).toBe(403);
    expect((await draft(pic)).status).toBe(403);
  });
});

describe('audit', () => {
  const auditFor = (entityType, entityId) =>
    models.AuditLog.findAll({
      where: { entityType, entityId: String(entityId) },
      order: [['timestamp', 'ASC']],
    });

  it('records the request, its items and their renumbering, with the actor', async () => {
    const teacher = await requester();
    const { id } = (await draft(teacher)).body.data;
    const a = (await addItem(teacher, id, { description: 'A' })).body.data;
    const b = (await addItem(teacher, id, { description: 'B' })).body.data;
    await del(`/request-items/${a.id}`, teacher);

    expect((await auditFor('Request', id))[0]).toMatchObject({
      action: 'CREATE',
      actorId: teacher.user.id,
    });
    expect((await auditFor('RequestItem', a.id)).map((e) => e.action)).toEqual([
      'CREATE',
      'DELETE',
    ]);
    const moved = await auditFor('RequestItem', b.id);
    expect(moved.map((e) => e.action)).toEqual(['CREATE', 'UPDATE']);
    expect(moved[1].newValues).toMatchObject({ lineNo: 1 });
  });
});

describe('nothing beyond drafting', () => {
  it('leaves direct registration unchanged and untouched by requests (REQ-REQUEST-001)', async () => {
    const teacher = await requester();
    await draft(teacher);

    const asset = await post(
      '/assets',
      { name: 'Laptop', classificationId: LEAF, institutionId: alpha.id },
      admin
    );
    const unit = await post(`/assets/${asset.body.data.id}/units`, {}, admin);

    expect(asset.status).toBe(201);
    expect(unit.status).toBe(201);
    // Phase 40 (D7): the unit detail carries `requestItem` — null for a unit
    // registered directly — and no link is ever created for it.
    expect(unit.body.data.requestItem).toBeNull();
    expect(await models.RequestItemUnit.count()).toBe(0);
  });

  it('touches no workflow definition', async () => {
    const definition = await activeWorkflow(alpha, 'COMMON', 'COMMON_TEACHER');
    const teacher = await requester();
    const { id } = (await draft(teacher)).body.data;
    await addItem(teacher, id);

    const after = await models.WorkflowDefinition.findByPk(definition.id);
    expect(after.status).toBe('ACTIVE');
    expect(after.updatedAt.getTime()).toBe(definition.updatedAt.getTime());
    expect((await get(`/requests/${id}`, teacher)).body.data.workflowDefinitionId).toBeNull();
  });

  // Submission and cancellation exist since Phase 38; deleting never does.
  it('mounts no endpoint that deletes a request', async () => {
    const teacher = await requester();
    const { id } = (await draft(teacher)).body.data;

    expect((await del(`/requests/${id}`, teacher)).status).toBe(404);
  });
});

/**
 * Migration 051's `down()` refuses while requests exist. Run against the cycle
 * database, by name.
 */
describe('rolling back migration 051', () => {
  const CYCLE = cycleDatabaseUrl();
  const NAME = '20260925010000-051-create-requests.js';

  beforeAll(async () => {
    await migrate(CYCLE);
  });

  it('refuses while a request exists', async () => {
    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address)
       VALUES ('Cycle R', 'CYCLER', 'Jl. C') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-requester', $1, 'Cycle', 'Requester', $2) RETURNING id`,
      [`$2b$10$${'0'.repeat(53)}`, institution.id],
      CYCLE
    );
    const [assignment] = await query(
      `INSERT INTO public.position_assignments (institution_id, user_id, position_code)
       VALUES ($1, $2, 'COMMON_TEACHER') RETURNING id`,
      [institution.id, user.id],
      CYCLE
    );
    await query(
      `INSERT INTO public.requests (institution_id, request_number, category, title,
         requester_user_id, requester_assignment_id, requester_position_code)
       VALUES ($1, 'REQ/2026/0001', 'COMMON', 'T', $2, $3, 'COMMON_TEACHER')`,
      [institution.id, user.id, assignment.id],
      CYCLE
    );

    try {
      await expect(runCli(['db:migrate:undo', '--name', NAME], CYCLE)).rejects.toThrow(
        /Migration 051 rollback refused/
      );
    } finally {
      await query('DELETE FROM public.requests', [], CYCLE);
      await query('DELETE FROM public.position_assignments', [], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }
  });

  it('rolls back and re-applies cleanly when empty', async () => {
    // Since Phase 38, `request_steps` references this table, and since Phase 39
    // `request_documents` does: 053 and 052 come off first.
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
    await runCli(['db:migrate:undo', '--name', NAME], CYCLE);

    const [gone] = await query(
      `SELECT to_regclass('public.requests') AS requests,
              to_regclass('public.request_items') AS items`,
      [],
      CYCLE
    );
    expect(gone).toEqual({ requests: null, items: null });

    await migrate(CYCLE);

    const [back] = await query(
      `SELECT to_regclass('public.requests')::text AS requests`,
      [],
      CYCLE
    );
    expect(back.requests).toBe('requests');
  });
});
