import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Reference and classification API — `IMPLEMENTATION_PLAN.md` §10.6–§10.8;
 * `06-api.md` §4.
 *
 * Runs against the real seeded classification hierarchy (14,738 rows), because
 * the drill-down and leaf rules only mean something against real depth.
 */

const V1 = '/api/v1';
const ROOT = '100000000000';

let admin;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetOrganizationData();
  admin = await createAdminCaller();
});

afterAll(async () => {
  await resetOrganizationData();
});

describe('classifications (§4.1, REQ-CLASS-003/006/007/009/010)', () => {
  it('returns root-level nodes when no parent is given, for the picker start', async () => {
    const response = await api()
      .get(`${V1}/classifications`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    // The seeded tree has one true root plus the three source rows whose parent
    // is absent from the data (preserved as roots in Phase 1).
    expect(response.body.data.length).toBeLessThan(10);
    expect(response.body.data.map((row) => row.id)).toContain(ROOT);
  });

  it('trims the blank-padded CHAR(12) keys at the API boundary', async () => {
    const response = await api()
      .get(`${V1}/classifications/${ROOT}`)
      .set(...admin.auth);

    expect(response.body.data.id).toBe(ROOT);
    expect(response.body.data.id).toHaveLength(12);
    expect(response.body.data.name).toBe('ASET');
  });

  it('reports whether a node is a leaf (REQ-CLASS-009)', async () => {
    const root = await api()
      .get(`${V1}/classifications/${ROOT}`)
      .set(...admin.auth);
    expect(root.body.data.isLeaf).toBe(false);

    const leaf = await api()
      .get(`${V1}/classifications/117010101001`)
      .set(...admin.auth);
    expect(leaf.body.data.isLeaf).toBe(true);
  });

  it('drills down through children, each flagged leaf or not (REQ-CLASS-007/010)', async () => {
    const response = await api()
      .get(`${V1}/classifications/${ROOT}/children`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.every((row) => row.parentId === ROOT)).toBe(true);
    expect(response.body.data[0]).toHaveProperty('isLeaf');

    // The collection envelope, complete rather than paged (§1.5) — the same
    // shape `/locations/:id/children` answers in, so one client helper reads
    // both. Both used to answer in the single-resource envelope instead.
    expect(response.body.meta).toEqual({
      page: 1,
      pageSize: response.body.data.length,
      total: response.body.data.length,
      totalPages: 1,
    });
  });

  it('resolves the full ancestor path, so a leaf name is never shown alone', async () => {
    const response = await api()
      .get(`${V1}/classifications/117010101001/path`)
      .set(...admin.auth);

    expect(response.body.data[0].id).toBe(ROOT);
    expect(response.body.data.at(-1)).toMatchObject({ id: '117010101001', name: 'Aspal' });
    expect(response.body.data.length).toBeGreaterThan(3);
  });

  it('searches leaves only, with their path (§4.1 type-ahead)', async () => {
    const response = await api()
      .get(`${V1}/classifications/leaf?q=aspal`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.every((row) => row.isLeaf)).toBe(true);
    expect(response.body.data[0].path.length).toBeGreaterThan(1);
  });

  it('never returns a non-leaf from the leaf search', async () => {
    const response = await api()
      .get(`${V1}/classifications/leaf?q=ASET`)
      .set(...admin.auth);

    expect(response.body.data.map((row) => row.id)).not.toContain(ROOT);
  });

  it('escapes wildcards so a search term cannot widen its own match', async () => {
    const response = await api()
      .get(`${V1}/classifications/leaf?q=%25`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('filters the list by search term', async () => {
    const response = await api()
      .get(`${V1}/classifications?q=Semen`)
      .set(...admin.auth);

    expect(response.body.data.some((row) => row.name === 'Semen')).toBe(true);
  });

  it.each([
    ['patch', 'renamed'],
    ['delete', 'deleted'],
  ])(
    'refuses to let a government classification be %s (REQ-CLASS-003, BR-016)',
    async (method) => {
      const response = await api()
        [method](`${V1}/classifications/${ROOT}`)
        .set(...admin.auth)
        .send({ name: 'Injected' });

      // 400, not 404: the route exists now, and the row is what refuses.
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  );

  it('refuses to create beneath a root node — additions attach at the deepest level', async () => {
    const response = await api()
      .post(`${V1}/classifications`)
      .set(...admin.auth)
      .send({ parentId: ROOT, name: 'Injected' });

    expect(response.status).toBe(400);
  });

  it('rejects an id that is not 12 characters', async () => {
    const response = await api()
      .get(`${V1}/classifications/123`)
      .set(...admin.auth);

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown classification', async () => {
    const response = await api()
      .get(`${V1}/classifications/999999999999`)
      .set(...admin.auth);

    expect(response.status).toBe(404);
  });
});

describe('attribute definitions (§4.3, REQ-ATTR-001–005)', () => {
  const LEAF = '117010101001';

  const definitionBody = {
    classificationId: LEAF,
    name: 'Serial Number',
    attributeType: 'TEXT',
    scope: 'ASSET_UNIT',
  };

  it('creates with its documented defaults', async () => {
    const response = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({ classificationId: LEAF, name: 'Colour' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      attributeType: 'TEXT',
      scope: 'ASSET',
      isRequired: false,
      usesMeasurementUnit: false,
      sortOrder: 0,
      isActive: true,
    });
  });

  it('records the scope that decides where values may live (REQ-ATTR-001)', async () => {
    const response = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send(definitionBody);

    expect(response.body.data.scope).toBe('ASSET_UNIT');
  });

  it.each([
    ['attributeType', 'COLOUR'],
    ['scope', 'EVERYTHING'],
  ])('rejects an invalid %s', async (field, value) => {
    const response = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({ ...definitionBody, [field]: value });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe(`body.${field}`);
  });

  it('rejects a classification that does not exist (REQ-VAL-003)', async () => {
    const response = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({ ...definitionBody, classificationId: '999999999999' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('classificationId');
  });

  it('rejects a measurement unit that does not exist', async () => {
    const response = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({
        ...definitionBody,
        attributeType: 'NUMBER',
        usesMeasurementUnit: true,
        measurementUnitId: '00000000-0000-0000-0000-000000000000',
      });

    expect(response.status).toBe(400);
  });

  it('refuses a measurement unit on a non-numeric attribute (REQ-ATTR-004)', async () => {
    const unit = await models.MeasurementUnit.create({ name: 'kg' });

    const response = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({
        ...definitionBody,
        attributeType: 'TEXT',
        usesMeasurementUnit: true,
        measurementUnitId: unit.id,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('usesMeasurementUnit');
  });

  it('accepts a measurement unit on a numeric attribute', async () => {
    const unit = await models.MeasurementUnit.create({ name: 'kg' });

    const response = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({
        ...definitionBody,
        name: 'Weight',
        attributeType: 'NUMBER',
        usesMeasurementUnit: true,
        measurementUnitId: unit.id,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.measurementUnitId).toBe(unit.id);
  });

  it('rejects a duplicate name within the same classification and scope', async () => {
    await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send(definitionBody);

    const response = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send(definitionBody);

    expect(response.status).toBe(409);
  });

  it('allows the same name at the other scope', async () => {
    await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send(definitionBody);

    const response = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({ ...definitionBody, scope: 'ASSET' });

    expect(response.status).toBe(201);
  });

  it('refuses to move a definition between classifications or scopes', async () => {
    const created = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send(definitionBody);

    for (const body of [{ classificationId: ROOT }, { scope: 'ASSET' }]) {
      const response = await api()
        .patch(`${V1}/attribute-definitions/${created.body.data.id}`)
        .set(...admin.auth)
        .send(body);

      expect(response.status).toBe(400);
    }
  });

  it('deactivates rather than deleting, preserving stored values (BR-005)', async () => {
    const created = await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send(definitionBody);

    const off = await api()
      .post(`${V1}/attribute-definitions/${created.body.data.id}/deactivate`)
      .set(...admin.auth);
    expect(off.body.data.isActive).toBe(false);

    const removal = await api()
      .delete(`${V1}/attribute-definitions/${created.body.data.id}`)
      .set(...admin.auth);
    expect(removal.status).toBe(404);
  });

  it('is reachable from its classification (REQ-ATTR-002)', async () => {
    await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send(definitionBody);

    const response = await api()
      .get(`${V1}/classifications/${LEAF}/attribute-definitions`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data.map((d) => d.name)).toEqual(['Serial Number']);
  });

  it('filters by classification and scope', async () => {
    await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send(definitionBody);
    await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({ ...definitionBody, name: 'Model', scope: 'ASSET' });

    const response = await api()
      .get(`${V1}/attribute-definitions?scope=ASSET_UNIT`)
      .set(...admin.auth);

    expect(response.body.data.map((d) => d.name)).toEqual(['Serial Number']);
  });
});

describe('reference lookups (§4.4, §4.5, REQ-REF-005/007/008/009)', () => {
  it.each([
    ['measurement-units', { name: 'kilogram' }],
    ['contract-types', { name: 'Purchase Order' }],
    // `code` is required on create since `CR-007`: it may be carried into an
    // inventory code, and the server never derives it from the name.
    ['funding-sources', { name: 'Capital Budget', code: 'CAPBUD' }],
    ['transaction-types', { name: 'Receipt' }],
  ])('%s supports plain CRUD', async (resource, body) => {
    const created = await api()
      .post(`${V1}/${resource}`)
      .set(...admin.auth)
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe(body.name);

    const id = created.body.data.id;

    const listed = await api()
      .get(`${V1}/${resource}`)
      .set(...admin.auth);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.meta.total).toBe(1);

    const updated = await api()
      .patch(`${V1}/${resource}/${id}`)
      .set(...admin.auth)
      .send({ name: 'Renamed' });
    expect(updated.body.data.name).toBe('Renamed');

    const removed = await api()
      .delete(`${V1}/${resource}/${id}`)
      .set(...admin.auth);
    expect(removed.status).toBe(204);

    const gone = await api()
      .get(`${V1}/${resource}/${id}`)
      .set(...admin.auth);
    expect(gone.status).toBe(404);
  });

  it('rejects a duplicate lookup name', async () => {
    await api()
      .post(`${V1}/measurement-units`)
      .set(...admin.auth)
      .send({ name: 'metre' });

    const response = await api()
      .post(`${V1}/measurement-units`)
      .set(...admin.auth)
      .send({ name: 'metre' });

    expect(response.status).toBe(409);
  });

  it('blocks deleting a lookup that is still referenced (§4.4)', async () => {
    const unit = await models.MeasurementUnit.create({ name: 'kg' });
    await api()
      .post(`${V1}/attribute-definitions`)
      .set(...admin.auth)
      .send({
        classificationId: '117010101001',
        name: 'Weight',
        attributeType: 'NUMBER',
        usesMeasurementUnit: true,
        measurementUnitId: unit.id,
      });

    const response = await api()
      .delete(`${V1}/measurement-units/${unit.id}`)
      .set(...admin.auth);

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/attribute definitions/);
  });

  it('account codes use their 12-character natural key (§4.5)', async () => {
    const created = await api()
      .post(`${V1}/account-codes`)
      .set(...admin.auth)
      .send({ code: '112233445566', name: 'Office Equipment' });

    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('112233445566');

    const detail = await api()
      .get(`${V1}/account-codes/112233445566`)
      .set(...admin.auth);
    expect(detail.body.data.name).toBe('Office Equipment');
  });

  it('rejects an account code of the wrong length', async () => {
    const response = await api()
      .post(`${V1}/account-codes`)
      .set(...admin.auth)
      .send({ code: '123', name: 'Too short' });

    expect(response.status).toBe(400);
  });

  it('serves categories read-only (§4.2)', async () => {
    const listed = await api()
      .get(`${V1}/categories`)
      .set(...admin.auth);
    expect(listed.status).toBe(200);

    const write = await api()
      .post(`${V1}/categories`)
      .set(...admin.auth)
      .send({ name: 'Injected' });
    expect(write.status).toBe(404);
  });

  it('serves the fixed condition list (§4.6, REQ-REF-006)', async () => {
    const response = await api()
      .get(`${V1}/reference/conditions`)
      .set(...admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.data.map((row) => row.value)).toEqual([
      'GOOD',
      'FAIR',
      'POOR',
      'DAMAGED',
      'UNSERVICEABLE',
    ]);
  });

  it('enforces per-resource permissions', async () => {
    const reader = await createCaller({ permissions: ['measurement-unit:read'] });

    expect(
      (
        await api()
          .get(`${V1}/measurement-units`)
          .set(...reader.auth)
      ).status
    ).toBe(200);

    expect(
      (
        await api()
          .post(`${V1}/measurement-units`)
          .set(...reader.auth)
          .send({ name: 'nope' })
      ).status
    ).toBe(403);

    // A permission on one lookup grants nothing on another.
    expect(
      (
        await api()
          .get(`${V1}/contract-types`)
          .set(...reader.auth)
      ).status
    ).toBe(403);
  });
});
