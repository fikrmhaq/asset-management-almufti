'use strict';

/**
 * Borrowing use cases — `IMPLEMENTATION_PLAN.md` §13.1, §13.2; `06-api.md` §7.2;
 * REQ-BORROW-001–015, `BR-003`, `BR-004`, `DR-005`, `DR-006`, `DR-011`,
 * `DR-012`, `DR-018`.
 *
 * A Borrowing is an EVENT, and it is returned as one whole event
 * (REQ-BORROW-011): its items carry no status of their own. Status changes are
 * action endpoints rather than field edits, because each one also moves the
 * physical units it holds:
 *
 *   activate  DRAFT → ACTIVE        each unit  ACTIVE   → BORROWED
 *   return    ACTIVE/OVERDUE → RETURNED  each unit  BORROWED → ACTIVE
 *   cancel    DRAFT → CANCELLED     units untouched — a DRAFT never held them
 *
 * Both sides of that are written in ONE transaction, so a unit is never left
 * marked BORROWED by a borrowing that failed to activate (REQ-NFR-REL-001).
 */

const { Op } = require('sequelize');

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { containsAny, equals } = require('../../query/filtering');
const {
  HOLDING_STATUSES,
  assertTransition,
  assertEditable,
} = require('../../domain/borrowingLifecycle');
const { assertTransition: assertUnitTransition } = require('../../domain/lifecycle');
const {
  scopeFilter,
  assertCanAccess,
  assertCanAssignInstitution,
  defaultInstitutionFor,
  unitCoverageFilter,
  assertCanAccessByUnits,
  BORROWING_COVERAGE,
} = require('../../domain/scope');
const unitService = require('../assetUnits/service');

const SORTABLE = ['borrowDate', 'expectedReturnDate', 'status', 'createdAt', 'updatedAt'];

/** Today as `YYYY-MM-DD`, matching how a SQL `DATE` is exchanged. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Filters — `06-api.md` §7.2.
 *
 * `overdue=true` is derived rather than read from the status column: it selects
 * borrowings still holding their units past the expected return date. That
 * answers REQ-BORROW-012 correctly whether or not the Phase 8 sweep
 * (`IMPLEMENTATION_PLAN.md` §14.3) has already stamped `status = 'OVERDUE'`.
 */
const FILTERS = {
  status: (value) => equals('status', value),
  institutionId: (value) => equals('institutionId', value),
  q: (value) => containsAny(['borrowerName', 'borrowerContact'], value),
  overdue: (value) => {
    if (value !== 'true') return undefined;
    return {
      status: { [Op.in]: HOLDING_STATUSES },
      expectedReturnDate: { [Op.lt]: today() },
    };
  },
};

function serialize(borrowing) {
  return {
    id: borrowing.id,
    borrowerName: borrowing.borrowerName,
    borrowerContact: borrowing.borrowerContact,
    borrowDate: borrowing.borrowDate,
    expectedReturnDate: borrowing.expectedReturnDate,
    actualReturnDate: borrowing.actualReturnDate ?? null,
    responsiblePersonId: borrowing.responsiblePersonId ?? null,
    institutionId: borrowing.institutionId,
    description: borrowing.description ?? null,
    status: borrowing.status,
    createdBy: borrowing.createdBy ?? null,
    updatedBy: borrowing.updatedBy ?? null,
    createdAt: borrowing.createdAt,
    updatedAt: borrowing.updatedAt,
    // Present only when the caller asked for detail.
    institution: borrowing.institution
      ? {
          id: borrowing.institution.id,
          name: borrowing.institution.name,
          code: borrowing.institution.code,
        }
      : undefined,
    responsiblePerson: borrowing.responsiblePerson
      ? {
          id: borrowing.responsiblePerson.id,
          username: borrowing.responsiblePerson.username,
          firstName: borrowing.responsiblePerson.firstName,
          lastName: borrowing.responsiblePerson.lastName,
        }
      : undefined,
  };
}

function serializeItem(item) {
  return {
    id: item.id,
    borrowingId: item.borrowingId,
    assetUnitId: item.assetUnitId,
    createdAt: item.createdAt,
    assetUnit: item.assetUnit ? unitService.serialize(item.assetUnit) : undefined,
  };
}

async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['borrowDate', 'DESC']],
  });

  // Institution scope, then the PIC narrowing — `CR-004` §4.4. The second
  // contributes nothing for the other two tiers.
  options.where = {
    [Op.and]: [options.where, scopeFilter(principal), unitCoverageFilter(principal, BORROWING_COVERAGE)],
  };

  const { rows, pagination } = await paginate(models.Borrowing, options);

  return { rows: rows.map(serialize), pagination };
}

/** @throws {NotFoundError} when absent, or outside the caller's scope (§1.4). */
async function getById(id, principal, { models = getModels(), withRelations = false } = {}) {
  const borrowing = await models.Borrowing.findByPk(id, {
    include: withRelations
      ? [{ association: 'institution' }, { association: 'responsiblePerson' }]
      : undefined,
  });

  assertCanAccess(principal, borrowing, { label: 'Borrowing' });

  /**
   * The unit-coverage narrowing, applied AFTER the institution check —
   * `CR-004` §4. Placing it here covers every record path at once: detail,
   * items, update, add and remove item, cancel, and all three state
   * transitions reach a borrowing through this function.
   *
   * This is what makes `loadUnits`' bypass safe (see below), and what replaced
   * `assertNotPicScoped`.
   */
  return assertCanAccessByUnits(principal, borrowing, BORROWING_COVERAGE, {
    label: 'Borrowing',
  });
}

const detail = async (id, principal, options = {}) =>
  serialize(await getById(id, principal, { ...options, withRelations: true }));

/**
 * `chk_borrowings_return_after_borrow` also enforces this; checking first
 * produces the message `06-api.md` §1.4 uses as its worked example.
 */
function assertDateOrder({ borrowDate, expectedReturnDate, actualReturnDate }) {
  if (expectedReturnDate && expectedReturnDate < borrowDate) {
    throw new ValidationError('expectedReturnDate must be on or after borrowDate', [
      { field: 'expectedReturnDate', issue: `must be on or after ${borrowDate}` },
    ]);
  }

  if (actualReturnDate && actualReturnDate < borrowDate) {
    throw new ValidationError('actualReturnDate must be on or after borrowDate', [
      { field: 'actualReturnDate', issue: `must be on or after ${borrowDate}` },
    ]);
  }
}

async function assertReferences({ institutionId, responsiblePersonId }, models) {
  if (institutionId) {
    const institution = await models.Institution.findByPk(institutionId);
    if (!institution) {
      throw new ValidationError('The institution does not exist', [
        { field: 'institutionId', issue: 'must reference an existing institution' },
      ]);
    }
  }

  if (responsiblePersonId) {
    const user = await models.User.findByPk(responsiblePersonId);
    if (!user) {
      throw new ValidationError('The responsible person does not exist', [
        { field: 'responsiblePersonId', issue: 'must reference an existing user' },
      ]);
    }
  }
}

async function create(body, principal, { models = getModels() } = {}) {
  const institutionId = defaultInstitutionFor(principal, body.institutionId);

  // `borrowings.institution_id` is NOT NULL, unlike assets and contracts: a
  // borrowing always happens somewhere. A system-wide caller therefore has to
  // name one, since there is no scope to fall back on.
  if (!institutionId) {
    throw new ValidationError('An institution is required', [
      { field: 'institutionId', issue: 'is required when your role is not scoped to one' },
    ]);
  }

  assertCanAssignInstitution(principal, institutionId);
  assertDateOrder(body);
  await assertReferences({ ...body, institutionId }, models);

  const borrowing = await models.Borrowing.create({
    ...body,
    institutionId,
    status: 'DRAFT',
    createdBy: principal.userId,
    updatedBy: principal.userId,
  });

  return detail(borrowing.id, principal, { models });
}

/** Editable while DRAFT only — `06-api.md` §7.2, `DR-011`. */
async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const borrowing = await getById(id, principal, { models });

  assertEditable(borrowing.status);

  if (body.institutionId !== undefined) {
    assertCanAssignInstitution(principal, body.institutionId);
  }

  assertDateOrder({
    borrowDate: body.borrowDate ?? borrowing.borrowDate,
    expectedReturnDate: body.expectedReturnDate ?? borrowing.expectedReturnDate,
  });

  await assertReferences(body, models);

  await borrowing.update({ ...body, updatedBy: principal.userId });

  return detail(id, principal, { models });
}

// --- Items -------------------------------------------------------------------

async function items(id, params, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  const findOptions = toFindOptions(params, {
    filters: {},
    sortable: ['createdAt'],
    defaultSort: [['createdAt', 'ASC']],
  });

  const { rows, pagination } = await paginate(
    models.BorrowingItem,
    { ...findOptions, where: { borrowingId: id } },
    { include: [{ association: 'assetUnit' }] }
  );

  return { rows: rows.map(serializeItem), pagination };
}

/**
 * The unit's availability — `BR-003`, `DR-005`, REQ-BORROW-008.
 *
 * "Incompatible" is read as: some OTHER borrowing is currently holding this
 * unit, i.e. is ACTIVE or OVERDUE. Two DRAFTs may name the same unit — nothing
 * is committed until one of them activates, and activation re-runs this check.
 */
async function findBlockingBorrowing(
  assetUnitId,
  models,
  { excludeBorrowingId, transaction } = {}
) {
  const where = { status: { [Op.in]: HOLDING_STATUSES } };
  if (excludeBorrowingId) where.id = { [Op.ne]: excludeBorrowingId };

  const item = await models.BorrowingItem.findOne({
    where: { assetUnitId },
    include: [{ association: 'borrowing', required: true, where }],
    transaction,
  });

  return item?.borrowing ?? null;
}

async function assertUnitAvailable(assetUnitId, models, options = {}) {
  const blocking = await findBlockingBorrowing(assetUnitId, models, options);

  if (blocking) {
    throw new ConflictError('That asset unit is already out on another borrowing', [
      {
        field: 'assetUnitId',
        issue: `borrowing ${blocking.id} (${blocking.status}) is holding it until ${blocking.expectedReturnDate} (BR-003)`,
      },
    ]);
  }
}

/**
 * Adds a unit — `06-api.md` §7.2, REQ-BORROW-006/008.
 *
 * DRAFT only. `06-api.md` annotates the DELETE as DRAFT-only and is silent on
 * the POST; composition is fixed at activation here, consistent with the header
 * being editable only while DRAFT and with the whole-event model of
 * REQ-BORROW-011 (`DEC-012`).
 */
async function addItem(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const borrowing = await getById(id, principal, { models });

  assertEditable(borrowing.status);

  // Proves the unit exists AND that the caller may reach it (`BR-007`).
  await unitService.getById(body.assetUnitId, principal, { models });

  const existing = await models.BorrowingItem.findOne({
    where: { borrowingId: id, assetUnitId: body.assetUnitId },
  });

  if (existing) {
    throw new ConflictError('That asset unit is already on this borrowing', [
      { field: 'assetUnitId', issue: 'must not appear twice on one borrowing' },
    ]);
  }

  await assertUnitAvailable(body.assetUnitId, models, { excludeBorrowingId: id });

  const item = await models.BorrowingItem.create({
    borrowingId: id,
    assetUnitId: body.assetUnitId,
  });

  return serializeItem(item);
}

async function removeItem(id, itemId, principal, options = {}) {
  const models = options.models ?? getModels();
  const borrowing = await getById(id, principal, { models });

  assertEditable(borrowing.status);

  const item = await models.BorrowingItem.findOne({ where: { id: itemId, borrowingId: id } });
  if (!item) throw new NotFoundError('Borrowing item not found');

  await item.destroy();
}

// --- State transitions -------------------------------------------------------

/**
 * The units on a borrowing, each loaded ready for a state change.
 *
 * DELIBERATELY BYPASSES `unitService.getById`, and therefore the per-unit scope
 * check. That is safe for ALL THREE TIERS, and the reason differs by tier:
 *
 *   system-wide, institution  a borrowing and its units share an institution,
 *                             and reaching the borrowing already proved it
 *   PIC-scoped                `getById` ran `assertCanAccessByUnits`, which
 *                             proves EVERY unit on this borrowing sits in a
 *                             department the caller currently holds
 *
 * Under `CR-003` the third row was false, and Phase 22 guarded it by refusing
 * PIC-scoped callers the whole operation (`assertNotPicScoped`). `CR-004` §4.4
 * replaced that refusal with the coverage guard, which is why a PIC may now
 * activate, return and extend a borrowing made entirely of their own units —
 * and why a mixed one answers `404` before ever reaching this function.
 */
async function loadUnits(borrowingId, models, transaction) {
  const rows = await models.BorrowingItem.findAll({
    where: { borrowingId },
    include: [
      {
        association: 'assetUnit',
        include: [{ association: 'asset', attributes: ['id', 'institutionId'] }],
      },
    ],
    transaction,
  });

  return rows.map((row) => row.assetUnit);
}

/**
 * DRAFT → ACTIVE — REQ-BORROW-007.
 *
 * Availability is re-checked here, not only at add time: a unit added to two
 * DRAFTs is legal, and whichever activates first takes it (`BR-003`).
 */
async function activate(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const borrowing = await getById(id, principal, { models });

  assertTransition(borrowing.status, 'ACTIVE');

  await withTransaction(
    async (transaction) => {
      const units = await loadUnits(id, models, transaction);

      if (units.length === 0) {
        throw new ConflictError('A borrowing must include at least one asset unit', [
          { field: 'items', issue: 'add at least one unit before activating (REQ-BORROW-006)' },
        ]);
      }

      for (const unit of units) {
        await assertUnitAvailable(unit.id, models, { excludeBorrowingId: id, transaction });

        // ACTIVE → BORROWED. A unit that is not ACTIVE — still REGISTERED, in
        // storage, under maintenance — is rejected by the state machine
        // (`03-domain.md` §7.1, REQ-LIFE-002) rather than quietly forced.
        //
        // Checked here rather than left to `applyStateChange`, which validates
        // the snapshot's own fields first: for a unit that never had a condition
        // or location recorded, "cannot be borrowed" is the useful answer, not
        // "condition is required".
        assertUnitTransition(unit.lifecycleState, 'BORROWED');

        await unitService.applyStateChange(
          unit,
          {
            lifecycleState: 'BORROWED',
            description: `Borrowed by ${borrowing.borrowerName} (borrowing ${borrowing.id})`,
          },
          principal,
          // `BORROWING`, not `MANUAL` (`CR-012`, REQ-COND-006): lending an item
          // out is not an assessment of its condition, and a month of borrowing
          // traffic must not read as a month of inspections.
          { models, transaction, entryType: 'BORROWING' }
        );
      }

      await borrowing.update({ status: 'ACTIVE', updatedBy: principal.userId }, { transaction });
    },
    { sequelize }
  );

  return detail(id, principal, { models });
}

/** DRAFT → CANCELLED. A DRAFT never took the units, so none change state. */
async function cancel(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const borrowing = await getById(id, principal, { models });

  assertTransition(borrowing.status, 'CANCELLED');

  await borrowing.update({ status: 'CANCELLED', updatedBy: principal.userId });

  return detail(id, principal, { models });
}

/**
 * Returns every unit and closes the record, inside the caller's transaction.
 *
 * Units not currently BORROWED are left alone rather than forced: one unit
 * disposed of mid-loan must not make the whole borrowing impossible to close
 * (REQ-LIFE-006 keeps its history either way).
 */
async function applyReturn(borrowing, { actualReturnDate, description }, principal, context) {
  const { models, transaction } = context;
  const units = await loadUnits(borrowing.id, models, transaction);

  for (const unit of units) {
    if (unit.lifecycleState !== 'BORROWED') continue;

    await unitService.applyStateChange(
      unit,
      {
        lifecycleState: 'ACTIVE',
        description: description ?? `Returned from borrowing ${borrowing.id}`,
      },
      principal,
      /*
       * `BORROWING` even when the returner supplied their own `description`
       * (`CR-012` `DEC-C`). The note is a real observation and still reaches
       * the `PERAWATAN` sheet, which filters on the description's shape — but a
       * return is not the monthly assessment REQ-COND-006 asks for, and
       * classifying it by whether someone typed something would make the
       * obligation satisfiable by returning an item.
       */
      { models, transaction, entryType: 'BORROWING' }
    );
  }

  await borrowing.update(
    { status: 'RETURNED', actualReturnDate, updatedBy: principal.userId },
    { transaction }
  );
}

/** ACTIVE/OVERDUE → RETURNED — REQ-BORROW-009/010. */
async function returnBorrowing(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const borrowing = await getById(id, principal, { models });

  assertTransition(borrowing.status, 'RETURNED');

  const actualReturnDate = body.actualReturnDate ?? today();
  assertDateOrder({ borrowDate: borrowing.borrowDate, actualReturnDate });

  await withTransaction(
    (transaction) =>
      applyReturn(borrowing, { actualReturnDate, description: body.description }, principal, {
        models,
        transaction,
      }),
    { sequelize }
  );

  return detail(id, principal, { models });
}

/**
 * Extension — REQ-BORROW-014, `DR-012`, `03-domain.md` §4.21.
 *
 * Deliberately NOT a `PATCH` on `expectedReturnDate`: a completed loan must keep
 * the dates it actually had (REQ-BORROW-015, `DR-011`). So this closes the
 * current record as RETURNED and opens a new DRAFT borrowing over the same
 * units, which the caller then activates. The history of one continuous loan is
 * therefore a chain of borrowings, each with its own true dates.
 */
async function extend(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const borrowing = await getById(id, principal, { models });

  // Extending closes this borrowing and opens a continuation over the SAME
  // units, so it moves every one of them just as `return` does — and the
  // continuation inherits the coverage `getById` just proved (`CR-004` §4.4).
  assertTransition(borrowing.status, 'RETURNED');

  const actualReturnDate = body.actualReturnDate ?? today();
  assertDateOrder({ borrowDate: borrowing.borrowDate, actualReturnDate });

  // The new loan starts where the old one ended.
  assertDateOrder({
    borrowDate: actualReturnDate,
    expectedReturnDate: body.expectedReturnDate,
  });

  const createdId = await withTransaction(
    async (transaction) => {
      const units = await loadUnits(borrowing.id, models, transaction);

      await applyReturn(borrowing, { actualReturnDate }, principal, { models, transaction });

      const next = await models.Borrowing.create(
        {
          borrowerName: borrowing.borrowerName,
          borrowerContact: borrowing.borrowerContact,
          borrowDate: actualReturnDate,
          expectedReturnDate: body.expectedReturnDate,
          responsiblePersonId: borrowing.responsiblePersonId,
          institutionId: borrowing.institutionId,
          description: body.description ?? borrowing.description,
          status: 'DRAFT',
          createdBy: principal.userId,
          updatedBy: principal.userId,
        },
        { transaction }
      );

      await models.BorrowingItem.bulkCreate(
        units.map((unit) => ({ borrowingId: next.id, assetUnitId: unit.id })),
        { transaction }
      );

      return next.id;
    },
    { sequelize }
  );

  return {
    returned: await detail(id, principal, { models }),
    borrowing: await detail(createdId, principal, { models }),
  };
}

/** Borrowing history for one asset unit — REQ-BORROW-013, `06-api.md` §5.2. */
async function forUnit(assetUnitId, params, principal, options = {}) {
  const models = options.models ?? getModels();
  await unitService.getById(assetUnitId, principal, { models });

  const findOptions = toFindOptions(params, {
    filters: {},
    sortable: SORTABLE,
    defaultSort: [['borrowDate', 'DESC']],
  });

  const { rows, pagination } = await paginate(
    models.Borrowing,
    {
      ...findOptions,
      // The unit guard above proves the caller reaches THIS unit; coverage is
      // still needed because a borrowing holding it may also hold units from
      // another department, and `CR-004` §9 makes that whole record invisible.
      where: {
        [Op.and]: [
          findOptions.where,
          scopeFilter(principal),
          unitCoverageFilter(principal, BORROWING_COVERAGE),
        ],
      },
    },
    {
      include: [{ association: 'items', where: { assetUnitId }, required: true, attributes: [] }],
      distinct: true,
    }
  );

  return { rows: rows.map(serialize), pagination };
}

module.exports = {
  list,
  detail,
  create,
  update,
  items,
  addItem,
  removeItem,
  activate,
  cancel,
  returnBorrowing,
  extend,
  forUnit,
  getById,
  serialize,
  serializeItem,
  SORTABLE,
};
