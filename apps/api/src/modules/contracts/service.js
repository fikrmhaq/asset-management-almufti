'use strict';

/**
 * Contract use cases — `IMPLEMENTATION_PLAN.md` §12.3, `06-api.md` §6.2;
 * REQ-PROC-001–003, REQ-PROC-007/008.
 *
 * The Contract is the procurement record an Asset is traced back to
 * (REQ-ASSET-011). Unlike Supplier and Vendor it DOES carry an `institution_id`
 * (`04-data-model.md` §5.4.3) — the receiving institution — so it is
 * organization-scoped like assets are (`BR-007`, `DEC-007`).
 */

const { getModels, normalizeCharKey } = require('../../db/models');
const { ConflictError, ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, contains, equals } = require('../../query/filtering');
const {
  scopeFilter,
  assertCanAccess,
  assertCanAssignInstitution,
  defaultInstitutionFor,
} = require('../../domain/scope');

const SORTABLE = ['contractNumber', 'contractDate', 'contractValue', 'createdAt', 'updatedAt'];

/** Filters — `06-api.md` §6.2. */
const FILTERS = {
  status: activeStatus(),
  q: (value) => contains('contractNumber', value),
  supplierId: (value) => equals('supplierId', value),
  institutionId: (value) => equals('institutionId', value),
  contractTypeId: (value) => equals('contractTypeId', value),
};

function serialize(contract) {
  return {
    id: contract.id,
    contractNumber: contract.contractNumber,
    supplierId: contract.supplierId ?? null,
    contractTypeId: contract.contractTypeId ?? null,
    contractDate: contract.contractDate,
    fundingSourceId: contract.fundingSourceId ?? null,
    contractValue: contract.contractValue ?? null,
    receivingDocument: contract.receivingDocument ?? null,
    receivingDate: contract.receivingDate ?? null,
    institutionId: contract.institutionId ?? null,
    accountCode: normalizeCharKey(contract.accountCode) ?? null,
    notes: contract.notes ?? null,
    isActive: contract.isActive,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    // Present only when the caller asked for detail.
    supplier: contract.supplier
      ? { id: contract.supplier.id, name: contract.supplier.name }
      : undefined,
    contractType: contract.contractType
      ? { id: contract.contractType.id, name: contract.contractType.name }
      : undefined,
    fundingSource: contract.fundingSource
      ? { id: contract.fundingSource.id, name: contract.fundingSource.name }
      : undefined,
    institution: contract.institution
      ? {
          id: contract.institution.id,
          name: contract.institution.name,
          code: contract.institution.code,
        }
      : undefined,
  };
}

async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['contractDate', 'DESC']],
  });

  options.where = { ...options.where, ...scopeFilter(principal) };

  const { rows, pagination } = await paginate(models.Contract, options);

  return { rows: rows.map(serialize), pagination };
}

/** @throws {NotFoundError} when absent, or outside the caller's scope (§1.4). */
async function getById(id, principal, { models = getModels(), withRelations = false } = {}) {
  const contract = await models.Contract.findByPk(id, {
    include: withRelations
      ? [
          { association: 'supplier' },
          { association: 'contractType' },
          { association: 'fundingSource' },
          { association: 'institution' },
        ]
      : undefined,
  });

  return assertCanAccess(principal, contract, { label: 'Contract' });
}

const detail = async (id, principal, options = {}) =>
  serialize(await getById(id, principal, { ...options, withRelations: true }));

/**
 * `uq_contracts_number` also enforces this; checking first turns a driver error
 * into a message naming the field (REQ-VAL-004).
 *
 * The check deliberately ignores organization scope: the constraint is global,
 * so a number already used by another institution's contract would still fail at
 * the database, and reporting it as a conflict is the honest answer.
 */
async function assertContractNumberFree(contractNumber, models, { excludeId } = {}) {
  const existing = await models.Contract.findOne({ where: { contractNumber } });

  if (existing && existing.id !== excludeId) {
    throw new ConflictError(`A contract with number "${contractNumber}" already exists`, [
      { field: 'contractNumber', issue: 'must be unique' },
    ]);
  }
}

/** Rejects references that do not exist, so the FK never has to. */
async function assertReferences(body, models) {
  const checks = [
    ['supplierId', 'Supplier', 'supplier'],
    ['contractTypeId', 'ContractType', 'contract type'],
    ['fundingSourceId', 'FundingSource', 'funding source'],
  ];

  for (const [field, modelName, label] of checks) {
    if (!body[field]) continue;

    const found = await models[modelName].findByPk(body[field]);
    if (!found) {
      throw new ValidationError(`The ${label} does not exist`, [
        { field, issue: `must reference an existing ${label}` },
      ]);
    }
  }

  // The account code is a CHAR(12) natural key (REQ-PROC-008), so it is looked
  // up by value rather than by id.
  if (body.accountCode) {
    const found = await models.AccountCode.findByPk(body.accountCode);
    if (!found) {
      throw new ValidationError('The account code does not exist', [
        { field: 'accountCode', issue: 'must reference an existing account code' },
      ]);
    }
  }
}

async function create(body, principal, { models = getModels() } = {}) {
  const institutionId = defaultInstitutionFor(principal, body.institutionId);
  assertCanAssignInstitution(principal, institutionId);

  await assertContractNumberFree(body.contractNumber, models);
  await assertReferences(body, models);

  const contract = await models.Contract.create({ ...body, institutionId });

  return detail(contract.id, principal, { models });
}

async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const contract = await getById(id, principal, { models });

  if (body.institutionId !== undefined) {
    assertCanAssignInstitution(principal, body.institutionId);
  }

  if (body.contractNumber && body.contractNumber !== contract.contractNumber) {
    await assertContractNumberFree(body.contractNumber, models, { excludeId: id });
  }

  await assertReferences(body, models);

  await contract.update(body);

  return detail(id, principal, { models });
}

/**
 * Soft delete — `06-api.md` §1.7, `BR-005`. Line items, and the assets traced
 * back to them, are untouched: deactivating a contract must not erase the
 * procurement history of anything acquired under it (REQ-PROC-006).
 */
async function setActive(id, isActive, principal, options = {}) {
  const models = options.models ?? getModels();
  const contract = await getById(id, principal, { models });

  if (contract.isActive === isActive) {
    throw new ConflictError(`Contract is already ${isActive ? 'active' : 'inactive'}`);
  }

  await contract.update({ isActive });

  return detail(id, principal, { models });
}

module.exports = {
  list,
  detail,
  create,
  update,
  deactivate: (id, principal, options) => setActive(id, false, principal, options),
  reactivate: (id, principal, options) => setActive(id, true, principal, options),
  getById,
  serialize,
  SORTABLE,
};
