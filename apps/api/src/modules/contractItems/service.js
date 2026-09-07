'use strict';

/**
 * Contract item use cases — `IMPLEMENTATION_PLAN.md` §12.4, §12.5;
 * `06-api.md` §6.3; REQ-PROC-004/005/006/009, REQ-ASSET-011, REQ-REPORT-008.
 *
 * A ContractItem is one line of a procurement contract. It carries no
 * `institution_id` of its own (`04-data-model.md` §5.4.4), so its organization
 * scope is its parent Contract's — reaching an item means being able to reach
 * the contract it belongs to (`BR-007`, `DEC-007`).
 *
 * This module also owns the procurement-to-asset flow (§12.5): the single
 * transactional operation that turns a purchased line item into an Asset and its
 * physical Asset Units.
 */

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { contains } = require('../../query/filtering');
const { assertLeafClassification } = require('../../domain/classificationRules');
const { assertDepartmentAssignable } = require('../../domain/departmentRules');
const {
  assertCanAccess,
  assertCanAssignInstitution,
  defaultInstitutionFor,
  unitScopeFilter,
  assertCanAssignDepartment,
} = require('../../domain/scope');
const { registrationHint } = require('../../domain/inventoryCodeFormat');
const contractService = require('../contracts/service');
const assetService = require('../assets/service');
const unitService = require('../assetUnits/service');

const SORTABLE = ['assetName', 'quantity', 'unitPrice', 'createdAt', 'updatedAt'];

const FILTERS = {
  q: (value) => contains('assetName', value),
};

/**
 * `totalValue` comes from the model's VIRTUAL attribute — derived from
 * `quantity * unitPrice`, never stored (`03-domain.md` §4.17,
 * `04-data-model.md` §5.4.4 note).
 */
function serialize(item) {
  return {
    id: item.id,
    contractId: item.contractId,
    assetName: item.assetName,
    specification: item.specification ?? null,
    quantity: item.quantity ?? null,
    unitPrice: item.unitPrice ?? null,
    unitType: item.unitType ?? null,
    totalValue: item.totalValue ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Loads an item and proves the caller may reach its contract.
 *
 * @throws {NotFoundError} when absent, or when the parent contract is outside
 *   the caller's organization scope (`06-api.md` §1.4)
 */
async function getById(id, principal, { models = getModels() } = {}) {
  const item = await models.ContractItem.findByPk(id, {
    include: [{ association: 'contract', attributes: ['id', 'institutionId'] }],
  });

  if (!item) throw new NotFoundError('Contract item not found');
  assertCanAccess(principal, item.contract, { label: 'Contract item' });

  return item;
}

/**
 * The item, plus what registering units through it requires — `CR-007`
 * `DEC-133`.
 *
 * The institution is the parent contract's, which is also what
 * `POST /contract-items/:id/assets` uses when the caller names none. Loaded
 * explicitly because `getById` deliberately selects only the contract columns
 * organization scope needs.
 */
const detail = async (id, principal, options = {}) => {
  const models = options.models ?? getModels();
  const item = await getById(id, principal, { models });

  const institution = item.contract?.institutionId
    ? await models.Institution.findByPk(item.contract.institutionId)
    : null;

  return { ...serialize(item), unitRegistration: registrationHint(institution) };
};

/** Line items of one contract — `06-api.md` §6.2. */
async function listForContract(contractId, params, principal, { models = getModels() } = {}) {
  await contractService.getById(contractId, principal, { models });

  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['createdAt', 'ASC']],
  });

  options.where = { ...options.where, contractId };

  const { rows, pagination } = await paginate(models.ContractItem, options);

  return { rows: rows.map(serialize), pagination };
}

async function createForContract(contractId, body, principal, { models = getModels() } = {}) {
  await contractService.getById(contractId, principal, { models });

  const item = await models.ContractItem.create({ ...body, contractId });

  return serialize(item);
}

async function update(id, body, principal, options = {}) {
  const item = await getById(id, principal, options);

  // `contractId` is not updatable: moving a line between contracts would
  // silently rewrite the procurement history of every unit already traced to it
  // (REQ-PROC-006), so it is absent from the update schema entirely.
  return serialize(await item.update(body));
}

/**
 * Hard delete — `06-api.md` §6.3. `contract_items` has no `is_active` column, so
 * unlike most resources this really removes the row.
 *
 * Blocked with `CONFLICT` once asset units reference the item: those units would
 * lose the procurement record they are traced to (REQ-PROC-006), and
 * `fk_asset_units_contract_item` is `NO ACTION`, so the database would refuse
 * anyway. Checking first names the reason.
 */
async function remove(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const item = await getById(id, principal, { models });

  const unitCount = await models.AssetUnit.count({ where: { contractItemId: id } });

  if (unitCount > 0) {
    throw new ConflictError(
      `This contract item cannot be deleted: ${unitCount} asset unit(s) were procured through it`,
      [{ field: 'id', issue: 'is referenced by existing asset units (REQ-PROC-006)' }]
    );
  }

  await item.destroy();
}

/** Units procured through this line item — REQ-PROC-006, REQ-REPORT-008. */
async function assetUnits(id, params, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  const findOptions = toFindOptions(params, {
    filters: {},
    sortable: unitService.SORTABLE,
    defaultSort: [['createdAt', 'ASC']],
  });

  const { rows, pagination } = await paginate(
    models.AssetUnit,
    // Phase 22: the PIC narrowing. Nothing for the other two tiers.
    { ...findOptions, where: { contractItemId: id, ...unitScopeFilter(principal) } },
    // Phase 20 (`CR-003`): `unitService.serialize` reports a resolved
    // department, so the join has to be here or every row reads as unassigned.
    { include: [{ association: 'department', attributes: ['id', 'code', 'name'] }] }
  );

  return { rows: rows.map(unitService.serialize), pagination };
}

async function assertVendorExists(vendorId, models) {
  if (!vendorId) return;

  const vendor = await models.Vendor.findByPk(vendorId);
  if (!vendor) {
    throw new ValidationError('The vendor does not exist', [
      { field: 'vendorId', issue: 'must reference an existing vendor' },
    ]);
  }
}

/**
 * Procurement → Asset → Asset Unit(s) — REQ-PROC-009, `IMPLEMENTATION_PLAN.md`
 * §12.5.
 *
 * The whole point is that the caller supplies only what the procurement record
 * cannot know — the classification, and how many physical units arrived. The
 * server fills in the traceability itself:
 *
 *   Asset.contractId      ← this item's parent contract (REQ-ASSET-011)
 *   AssetUnit.contractItemId ← this item                (REQ-PROC-006)
 *
 * One transaction, per §35: a failure part-way through must not leave an asset
 * with no units, or units with no asset.
 */
async function createAsset(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  const item = await getById(id, principal, { models });
  const contract = item.contract;

  // Precedence: what the caller asked for, else the contract's own receiving
  // institution, else the caller's scope. The contract already names it, so
  // REQ-PROC-009's "without requiring the user to separately re-select" applies
  // here too.
  const institutionId =
    body.institutionId ?? contract.institutionId ?? defaultInstitutionFor(principal, undefined);

  assertCanAssignInstitution(principal, institutionId);

  await assertLeafClassification(body.classificationId, { models, institutionId });
  await assertVendorExists(body.vendorId, models);
  /**
   * Unreachable for a PIC-scoped caller — `CR-004` §7.
   *
   * This flow creates an Asset AND its units, so it is gated by `asset:create`
   * and `asset-unit:create`, and the ceiling suppresses both. Under `CR-003`
   * that was a convention ("a PIC-scoped role should not hold the first"); it is
   * now structural. The department check stays as the second layer.
   */
  assertCanAssignDepartment(principal, body.departmentId);
  // Judged against the institution the ASSET is about to be created in, not one
  // already on a record — this flow decides that institution a few lines above.
  await assertDepartmentAssignable(body.departmentId, { institutionId }, { models });

  /**
   * The manually supplied component, one per unit or one for the batch —
   * `CR-007` `DEC-130`. Resolved before the transaction so a bad request costs
   * no lock, and refused outright when the institution's format never asked for
   * one.
   */
  const institution = institutionId ? await models.Institution.findByPk(institutionId) : null;

  const numberCompositions = unitService.resolveCompositions(institution, {
    single: body.numberComposition,
    list: body.numberCompositions,
    count: body.unitCount,
  });

  const assetId = await withTransaction(
    async (transaction) => {
      const asset = await models.Asset.create(
        {
          name: body.name ?? item.assetName,
          classificationId: body.classificationId,
          vendorId: body.vendorId ?? null,
          contractId: contract.id,
          institutionId,
          description: body.description ?? null,
          createdBy: principal.userId,
          updatedBy: principal.userId,
        },
        { transaction }
      );

      // One allocation for the whole batch (REQ-UNIT-007): a single advisory
      // lock and a single scan, rather than `unitCount` of each.
      const codes = await unitService.allocateCodesForAsset(asset, body.unitCount, {
        models,
        transaction,
        // Every unit in this batch takes the same department, so they share a
        // prefix and the whole batch costs one lock and one scan (`CR-006`).
        departmentId: body.departmentId ?? null,
        numberCompositions,
      });

      await models.AssetUnit.bulkCreate(
        Array.from({ length: body.unitCount }, (_, index) => ({
          assetId: asset.id,
          contractItemId: item.id,
          departmentId: body.departmentId ?? null,
          inventoryCode: codes[index],
          numberComposition: numberCompositions[index] ?? null,
          createdBy: principal.userId,
          updatedBy: principal.userId,
        })),
        { transaction }
      );

      return asset.id;
    },
    { sequelize }
  ).catch((error) => {
    // A batch rendering the same code twice was already refused above; this
    // catches a collision with a code issued earlier (`BR-020`).
    throw unitService.asDuplicateCodeError(error, numberCompositions);
  });

  const [asset, units] = await Promise.all([
    assetService.detail(assetId, principal, { models }),
    models.AssetUnit.findAll({ where: { assetId }, order: [['createdAt', 'ASC']] }),
  ]);

  return { asset, units: units.map(unitService.serialize) };
}

module.exports = {
  listForContract,
  createForContract,
  detail,
  update,
  remove,
  assetUnits,
  createAsset,
  getById,
  serialize,
  SORTABLE,
};
