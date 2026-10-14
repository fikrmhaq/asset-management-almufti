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
import { query, seed } from './helpers/db.js';

const require = createRequire(import.meta.url);
const { Op } = require('sequelize');

/**
 * Specifications during registration — REQ-REQUEST-021 (`IMPLEMENTATION_PLAN.md`
 * §68). The approved matrix, A – S:
 *
 *   AFTER        values go through the existing attribute-value API once a unit is
 *                registered or linked — also after REGISTER is DONE; registration
 *                itself never needs them and never touches them (A – F, S)
 *   RESPONSE     GET adds isRequired and the measurement unit's name, keeping
 *                every earlier field (G, H)
 *   AUDIT        each value created, changed or cleared is audited with its actor
 *                and before / after — the bulk writes were not (I)
 *   AUTHORITY    asset-attribute-value:update and the existing scope, Kajur's
 *                department and the whole-asset rule included (J – M)
 *   RULES        inactive definitions kept but closed; scope and classification
 *                enforced (N, O)
 *   EXISTING     what an asset or unit already holds survives registration and a
 *                fill-the-blanks save (P – R)
 */

const V1 = '/api/v1';
const LEAF = '117010101001';
const OTHER_LEAF = '132100102002';

const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request:submit',
  'request-item:create',
  'request-item-unit:read',
];
const APPROVER = ['request:read', 'request-step:decide'];
const PROCURER = ['request:read', 'request-step:complete'];
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
const SPECS = ['asset-attribute-value:read', 'asset-attribute-value:update'];

let admin;
let alpha;
let beta;
let tkj;
let tkr;
let cast;
let def;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetAssetCoreData();
  await models.AttributeDefinition.destroy({ where: {} });
  await resetOrganizationData();
  admin = await createAdminCaller();
  alpha = await models.Institution.create({ name: 'Alpha', code: 'ALPHA', address: 'Jl. A' });
  beta = await models.Institution.create({ name: 'Beta', code: 'BETA', address: 'Jl. B' });
  tkj = await models.Department.create({ code: 'TKJ', name: 'TKJ', institutionId: alpha.id });
  tkr = await models.Department.create({ code: 'TKR', name: 'TKR', institutionId: alpha.id });

  const [gb] = await models.MeasurementUnit.findOrCreate({ where: { name: 'GB' } });
  const definition = (name, extra = {}) =>
    models.AttributeDefinition.create({
      classificationId: LEAF,
      name,
      attributeType: 'TEXT',
      scope: 'ASSET_UNIT',
      ...extra,
    });
  def = {
    ram: await definition('RAM', {
      attributeType: 'NUMBER',
      scope: 'ASSET',
      usesMeasurementUnit: true,
      measurementUnitId: gb.id,
      sortOrder: 1,
    }),
    serial: await definition('Serial Number', { sortOrder: 1 }),
    mac: await definition('MAC Address', { isRequired: true, sortOrder: 2 }),
    vga: await definition('VGA', { sortOrder: 3 }),
    retired: await definition('Old tag', { isActive: false }),
    foreign: await definition('Other class', { classificationId: OTHER_LEAF }),
  };

  cast = {
    teacher: await person(REQUESTER, [['COMMON_TEACHER']]),
    jurusanTeacher: await person(REQUESTER, [['JURUSAN_TEACHER', tkj]]),
    kepala: await person(APPROVER, [['KEPALA_SEKOLAH']]),
    sarpras: await person([...PROCURER, ...REGISTRAR, ...SPECS], [['WAKASEK_SARPRAS']]),
    kajur: await person([...REGISTRAR, ...SPECS], [['KAJUR', tkj]]),
    // Registers, but holds no attribute code.
    plainRegistrar: await person(REGISTRAR),
    stranger: await person(['asset:read', 'asset-unit:read', ...SPECS], [], beta),
  };
  await workflow('COMMON_TEACHER', 'WAKASEK_SARPRAS');
  await workflow('JURUSAN_TEACHER', 'KAJUR');
});

afterAll(async () => {
  await resetAssetCoreData();
  await models.AttributeDefinition.destroy({ where: {} });
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
const put = (url, body, caller) => call('put', url, body, caller);

async function person(permissions, positions = [], institution = alpha) {
  const caller = await createCaller({
    permissions: [...new Set(permissions)],
    institutionId: institution.id,
  });
  for (const [positionCode, department] of positions) {
    await models.PositionAssignment.create({
      institutionId: institution.id,
      userId: caller.user.id,
      positionCode,
      departmentId: department?.id ?? null,
    });
  }
  const assignment = await models.PositionAssignment.findOne({ where: { userId: caller.user.id } });
  return { ...caller, assignment };
}

async function workflow(requester, registrar) {
  const definition = await models.WorkflowDefinition.create({
    institutionId: alpha.id,
    category: 'COMMON',
    requesterPositionCode: requester,
    version: 1,
    status: 'ACTIVE',
    publishedAt: new Date(),
  });
  const steps = [
    ['DECIDE', 'KEPALA_SEKOLAH'],
    ['PROCURE', 'WAKASEK_SARPRAS'],
    ['REGISTER', registrar],
  ];
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

async function approved({ requester = cast.teacher, quantity = 2 } = {}) {
  const created = await post(
    '/requests',
    { requesterAssignmentId: requester.assignment.id, category: 'COMMON', title: 'Laptop' },
    requester
  );
  expect(created.status).toBe(201);
  const item = await post(
    `/requests/${created.body.data.id}/items`,
    { description: 'Laptop', quantityRequested: quantity },
    requester
  );
  const submitted = await post(`/requests/${created.body.data.id}/submit`, {}, requester);
  const decided = await post(
    `/request-steps/${submitted.body.data.steps[0].id}/decide`,
    { decision: 'APPROVE' },
    cast.kepala
  );
  expect(decided.body.data.status).toBe('APPROVED');
  return { request: decided.body.data, itemId: item.body.data.id };
}

const register = (itemId, body, caller) => post(`/request-items/${itemId}/register`, body, caller);

/** `count` units registered under a new asset; `quantity` on the item. */
async function registered({ caller = cast.sarpras, count = 2, ...options } = {}) {
  const context = await approved(options);
  const response = await register(
    context.itemId,
    { name: 'Laptop', classificationId: LEAF, unitCount: count },
    caller
  );
  expect(response.status).toBe(201);
  const units = response.body.data.units;
  return { ...context, units, assetId: units[0].assetId };
}

async function directUnit({ assetId, departmentId } = {}) {
  let target = assetId;
  if (!target) {
    const asset = await post(
      '/assets',
      { name: 'Laptop lama', classificationId: LEAF, institutionId: alpha.id },
      admin
    );
    target = asset.body.data.id;
  }
  const unit = await post(`/assets/${target}/units`, departmentId ? { departmentId } : {}, admin);
  expect(unit.status).toBe(201);
  return unit.body.data;
}

const unitValues = (unitId, values, caller = cast.sarpras) =>
  put(`/asset-units/${unitId}/attribute-values`, { values }, caller);
const assetValues = (assetId, values, caller = cast.sarpras) =>
  put(`/assets/${assetId}/attribute-values`, { values }, caller);
const read = async (url, caller = cast.sarpras) =>
  Object.fromEntries((await get(url, caller)).body.data.map((row) => [row.name, row.value]));

/** Audit rows of `entityType` written since `since` — the trail is never reset. */
const auditFor = (entityType, since) =>
  models.AuditLog.findAll({
    where: { entityType, timestamp: { [Op.gte]: since } },
    order: [['timestamp', 'ASC']],
  });

const registerState = async (requestId) =>
  (
    await query(
      `SELECT state FROM public.request_steps WHERE request_id = $1 AND step_type = 'REGISTER'`,
      [requestId]
    )
  )[0].state;

// ---------------------------------------------------------------------------

describe('after registration, through the existing API (REQ-REQUEST-021, A – F)', () => {
  it('registers without any specification, and leaves none behind (F)', async () => {
    const { units } = await registered();

    expect(units).toHaveLength(2);
    expect(await models.AssetUnitAttributeValue.count()).toBe(0);
    expect(await models.AssetAttributeValue.count()).toBe(0);
  });

  it('takes a unit’s values once REGISTER is DONE (A)', async () => {
    const { units, request } = await registered({ count: 2, quantity: 2 });
    expect(await registerState(request.id)).toBe('DONE');

    const response = await unitValues(units[1].id, {
      [def.serial.id]: 'SN-0002',
      [def.mac.id]: 'AA:BB:CC:00:00:02',
    });

    expect(response.status).toBe(200);
    expect(await read(`/asset-units/${units[1].id}/attribute-values`)).toEqual({
      'Serial Number': 'SN-0002',
      'MAC Address': 'AA:BB:CC:00:00:02',
      VGA: null,
    });
  });

  it('takes the new asset’s own values (B)', async () => {
    const { assetId } = await registered();

    expect((await assetValues(assetId, { [def.ram.id]: 16 })).status).toBe(200);
    const [ram] = (await get(`/assets/${assetId}/attribute-values`, cast.sarpras)).body.data;
    expect(Number(ram.value)).toBe(16);
  });

  it('changes only the unit it is saved for — its sibling keeps nothing (C, D)', async () => {
    const { units } = await registered();

    await unitValues(units[0].id, {
      [def.serial.id]: 'SN-0001',
      [def.mac.id]: 'AA:BB:CC:00:00:01',
      [def.vga.id]: 'Intel UHD',
    });

    expect(await read(`/asset-units/${units[1].id}/attribute-values`)).toEqual({
      'Serial Number': null,
      'MAC Address': null,
      VGA: null,
    });
    expect(
      await models.AssetUnitAttributeValue.count({ where: { assetUnitId: units[1].id } })
    ).toBe(0);
  });

  it('refuses a set without a required value, naming the field, and stores nothing (E)', async () => {
    const { units } = await registered();

    const response = await unitValues(units[0].id, { [def.serial.id]: 'SN-0001' });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ field: `values.${def.mac.id}` }),
    ]);
    expect(await models.AssetUnitAttributeValue.count()).toBe(0);
  });

  it('leaves the registration alone when a save is refused (S)', async () => {
    const { units, itemId, request, assetId } = await registered({ count: 1, quantity: 2 });
    const before = {
      links: await models.RequestItemUnit.count({ where: { requestItemId: itemId } }),
      units: await models.AssetUnit.count({ where: { assetId } }),
      state: await registerState(request.id),
    };

    expect((await unitValues(units[0].id, { [def.mac.id]: '' })).status).toBe(400);
    expect((await assetValues(assetId, { [def.ram.id]: 'banyak' })).status).toBe(400);

    expect({
      links: await models.RequestItemUnit.count({ where: { requestItemId: itemId } }),
      units: await models.AssetUnit.count({ where: { assetId } }),
      state: await registerState(request.id),
    }).toEqual({ ...before, state: 'ACTIVE' });
    expect((await register(itemId, { assetId, unitCount: 1 }, cast.sarpras)).status).toBe(201);
  });
});

describe('the response (G, H)', () => {
  it('adds isRequired and the measurement unit’s name, keeping every earlier field', async () => {
    const { assetId, units } = await registered();

    const [ram] = (await get(`/assets/${assetId}/attribute-values`, cast.sarpras)).body.data;
    expect(ram).toEqual({
      attributeDefinitionId: def.ram.id,
      name: 'RAM',
      attributeType: 'NUMBER',
      scope: 'ASSET',
      isRequired: false,
      measurementUnitId: def.ram.measurementUnitId,
      measurementUnitName: 'GB',
      value: null,
    });

    const unitRows = (await get(`/asset-units/${units[0].id}/attribute-values`, cast.sarpras)).body
      .data;
    expect(unitRows.map((row) => [row.name, row.isRequired, row.measurementUnitName])).toEqual([
      ['Serial Number', false, null],
      ['MAC Address', true, null],
      ['VGA', false, null],
    ]);
  });

  it('describes a valued definition the same way', async () => {
    const { units } = await registered();
    await unitValues(units[0].id, { [def.mac.id]: 'AA' });

    const mac = (await get(`/asset-units/${units[0].id}/attribute-values`, cast.sarpras)).body
      .data[1];
    expect(mac).toMatchObject({ name: 'MAC Address', isRequired: true, value: 'AA' });
  });
});

describe('audit — every value written is recorded (I)', () => {
  it('records a unit value created, changed and cleared, with the actor and before / after', async () => {
    const { units } = await registered();
    const unitId = units[0].id;
    const since = new Date();

    await unitValues(unitId, { [def.serial.id]: 'SN-A', [def.mac.id]: 'MAC-1' });
    await unitValues(unitId, { [def.serial.id]: 'SN-B', [def.mac.id]: 'MAC-1' });
    await unitValues(unitId, { [def.mac.id]: 'MAC-1' });

    const entries = await auditFor('AssetUnitAttributeValue', since);
    expect(entries.map((entry) => entry.action)).toEqual(['CREATE', 'CREATE', 'UPDATE', 'DELETE']);
    expect(entries.every((entry) => entry.actorId === cast.sarpras.user.id)).toBe(true);
    const serialCreate = entries.find(
      (entry) =>
        entry.action === 'CREATE' && entry.newValues.attributeDefinitionId === def.serial.id
    );
    expect(serialCreate.newValues).toMatchObject({ assetUnitId: unitId, valueText: 'SN-A' });
    expect(entries[2]).toMatchObject({
      oldValues: { valueText: 'SN-A' },
      newValues: { valueText: 'SN-B' },
    });
    expect(entries[3].oldValues).toMatchObject({
      attributeDefinitionId: def.serial.id,
      valueText: 'SN-B',
    });
    // The unchanged MAC was never rewritten: its row has its CREATE and nothing else.
    const macCreate = entries.find(
      (entry) => entry.action === 'CREATE' && entry.newValues.attributeDefinitionId === def.mac.id
    );
    expect(entries.filter((entry) => entry.entityId === macCreate.entityId)).toHaveLength(1);
  });

  it('records an asset value created, changed and cleared — and nothing for an unchanged one', async () => {
    const { assetId } = await registered();
    const since = new Date();

    await assetValues(assetId, { [def.ram.id]: 16 });
    await assetValues(assetId, { [def.ram.id]: '16' });
    await assetValues(assetId, { [def.ram.id]: 32 });
    await assetValues(assetId, {});

    const entries = await auditFor('AssetAttributeValue', since);
    expect(entries.map((entry) => entry.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
    expect(Number(entries[0].newValues.valueNumeric)).toBe(16);
    expect(Number(entries[1].oldValues.valueNumeric)).toBe(16);
    expect(Number(entries[1].newValues.valueNumeric)).toBe(32);
    expect(Number(entries[2].oldValues.valueNumeric)).toBe(32);
    expect(entries.every((entry) => entry.actorId === cast.sarpras.user.id)).toBe(true);
  });

  it('audits edits made the existing way too — on a directly registered unit', async () => {
    const unit = await directUnit();
    const since = new Date();
    await unitValues(unit.id, { [def.mac.id]: 'DIRECT' }, admin);

    const [entry] = await auditFor('AssetUnitAttributeValue', since);
    expect(entry).toMatchObject({ action: 'CREATE', actorId: admin.user.id });
  });
});

describe('authority (J – M)', () => {
  it('refuses a registrar without the attribute code, and another institution', async () => {
    const { units, assetId } = await registered();

    expect((await unitValues(units[0].id, { [def.mac.id]: 'X' }, cast.plainRegistrar)).status).toBe(
      403
    );
    expect((await get(`/assets/${assetId}/attribute-values`, cast.plainRegistrar)).status).toBe(
      403
    );
    expect((await unitValues(units[0].id, { [def.mac.id]: 'X' }, cast.stranger)).status).toBe(404);
    expect((await assetValues(assetId, { [def.ram.id]: 8 }, cast.stranger)).status).toBe(404);
    expect(await models.AssetUnitAttributeValue.count()).toBe(0);
  });

  it('holds a Kajur to their department, and to the whole-asset rule (L, M)', async () => {
    const own = await registered({ caller: cast.kajur, requester: cast.jurusanTeacher });
    expect((await unitValues(own.units[0].id, { [def.mac.id]: 'TKJ-1' }, cast.kajur)).status).toBe(
      200
    );
    expect((await assetValues(own.assetId, { [def.ram.id]: 8 }, cast.kajur)).status).toBe(200);

    const tkrUnit = await directUnit({ assetId: own.assetId, departmentId: tkr.id });

    expect((await unitValues(tkrUnit.id, { [def.mac.id]: 'TKR-1' }, cast.kajur)).status).toBe(404);
    expect((await assetValues(own.assetId, { [def.ram.id]: 16 }, cast.kajur)).status).toBe(403);
    expect((await unitValues(own.units[1].id, { [def.mac.id]: 'TKJ-2' }, cast.kajur)).status).toBe(
      200
    );
    expect(Number((await models.AssetAttributeValue.findOne()).valueNumeric)).toBe(8);
    // Sarpras is not narrowed.
    expect((await unitValues(tkrUnit.id, { [def.mac.id]: 'TKR-1' })).status).toBe(200);
  });
});

describe('the existing rules (N, O)', () => {
  it('keeps a value whose definition was deactivated, without offering or accepting it (N)', async () => {
    const { units } = await registered();
    await def.retired.update({ isActive: true });
    await unitValues(units[0].id, { [def.retired.id]: 'kept', [def.mac.id]: 'M' });
    await def.retired.update({ isActive: false });

    await unitValues(units[0].id, { [def.mac.id]: 'M2' });

    const rows = (await get(`/asset-units/${units[0].id}/attribute-values`, cast.sarpras)).body
      .data;
    expect(rows.map((row) => row.name)).not.toContain('Old tag');
    expect(
      await models.AssetUnitAttributeValue.count({
        where: { attributeDefinitionId: def.retired.id },
      })
    ).toBe(1);
    const refused = await unitValues(units[0].id, { [def.retired.id]: 'x', [def.mac.id]: 'M2' });
    expect(refused.status).toBe(400);
  });

  it('refuses another classification’s definition, and the wrong scope (O)', async () => {
    const { units, assetId } = await registered();

    const foreign = await unitValues(units[0].id, { [def.foreign.id]: 'x', [def.mac.id]: 'M' });
    const assetOnUnit = await unitValues(units[0].id, { [def.ram.id]: 8, [def.mac.id]: 'M' });
    const unitOnAsset = await assetValues(assetId, { [def.serial.id]: 'SN' });

    for (const response of [foreign, assetOnUnit, unitOnAsset]) {
      expect(response.status).toBe(400);
    }
    expect(await models.AssetUnitAttributeValue.count()).toBe(0);
    expect(await models.AssetAttributeValue.count()).toBe(0);
  });
});

describe('what an existing asset or unit holds survives (P – R)', () => {
  it('registering new units under an existing asset leaves its values alone (P)', async () => {
    const { assetId, itemId, units } = await registered({ count: 1, quantity: 3 });
    await assetValues(assetId, { [def.ram.id]: 16 });
    await unitValues(units[0].id, { [def.serial.id]: 'SN-1', [def.mac.id]: 'MAC-1' });
    const auditBefore = await models.AuditLog.count({
      where: { entityType: ['AssetAttributeValue', 'AssetUnitAttributeValue'] },
    });

    const more = await register(itemId, { assetId, unitCount: 1 }, cast.sarpras);
    expect(more.status).toBe(201);

    expect(Number((await models.AssetAttributeValue.findOne()).valueNumeric)).toBe(16);
    expect(await read(`/asset-units/${units[0].id}/attribute-values`)).toMatchObject({
      'Serial Number': 'SN-1',
      'MAC Address': 'MAC-1',
    });
    expect(
      await models.AuditLog.count({
        where: { entityType: ['AssetAttributeValue', 'AssetUnitAttributeValue'] },
      })
    ).toBe(auditBefore);
  });

  it('a fill-the-blanks save keeps what was recorded, rewriting nothing (Q)', async () => {
    const { units } = await registered();
    const unitId = units[0].id;
    const since = new Date();
    await unitValues(unitId, { [def.serial.id]: 'SN-1', [def.mac.id]: 'MAC-1' });

    // What the registration dialog sends: everything recorded, plus the blank filled.
    const response = await unitValues(unitId, {
      [def.serial.id]: 'SN-1',
      [def.mac.id]: 'MAC-1',
      [def.vga.id]: 'GTX',
    });

    expect(response.status).toBe(200);
    const entries = await auditFor('AssetUnitAttributeValue', since);
    expect(entries.map((entry) => entry.action)).toEqual(['CREATE', 'CREATE', 'CREATE']);
    expect(await read(`/asset-units/${unitId}/attribute-values`)).toEqual({
      'Serial Number': 'SN-1',
      'MAC Address': 'MAC-1',
      VGA: 'GTX',
    });
  });

  it('linking an existing unit keeps its specifications (R)', async () => {
    const existing = await directUnit();
    await unitValues(existing.id, { [def.serial.id]: 'OLD-SN', [def.mac.id]: 'OLD-MAC' }, admin);
    const { itemId } = await approved({ quantity: 1 });

    const linked = await post(
      `/request-items/${itemId}/units`,
      { assetUnitId: existing.id },
      cast.sarpras
    );
    expect(linked.status).toBe(201);

    expect(await read(`/asset-units/${existing.id}/attribute-values`)).toEqual({
      'Serial Number': 'OLD-SN',
      'MAC Address': 'OLD-MAC',
      VGA: null,
    });
    // Filling its blank afterwards keeps the recorded two.
    await unitValues(existing.id, {
      [def.serial.id]: 'OLD-SN',
      [def.mac.id]: 'OLD-MAC',
      [def.vga.id]: 'Radeon',
    });
    expect(await read(`/asset-units/${existing.id}/attribute-values`)).toMatchObject({
      'Serial Number': 'OLD-SN',
      VGA: 'Radeon',
    });
  });
});
