import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetAssetCoreData,
  resetProcurementData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Procurement API — `IMPLEMENTATION_PLAN.md` §12; `06-api.md` §6 and §7.1.
 *
 * Covers suppliers, vendors, contracts, contract items and the
 * procurement-to-asset flow, including its transactional guarantee.
 */

const V1 = '/api/v1';
const LEAF = '117010101001'; // Aspal — a real leaf classification
const ROOT_CLASSIFICATION = '100000000000';

let admin;
let institution;

function request(method, path, caller = admin) {
  return api()
    [method](`${V1}${path}`)
    .set(...caller.auth);
}

const get = (path, caller = admin) => request('get', path, caller);
const post = (path, body, caller = admin) => request('post', path, caller).send(body);
const patch = (path, body, caller = admin) => request('patch', path, caller).send(body);
const del = (path, caller = admin) => request('delete', path, caller);

async function createSupplier(overrides = {}) {
  const response = await post('/suppliers', { name: 'PT Sumber Jaya', ...overrides });
  return response.body.data;
}

async function createVendor(overrides = {}) {
  const response = await post('/vendors', { name: 'Acme Manufacturing', ...overrides });
  return response.body.data;
}

let contractSequence = 0;

async function createContract(overrides = {}, caller = admin) {
  contractSequence += 1;
  const response = await post(
    '/contracts',
    {
      contractNumber: `CTR-${contractSequence}-${Math.random().toString(36).slice(2, 7)}`,
      contractDate: '2025-03-01',
      institutionId: institution.id,
      ...overrides,
    },
    caller
  );
  return response.body.data;
}

async function createItem(contractId, overrides = {}, caller = admin) {
  const response = await post(
    `/contracts/${contractId}/items`,
    { assetName: 'Laptop 14"', quantity: 10, unitPrice: 12500000, unitType: 'unit', ...overrides },
    caller
  );
  return response.body.data;
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  // Order matters: assets reference contracts and vendors, contracts reference
  // institutions and the reference lookups.
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();

  admin = await createAdminCaller();
  institution = await models.Institution.create({
    name: 'Procurement Institution',
    code: `PROC-${Math.random().toString(36).slice(2, 7)}`,
    address: 'Somewhere',
  });
});

afterAll(async () => {
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
});

describe('suppliers (§6.1, REQ-SUPPLIER-001–003)', () => {
  it('creates, reads, updates and lists', async () => {
    const created = await createSupplier({ address: 'Jl. Merdeka 1', contactInfo: '021-555' });

    expect(created.name).toBe('PT Sumber Jaya');
    expect(created.address).toBe('Jl. Merdeka 1');
    expect(created.isActive).toBe(true);

    const detail = await get(`/suppliers/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.contactInfo).toBe('021-555');

    const updated = await patch(`/suppliers/${created.id}`, { name: 'PT Sumber Jaya Abadi' });
    expect(updated.body.data.name).toBe('PT Sumber Jaya Abadi');

    const list = await get('/suppliers');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);
  });

  it('deactivates and reactivates rather than deleting (§1.7, BR-005)', async () => {
    const supplier = await createSupplier();

    expect((await post(`/suppliers/${supplier.id}/deactivate`)).body.data.isActive).toBe(false);
    expect((await post(`/suppliers/${supplier.id}/deactivate`)).status).toBe(409);
    expect((await post(`/suppliers/${supplier.id}/reactivate`)).body.data.isActive).toBe(true);

    expect(await models.Supplier.findByPk(supplier.id)).not.toBeNull();
  });

  it('filters by status and search term', async () => {
    const first = await createSupplier({ name: 'Alpha Trading' });
    await createSupplier({ name: 'Beta Supplies' });
    await post(`/suppliers/${first.id}/deactivate`);

    expect((await get('/suppliers?status=inactive')).body.data.map((s) => s.name)).toEqual([
      'Alpha Trading',
    ]);
    expect((await get('/suppliers?q=beta')).body.data.map((s) => s.name)).toEqual([
      'Beta Supplies',
    ]);
  });

  it('answers 404 for an unknown supplier', async () => {
    const response = await get('/suppliers/00000000-0000-4000-8000-000000000000');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an empty name', async () => {
    const response = await post('/suppliers', { name: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is not organization-scoped — every caller sees the same list (DEC-007)', async () => {
    await createSupplier({ name: 'Shared Supplier' });

    const other = await models.Institution.create({
      name: 'Other',
      code: `OTH-${Math.random().toString(36).slice(2, 7)}`,
      address: 'Elsewhere',
    });
    const scoped = await createCaller({
      permissions: ['supplier:read'],
      institutionId: other.id,
    });

    const response = await get('/suppliers', scoped);

    expect(response.status).toBe(200);
    expect(response.body.data.map((s) => s.name)).toEqual(['Shared Supplier']);
  });
});

describe('vendors (§7.1, REQ-VENDOR-001–004)', () => {
  it('creates, reads, updates and deactivates', async () => {
    const created = await createVendor({ contactInfo: 'sales@acme.test' });

    expect(created.name).toBe('Acme Manufacturing');
    expect((await get(`/vendors/${created.id}`)).body.data.contactInfo).toBe('sales@acme.test');
    expect((await patch(`/vendors/${created.id}`, { address: 'Bandung' })).body.data.address).toBe(
      'Bandung'
    );
    expect((await post(`/vendors/${created.id}/deactivate`)).body.data.isActive).toBe(false);
    expect((await post(`/vendors/${created.id}/reactivate`)).body.data.isActive).toBe(true);
  });

  it('lists the assets it supplies (REQ-VENDOR-004)', async () => {
    const vendor = await createVendor();
    await post('/assets', {
      name: 'Supplied Asset',
      classificationId: LEAF,
      vendorId: vendor.id,
      institutionId: institution.id,
    });
    await post('/assets', { name: 'Unrelated Asset', classificationId: LEAF });

    const response = await get(`/vendors/${vendor.id}/assets`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((a) => a.name)).toEqual(['Supplied Asset']);
  });

  it('scopes the assets it returns to the caller’s institution (BR-007)', async () => {
    const other = await models.Institution.create({
      name: 'Other',
      code: `OTH-${Math.random().toString(36).slice(2, 7)}`,
      address: 'Elsewhere',
    });
    const vendor = await createVendor();

    await post('/assets', {
      name: 'Mine',
      classificationId: LEAF,
      vendorId: vendor.id,
      institutionId: institution.id,
    });
    await post('/assets', {
      name: 'Theirs',
      classificationId: LEAF,
      vendorId: vendor.id,
      institutionId: other.id,
    });

    const scoped = await createCaller({
      permissions: ['vendor:read', 'asset:read'],
      institutionId: institution.id,
    });

    const response = await get(`/vendors/${vendor.id}/assets`, scoped);

    expect(response.body.data.map((a) => a.name)).toEqual(['Mine']);
  });

  it('answers 404 for assets of an unknown vendor', async () => {
    const response = await get('/vendors/00000000-0000-4000-8000-000000000000/assets');

    expect(response.status).toBe(404);
  });
});

describe('contracts (§6.2, REQ-PROC-001–003, REQ-PROC-007/008)', () => {
  it('creates with every documented field and resolves its relations', async () => {
    const supplier = await createSupplier();
    const contractType = await models.ContractType.create({ name: 'Pengadaan Langsung' });
    const fundingSource = await models.FundingSource.create({ name: 'APBD' });
    const accountCode = await models.AccountCode.create({
      code: '5.2.2.01.01',
      name: 'Belanja Modal',
    });

    const response = await post('/contracts', {
      contractNumber: 'CTR-2025-0001',
      supplierId: supplier.id,
      contractTypeId: contractType.id,
      contractDate: '2025-03-01',
      fundingSourceId: fundingSource.id,
      contractValue: 125000000,
      receivingDocument: 'BA-2025-77',
      receivingDate: '2025-03-15',
      institutionId: institution.id,
      accountCode: accountCode.code,
      notes: 'Pengadaan laptop',
    });

    expect(response.status).toBe(201);
    const contract = response.body.data;
    expect(contract.contractNumber).toBe('CTR-2025-0001');
    expect(contract.contractDate).toBe('2025-03-01');
    expect(contract.receivingDate).toBe('2025-03-15');
    expect(Number(contract.contractValue)).toBe(125000000);
    // CHAR(12) is blank-padded by PostgreSQL; the API must not leak the padding.
    expect(contract.accountCode).toBe('5.2.2.01.01');
    expect(contract.supplier).toEqual({ id: supplier.id, name: 'PT Sumber Jaya' });
    expect(contract.contractType.name).toBe('Pengadaan Langsung');
    expect(contract.fundingSource.name).toBe('APBD');
    expect(contract.institution.id).toBe(institution.id);
  });

  it('rejects a duplicate contract number with CONFLICT (REQ-VAL-004)', async () => {
    await createContract({ contractNumber: 'CTR-DUP-1' });

    const response = await post('/contracts', {
      contractNumber: 'CTR-DUP-1',
      contractDate: '2025-04-01',
      institutionId: institution.id,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.details[0].field).toBe('contractNumber');
  });

  it('rejects a duplicate contract number on update but allows a no-op rename', async () => {
    await createContract({ contractNumber: 'CTR-TAKEN' });
    const mine = await createContract({ contractNumber: 'CTR-MINE' });

    expect((await patch(`/contracts/${mine.id}`, { contractNumber: 'CTR-TAKEN' })).status).toBe(
      409
    );
    expect((await patch(`/contracts/${mine.id}`, { contractNumber: 'CTR-MINE' })).status).toBe(200);
  });

  it('rejects references that do not exist', async () => {
    const cases = [
      ['supplierId', '00000000-0000-4000-8000-000000000000'],
      ['contractTypeId', 999999],
      ['fundingSourceId', 999999],
      ['accountCode', '9.9.9.99.99'],
    ];

    for (const [field, value] of cases) {
      const response = await post('/contracts', {
        contractNumber: `CTR-BAD-${field}`,
        contractDate: '2025-03-01',
        [field]: value,
      });

      expect(response.status, field).toBe(400);
      expect(response.body.error.details[0].field, field).toBe(field);
    }
  });

  it('rejects a malformed date and a negative value', async () => {
    expect(
      (await post('/contracts', { contractNumber: 'CTR-D', contractDate: '01-03-2025' })).status
    ).toBe(400);
    expect(
      (
        await post('/contracts', {
          contractNumber: 'CTR-V',
          contractDate: '2025-03-01',
          contractValue: -1,
        })
      ).status
    ).toBe(400);
  });

  it('filters by supplier, type, status and contract number', async () => {
    const supplier = await createSupplier();
    const contractType = await models.ContractType.create({ name: 'Swakelola' });

    const first = await createContract({
      contractNumber: 'CTR-FILTER-A',
      supplierId: supplier.id,
      contractTypeId: contractType.id,
    });
    await createContract({ contractNumber: 'CTR-FILTER-B' });
    await post(`/contracts/${first.id}/deactivate`);

    expect((await get(`/contracts?supplierId=${supplier.id}`)).body.data).toHaveLength(1);
    expect((await get(`/contracts?contractTypeId=${contractType.id}`)).body.data).toHaveLength(1);
    expect(
      (await get('/contracts?status=inactive')).body.data.map((c) => c.contractNumber)
    ).toEqual(['CTR-FILTER-A']);
    expect((await get('/contracts?q=FILTER-B')).body.data.map((c) => c.contractNumber)).toEqual([
      'CTR-FILTER-B',
    ]);
  });

  it('deactivates without touching its line items or the assets traced to it', async () => {
    const contract = await createContract();
    const item = await createItem(contract.id);

    const response = await post(`/contracts/${contract.id}/deactivate`);

    expect(response.body.data.isActive).toBe(false);
    expect(await models.ContractItem.findByPk(item.id)).not.toBeNull();
  });
});

describe('contract organization scope (BR-007, REQ-AUTHZ-004/005)', () => {
  let scoped;
  let otherInstitution;

  beforeEach(async () => {
    otherInstitution = await models.Institution.create({
      name: 'Other Institution',
      code: `OTH-${Math.random().toString(36).slice(2, 7)}`,
      address: 'Elsewhere',
    });
    scoped = await createCaller({
      permissions: [
        'contract:read',
        'contract:create',
        'contract:update',
        'contract-item:read',
        'contract-item:create',
      ],
      institutionId: institution.id,
    });
  });

  it('hides another institution’s contracts', async () => {
    await createContract({ contractNumber: 'CTR-MINE', institutionId: institution.id });
    await createContract({ contractNumber: 'CTR-THEIRS', institutionId: otherInstitution.id });

    const response = await get('/contracts', scoped);

    expect(response.body.data.map((c) => c.contractNumber)).toEqual(['CTR-MINE']);
  });

  it('answers 404, not 403, for an out-of-scope contract (§1.4)', async () => {
    const theirs = await createContract({ institutionId: otherInstitution.id });

    const response = await get(`/contracts/${theirs.id}`, scoped);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('defaults a new contract to the caller’s own institution', async () => {
    const response = await post(
      '/contracts',
      { contractNumber: 'CTR-DEFAULTED', contractDate: '2025-05-01' },
      scoped
    );

    expect(response.status).toBe(201);
    expect(response.body.data.institutionId).toBe(institution.id);
  });

  it('refuses to create a contract into another institution', async () => {
    const response = await post(
      '/contracts',
      {
        contractNumber: 'CTR-SNEAKY',
        contractDate: '2025-05-01',
        institutionId: otherInstitution.id,
      },
      scoped
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/BR-007/);
  });

  it('inherits the contract’s scope on its line items (DEC-007)', async () => {
    const theirs = await createContract({ institutionId: otherInstitution.id });
    const item = await createItem(theirs.id);

    expect((await get(`/contracts/${theirs.id}/items`, scoped)).status).toBe(404);
    expect((await get(`/contract-items/${item.id}`, scoped)).status).toBe(404);
  });

  it('lets a system-wide caller see every institution (REQ-AUTHZ-005)', async () => {
    await createContract({ contractNumber: 'CTR-A', institutionId: institution.id });
    await createContract({ contractNumber: 'CTR-B', institutionId: otherInstitution.id });

    const response = await get('/contracts');

    expect(response.body.data.map((c) => c.contractNumber).sort()).toEqual(['CTR-A', 'CTR-B']);
  });
});

describe('contract items (§6.3, REQ-PROC-004/005)', () => {
  let contract;

  beforeEach(async () => {
    contract = await createContract();
  });

  it('creates a line item under its contract and lists it', async () => {
    const item = await createItem(contract.id);

    expect(item.contractId).toBe(contract.id);
    expect(item.assetName).toBe('Laptop 14"');

    const list = await get(`/contracts/${contract.id}/items`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);
  });

  it('derives totalValue rather than storing it (03-domain.md §4.17)', async () => {
    const item = await createItem(contract.id, { quantity: 3, unitPrice: 1500.5 });

    expect(Number(item.totalValue)).toBe(4501.5);

    const columns = Object.keys(models.ContractItem.rawAttributes);
    expect(columns).toContain('totalValue');
    // VIRTUAL: derived on read, never a stored column.
    expect(models.ContractItem.rawAttributes.totalValue.type.constructor.name).toBe('VIRTUAL');
  });

  it('returns null totalValue when quantity or price is missing', async () => {
    const item = await createItem(contract.id, { quantity: null, unitPrice: 1000 });

    expect(item.totalValue).toBeNull();
  });

  it('enforces the quantity and price checks (04-data-model.md §5.4.4)', async () => {
    expect(
      (await post(`/contracts/${contract.id}/items`, { assetName: 'X', quantity: 0 })).status
    ).toBe(400);
    expect(
      (await post(`/contracts/${contract.id}/items`, { assetName: 'X', unitPrice: -5 })).status
    ).toBe(400);
    expect((await post(`/contracts/${contract.id}/items`, { assetName: '  ' })).status).toBe(400);
  });

  it('updates editable fields but refuses to move the item between contracts', async () => {
    const item = await createItem(contract.id);
    const otherContract = await createContract();

    const updated = await patch(`/contract-items/${item.id}`, { quantity: 4, unitPrice: 100 });
    expect(updated.status).toBe(200);
    expect(Number(updated.body.data.totalValue)).toBe(400);

    const moved = await patch(`/contract-items/${item.id}`, { contractId: otherContract.id });
    expect(moved.status).toBe(400);
  });

  it('deletes a line item that nothing references', async () => {
    const item = await createItem(contract.id);

    expect((await del(`/contract-items/${item.id}`)).status).toBe(204);
    expect(await models.ContractItem.findByPk(item.id)).toBeNull();
  });

  it('blocks deletion once asset units were procured through it (REQ-PROC-006)', async () => {
    const item = await createItem(contract.id);
    await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 2,
    });

    const response = await del(`/contract-items/${item.id}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.message).toMatch(/2 asset unit/);
    expect(await models.ContractItem.findByPk(item.id)).not.toBeNull();
  });

  it('cascades when the contract itself is deleted (fk ON DELETE CASCADE)', async () => {
    const item = await createItem(contract.id);

    await models.Contract.destroy({ where: { id: contract.id } });

    expect(await models.ContractItem.findByPk(item.id)).toBeNull();
  });
});

describe('procurement → asset (§12.5, REQ-PROC-009, REQ-ASSET-011)', () => {
  let contract;
  let item;

  beforeEach(async () => {
    contract = await createContract();
    item = await createItem(contract.id);
  });

  it('creates the asset and its units, wiring the traceability itself', async () => {
    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 3,
    });

    expect(response.status).toBe(201);
    const { asset, units } = response.body.data;

    // The caller supplied neither, yet both point back at the procurement.
    expect(asset.contractId).toBe(contract.id);
    expect(units).toHaveLength(3);
    expect(units.every((unit) => unit.contractItemId === item.id)).toBe(true);
    expect(units.every((unit) => unit.assetId === asset.id)).toBe(true);
    expect(units.every((unit) => unit.lifecycleState === 'REGISTERED')).toBe(true);

    // And the same relationships are readable back through the API.
    const traced = await get(`/contract-items/${item.id}/asset-units`);
    expect(traced.body.meta.total).toBe(3);

    const assetDetail = await get(`/assets/${asset.id}`);
    expect(assetDetail.body.data.contract.contractNumber).toBe(contract.contractNumber);
  });

  it('defaults the asset name to the line item’s asset name', async () => {
    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 1,
    });

    expect(response.body.data.asset.name).toBe('Laptop 14"');
  });

  it('accepts an explicit name, vendor, department and description', async () => {
    const vendor = await createVendor();
    // Phase 20 (`CR-003`): the department must belong to the same institution as
    // the asset being created, which this flow takes from the contract.
    const department = await models.Department.create({
      code: 'DEP-01',
      name: 'IT',
      institutionId: institution.id,
    });

    const response = await post(`/contract-items/${item.id}/assets`, {
      name: 'Laptop Dinas',
      classificationId: LEAF,
      unitCount: 2,
      vendorId: vendor.id,
      departmentId: department.id,
      description: 'Untuk staf',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.asset.name).toBe('Laptop Dinas');
    expect(response.body.data.asset.vendorId).toBe(vendor.id);
    expect(response.body.data.units.every((unit) => unit.departmentId === department.id)).toBe(
      true
    );
  });

  it('takes the institution from the contract when the caller omits it', async () => {
    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 1,
    });

    expect(response.body.data.asset.institutionId).toBe(institution.id);
  });

  it('enforces the leaf classification rule (BR-011, REQ-CLASS-009)', async () => {
    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: ROOT_CLASSIFICATION,
      unitCount: 1,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('classificationId');
    expect(await models.Asset.count()).toBe(0);
  });

  it('rejects a vendor or department that does not exist', async () => {
    const badVendor = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 1,
      vendorId: '00000000-0000-4000-8000-000000000000',
    });
    expect(badVendor.status).toBe(400);
    expect(badVendor.body.error.details[0].field).toBe('vendorId');

    const badDepartment = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 1,
      departmentId: '00000000-0000-4000-8000-000000000001',
    });
    expect(badDepartment.status).toBe(400);
    expect(badDepartment.body.error.details[0].field).toBe('departmentId');

    expect(await models.Asset.count()).toBe(0);
  });

  it('bounds unitCount between 1 and 500 without tying it to quantity', async () => {
    expect(
      (await post(`/contract-items/${item.id}/assets`, { classificationId: LEAF, unitCount: 0 }))
        .status
    ).toBe(400);
    expect(
      (await post(`/contract-items/${item.id}/assets`, { classificationId: LEAF, unitCount: 501 }))
        .status
    ).toBe(400);

    // The line item ordered 10; registering 25 is allowed — no requirement ties
    // the two together.
    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 25,
    });
    expect(response.status).toBe(201);
    expect(response.body.data.units).toHaveLength(25);
  });

  it('rolls back completely when unit creation fails, leaving no orphan asset (§35)', async () => {
    const spy = vi
      .spyOn(models.AssetUnit, 'bulkCreate')
      .mockRejectedValueOnce(new Error('simulated failure'));

    const response = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 4,
    });

    expect(response.status).toBe(500);
    expect(await models.Asset.count()).toBe(0);
    expect(await models.AssetUnit.count()).toBe(0);

    spy.mockRestore();

    // And the operation still works afterwards — the failure left nothing behind.
    const retry = await post(`/contract-items/${item.id}/assets`, {
      classificationId: LEAF,
      unitCount: 4,
    });
    expect(retry.status).toBe(201);
    expect(await models.Asset.count()).toBe(1);
    expect(await models.AssetUnit.count()).toBe(4);
  });

  it('refuses to create into an institution the caller cannot reach (BR-007)', async () => {
    const otherInstitution = await models.Institution.create({
      name: 'Other',
      code: `OTH-${Math.random().toString(36).slice(2, 7)}`,
      address: 'Elsewhere',
    });
    const scoped = await createCaller({
      permissions: ['asset:create', 'asset-unit:create'],
      institutionId: institution.id,
    });

    const response = await post(
      `/contract-items/${item.id}/assets`,
      { classificationId: LEAF, unitCount: 1, institutionId: otherInstitution.id },
      scoped
    );

    expect(response.status).toBe(400);
    expect(await models.Asset.count()).toBe(0);
  });

  it('answers 404 for an unknown contract item', async () => {
    const response = await post('/contract-items/00000000-0000-4000-8000-000000000000/assets', {
      classificationId: LEAF,
      unitCount: 1,
    });

    expect(response.status).toBe(404);
  });
});

describe('authorization (§1.3, REQ-AUTHZ-002/003)', () => {
  it('rejects every procurement endpoint without a token', async () => {
    const paths = ['/suppliers', '/vendors', '/contracts'];

    for (const path of paths) {
      const response = await api().get(`${V1}${path}`);
      expect(response.status, path).toBe(401);
      expect(response.body.error.code, path).toBe('UNAUTHORIZED');
    }
  });

  it('enforces the per-resource permission on each verb', async () => {
    const reader = await createCaller({
      permissions: ['supplier:read', 'vendor:read', 'contract:read', 'contract-item:read'],
      isSystemWide: true,
    });
    const contract = await createContract();
    const item = await createItem(contract.id);
    const supplier = await createSupplier();

    expect((await get('/suppliers', reader)).status).toBe(200);
    expect((await post('/suppliers', { name: 'Nope' }, reader)).status).toBe(403);
    expect((await patch(`/suppliers/${supplier.id}`, { name: 'Nope' }, reader)).status).toBe(403);
    expect((await post(`/suppliers/${supplier.id}/deactivate`, {}, reader)).status).toBe(403);
    expect((await post('/vendors', { name: 'Nope' }, reader)).status).toBe(403);
    expect(
      (await post('/contracts', { contractNumber: 'X', contractDate: '2025-01-01' }, reader)).status
    ).toBe(403);
    expect((await post(`/contracts/${contract.id}/items`, { assetName: 'X' }, reader)).status).toBe(
      403
    );
    expect((await del(`/contract-items/${item.id}`, reader)).status).toBe(403);
  });

  it('demands BOTH asset:create and asset-unit:create for the procurement flow', async () => {
    const contract = await createContract();
    const item = await createItem(contract.id);
    const body = { classificationId: LEAF, unitCount: 1 };

    const assetOnly = await createCaller({ permissions: ['asset:create'], isSystemWide: true });
    const unitOnly = await createCaller({ permissions: ['asset-unit:create'], isSystemWide: true });
    const both = await createCaller({
      permissions: ['asset:create', 'asset-unit:create'],
      isSystemWide: true,
    });

    expect((await post(`/contract-items/${item.id}/assets`, body, assetOnly)).status).toBe(403);
    expect((await post(`/contract-items/${item.id}/assets`, body, unitOnly)).status).toBe(403);
    expect((await post(`/contract-items/${item.id}/assets`, body, both)).status).toBe(201);
  });

  it('guards the sub-lists by the resource they actually return (§1.3)', async () => {
    const contract = await createContract();
    const item = await createItem(contract.id);
    const vendor = await createVendor();

    // `GET /contract-items/:id/asset-units` returns units, so `contract-item:read`
    // alone is not enough.
    const itemReader = await createCaller({
      permissions: ['contract-item:read'],
      isSystemWide: true,
    });
    expect((await get(`/contract-items/${item.id}/asset-units`, itemReader)).status).toBe(403);

    const unitReader = await createCaller({
      permissions: ['contract-item:read', 'asset-unit:read'],
      isSystemWide: true,
    });
    expect((await get(`/contract-items/${item.id}/asset-units`, unitReader)).status).toBe(200);

    // `GET /vendors/:id/assets` returns assets, so it needs `asset:read`.
    const vendorReader = await createCaller({ permissions: ['vendor:read'], isSystemWide: true });
    expect((await get(`/vendors/${vendor.id}/assets`, vendorReader)).status).toBe(403);
  });
});
