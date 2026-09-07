import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  models,
  createCaller,
  createAdminCaller,
  resetOperationsData,
  resetAssetCoreData,
  resetProcurementData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

/**
 * Operations API — `IMPLEMENTATION_PLAN.md` §13; `06-api.md` §7.2, §7.3.
 *
 * Covers the borrowing lifecycle and the unit lifecycle it drives, transaction
 * records and their immutability, and unit-level operational history.
 */

const V1 = '/api/v1';
const LEAF = '117010101001'; // Aspal — a real leaf classification
const LEAF_2 = '117010101002'; // Semen

let admin;
let institution;
let location;

function request(method, path, caller = admin) {
  return api()
    [method](`${V1}${path}`)
    .set(...caller.auth);
}

const get = (path, caller = admin) => request('get', path, caller);
const post = (path, body, caller = admin) => request('post', path, caller).send(body);
const patch = (path, body, caller = admin) => request('patch', path, caller).send(body);
const del = (path, caller = admin) => request('delete', path, caller);

const isoDate = (offsetDays = 0) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

/** A unit that is ACTIVE, and therefore eligible to be borrowed (§7.1). */
async function createActiveUnit() {
  const asset = (
    await post('/assets', {
      name: 'Borrowable Asset',
      classificationId: LEAF,
      institutionId: institution.id,
    })
  ).body.data;

  const unit = (await post(`/assets/${asset.id}/units`, {})).body.data;

  await post(`/asset-units/${unit.id}/history`, {
    condition: 'GOOD',
    locationId: location.id,
    lifecycleState: 'ACTIVE',
    description: 'Commissioned',
  });

  return unit;
}

async function createBorrowing(overrides = {}, caller = admin) {
  const response = await post(
    '/borrowings',
    {
      borrowerName: 'Budi Santoso',
      borrowerContact: '0812-3456-7890',
      borrowDate: isoDate(0),
      expectedReturnDate: isoDate(7),
      institutionId: institution.id,
      ...overrides,
    },
    caller
  );
  return response.body.data;
}

/** A DRAFT borrowing already holding one ACTIVE unit. */
async function draftWithUnit(overrides = {}) {
  const borrowing = await createBorrowing(overrides);
  const unit = await createActiveUnit();
  await post(`/borrowings/${borrowing.id}/items`, { assetUnitId: unit.id });
  return { borrowing, unit };
}

async function activeBorrowing(overrides = {}) {
  const { borrowing, unit } = await draftWithUnit(overrides);
  const activated = (await post(`/borrowings/${borrowing.id}/activate`)).body.data;
  return { borrowing: activated, unit };
}

const unitState = async (id) => (await get(`/asset-units/${id}`)).body.data.lifecycleState;

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();

  admin = await createAdminCaller();
  institution = await models.Institution.create({
    name: 'Operations Institution',
    code: `OPS-${Math.random().toString(36).slice(2, 7)}`,
    address: 'Somewhere',
  });
  location = (
    await post('/locations', {
      name: 'Gudang',
      classificationId: LEAF_2,
      institutionId: institution.id,
    })
  ).body.data;
});

afterAll(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
});

describe('borrowing creation and editing (§7.2, REQ-BORROW-001–006)', () => {
  it('creates a DRAFT with borrower, dates and institution', async () => {
    const borrowing = await createBorrowing({ description: 'Kegiatan lapangan' });

    expect(borrowing.status).toBe('DRAFT');
    expect(borrowing.borrowerName).toBe('Budi Santoso');
    expect(borrowing.borrowerContact).toBe('0812-3456-7890');
    expect(borrowing.actualReturnDate).toBeNull();
    expect(borrowing.institution.id).toBe(institution.id);
  });

  it('requires a borrower name and contact (REQ-BORROW-002)', async () => {
    expect(
      (
        await post('/borrowings', {
          borrowerName: '  ',
          borrowerContact: 'x',
          borrowDate: isoDate(0),
          expectedReturnDate: isoDate(1),
          institutionId: institution.id,
        })
      ).status
    ).toBe(400);

    expect(
      (
        await post('/borrowings', {
          borrowerName: 'Budi',
          borrowDate: isoDate(0),
          expectedReturnDate: isoDate(1),
          institutionId: institution.id,
        })
      ).status
    ).toBe(400);
  });

  it('rejects an expected return before the borrow date (REQ-BORROW-005)', async () => {
    const response = await post('/borrowings', {
      borrowerName: 'Budi',
      borrowerContact: '0812',
      borrowDate: isoDate(5),
      expectedReturnDate: isoDate(1),
      institutionId: institution.id,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('expectedReturnDate must be on or after borrowDate');
    expect(response.body.error.details[0].field).toBe('expectedReturnDate');
  });

  it('rejects a responsible person who does not exist (REQ-BORROW-003)', async () => {
    const response = await post('/borrowings', {
      borrowerName: 'Budi',
      borrowerContact: '0812',
      borrowDate: isoDate(0),
      expectedReturnDate: isoDate(1),
      institutionId: institution.id,
      responsiblePersonId: '00000000-0000-4000-8000-000000000000',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('responsiblePersonId');
  });

  it('accepts a responsible person who exists', async () => {
    const borrowing = await createBorrowing({ responsiblePersonId: admin.user.id });

    expect(borrowing.responsiblePerson.id).toBe(admin.user.id);
  });

  it('edits while DRAFT and refuses once ACTIVE (§7.2, DR-011)', async () => {
    const { borrowing } = await draftWithUnit();

    const edited = await patch(`/borrowings/${borrowing.id}`, { borrowerName: 'Siti' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.borrowerName).toBe('Siti');

    await post(`/borrowings/${borrowing.id}/activate`);

    const rejected = await patch(`/borrowings/${borrowing.id}`, { borrowerName: 'Andi' });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('CONFLICT');
  });

  it('re-checks the date rule against stored values on update', async () => {
    const borrowing = await createBorrowing({
      borrowDate: isoDate(0),
      expectedReturnDate: isoDate(10),
    });

    const response = await patch(`/borrowings/${borrowing.id}`, {
      expectedReturnDate: isoDate(-2),
    });

    expect(response.status).toBe(400);
  });
});

describe('borrowing items (§7.2, REQ-BORROW-006/008, BR-003)', () => {
  it('adds and lists units, then removes one while DRAFT', async () => {
    const { borrowing, unit } = await draftWithUnit();

    const list = await get(`/borrowings/${borrowing.id}/items`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].assetUnitId).toBe(unit.id);
    expect(list.body.data[0].assetUnit.id).toBe(unit.id);

    const removed = await del(`/borrowings/${borrowing.id}/items/${list.body.data[0].id}`);
    expect(removed.status).toBe(204);
    expect((await get(`/borrowings/${borrowing.id}/items`)).body.data).toHaveLength(0);
  });

  it('refuses the same unit twice on one borrowing', async () => {
    const { borrowing, unit } = await draftWithUnit();

    const response = await post(`/borrowings/${borrowing.id}/items`, { assetUnitId: unit.id });

    expect(response.status).toBe(409);
  });

  it('refuses a unit already out on an ACTIVE borrowing (BR-003)', async () => {
    const { unit } = await activeBorrowing();
    const other = await createBorrowing();

    const response = await post(`/borrowings/${other.id}/items`, { assetUnitId: unit.id });

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toMatch(/BR-003/);
  });

  it('allows the same unit on two DRAFTs, and lets only the first activate', async () => {
    const { borrowing: first, unit } = await draftWithUnit();
    const second = await createBorrowing();

    // Legal: nothing is committed until one of them activates.
    expect((await post(`/borrowings/${second.id}/items`, { assetUnitId: unit.id })).status).toBe(
      201
    );

    expect((await post(`/borrowings/${first.id}/activate`)).status).toBe(200);

    const race = await post(`/borrowings/${second.id}/activate`);
    expect(race.status).toBe(409);
    expect(await unitState(unit.id)).toBe('BORROWED');
  });

  it('refuses to add or remove items once ACTIVE', async () => {
    const { borrowing } = await activeBorrowing();
    const extra = await createActiveUnit();
    const itemId = (await get(`/borrowings/${borrowing.id}/items`)).body.data[0].id;

    expect(
      (await post(`/borrowings/${borrowing.id}/items`, { assetUnitId: extra.id })).status
    ).toBe(409);
    expect((await del(`/borrowings/${borrowing.id}/items/${itemId}`)).status).toBe(409);
  });

  it('answers 404 for an item that belongs to another borrowing', async () => {
    const { borrowing } = await draftWithUnit();
    const other = await draftWithUnit();
    const foreignItem = (await get(`/borrowings/${other.borrowing.id}/items`)).body.data[0];

    const response = await del(`/borrowings/${borrowing.id}/items/${foreignItem.id}`);

    expect(response.status).toBe(404);
  });
});

describe('borrowing state transitions (§7.2, 03-domain.md §7.2)', () => {
  it('activates DRAFT → ACTIVE and moves each unit to BORROWED', async () => {
    const { borrowing, unit } = await draftWithUnit();

    expect(await unitState(unit.id)).toBe('ACTIVE');

    const response = await post(`/borrowings/${borrowing.id}/activate`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ACTIVE');
    expect(await unitState(unit.id)).toBe('BORROWED');
  });

  it('records the lifecycle change in the unit’s longitudinal history (REQ-LIFE-003)', async () => {
    const { unit } = await activeBorrowing();

    const history = await get(`/asset-units/${unit.id}/history`);

    expect(history.body.data[0].lifecycleState).toBe('BORROWED');
    expect(history.body.data[0].effectiveTo).toBeNull();
    // The superseded snapshot was closed rather than overwritten.
    expect(history.body.data[1].lifecycleState).toBe('ACTIVE');
    expect(history.body.data[1].effectiveTo).not.toBeNull();
    // Condition and location carried forward untouched (REQ-LIFE-004).
    expect(history.body.data[0].condition).toBe('GOOD');
    expect(history.body.data[0].locationId).toBe(location.id);
  });

  /**
   * Provenance — `CR-012` `DEC-A`, REQ-COND-006, TC-COND-006.
   *
   * Lending an item out is not an assessment of its condition. If activation
   * wrote `MANUAL`, a department could satisfy its monthly obligation by
   * borrowing its own equipment.
   */
  it('classifies the activation entry as BORROWING, not MANUAL (CR-012)', async () => {
    const { unit } = await activeBorrowing();

    const history = await get(`/asset-units/${unit.id}/history`);

    expect(history.body.data[0].entryType).toBe('BORROWING');
    // The manual entry that set the unit up is untouched and still MANUAL.
    expect(history.body.data.at(-1).entryType).toBe('MANUAL');
  });

  it('refuses to activate a borrowing with no items (REQ-BORROW-006)', async () => {
    const borrowing = await createBorrowing();

    const response = await post(`/borrowings/${borrowing.id}/activate`);

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].field).toBe('items');
  });

  it('refuses to activate when a unit is not ACTIVE (REQ-LIFE-002)', async () => {
    const borrowing = await createBorrowing();
    const asset = (
      await post('/assets', {
        name: 'Fresh Asset',
        classificationId: LEAF,
        institutionId: institution.id,
      })
    ).body.data;
    // Still REGISTERED — the state machine has no REGISTERED → BORROWED edge.
    const unit = (await post(`/assets/${asset.id}/units`, {})).body.data;
    await post(`/borrowings/${borrowing.id}/items`, { assetUnitId: unit.id });

    const response = await post(`/borrowings/${borrowing.id}/activate`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(await unitState(unit.id)).toBe('REGISTERED');
    expect((await get(`/borrowings/${borrowing.id}`)).body.data.status).toBe('DRAFT');
  });

  it('rolls back the whole activation when one unit cannot be borrowed', async () => {
    const borrowing = await createBorrowing();
    const good = await createActiveUnit();
    const asset = (
      await post('/assets', {
        name: 'Fresh Asset',
        classificationId: LEAF,
        institutionId: institution.id,
      })
    ).body.data;
    const bad = (await post(`/assets/${asset.id}/units`, {})).body.data;

    await post(`/borrowings/${borrowing.id}/items`, { assetUnitId: good.id });
    await post(`/borrowings/${borrowing.id}/items`, { assetUnitId: bad.id });

    expect((await post(`/borrowings/${borrowing.id}/activate`)).status).toBe(409);

    // The unit that could have been borrowed was not left BORROWED.
    expect(await unitState(good.id)).toBe('ACTIVE');
    expect(await models.LongitudinalHistory.count({ where: { assetUnitId: good.id } })).toBe(1);
  });

  it('cancels DRAFT → CANCELLED without touching the units', async () => {
    const { borrowing, unit } = await draftWithUnit();

    const response = await post(`/borrowings/${borrowing.id}/cancel`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('CANCELLED');
    expect(await unitState(unit.id)).toBe('ACTIVE');
  });

  it('refuses to cancel or activate a terminal borrowing', async () => {
    const { borrowing } = await activeBorrowing();
    await post(`/borrowings/${borrowing.id}/return`, {});

    expect((await post(`/borrowings/${borrowing.id}/cancel`)).status).toBe(409);
    expect((await post(`/borrowings/${borrowing.id}/activate`)).status).toBe(409);
  });

  it('refuses to return a DRAFT', async () => {
    const { borrowing } = await draftWithUnit();

    const response = await post(`/borrowings/${borrowing.id}/return`, {});

    expect(response.status).toBe(409);
    expect(response.body.error.details[0].issue).toMatch(/ACTIVE, CANCELLED/);
  });
});

describe('borrowing return (§7.2, REQ-BORROW-009/010/011)', () => {
  it('returns the whole event, sets the date and frees the units', async () => {
    const { borrowing, unit } = await activeBorrowing();

    const response = await post(`/borrowings/${borrowing.id}/return`, {});

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('RETURNED');
    expect(response.body.data.actualReturnDate).toBe(isoDate(0));
    expect(await unitState(unit.id)).toBe('ACTIVE');
  });

  /**
   * `BORROWING` even when the returner supplied their own note — `CR-012`
   * `DEC-C`.
   *
   * This is the case `CR-011` `DEC-E` had to solve with a regex, and the reason
   * the two predicates stay separate: the note IS a human observation and still
   * reaches the `PERAWATAN` sheet, but a return is not the monthly assessment
   * REQ-COND-006 asks for. Classifying by "did someone type something" would
   * make the obligation satisfiable by returning an item.
   */
  it('classifies a return as BORROWING even with a human note (CR-012 DEC-C)', async () => {
    const { borrowing, unit } = await activeBorrowing();

    await post(`/borrowings/${borrowing.id}/return`, {
      description: 'Casing cracked while out on loan',
    });

    const history = await get(`/asset-units/${unit.id}/history`);

    expect(history.body.data[0].description).toBe('Casing cracked while out on loan');
    expect(history.body.data[0].entryType).toBe('BORROWING');
  });

  it('accepts an explicit return date and rejects one before the borrow date', async () => {
    const { borrowing } = await activeBorrowing({
      borrowDate: isoDate(-5),
      expectedReturnDate: isoDate(5),
    });

    const early = await post(`/borrowings/${borrowing.id}/return`, {
      actualReturnDate: isoDate(-9),
    });
    expect(early.status).toBe(400);
    expect(early.body.error.details[0].field).toBe('actualReturnDate');

    const ok = await post(`/borrowings/${borrowing.id}/return`, { actualReturnDate: isoDate(-1) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.actualReturnDate).toBe(isoDate(-1));
  });

  it('frees the unit for another borrowing once returned', async () => {
    const { borrowing, unit } = await activeBorrowing();
    await post(`/borrowings/${borrowing.id}/return`, {});

    const next = await createBorrowing();

    expect((await post(`/borrowings/${next.id}/items`, { assetUnitId: unit.id })).status).toBe(201);
    expect((await post(`/borrowings/${next.id}/activate`)).status).toBe(200);
  });

  it('preserves the original dates of a completed record (REQ-BORROW-015)', async () => {
    const { borrowing } = await activeBorrowing({
      borrowDate: isoDate(-10),
      expectedReturnDate: isoDate(-3),
    });

    const returned = (await post(`/borrowings/${borrowing.id}/return`, {})).body.data;

    expect(returned.borrowDate).toBe(isoDate(-10));
    expect(returned.expectedReturnDate).toBe(isoDate(-3));
    // And it can no longer be edited into something else.
    expect((await patch(`/borrowings/${borrowing.id}`, { borrowDate: isoDate(0) })).status).toBe(
      409
    );
  });

  it('still closes when a unit left BORROWED by another route', async () => {
    const { borrowing, unit } = await activeBorrowing();

    // Recorded out-of-band: BORROWED → ACTIVE through the history endpoint.
    await post(`/asset-units/${unit.id}/history`, {
      lifecycleState: 'ACTIVE',
      description: 'Recovered directly',
    });

    const response = await post(`/borrowings/${borrowing.id}/return`, {});

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('RETURNED');
  });
});

describe('borrowing extension (§7.2, REQ-BORROW-014, DR-012)', () => {
  it('returns the current record and opens a new DRAFT over the same units', async () => {
    const { borrowing, unit } = await activeBorrowing({
      borrowDate: isoDate(-7),
      expectedReturnDate: isoDate(0),
    });

    const response = await post(`/borrowings/${borrowing.id}/extend`, {
      expectedReturnDate: isoDate(14),
    });

    expect(response.status).toBe(201);
    const { returned, borrowing: next } = response.body.data;

    expect(returned.status).toBe('RETURNED');
    expect(returned.borrowDate).toBe(isoDate(-7));
    expect(returned.expectedReturnDate).toBe(isoDate(0));
    expect(returned.actualReturnDate).toBe(isoDate(0));

    expect(next.status).toBe('DRAFT');
    expect(next.id).not.toBe(borrowing.id);
    expect(next.borrowDate).toBe(isoDate(0));
    expect(next.expectedReturnDate).toBe(isoDate(14));
    expect(next.borrowerName).toBe(returned.borrowerName);
    expect(next.institutionId).toBe(institution.id);

    const items = await get(`/borrowings/${next.id}/items`);
    expect(items.body.data.map((item) => item.assetUnitId)).toEqual([unit.id]);
  });

  it('never silently alters the original record (REQ-BORROW-014)', async () => {
    const { borrowing } = await activeBorrowing({
      borrowDate: isoDate(-7),
      expectedReturnDate: isoDate(0),
    });

    await post(`/borrowings/${borrowing.id}/extend`, { expectedReturnDate: isoDate(14) });

    const original = (await get(`/borrowings/${borrowing.id}`)).body.data;
    expect(original.expectedReturnDate).toBe(isoDate(0));
    expect(original.status).toBe('RETURNED');
  });

  it('leaves the unit free until the new borrowing is activated', async () => {
    const { borrowing, unit } = await activeBorrowing();

    const next = (
      await post(`/borrowings/${borrowing.id}/extend`, { expectedReturnDate: isoDate(14) })
    ).body.data.borrowing;

    expect(await unitState(unit.id)).toBe('ACTIVE');

    expect((await post(`/borrowings/${next.id}/activate`)).status).toBe(200);
    expect(await unitState(unit.id)).toBe('BORROWED');
  });

  it('rejects a new expected return before the extension takes effect', async () => {
    const { borrowing } = await activeBorrowing({
      borrowDate: isoDate(-7),
      expectedReturnDate: isoDate(0),
    });

    const response = await post(`/borrowings/${borrowing.id}/extend`, {
      expectedReturnDate: isoDate(-3),
    });

    expect(response.status).toBe(400);
  });

  it('refuses to extend a DRAFT or a completed borrowing', async () => {
    const { borrowing: draft } = await draftWithUnit();
    expect(
      (await post(`/borrowings/${draft.id}/extend`, { expectedReturnDate: isoDate(14) })).status
    ).toBe(409);

    const { borrowing: done } = await activeBorrowing();
    await post(`/borrowings/${done.id}/return`, {});
    expect(
      (await post(`/borrowings/${done.id}/extend`, { expectedReturnDate: isoDate(14) })).status
    ).toBe(409);
  });
});

describe('borrowing list and overdue (§7.2, REQ-BORROW-012, REQ-REPORT-007)', () => {
  it('filters by status', async () => {
    await createBorrowing();
    const { borrowing } = await activeBorrowing();

    const drafts = await get('/borrowings?status=DRAFT');
    expect(drafts.body.data.every((b) => b.status === 'DRAFT')).toBe(true);

    const actives = await get('/borrowings?status=ACTIVE');
    expect(actives.body.data.map((b) => b.id)).toEqual([borrowing.id]);
  });

  it('identifies overdue borrowings before the Phase 8 sweep has run', async () => {
    const { borrowing: late } = await activeBorrowing({
      borrowDate: isoDate(-20),
      expectedReturnDate: isoDate(-2),
    });
    await activeBorrowing({ borrowDate: isoDate(-1), expectedReturnDate: isoDate(30) });

    const response = await get('/borrowings?overdue=true');

    expect(response.body.data.map((b) => b.id)).toEqual([late.id]);
    // Status is still ACTIVE: writing OVERDUE is the scheduled job's job (§14.3).
    expect(response.body.data[0].status).toBe('ACTIVE');
  });

  it('excludes returned and draft records from the overdue filter', async () => {
    const { borrowing } = await activeBorrowing({
      borrowDate: isoDate(-20),
      expectedReturnDate: isoDate(-2),
    });
    await post(`/borrowings/${borrowing.id}/return`, {});
    await createBorrowing({ borrowDate: isoDate(-20), expectedReturnDate: isoDate(-2) });

    expect((await get('/borrowings?overdue=true')).body.data).toHaveLength(0);
  });

  it('paginates and filters by institution', async () => {
    await createBorrowing();
    await createBorrowing();

    const response = await get(`/borrowings?institutionId=${institution.id}&pageSize=1`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(2);
    expect(response.body.meta.totalPages).toBe(2);
  });
});

describe('transactions (§7.3, REQ-TXN-001–010)', () => {
  let transactionType;

  beforeEach(async () => {
    transactionType = await models.TransactionType.create({ name: 'Penghapusan' });
  });

  it('creates a transaction with its items in one call', async () => {
    const unit = await createActiveUnit();

    const response = await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: transactionType.id,
      description: 'Penghapusan aset rusak',
      institutionId: institution.id,
      items: [{ assetUnitId: unit.id, notes: 'Rusak berat' }],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.transactionType.name).toBe('Penghapusan');
    expect(response.body.data.supplierId).toBeNull();
    expect(response.body.data.contractId).toBeNull();

    const items = await get(`/transactions/${response.body.data.id}/items`);
    expect(items.body.data).toHaveLength(1);
    expect(items.body.data[0].assetUnitId).toBe(unit.id);
    expect(items.body.data[0].notes).toBe('Rusak berat');
    expect(items.body.data[0].assetUnit.id).toBe(unit.id);
  });

  it('needs no procurement record (REQ-TXN-008)', async () => {
    const unit = await createActiveUnit();

    const response = await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: transactionType.id,
      institutionId: institution.id,
      items: [{ assetUnitId: unit.id }],
    });

    expect(response.status).toBe(201);
  });

  it('links to a supplier and contract when procurement-originated (REQ-TXN-009)', async () => {
    const unit = await createActiveUnit();
    const supplier = (await post('/suppliers', { name: 'PT Sumber' })).body.data;
    const contract = (
      await post('/contracts', {
        contractNumber: `CTR-TXN-${Math.random().toString(36).slice(2, 7)}`,
        contractDate: isoDate(-30),
        institutionId: institution.id,
      })
    ).body.data;

    const response = await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: transactionType.id,
      institutionId: institution.id,
      supplierId: supplier.id,
      contractId: contract.id,
      items: [{ assetUnitId: unit.id }],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.supplier.name).toBe('PT Sumber');
    expect(response.body.data.contract.contractNumber).toBe(contract.contractNumber);
  });

  it('requires a transaction type that exists (REQ-TXN-002)', async () => {
    const unit = await createActiveUnit();

    const missing = await post('/transactions', {
      transactionDate: isoDate(0),
      institutionId: institution.id,
      items: [{ assetUnitId: unit.id }],
    });
    expect(missing.status).toBe(400);

    const unknown = await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: 999999,
      institutionId: institution.id,
      items: [{ assetUnitId: unit.id }],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details[0].field).toBe('transactionTypeId');
  });

  it('requires at least one asset unit, each of which must exist (REQ-TXN-004)', async () => {
    const empty = await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: transactionType.id,
      institutionId: institution.id,
      items: [],
    });
    expect(empty.status).toBe(400);

    const unknown = await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: transactionType.id,
      institutionId: institution.id,
      items: [{ assetUnitId: '00000000-0000-4000-8000-000000000000' }],
    });
    expect(unknown.status).toBe(404);
  });

  it('refuses the same unit twice on one transaction', async () => {
    const unit = await createActiveUnit();

    const response = await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: transactionType.id,
      institutionId: institution.id,
      items: [{ assetUnitId: unit.id }, { assetUnitId: unit.id }],
    });

    expect(response.status).toBe(400);
  });

  it('writes nothing when item creation fails (§35)', async () => {
    const before = await models.Transaction.count();

    await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: transactionType.id,
      institutionId: institution.id,
      items: [{ assetUnitId: '00000000-0000-4000-8000-000000000000' }],
    });

    expect(await models.Transaction.count()).toBe(before);
    expect(await models.TransactionItem.count()).toBe(0);
  });

  it('exposes no way to modify or delete a record (REQ-TXN-007, DR-013)', async () => {
    const unit = await createActiveUnit();
    const txn = (
      await post('/transactions', {
        transactionDate: isoDate(0),
        transactionTypeId: transactionType.id,
        institutionId: institution.id,
        items: [{ assetUnitId: unit.id }],
      })
    ).body.data;

    expect((await patch(`/transactions/${txn.id}`, { description: 'edited' })).status).toBe(404);
    expect((await del(`/transactions/${txn.id}`)).status).toBe(404);
  });

  it('filters by type, contract and date range', async () => {
    const unit = await createActiveUnit();
    const other = await models.TransactionType.create({ name: 'Mutasi' });

    await post('/transactions', {
      transactionDate: isoDate(-10),
      transactionTypeId: transactionType.id,
      institutionId: institution.id,
      items: [{ assetUnitId: unit.id }],
    });
    await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: other.id,
      institutionId: institution.id,
      items: [{ assetUnitId: unit.id }],
    });

    expect((await get(`/transactions?transactionTypeId=${other.id}`)).body.data).toHaveLength(1);
    expect((await get(`/transactions?dateFrom=${isoDate(-5)}`)).body.data).toHaveLength(1);
    expect((await get(`/transactions?dateTo=${isoDate(-5)}`)).body.data).toHaveLength(1);
    expect(
      (await get(`/transactions?dateFrom=${isoDate(-30)}&dateTo=${isoDate(1)}`)).body.data
    ).toHaveLength(2);
  });
});

describe('unit-level operational history (§5.2, REQ-BORROW-013, REQ-TXN-006/010)', () => {
  it('lists the borrowings a unit has been on', async () => {
    const { borrowing, unit } = await activeBorrowing();
    await post(`/borrowings/${borrowing.id}/return`, {});

    const next = await createBorrowing({ borrowerName: 'Siti' });
    await post(`/borrowings/${next.id}/items`, { assetUnitId: unit.id });

    const response = await get(`/asset-units/${unit.id}/borrowings`);

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(2);
    expect(response.body.data.map((b) => b.id).sort()).toEqual([borrowing.id, next.id].sort());
  });

  it('does not list borrowings of a different unit', async () => {
    const { unit } = await activeBorrowing();
    const untouched = await createActiveUnit();

    expect((await get(`/asset-units/${untouched.id}/borrowings`)).body.data).toHaveLength(0);
    expect((await get(`/asset-units/${unit.id}/borrowings`)).body.data).toHaveLength(1);
  });

  it('lists the transactions a unit has been part of', async () => {
    const transactionType = await models.TransactionType.create({ name: 'Mutasi' });
    const unit = await createActiveUnit();
    const other = await createActiveUnit();

    await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: transactionType.id,
      institutionId: institution.id,
      items: [{ assetUnitId: unit.id }],
    });

    expect((await get(`/asset-units/${unit.id}/transactions`)).body.data).toHaveLength(1);
    expect((await get(`/asset-units/${other.id}/transactions`)).body.data).toHaveLength(0);
  });

  it('keeps history attached after the unit is deactivated (REQ-LIFE-006)', async () => {
    const { borrowing, unit } = await activeBorrowing();
    await post(`/borrowings/${borrowing.id}/return`, {});
    await post(`/asset-units/${unit.id}/deactivate`);

    const response = await get(`/asset-units/${unit.id}/borrowings`);

    expect(response.body.data).toHaveLength(1);
  });
});

describe('organization scope (BR-007, REQ-AUTHZ-004/005)', () => {
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
        'borrowing:read',
        'borrowing:create',
        'borrowing:update',
        'transaction:read',
        'transaction:create',
      ],
      institutionId: institution.id,
    });
  });

  it('hides another institution’s borrowings', async () => {
    await createBorrowing({ borrowerName: 'Mine', institutionId: institution.id });
    await createBorrowing({ borrowerName: 'Theirs', institutionId: otherInstitution.id });

    const response = await get('/borrowings', scoped);

    expect(response.body.data.map((b) => b.borrowerName)).toEqual(['Mine']);
  });

  it('answers 404, not 403, for an out-of-scope borrowing (§1.4)', async () => {
    const theirs = await createBorrowing({ institutionId: otherInstitution.id });

    const response = await get(`/borrowings/${theirs.id}`, scoped);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('defaults a new borrowing to the caller’s own institution', async () => {
    const response = await post(
      '/borrowings',
      {
        borrowerName: 'Budi',
        borrowerContact: '0812',
        borrowDate: isoDate(0),
        expectedReturnDate: isoDate(3),
      },
      scoped
    );

    expect(response.status).toBe(201);
    expect(response.body.data.institutionId).toBe(institution.id);
  });

  it('refuses to create into another institution', async () => {
    const response = await post(
      '/borrowings',
      {
        borrowerName: 'Budi',
        borrowerContact: '0812',
        borrowDate: isoDate(0),
        expectedReturnDate: isoDate(3),
        institutionId: otherInstitution.id,
      },
      scoped
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].issue).toMatch(/BR-007/);
  });

  it('requires a system-wide caller to name an institution', async () => {
    const response = await post('/borrowings', {
      borrowerName: 'Budi',
      borrowerContact: '0812',
      borrowDate: isoDate(0),
      expectedReturnDate: isoDate(3),
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('institutionId');
  });

  it('hides another institution’s transactions', async () => {
    const transactionType = await models.TransactionType.create({ name: 'Mutasi' });
    const unit = await createActiveUnit();

    await post('/transactions', {
      transactionDate: isoDate(0),
      transactionTypeId: transactionType.id,
      institutionId: otherInstitution.id,
      items: [{ assetUnitId: unit.id }],
    });

    expect((await get('/transactions', scoped)).body.data).toHaveLength(0);
    expect((await get('/transactions')).body.data).toHaveLength(1);
  });
});

describe('authorization (§1.3, REQ-AUTHZ-002/003)', () => {
  it('rejects the operations endpoints without a token', async () => {
    for (const path of ['/borrowings', '/transactions']) {
      const response = await api().get(`${V1}${path}`);
      expect(response.status, path).toBe(401);
    }
  });

  it('guards each state transition with its own permission', async () => {
    const { borrowing } = await draftWithUnit();

    const reader = await createCaller({
      permissions: ['borrowing:read', 'borrowing-item:read'],
      isSystemWide: true,
    });

    expect((await get(`/borrowings/${borrowing.id}`, reader)).status).toBe(200);
    expect((await post(`/borrowings/${borrowing.id}/activate`, {}, reader)).status).toBe(403);
    expect((await post(`/borrowings/${borrowing.id}/cancel`, {}, reader)).status).toBe(403);
    expect((await post(`/borrowings/${borrowing.id}/return`, {}, reader)).status).toBe(403);
    expect(
      (await post(`/borrowings/${borrowing.id}/extend`, { expectedReturnDate: isoDate(9) }, reader))
        .status
    ).toBe(403);
  });

  it('does not let borrowing:activate stand in for borrowing:return', async () => {
    const { borrowing } = await draftWithUnit();

    const activator = await createCaller({
      permissions: ['borrowing:read', 'borrowing:activate'],
      isSystemWide: true,
    });

    expect((await post(`/borrowings/${borrowing.id}/activate`, {}, activator)).status).toBe(200);
    expect((await post(`/borrowings/${borrowing.id}/return`, {}, activator)).status).toBe(403);
  });

  it('guards items and transactions by their own resource', async () => {
    const { borrowing } = await draftWithUnit();
    const unit = await createActiveUnit();
    const transactionType = await models.TransactionType.create({ name: 'Mutasi' });

    const reader = await createCaller({
      permissions: ['borrowing:read', 'transaction:read'],
      isSystemWide: true,
    });

    expect((await get(`/borrowings/${borrowing.id}/items`, reader)).status).toBe(403);
    expect(
      (await post(`/borrowings/${borrowing.id}/items`, { assetUnitId: unit.id }, reader)).status
    ).toBe(403);
    expect(
      (
        await post(
          '/transactions',
          {
            transactionDate: isoDate(0),
            transactionTypeId: transactionType.id,
            institutionId: institution.id,
            items: [{ assetUnitId: unit.id }],
          },
          reader
        )
      ).status
    ).toBe(403);
  });

  it('guards the unit sub-lists by the resource they return (§1.3)', async () => {
    const unit = await createActiveUnit();

    const unitReader = await createCaller({ permissions: ['asset-unit:read'], isSystemWide: true });
    expect((await get(`/asset-units/${unit.id}/borrowings`, unitReader)).status).toBe(403);
    expect((await get(`/asset-units/${unit.id}/transactions`, unitReader)).status).toBe(403);

    const opsReader = await createCaller({
      permissions: ['asset-unit:read', 'borrowing:read', 'transaction:read'],
      isSystemWide: true,
    });
    expect((await get(`/asset-units/${unit.id}/borrowings`, opsReader)).status).toBe(200);
    expect((await get(`/asset-units/${unit.id}/transactions`, opsReader)).status).toBe(200);
  });
});
