import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  resetAssetCoreData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { cycleDatabaseUrl, migrate, query, runCli, seed } from './helpers/db.js';

/**
 * Request item reference URL — REQ-REQUEST-019, migration 060
 * (`IMPLEMENTATION_PLAN.md` §66). The approved test matrix, A – V:
 *
 *   WRITE       both paths (POST /requests/:id/items, PATCH /request-items/:id)
 *               accept, normalize, clear and refuse alike (A–G, V)
 *   LIFECYCLE   editable in DRAFT and REVISION_REQUESTED only; a resubmission
 *               carries the revised value (H–K)
 *   READ        the detail returns it; the list is unchanged (L, M)
 *   BOUNDARY    the existing item authorization, unchanged (N)
 *   AUDIT       before / after / actor through the RequestItem audit (R)
 *   SCHEMA      the CHECK backstop, NULL for existing rows, guarded rollback (P, Q)
 */

const V1 = '/api/v1';
const MIGRATION = '20261003010000-060-add-request-item-reference-url.js';

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
const APPROVER = ['request:read', 'request-step:decide', 'request-item:update'];

const FLOW = [
  ['DECIDE', 'WAKASEK_SARPRAS'],
  ['DECIDE', 'KEPALA_SEKOLAH'],
  ['PROCURE', 'WAKASEK_SARPRAS'],
  ['REGISTER', 'WAKASEK_SARPRAS'],
];

const LINK = 'https://toko.example/produk/proyektor-epson?warna=hitam#spesifikasi';

let alpha;
let cast;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await resetOrganizationData();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  cast = {
    teacher: await person(REQUESTER, 'COMMON_TEACHER'),
    colleague: await person(REQUESTER, 'COMMON_TEACHER'),
    sarpras: await person(APPROVER, 'WAKASEK_SARPRAS'),
    kepala: await person(APPROVER, 'KEPALA_SEKOLAH'),
    // The teacher's position, but no item permission.
    readOnly: await person(['request:read', 'request:create'], 'COMMON_TEACHER'),
  };
  await workflow(FLOW);
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

async function person(permissions, positionCode) {
  const caller = await createCaller({ permissions, institutionId: alpha.id });
  const assignment = await models.PositionAssignment.create({
    institutionId: alpha.id,
    userId: caller.user.id,
    positionCode,
  });
  return { ...caller, assignment };
}

async function workflow(steps) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: alpha.id,
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
}

async function draft(caller = cast.teacher) {
  const response = await post(
    '/requests',
    { requesterAssignmentId: caller.assignment.id, category: 'COMMON', title: 'Proyektor' },
    caller
  );
  expect(response.status).toBe(201);
  return response.body.data;
}

const addItem = (requestId, body = {}, caller = cast.teacher) =>
  post(
    `/requests/${requestId}/items`,
    { description: 'Proyektor', quantityRequested: 1, ...body },
    caller
  );
const updateItem = (itemId, body, caller = cast.teacher) =>
  patch(`/request-items/${itemId}`, body, caller);
const detail = async (id, caller = cast.teacher) =>
  (await get(`/requests/${id}`, caller)).body.data;
const storedUrl = async (itemId) =>
  (await query('SELECT reference_url FROM public.request_items WHERE id = $1', [itemId]))[0]
    .reference_url;
const activeStep = (request) => request.steps.find((step) => step.state === 'ACTIVE');

/** A draft with one item, then submitted. */
async function submitted(itemBody = {}) {
  const request = await draft();
  const item = (await addItem(request.id, itemBody)).body.data;
  const response = await post(`/requests/${request.id}/submit`, {}, cast.teacher);
  expect(response.status).toBe(200);
  return { request: response.body.data, item };
}

/** Submitted, then returned for revision by Sarpras at step 1. */
async function returned(itemBody = {}) {
  const { request, item } = await submitted(itemBody);
  const response = await post(
    `/request-steps/${activeStep(request).id}/decide`,
    { decision: 'REQUEST_REVISION', comment: 'Sertakan tautan produk' },
    cast.sarpras
  );
  expect(response.status).toBe(200);
  expect(response.body.data.status).toBe('REVISION_REQUESTED');
  return { request: response.body.data, item };
}

// ---------------------------------------------------------------------------

describe('writing on both item paths (REQ-REQUEST-019, V)', () => {
  it('creates an item without a link: null, in the response and the row (A)', async () => {
    const request = await draft();
    const response = await addItem(request.id);

    expect(response.status).toBe(201);
    expect(response.body.data.referenceUrl).toBeNull();
    expect(await storedUrl(response.body.data.id)).toBeNull();
  });

  it('accepts HTTP and HTTPS on create, stored and returned normalized (B, C)', async () => {
    const request = await draft();
    const http = await addItem(request.id, { referenceUrl: 'http://192.168.1.10:8080/barang' });
    const https = await addItem(request.id, { referenceUrl: '  HTTPS://Toko.Example/Produk  ' });

    expect(http.status).toBe(201);
    expect(http.body.data.referenceUrl).toBe('http://192.168.1.10:8080/barang');
    expect(https.status).toBe(201);
    expect(https.body.data.referenceUrl).toBe('https://toko.example/Produk');
    expect(await storedUrl(https.body.data.id)).toBe('https://toko.example/Produk');
  });

  it('refuses malformed URLs and unsupported schemes on POST and on PATCH alike (D, E, V)', async () => {
    const request = await draft();
    const item = (await addItem(request.id)).body.data;
    const refused = [
      ['https://', 'must be a valid web address'],
      ['https://[::1', 'must be a valid web address'],
      ['javascript:alert(1)', 'must start with http:// or https://'],
      ['data:text/html,<b>x</b>', 'must start with http:// or https://'],
      ['file:///etc/passwd', 'must start with http:// or https://'],
      ['ftp://files.example/a', 'must start with http:// or https://'],
      ['mailto:sarpras@example.com', 'must start with http:// or https://'],
      ['//example.com/a', 'must start with http:// or https://'],
      ['https://exa mple.com', 'must not contain spaces or control characters'],
      ['https://user:secret@example.com', 'must not contain a user name or password'],
      ['http://./', 'must name a website'],
      [42, 'must be a web address'],
    ];

    for (const [value, message] of refused) {
      for (const response of [
        await addItem(request.id, { referenceUrl: value }),
        await updateItem(item.id, { referenceUrl: value }),
      ]) {
        expect(response.status, String(value)).toBe(400);
        expect(response.body.error.details).toEqual([
          expect.objectContaining({ field: 'body.referenceUrl', issue: message }),
        ]);
      }
    }
    expect(await models.RequestItem.count({ where: { requestId: request.id } })).toBe(1);
    expect(await storedUrl(item.id)).toBeNull();
  });

  it('updates the link while editable, leaving it alone when not sent (F)', async () => {
    const request = await draft();
    const item = (await addItem(request.id, { referenceUrl: 'https://a.example/1' })).body.data;

    const changed = await updateItem(item.id, { referenceUrl: LINK });
    expect(changed.status).toBe(200);
    expect(changed.body.data.referenceUrl).toBe(LINK);

    const untouched = await updateItem(item.id, { description: 'Proyektor kelas' });
    expect(untouched.status).toBe(200);
    expect(untouched.body.data.referenceUrl).toBe(LINK);
    expect(await storedUrl(item.id)).toBe(LINK);
  });

  it('clears it with null or with blank text (G)', async () => {
    const request = await draft();
    const a = (await addItem(request.id, { referenceUrl: LINK })).body.data;
    const b = (await addItem(request.id, { referenceUrl: LINK })).body.data;

    expect((await updateItem(a.id, { referenceUrl: null })).body.data.referenceUrl).toBeNull();
    expect((await updateItem(b.id, { referenceUrl: '   ' })).body.data.referenceUrl).toBeNull();
    expect(await storedUrl(a.id)).toBeNull();
    expect(await storedUrl(b.id)).toBeNull();
    // Blank on create is none, too.
    expect((await addItem(request.id, { referenceUrl: '' })).body.data.referenceUrl).toBeNull();
  });

  it('accepts exactly 2,048 normalized characters and refuses one more', async () => {
    const request = await draft();
    const base = 'https://example.com/';
    const longest = base + 'a'.repeat(2048 - base.length);

    expect((await addItem(request.id, { referenceUrl: longest })).body.data.referenceUrl).toBe(
      longest
    );
    const over = await addItem(request.id, { referenceUrl: `${longest}a` });
    expect(over.status).toBe(400);
    expect(over.body.error.details[0]).toMatchObject({ field: 'body.referenceUrl' });
  });
});

describe('the lifecycle (H – K)', () => {
  it('is fixed once submitted (H)', async () => {
    const { item } = await submitted({ referenceUrl: LINK });
    const response = await updateItem(item.id, { referenceUrl: 'https://other.example/' });

    expect(response.status).toBe(409);
    expect(await storedUrl(item.id)).toBe(LINK);
  });

  it('is fixed once approved, on create as on update', async () => {
    const { request, item } = await submitted({ referenceUrl: LINK });
    let current = request;
    for (const approver of [cast.sarpras, cast.kepala]) {
      const response = await post(
        `/request-steps/${activeStep(current).id}/decide`,
        { decision: 'APPROVE' },
        approver
      );
      expect(response.status).toBe(200);
      current = response.body.data;
    }
    expect(current.status).toBe('APPROVED');

    expect((await updateItem(item.id, { referenceUrl: null })).status).toBe(409);
    expect((await addItem(request.id, { referenceUrl: LINK })).status).toBe(409);
    expect(await storedUrl(item.id)).toBe(LINK);
  });

  it('is fixed once cancelled', async () => {
    const request = await draft();
    const item = (await addItem(request.id, { referenceUrl: LINK })).body.data;
    expect(
      (await post(`/requests/${request.id}/cancel`, { reason: 'Tidak jadi' }, cast.teacher)).status
    ).toBe(200);

    expect((await updateItem(item.id, { referenceUrl: null })).status).toBe(409);
  });

  it('is editable while returned for revision: change, remove or leave (I)', async () => {
    const { request, item } = await returned({ referenceUrl: LINK });
    const second = await addItem(request.id, { description: 'Layar', referenceUrl: LINK });
    expect(second.status).toBe(201);
    const third = await addItem(request.id, { description: 'Kabel', referenceUrl: LINK });

    const changed = await updateItem(item.id, {
      referenceUrl: 'https://toko.example/epson-eb-x500',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.data.referenceUrl).toBe('https://toko.example/epson-eb-x500');
    expect((await updateItem(second.body.data.id, { referenceUrl: null })).status).toBe(200);
    expect((await updateItem(third.body.data.id, { quantityRequested: 2 })).status).toBe(200);

    const items = (await detail(request.id)).items;
    expect(items.map((row) => row.referenceUrl)).toEqual([
      'https://toko.example/epson-eb-x500',
      null,
      LINK,
    ]);
  });

  it('carries the revised value through resubmission, and keeps cycle 1 as decided (J)', async () => {
    const { request, item } = await returned({ referenceUrl: LINK });
    await updateItem(item.id, { referenceUrl: 'https://toko.example/epson-eb-x500' });

    const response = await post(`/requests/${request.id}/submit`, {}, cast.teacher);
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('SUBMITTED');
    expect(response.body.data.cycle).toBe(2);
    expect(response.body.data.items[0].referenceUrl).toBe('https://toko.example/epson-eb-x500');

    const [returnedStep] = await query(
      `SELECT state, comment FROM public.request_steps
        WHERE request_id = $1 AND cycle = 1 AND sequence = 1`,
      [request.id]
    );
    expect(returnedStep).toEqual({ state: 'RETURNED', comment: 'Sertakan tautan produk' });
    // Fixed again in the new cycle.
    expect((await updateItem(item.id, { referenceUrl: null })).status).toBe(409);
  });
});

describe('reading (L, M)', () => {
  it('returns the link in the detail’s items, to the requester and the approver (L)', async () => {
    const { request } = await submitted({ referenceUrl: LINK });

    expect((await detail(request.id)).items[0].referenceUrl).toBe(LINK);
    expect((await detail(request.id, cast.sarpras)).items[0].referenceUrl).toBe(LINK);
  });

  it('leaves the request list without items, and so without links (M)', async () => {
    await submitted({ referenceUrl: LINK });
    const rows = (await get('/requests?mine=true', cast.teacher)).body.data;

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('items');
    expect(JSON.stringify(rows)).not.toContain('toko.example');
  });
});

describe('authorization — the existing item rules, nothing new (N)', () => {
  it('refuses a colleague (the draft is invisible) and a caller without the permission', async () => {
    const request = await draft();
    const item = (await addItem(request.id)).body.data;

    expect((await updateItem(item.id, { referenceUrl: LINK }, cast.colleague)).status).toBe(404);
    expect((await addItem(request.id, { referenceUrl: LINK }, cast.colleague)).status).toBe(404);
    expect((await updateItem(item.id, { referenceUrl: LINK }, cast.readOnly)).status).toBe(403);
    expect(await storedUrl(item.id)).toBeNull();
  });

  it('refuses an approver who can see the request but is not its requester', async () => {
    const { item } = await returned();
    const response = await updateItem(item.id, { referenceUrl: LINK }, cast.sarpras);

    expect(response.status).toBe(403);
    expect(await storedUrl(item.id)).toBeNull();
  });
});

describe('audit (R)', () => {
  it('records each change before and after, with the actor', async () => {
    const request = await draft();
    const item = (await addItem(request.id, { referenceUrl: LINK })).body.data;
    await updateItem(item.id, { referenceUrl: 'https://toko.example/lain' });
    await updateItem(item.id, { referenceUrl: null });

    const entries = await models.AuditLog.findAll({
      where: { entityType: 'RequestItem', entityId: item.id },
      order: [['timestamp', 'ASC']],
    });
    expect(entries.map((entry) => entry.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
    expect(entries[0].newValues).toMatchObject({ referenceUrl: LINK });
    expect(entries[1]).toMatchObject({
      actorId: cast.teacher.user.id,
      oldValues: { referenceUrl: LINK },
      newValues: { referenceUrl: 'https://toko.example/lain' },
    });
    expect(entries[2]).toMatchObject({
      oldValues: { referenceUrl: 'https://toko.example/lain' },
      newValues: { referenceUrl: null },
    });
    expect(entries.every((entry) => entry.timestamp instanceof Date)).toBe(true);
  });
});

describe('the schema (migration 060)', () => {
  const write = async (value) => {
    const request = await draft();
    const item = (await addItem(request.id)).body.data;
    return query('UPDATE public.request_items SET reference_url = $1 WHERE id = $2', [
      value,
      item.id,
    ]);
  };

  it('backs the application with a CHECK: HTTP(S), a host, no whitespace or credentials', async () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://a.example/',
      '//a.example/',
      'https://',
      'https://a.example/b c',
      'https://a.example/\tb',
      'https://user:pw@a.example/',
      'https://user@a.example/',
    ]) {
      await expect(write(value), value).rejects.toThrow(/chk_request_items_reference_url/);
    }
    await expect(write(`https://a.example/${'a'.repeat(2048)}`)).rejects.toThrow(/too long/);
    await expect(write('http://localhost:3000/x?y=1#z')).resolves.toBeDefined();
    await expect(write('https://a.example/@handle')).resolves.toBeDefined();
  });

  it('refuses to roll back while a link exists; existing rows come back NULL (P, Q)', async () => {
    const CYCLE = cycleDatabaseUrl();
    await migrate(CYCLE);

    // An item written before migration 060.
    await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);
    const [institution] = await query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('U', 'URL', 'x') RETURNING id`,
      [],
      CYCLE
    );
    const [user] = await query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name, institution_id)
       VALUES ('cycle-reference-url', $1, 'Cycle', 'Url', $2) RETURNING id`,
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
    const [item] = await query(
      `INSERT INTO public.request_items (request_id, line_no, description, quantity_requested)
       VALUES ($1, 1, 'Proyektor', 1) RETURNING id`,
      [request.id],
      CYCLE
    );

    try {
      await migrate(CYCLE);
      const [existing] = await query(
        'SELECT reference_url FROM public.request_items WHERE id = $1',
        [item.id],
        CYCLE
      );
      expect(existing.reference_url).toBeNull();

      await query(
        'UPDATE public.request_items SET reference_url = $1 WHERE id = $2',
        [LINK, item.id],
        CYCLE
      );
      await expect(runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE)).rejects.toThrow(
        /Migration 060 rollback refused/
      );

      // Cleared deliberately, it rolls back.
      await query('UPDATE public.request_items SET reference_url = NULL', [], CYCLE);
      await runCli(['db:migrate:undo', '--name', MIGRATION], CYCLE);
      const [gone] = await query(
        `SELECT count(*)::int AS columns FROM information_schema.columns
          WHERE table_name = 'request_items' AND column_name = 'reference_url'`,
        [],
        CYCLE
      );
      expect(gone.columns).toBe(0);
    } finally {
      await migrate(CYCLE);
      await query('DELETE FROM public.request_items WHERE id = $1', [item.id], CYCLE);
      await query('DELETE FROM public.requests WHERE id = $1', [request.id], CYCLE);
      await query('DELETE FROM public.position_assignments WHERE id = $1', [assignment.id], CYCLE);
      await query('DELETE FROM public.users WHERE id = $1', [user.id], CYCLE);
      await query('DELETE FROM public.institutions WHERE id = $1', [institution.id], CYCLE);
    }

    const [back] = await query(
      `SELECT count(*)::int AS columns FROM information_schema.columns
        WHERE table_name = 'request_items' AND column_name = 'reference_url'`,
      [],
      CYCLE
    );
    expect(back.columns).toBe(1);
  });
});
