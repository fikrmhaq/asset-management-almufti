'use strict';

/**
 * Transaction use cases — `IMPLEMENTATION_PLAN.md` §13.3; `06-api.md` §7.3;
 * REQ-TXN-001–010, `DR-013`, `DR-014`.
 *
 * Create and read only. There is no update and no delete, by design: a
 * transaction is a historical record of something that happened, and rewriting
 * it would change the recorded asset history (REQ-TXN-007). Corrections are new
 * transactions, not edits.
 *
 * `supplierId` and `contractId` stay optional so a disposal or transfer needs no
 * procurement record to exist (REQ-TXN-008/009).
 */

const { Op } = require('sequelize');

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { equals, dateRange } = require('../../query/filtering');
const {
  scopeFilter,
  assertCanAccess,
  assertCanAssignInstitution,
  defaultInstitutionFor,
  unitCoverageFilter,
  assertCanAccessByUnits,
  TRANSACTION_COVERAGE,
} = require('../../domain/scope');
const unitService = require('../assetUnits/service');

const SORTABLE = ['transactionDate', 'createdAt'];

/** Filters — `06-api.md` §7.3. */
const FILTERS = {
  transactionTypeId: (value) => equals('transactionTypeId', value),
  institutionId: (value) => equals('institutionId', value),
  contractId: (value) => equals('contractId', value),
  supplierId: (value) => equals('supplierId', value),
  dateFrom: (value, params) => dateRange('transactionDate', { from: value, to: params.dateTo }),
  // Handled together with `dateFrom` above, so a lone `dateTo` still applies.
  dateTo: (value, params) =>
    params.dateFrom ? undefined : dateRange('transactionDate', { to: value }),
};

function serialize(txn) {
  return {
    id: txn.id,
    transactionDate: txn.transactionDate,
    transactionTypeId: txn.transactionTypeId,
    description: txn.description ?? null,
    supplierId: txn.supplierId ?? null,
    contractId: txn.contractId ?? null,
    institutionId: txn.institutionId ?? null,
    createdBy: txn.createdBy,
    createdAt: txn.createdAt,
    updatedAt: txn.updatedAt,
    // Present only when the caller asked for detail.
    transactionType: txn.transactionType
      ? { id: txn.transactionType.id, name: txn.transactionType.name }
      : undefined,
    supplier: txn.supplier ? { id: txn.supplier.id, name: txn.supplier.name } : undefined,
    contract: txn.contract
      ? { id: txn.contract.id, contractNumber: txn.contract.contractNumber }
      : undefined,
    institution: txn.institution
      ? { id: txn.institution.id, name: txn.institution.name, code: txn.institution.code }
      : undefined,
  };
}

function serializeItem(item) {
  return {
    id: item.id,
    transactionId: item.transactionId,
    assetUnitId: item.assetUnitId,
    notes: item.notes ?? null,
    createdAt: item.createdAt,
    assetUnit: item.assetUnit ? unitService.serialize(item.assetUnit) : undefined,
  };
}

async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['transactionDate', 'DESC']],
  });

  // Institution scope, then the PIC narrowing — `CR-004` §5. The second
  // contributes nothing for the other two tiers.
  options.where = {
    [Op.and]: [
      options.where,
      scopeFilter(principal),
      unitCoverageFilter(principal, TRANSACTION_COVERAGE),
    ],
  };

  const { rows, pagination } = await paginate(models.Transaction, options);

  return { rows: rows.map(serialize), pagination };
}

/** @throws {NotFoundError} when absent, or outside the caller's scope (§1.4). */
async function getById(id, principal, { models = getModels(), withRelations = false } = {}) {
  const txn = await models.Transaction.findByPk(id, {
    include: withRelations
      ? [
          { association: 'transactionType' },
          { association: 'supplier' },
          { association: 'contract' },
          { association: 'institution' },
        ]
      : undefined,
  });

  assertCanAccess(principal, txn, { label: 'Transaction' });

  /**
   * The unit-coverage narrowing — `CR-004` §5. Covers `detail` and `items` in
   * one place, the same way the borrowing guard does.
   *
   * `create` needs no coverage check of its own: it validates every unit
   * individually through `unitService.getById` before the transaction exists,
   * which is a strictly stronger statement. That behaviour is preserved
   * unchanged; this guard is what the READ paths were missing.
   */
  return assertCanAccessByUnits(principal, txn, TRANSACTION_COVERAGE, {
    label: 'Transaction',
  });
}

const detail = async (id, principal, options = {}) =>
  serialize(await getById(id, principal, { ...options, withRelations: true }));

async function assertReferences(body, models) {
  const type = await models.TransactionType.findByPk(body.transactionTypeId);
  if (!type) {
    throw new ValidationError('The transaction type does not exist', [
      { field: 'transactionTypeId', issue: 'must reference an existing transaction type' },
    ]);
  }

  if (body.supplierId) {
    const supplier = await models.Supplier.findByPk(body.supplierId);
    if (!supplier) {
      throw new ValidationError('The supplier does not exist', [
        { field: 'supplierId', issue: 'must reference an existing supplier' },
      ]);
    }
  }

  if (body.contractId) {
    const contract = await models.Contract.findByPk(body.contractId);
    if (!contract) {
      throw new ValidationError('The contract does not exist', [
        { field: 'contractId', issue: 'must reference an existing contract' },
      ]);
    }
  }
}

/**
 * Creates the transaction and its items in one transaction — REQ-TXN-004,
 * REQ-TXN-010, `IMPLEMENTATION_PLAN.md` §35.
 *
 * A transaction header with no items would claim something happened without
 * recording what it happened to, so the two are written together or not at all.
 */
async function create(body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  const institutionId = defaultInstitutionFor(principal, body.institutionId);
  assertCanAssignInstitution(principal, institutionId);

  await assertReferences(body, models);

  const seen = new Set();
  for (const item of body.items) {
    if (seen.has(item.assetUnitId)) {
      throw new ValidationError('An asset unit may appear only once on a transaction', [
        { field: 'items', issue: `${item.assetUnitId} is listed more than once` },
      ]);
    }
    seen.add(item.assetUnitId);

    // Proves the unit exists AND that the caller may reach it (`BR-007`).
    await unitService.getById(item.assetUnitId, principal, { models });
  }

  const createdId = await withTransaction(
    async (transaction) => {
      const txn = await models.Transaction.create(
        {
          transactionDate: body.transactionDate,
          transactionTypeId: body.transactionTypeId,
          description: body.description ?? null,
          supplierId: body.supplierId ?? null,
          contractId: body.contractId ?? null,
          institutionId,
          createdBy: principal.userId,
        },
        { transaction }
      );

      await models.TransactionItem.bulkCreate(
        body.items.map((item) => ({
          transactionId: txn.id,
          assetUnitId: item.assetUnitId,
          notes: item.notes ?? null,
        })),
        { transaction }
      );

      return txn.id;
    },
    { sequelize }
  );

  return detail(createdId, principal, { models });
}

/** The units a transaction affected — REQ-TXN-004. */
async function items(id, params, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  const findOptions = toFindOptions(params, {
    filters: {},
    sortable: ['createdAt'],
    defaultSort: [['createdAt', 'ASC']],
  });

  const { rows, pagination } = await paginate(
    models.TransactionItem,
    { ...findOptions, where: { transactionId: id } },
    { include: [{ association: 'assetUnit' }] }
  );

  return { rows: rows.map(serializeItem), pagination };
}

/**
 * Transaction history for one asset unit — REQ-TXN-006, REQ-TXN-010,
 * `06-api.md` §5.2.
 *
 * The history follows the unit, not its asset: that is what keeps it attached to
 * the specific physical item throughout its life.
 */
async function forUnit(assetUnitId, params, principal, options = {}) {
  const models = options.models ?? getModels();
  await unitService.getById(assetUnitId, principal, { models });

  const findOptions = toFindOptions(params, {
    filters: {},
    sortable: SORTABLE,
    defaultSort: [['transactionDate', 'DESC']],
  });

  const { rows, pagination } = await paginate(
    models.Transaction,
    {
      ...findOptions,
      // The unit guard above proves the caller reaches THIS unit; coverage is
      // still needed because a transaction holding it may also affect units
      // from another department, and `CR-004` §9 hides that whole record.
      where: {
        [Op.and]: [
          findOptions.where,
          scopeFilter(principal),
          unitCoverageFilter(principal, TRANSACTION_COVERAGE),
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
  items,
  forUnit,
  getById,
  serialize,
  serializeItem,
  SORTABLE,
};
