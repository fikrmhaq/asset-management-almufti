import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetAssetCoreData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Attribute values, attachments and floor plans — `IMPLEMENTATION_PLAN.md`
 * §11.2, §11.7, §11.8; `06-api.md` §5.1–§5.4.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';
const LEAF_2 = '117010101002';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let admin;
let asset;
let unit;
let location;

const post = (path, body, caller = admin) =>
  api()
    .post(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

const get = (path, caller = admin) =>
  api()
    .get(`${V1}${path}`)
    .set(...caller.auth);

const put = (path, body, caller = admin) =>
  api()
    .put(`${V1}${path}`)
    .set(...caller.auth)
    .send(body);

async function defineAttribute(overrides = {}) {
  const response = await post('/attribute-definitions', {
    classificationId: LEAF,
    name: `Attr ${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  });
  return response.body.data;
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await models.AttributeDefinition.destroy({ where: {} });
  await resetOrganizationData();

  admin = await createAdminCaller();
  location = (await post('/locations', { name: 'Room 1', classificationId: LEAF_2 })).body.data;
  asset = (await post('/assets', { name: 'Test Asset', classificationId: LEAF })).body.data;
  unit = (await post(`/assets/${asset.id}/units`, {})).body.data;
});

afterAll(async () => {
  await resetAssetCoreData();
  await models.AttributeDefinition.destroy({ where: {} });
  await resetOrganizationData();
});

describe('attribute values (§11.7, REQ-ATTR-006/007/008)', () => {
  it('returns every applicable definition, valued or not', async () => {
    await defineAttribute({ name: 'Colour', scope: 'ASSET' });

    const response = await get(`/assets/${asset.id}/attribute-values`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ name: 'Colour', value: null });
  });

  it('stores a value in the column its type names (REQ-ATTR-008)', async () => {
    const definition = await defineAttribute({ name: 'Weight', attributeType: 'NUMBER' });

    await put(`/assets/${asset.id}/attribute-values`, { values: { [definition.id]: '12.5' } });

    const stored = await models.AssetAttributeValue.findOne({
      where: { assetId: asset.id, attributeDefinitionId: definition.id },
    });
    expect(stored.valueNumeric).toBe('12.5000');
    expect(stored.valueText).toBeNull();
  });

  it.each([
    ['NUMBER', 'not-a-number'],
    ['BOOLEAN', 'maybe'],
    ['DATE', '31-12-2026'],
  ])('rejects a bad %s value', async (attributeType, value) => {
    const definition = await defineAttribute({ attributeType });

    const response = await put(`/assets/${asset.id}/attribute-values`, {
      values: { [definition.id]: value },
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toContain(definition.id);
  });

  it('coerces valid values of each type', async () => {
    const number = await defineAttribute({ attributeType: 'NUMBER' });
    const boolean = await defineAttribute({ attributeType: 'BOOLEAN' });
    const date = await defineAttribute({ attributeType: 'DATE' });

    const response = await put(`/assets/${asset.id}/attribute-values`, {
      values: { [number.id]: 3, [boolean.id]: true, [date.id]: '2026-08-12' },
    });

    expect(response.status).toBe(200);
    const byId = Object.fromEntries(
      response.body.data.map((row) => [row.attributeDefinitionId, row.value])
    );
    expect(byId[number.id]).toBe('3.0000');
    expect(byId[boolean.id]).toBe(true);
    expect(byId[date.id]).toBe('2026-08-12');
  });

  it('rejects a definition from the wrong scope (BR-009)', async () => {
    const unitScoped = await defineAttribute({ scope: 'ASSET_UNIT' });

    const response = await put(`/assets/${asset.id}/attribute-values`, {
      values: { [unitScoped.id]: 'x' },
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/BR-009/);
  });

  it('rejects a definition from another classification (BR-010)', async () => {
    const other = await defineAttribute({ classificationId: LEAF_2, scope: 'ASSET' });

    const response = await put(`/assets/${asset.id}/attribute-values`, {
      values: { [other.id]: 'x' },
    });

    expect(response.status).toBe(400);
  });

  it('applies unit-scoped definitions to the unit, via its parent asset (REQ-ATTR-007)', async () => {
    const definition = await defineAttribute({ name: 'Serial', scope: 'ASSET_UNIT' });

    const response = await put(`/asset-units/${unit.id}/attribute-values`, {
      values: { [definition.id]: 'SN-001' },
    });

    expect(response.status).toBe(200);
    expect(response.body.data[0].value).toBe('SN-001');
  });

  it('enforces a required attribute (REQ-ATTR-005)', async () => {
    const definition = await defineAttribute({ isRequired: true });

    const response = await put(`/assets/${asset.id}/attribute-values`, { values: {} });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/required/);
    expect(response.body.error.details[0].field).toContain(definition.id);
  });

  it('replaces rather than merges, so a cleared value is really cleared', async () => {
    const first = await defineAttribute({ name: 'A' });
    const second = await defineAttribute({ name: 'B' });

    await put(`/assets/${asset.id}/attribute-values`, {
      values: { [first.id]: 'one', [second.id]: 'two' },
    });
    const response = await put(`/assets/${asset.id}/attribute-values`, {
      values: { [first.id]: 'one' },
    });

    const byId = Object.fromEntries(
      response.body.data.map((row) => [row.attributeDefinitionId, row.value])
    );
    expect(byId[first.id]).toBe('one');
    expect(byId[second.id]).toBeNull();
  });

  it('reports every invalid value at once', async () => {
    const a = await defineAttribute({ attributeType: 'NUMBER' });
    const b = await defineAttribute({ attributeType: 'BOOLEAN' });

    const response = await put(`/assets/${asset.id}/attribute-values`, {
      values: { [a.id]: 'x', [b.id]: 'y' },
    });

    expect(response.body.error.details).toHaveLength(2);
  });

  it('hides a deactivated definition without destroying its value (BR-005)', async () => {
    const definition = await defineAttribute();
    await put(`/assets/${asset.id}/attribute-values`, { values: { [definition.id]: 'recorded' } });

    await post(`/attribute-definitions/${definition.id}/deactivate`, {});
    expect((await get(`/assets/${asset.id}/attribute-values`)).body.data).toEqual([]);

    // The row survives, so deactivation is not a silent delete.
    expect(
      await models.AssetAttributeValue.count({
        where: { assetId: asset.id, attributeDefinitionId: definition.id },
      })
    ).toBe(1);

    await post(`/attribute-definitions/${definition.id}/reactivate`, {});
    const restored = await get(`/assets/${asset.id}/attribute-values`);
    expect(restored.body.data[0].value).toBe('recorded');
  });

  it('leaves a deactivated definition’s value alone when the rest are replaced', async () => {
    const kept = await defineAttribute({ name: 'Kept' });
    const other = await defineAttribute({ name: 'Other' });
    await put(`/assets/${asset.id}/attribute-values`, {
      values: { [kept.id]: 'preserved', [other.id]: 'editable' },
    });
    await post(`/attribute-definitions/${kept.id}/deactivate`, {});

    await put(`/assets/${asset.id}/attribute-values`, { values: { [other.id]: 'changed' } });

    expect(
      await models.AssetAttributeValue.count({
        where: { assetId: asset.id, attributeDefinitionId: kept.id },
      })
    ).toBe(1);
  });
});

describe('attachments (§11.8, REQ-FILE-001–005)', () => {
  const upload = (assetId, { name = 'doc.pdf', type = 'application/pdf', body = PNG } = {}) =>
    api()
      .post(`${V1}/assets/${assetId}/attachments`)
      .set(...admin.auth)
      .attach('file', body, { filename: name, contentType: type });

  it('uploads and returns metadata (REQ-FILE-003)', async () => {
    const response = await upload(asset.id);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      assetId: asset.id,
      fileName: 'doc.pdf',
      fileType: 'application/pdf',
      uploadedBy: admin.user.id,
    });
    expect(response.body.data.fileSize).toBeGreaterThan(0);
  });

  it('never exposes the storage path', async () => {
    const response = await upload(asset.id);

    expect(JSON.stringify(response.body)).not.toMatch(/storageReference|storage[\\/]/);
  });

  it('rejects a disallowed file type (REQ-FILE-004)', async () => {
    const response = await upload(asset.id, { name: 'evil.exe', type: 'application/x-msdownload' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('file');
  });

  it('rejects an upload with no file', async () => {
    const response = await api()
      .post(`${V1}/assets/${asset.id}/attachments`)
      .set(...admin.auth);

    expect(response.status).toBe(400);
  });

  it('lists attachments for an asset (REQ-FILE-002)', async () => {
    await upload(asset.id);
    await upload(asset.id, { name: 'second.png', type: 'image/png' });

    const response = await get(`/assets/${asset.id}/attachments`);

    expect(response.body.data).toHaveLength(2);
  });

  it('downloads the bytes only when asked', async () => {
    const created = await upload(asset.id, { name: 'plan.png', type: 'image/png' });

    const metadata = await get(`/attachments/${created.body.data.id}`);
    expect(metadata.headers['content-type']).toMatch(/application\/json/);

    const file = await get(`/attachments/${created.body.data.id}?download=true`);
    expect(file.headers['content-type']).toMatch(/image\/png/);
    expect(file.headers['content-disposition']).toMatch(/^attachment;/);
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it('deletes the row and the stored file', async () => {
    const created = await upload(asset.id);

    const removed = await api()
      .delete(`${V1}/attachments/${created.body.data.id}`)
      .set(...admin.auth);
    expect(removed.status).toBe(204);

    expect((await get(`/attachments/${created.body.data.id}`)).status).toBe(404);
  });

  it('rejects a unit that belongs to another asset', async () => {
    const otherAsset = (await post('/assets', { name: 'Other', classificationId: LEAF })).body.data;
    const otherUnit = (await post(`/assets/${otherAsset.id}/units`, {})).body.data;

    const response = await api()
      .post(`${V1}/assets/${asset.id}/attachments`)
      .set(...admin.auth)
      .field('assetUnitId', otherUnit.id)
      .attach('file', PNG, { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(400);
  });

  it('follows the asset’s organization scope (REQ-FILE-005)', async () => {
    const other = await models.Institution.create({
      name: 'Other',
      code: `ATT-${Math.random().toString(36).slice(2, 7)}`,
      address: 'Elsewhere',
    });
    const theirAsset = (
      await post('/assets', { name: 'Theirs', classificationId: LEAF, institutionId: other.id })
    ).body.data;
    const created = await upload(theirAsset.id);
    const scoped = await createCaller({
      permissions: ['attachment:read'],
      institutionId: null,
    });

    expect((await get(`/attachments/${created.body.data.id}`, scoped)).status).toBe(404);
  });
});

describe('floor plans (§11.2, REQ-LOC-009–013)', () => {
  const uploadPlan = (locationId, { name = 'plan.png', type = 'image/png' } = {}) =>
    api()
      .put(`${V1}/locations/${locationId}/floor-plan`)
      .set(...admin.auth)
      .attach('file', PNG, { filename: name, contentType: type });

  async function childLocation() {
    const response = await post('/locations', {
      name: 'Child Room',
      classificationId: LEAF_2,
      parentLocationId: location.id,
    });
    return response.body.data;
  }

  it('uploads a plan (REQ-LOC-009)', async () => {
    const response = await uploadPlan(location.id);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ locationId: location.id, fileType: 'image/png' });
    expect(response.body.data.areas).toEqual([]);
  });

  it('rejects a non-image plan', async () => {
    const response = await uploadPlan(location.id, { name: 'plan.pdf', type: 'application/pdf' });

    expect(response.status).toBe(400);
  });

  it('serves the image bytes', async () => {
    await uploadPlan(location.id);

    const response = await get(`/locations/${location.id}/floor-plan/image`);

    expect(response.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.compare(response.body, PNG)).toBe(0);
  });

  it('reports 404 when the location has no plan', async () => {
    expect((await get(`/locations/${location.id}/floor-plan`)).status).toBe(404);
  });

  it('draws an area against a descendant location (REQ-LOC-010)', async () => {
    await uploadPlan(location.id);
    const child = await childLocation();

    const response = await post(`/locations/${location.id}/floor-plan/areas`, {
      locationId: child.id,
      polygon: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.polygon).toHaveLength(3);
  });

  it('refuses an area for a location outside the plan’s subtree (BR-014, REQ-LOC-012)', async () => {
    await uploadPlan(location.id);
    const unrelated = (await post('/locations', { name: 'Elsewhere', classificationId: LEAF_2 }))
      .body.data;

    const response = await post(`/locations/${location.id}/floor-plan/areas`, {
      locationId: unrelated.id,
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    });

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toMatch(/BR-014/);
  });

  it.each([
    [
      'too few points',
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    ],
    [
      'a coordinate above 1',
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1.5, y: 1 },
      ],
    ],
    [
      'a negative coordinate',
      [
        { x: -0.1, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    ],
  ])('rejects a polygon with %s', async (label, polygon) => {
    await uploadPlan(location.id);
    const child = await childLocation();

    const response = await post(`/locations/${location.id}/floor-plan/areas`, {
      locationId: child.id,
      polygon,
    });

    expect(response.status).toBe(400);
  });

  it('redraws an area', async () => {
    await uploadPlan(location.id);
    const child = await childLocation();
    const area = (
      await post(`/locations/${location.id}/floor-plan/areas`, {
        locationId: child.id,
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      })
    ).body.data;

    const response = await api()
      .patch(`${V1}/locations/${location.id}/floor-plan/areas/${area.id}`)
      .set(...admin.auth)
      .send({
        polygon: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.polygon).toHaveLength(4);
  });

  it('removes an area without touching the location it represented', async () => {
    await uploadPlan(location.id);
    const child = await childLocation();
    const area = (
      await post(`/locations/${location.id}/floor-plan/areas`, {
        locationId: child.id,
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      })
    ).body.data;

    const removed = await api()
      .delete(`${V1}/locations/${location.id}/floor-plan/areas/${area.id}`)
      .set(...admin.auth);

    expect(removed.status).toBe(204);
    expect((await get(`/locations/${child.id}`)).status).toBe(200);
  });

  it('replacing the plan clears its areas but leaves the locations (REQ-LOC-013)', async () => {
    await uploadPlan(location.id);
    const child = await childLocation();
    await post(`/locations/${location.id}/floor-plan/areas`, {
      locationId: child.id,
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    });

    await uploadPlan(location.id, { name: 'replacement.png' });

    expect((await get(`/locations/${location.id}/floor-plan/areas`)).body.data).toEqual([]);
    expect((await get(`/locations/${child.id}`)).status).toBe(200);
  });

  it('deleting the plan removes its areas and leaves the locations (REQ-LOC-013)', async () => {
    await uploadPlan(location.id);
    const child = await childLocation();
    await post(`/locations/${location.id}/floor-plan/areas`, {
      locationId: child.id,
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    });

    const removed = await api()
      .delete(`${V1}/locations/${location.id}/floor-plan`)
      .set(...admin.auth);

    expect(removed.status).toBe(204);
    expect(await models.FloorPlanArea.count()).toBe(0);
    expect((await get(`/locations/${child.id}`)).status).toBe(200);
  });
});

describe('location hierarchy (§11.1, BR-012, REQ-LOC-007)', () => {
  it('lists direct children', async () => {
    const child = (
      await post('/locations', {
        name: 'Child',
        classificationId: LEAF_2,
        parentLocationId: location.id,
      })
    ).body.data;

    const response = await get(`/locations/${location.id}/children`);

    expect(response.body.data.map((row) => row.id)).toEqual([child.id]);
  });

  it('refuses to make a location its own parent (BR-012)', async () => {
    const response = await api()
      .patch(`${V1}/locations/${location.id}`)
      .set(...admin.auth)
      .send({ parentLocationId: location.id });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/BR-012/);
  });

  it('refuses a longer cycle the CHECK constraint cannot see (BR-012)', async () => {
    const child = (
      await post('/locations', {
        name: 'Child',
        classificationId: LEAF_2,
        parentLocationId: location.id,
      })
    ).body.data;
    const grandchild = (
      await post('/locations', {
        name: 'Grandchild',
        classificationId: LEAF_2,
        parentLocationId: child.id,
      })
    ).body.data;

    // Moving the root beneath its own grandchild would close the loop.
    const response = await api()
      .patch(`${V1}/locations/${location.id}`)
      .set(...admin.auth)
      .send({ parentLocationId: grandchild.id });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/cycle/);
  });

  it('lists units at a location, including its descendants (REQ-REPORT-005)', async () => {
    const child = (
      await post('/locations', {
        name: 'Child',
        classificationId: LEAF_2,
        parentLocationId: location.id,
      })
    ).body.data;
    await post(`/asset-units/${unit.id}/history`, {
      description: 'Placed in the child room',
      condition: 'GOOD',
      locationId: child.id,
    });

    const response = await get(`/locations/${location.id}/units`);

    expect(response.body.data.map((row) => row.id)).toEqual([unit.id]);
  });

  it('reports where each unit actually is, not the location it was found under', async () => {
    const child = (
      await post('/locations', {
        name: 'Child',
        classificationId: LEAF_2,
        parentLocationId: location.id,
      })
    ).body.data;
    await post(`/asset-units/${unit.id}/history`, {
      description: 'Placed in the child room',
      condition: 'GOOD',
      locationId: child.id,
    });

    const [row] = (await get(`/locations/${location.id}/units`)).body.data;

    // Viewing from the parent must not make the unit look like it lives there.
    expect(row.currentLocation).toMatchObject({ id: child.id, name: 'Child' });
    expect(row.asset).toMatchObject({ id: asset.id, name: 'Test Asset' });
    expect(row.currentLocationId).toBe(child.id);
  });

  it('narrows to direct contents with scope=direct, and defaults to everything', async () => {
    const child = (
      await post('/locations', {
        name: 'Child',
        classificationId: LEAF_2,
        parentLocationId: location.id,
      })
    ).body.data;
    const here = (await post(`/assets/${asset.id}/units`, {})).body.data;

    await post(`/asset-units/${unit.id}/history`, {
      description: 'In the child room',
      condition: 'GOOD',
      locationId: child.id,
    });
    await post(`/asset-units/${here.id}/history`, {
      description: 'In this room',
      condition: 'GOOD',
      locationId: location.id,
    });

    const all = await get(`/locations/${location.id}/units`);
    const direct = await get(`/locations/${location.id}/units?scope=direct`);

    expect(all.body.data.map((row) => row.id).sort()).toEqual([unit.id, here.id].sort());
    expect(direct.body.data.map((row) => row.id)).toEqual([here.id]);

    // The child's own view never reaches back up to its parent's contents.
    const fromChild = await get(`/locations/${child.id}/units`);
    expect(fromChild.body.data.map((row) => row.id)).toEqual([unit.id]);
  });
});

/**
 * Location context — REQ-LOC-007/011.
 *
 * The hierarchy is arbitrary, so these build a five-level chain and assert
 * against the DATA, never against a level number.
 */
describe('location context and floor-plan resolution', () => {
  const uploadPlan = (locationId) =>
    api()
      .put(`${V1}/locations/${locationId}/floor-plan`)
      .set(...admin.auth)
      .attach('file', PNG, { filename: 'plan.png', contentType: 'image/png' });

  /** `Site → Building → Floor → Wing → Room`, returned nearest-last. */
  async function buildChain() {
    const names = ['Site', 'Building', 'Floor', 'Wing', 'Room'];
    const nodes = [];
    let parentLocationId = null;

    for (const name of names) {
      const created = await post('/locations', {
        name,
        classificationId: LEAF_2,
        parentLocationId,
      });
      nodes.push(created.body.data);
      parentLocationId = created.body.data.id;
    }

    return nodes;
  }

  const drawArea = (planLocationId, areaLocationId) =>
    post(`/locations/${planLocationId}/floor-plan/areas`, {
      locationId: areaLocationId,
      polygon: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
    });

  it('returns the whole path root-first, however deep it runs', async () => {
    const [site, building, floor, wing, room] = await buildChain();

    const response = await get(`/locations/${room.id}/context`);

    expect(response.status).toBe(200);
    expect(response.body.data.path.map((node) => node.name)).toEqual([
      'Site',
      'Building',
      'Floor',
      'Wing',
      'Room',
    ]);
    expect(response.body.data.path.map((node) => node.id)).toEqual([
      site.id,
      building.id,
      floor.id,
      wing.id,
      room.id,
    ]);
  });

  it('finds no floor plan when nothing in the chain has one', async () => {
    const nodes = await buildChain();

    const response = await get(`/locations/${nodes.at(-1).id}/context`);

    expect(response.body.data.floorPlan).toBeNull();
    expect(response.body.data.path).toHaveLength(5);
  });

  it('prefers the plan whose area maps the location, over a nearer ancestor', async () => {
    const [, building, floor, , room] = await buildChain();

    // Two candidates: the Floor is nearer, but only the Building's plan says
    // where the Room actually is.
    await uploadPlan(building.id);
    await uploadPlan(floor.id);
    const area = await drawArea(building.id, room.id);

    const { floorPlan } = (await get(`/locations/${room.id}/context`)).body.data;

    expect(floorPlan.locationId).toBe(building.id);
    expect(floorPlan.areaId).toBe(area.body.data.id);
  });

  it('falls back to the nearest ancestor with a plan when the location is unmapped', async () => {
    const [site, building, floor] = await buildChain();
    const room = (await get(`/locations/${floor.id}/children`)).body.data[0];

    await uploadPlan(site.id);
    await uploadPlan(building.id);

    const { floorPlan } = (await get(`/locations/${room.id}/context`)).body.data;

    // Building, not Site: nearest wins. And no area, which is what tells the UI
    // to say the exact location is not drawn on this plan.
    expect(floorPlan.locationId).toBe(building.id);
    expect(floorPlan.areaId).toBeNull();
  });

  it('uses the location’s own plan before looking upwards at all', async () => {
    const [, building, , , room] = await buildChain();

    await uploadPlan(building.id);
    await uploadPlan(room.id);

    const { floorPlan } = (await get(`/locations/${room.id}/context`)).body.data;

    expect(floorPlan.locationId).toBe(room.id);
  });

  it('ignores an area orphaned by re-parenting rather than pointing at a stranger', async () => {
    const [, building, , , room] = await buildChain();
    await uploadPlan(building.id);
    await drawArea(building.id, room.id);

    // Moving the room out from under the building leaves the area behind. The
    // plan no longer contains the room, so it must not be offered for it.
    const elsewhere = (await post('/locations', { name: 'Annexe', classificationId: LEAF_2 })).body
      .data;
    await api()
      .patch(`${V1}/locations/${room.id}`)
      .set(...admin.auth)
      .send({ parentLocationId: elsewhere.id });

    const { floorPlan, path } = (await get(`/locations/${room.id}/context`)).body.data;

    expect(path.map((node) => node.name)).toEqual(['Annexe', 'Room']);
    expect(floorPlan).toBeNull();
  });

  /**
   * The plan CHAIN — every level that has a plan, each marking the next step
   * down. This is what lets someone follow a unit from the top of the hierarchy
   * inwards instead of being handed one plan and no way up.
   */
  it('returns every plan along the chain, root-first, each marking the next step down', async () => {
    const [site, building, floor, wing, room] = await buildChain();

    await uploadPlan(site.id);
    await uploadPlan(building.id);
    const onSite = await drawArea(site.id, building.id);
    const onBuilding = await drawArea(building.id, room.id);

    const { floorPlans } = (await get(`/locations/${room.id}/context`)).body.data;

    // Outside-in, the way someone walks the building.
    expect(floorPlans).toEqual([
      {
        locationId: site.id,
        floorPlanId: expect.any(String),
        areaId: onSite.body.data.id,
        areaLocationId: building.id,
      },
      {
        locationId: building.id,
        floorPlanId: expect.any(String),
        areaId: onBuilding.body.data.id,
        areaLocationId: room.id,
      },
    ]);

    // Levels with no plan of their own simply are not steps in the trail.
    expect(floorPlans.map((entry) => entry.locationId)).not.toContain(floor.id);
    expect(floorPlans.map((entry) => entry.locationId)).not.toContain(wing.id);
  });

  it('keeps a level that has a plan but draws nothing on the way down', async () => {
    const [site, building, , , room] = await buildChain();

    await uploadPlan(site.id);
    await uploadPlan(building.id);
    const onBuilding = await drawArea(building.id, room.id);

    const { floorPlans } = (await get(`/locations/${room.id}/context`)).body.data;

    // "It is somewhere in here" is still worth knowing, so the Site stays in the
    // trail — with nothing highlighted, which is the honest answer.
    expect(floorPlans).toHaveLength(2);
    expect(floorPlans[0]).toMatchObject({
      locationId: site.id,
      areaId: null,
      areaLocationId: null,
    });
    expect(floorPlans[1]).toMatchObject({ areaId: onBuilding.body.data.id });
  });

  it('highlights the deepest node a plan draws, not merely the first', async () => {
    const [, building, floor, , room] = await buildChain();

    await uploadPlan(building.id);
    // One plan drawing two levels of the same chain — an area may represent any
    // descendant, not only a direct child (REQ-LOC-012).
    await drawArea(building.id, floor.id);
    const onRoom = await drawArea(building.id, room.id);

    const { floorPlans } = (await get(`/locations/${room.id}/context`)).body.data;

    // The Room is the most precise thing this plan can say about where the unit
    // is; the Floor is true but less useful.
    expect(floorPlans).toHaveLength(1);
    expect(floorPlans[0]).toMatchObject({
      areaId: onRoom.body.data.id,
      areaLocationId: room.id,
    });
  });

  it('highlights nothing on the location’s own plan', async () => {
    const [, building, , , room] = await buildChain();

    await uploadPlan(building.id);
    await uploadPlan(room.id);
    const onBuilding = await drawArea(building.id, room.id);

    const { floorPlans } = (await get(`/locations/${room.id}/context`)).body.data;

    expect(floorPlans.at(-1)).toMatchObject({
      locationId: room.id,
      areaId: null,
      areaLocationId: null,
    });
    // …while the ancestor above it still points the way in.
    expect(floorPlans.at(0)).toMatchObject({
      locationId: building.id,
      areaId: onBuilding.body.data.id,
    });
  });

  it('drops a chain plan whose area was orphaned by re-parenting', async () => {
    const [, building, , , room] = await buildChain();
    await uploadPlan(building.id);
    await drawArea(building.id, room.id);

    const elsewhere = (await post('/locations', { name: 'Annexe', classificationId: LEAF_2 })).body
      .data;
    await api()
      .patch(`${V1}/locations/${room.id}`)
      .set(...admin.auth)
      .send({ parentLocationId: elsewhere.id });

    const { floorPlans } = (await get(`/locations/${room.id}/context`)).body.data;

    // The building is no longer above the room, so neither its plan nor the area
    // it left behind may be offered for it.
    expect(floorPlans).toEqual([]);
  });

  it('resolves an area to the location it represents, at any depth', async () => {
    const [, building, , , room] = await buildChain();
    await uploadPlan(building.id);
    await drawArea(building.id, room.id);

    const areas = (await get(`/locations/${building.id}/floor-plan/areas`)).body.data;

    expect(areas[0].location).toMatchObject({ id: room.id, name: 'Room' });
  });

  it('omits the floor plan for a caller without floor-plan:read', async () => {
    const [, building, , , room] = await buildChain();
    await uploadPlan(building.id);

    const scoped = await createCaller({ permissions: ['location:read'], institutionId: null });
    const response = await get(`/locations/${room.id}/context`, scoped);

    expect(response.status).toBe(200);
    expect(response.body.data.path).toHaveLength(5);
    expect(response.body.data.floorPlan).toBeNull();
  });

  it('lists every descendant at any depth, without walking level by level', async () => {
    const [site, , , , room] = await buildChain();

    const response = await get(`/locations?descendantsOf=${site.id}&pageSize=100`);

    // Four descendants across four levels — the deepest included.
    expect(response.body.data.map((row) => row.name).sort()).toEqual([
      'Building',
      'Floor',
      'Room',
      'Wing',
    ]);
    expect(response.body.data.map((row) => row.id)).toContain(room.id);
  });
});
