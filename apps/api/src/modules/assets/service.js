'use strict';

/**
 * Asset use cases — `IMPLEMENTATION_PLAN.md` §11.3, §11.9; `06-api.md` §5.1;
 * REQ-ASSET-001–011, REQ-SEARCH-001–005.
 *
 * The Asset is the master record. Physical items are its Asset Units, which is
 * why department, condition and location live there rather than here.
 */

const { Op } = require('sequelize');

const { getModels, normalizeCharKey } = require('../../db/models');
const { withTransaction } = require('../../db/withTransaction');
const { ConflictError, ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, containsAny, equals } = require('../../query/filtering');
const { assertLeafClassification } = require('../../domain/classificationRules');
const { registrationHint } = require('../../domain/inventoryCodeFormat');
const {
  scopeFilter,
  assertCanAccess,
  assertCanAssignInstitution,
  defaultInstitutionFor,
  assetScopeFilter,
  assertCanAccessAsset,
  assertAssetWideChange,
  mayChangeWholeAsset,
  assertCanCreateStandaloneAsset,
} = require('../../domain/scope');
const { operatingDepartments } = require('../../domain/operatingScope');

const SORTABLE = ['name', 'createdAt', 'updatedAt'];

function serialize(asset) {
  return {
    id: asset.id,
    name: asset.name,
    classificationId: normalizeCharKey(asset.classificationId),
    vendorId: asset.vendorId ?? null,
    contractId: asset.contractId ?? null,
    institutionId: asset.institutionId ?? null,
    description: asset.description ?? null,
    isActive: asset.isActive,
    createdBy: asset.createdBy ?? null,
    updatedBy: asset.updatedBy ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    // Present only when the caller asked for detail.
    classification: asset.classification
      ? { id: normalizeCharKey(asset.classification.id), name: asset.classification.name }
      : undefined,
    vendor: asset.vendor ? { id: asset.vendor.id, name: asset.vendor.name } : undefined,
    institution: asset.institution
      ? { id: asset.institution.id, name: asset.institution.name, code: asset.institution.code }
      : undefined,
    // REQ-ASSET-011 asks for the contract number at minimum, so the procurement
    // line can be shown without a second request.
    contract: asset.contract
      ? { id: asset.contract.id, contractNumber: asset.contract.contractNumber }
      : undefined,
  };
}

/**
 * Filters — `06-api.md` §5.1, REQ-ASSET-009.
 *
 * `departmentId`, `locationId` and `condition` describe an Asset Unit, not an
 * Asset, so each becomes an EXISTS-style subquery over this asset's units. That
 * is what makes "assets at location X" mean "assets with a unit at X".
 */
function buildFilters(models) {
  const unitSubquery = (where) => ({
    id: {
      [Op.in]: models.AssetUnit.sequelize.literal(
        `(SELECT "asset_id" FROM "public"."asset_units" WHERE ${where})`
      ),
    },
  });

  return {
    status: activeStatus(),
    q: (value) => containsAny(['name', 'description'], value),
    classificationId: (value) => equals('classificationId', value),
    institutionId: (value) => equals('institutionId', value),
    vendorId: (value) => equals('vendorId', value),
    contractId: (value) => equals('contractId', value),
    departmentId: (value) =>
      unitSubquery(
        `"department_id" = ${models.AssetUnit.sequelize.escape(value)} AND "is_active" = true`
      ),
    locationId: (value) =>
      unitSubquery(
        `"current_location_id" = ${models.AssetUnit.sequelize.escape(value)} AND "is_active" = true`
      ),
    condition: (value) =>
      unitSubquery(
        `"current_condition" = ${models.AssetUnit.sequelize.escape(value)}::public.condition_enum ` +
          'AND "is_active" = true'
      ),
    lifecycleState: (value) =>
      unitSubquery(
        `"lifecycle_state" = ${models.AssetUnit.sequelize.escape(value)}::public.lifecycle_state ` +
          'AND "is_active" = true'
      ),
  };
}

async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: buildFilters(models),
    sortable: SORTABLE,
    defaultSort: [['createdAt', 'DESC']],
  });

  // P3 (§64.3): a department-bound operator reaches only assets with a unit of
  // their department. Merged as `Op.and`, so no supplied filter displaces it.
  options.where = {
    [Op.and]: [options.where, scopeFilter(principal), assetScopeFilter(principal)],
  };

  const { rows, pagination } = await paginate(models.Asset, options);

  return { rows: rows.map(serialize), pagination };
}

async function getById(id, principal, { models = getModels(), withRelations = false } = {}) {
  const asset = await models.Asset.findByPk(id, {
    include: withRelations
      ? [
          { association: 'classification' },
          { association: 'vendor' },
          { association: 'institution' },
          { association: 'contract' },
        ]
      : undefined,
  });

  assertCanAccess(principal, asset, { label: 'Asset' });
  // P3 (§64.3): through its units, for a department-bound operator — `404`.
  return assertCanAccessAsset(principal, asset, { label: 'Asset' });
}

/**
 * The detail response, plus what registering a unit against this asset requires
 * — `CR-007` `DEC-133`.
 *
 * `unitRegistration` is derived from the owning institution's inventory code
 * format, which itself sits behind `inventory-code-format:read` — an
 * administration permission the person registering a unit has no reason to hold.
 * Publishing the one bit the form needs is what avoids widening that permission
 * to make a field appear.
 */
const detail = async (id, principal, options = {}) => {
  const asset = await getById(id, principal, { ...options, withRelations: true });

  return {
    ...serialize(asset),
    unitRegistration: registrationHint(asset.institution ?? null),
    // P3 (§64.3): whether a change to the WHOLE asset is open to the caller —
    // the rule `assertAssetWideChange` enforces, so the screen offers edit,
    // (de)activation, asset attribute values and asset-level files only then.
    scope: { wholeAssetChange: await mayChangeWholeAsset(principal, asset) },
  };
};

/**
 * `GET /assets/scope` — the caller's own Asset reach, for the screens (P3 UI):
 * whether they are narrowed to departments (a KAJUR / TOOLMAN, REQ-AUTHZ-009),
 * which, and whether a standalone asset may be created. Read-only; the server
 * enforces every one of these on its own paths.
 */
async function scope(principal, { models = getModels() } = {}) {
  const narrowed = operatingDepartments(principal);
  const departments = narrowed
    ? await models.Department.findAll({
        where: { id: [...narrowed] },
        attributes: ['id', 'code', 'name'],
        order: [['code', 'ASC']],
      })
    : [];
  return {
    departmentScoped: Boolean(narrowed),
    departments: departments.map(({ id, code, name }) => ({ id, code, name })),
    createStandaloneAsset: !narrowed,
  };
}

/** Rejects references that do not exist, so the FK never has to. */
async function assertReferences(body, models) {
  if (body.vendorId) {
    const vendor = await models.Vendor.findByPk(body.vendorId);
    if (!vendor) {
      throw new ValidationError('The vendor does not exist', [
        { field: 'vendorId', issue: 'must reference an existing vendor' },
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
 * An asset's contract may not be changed out from under its units'
 * procurement lines — REQ-ASSET-011 with REQ-PROC-006.
 *
 * `contractId` became editable in the procurement revision, which introduces a
 * disagreement that could not previously arise: the asset says it was
 * established under contract A while its units say they arrived on line items of
 * contract B. Clearing the contract while units still carry items is the same
 * disagreement with A absent.
 *
 * Rejected rather than cascaded: which of the two records is the wrong one is
 * not something this endpoint can know. The way out is to clear or re-point the
 * units' items first, which `PATCH /asset-units/:id` now allows.
 */
async function assertContractChangeAllowed(asset, body, models) {
  if (body.contractId === undefined) return;

  const next = body.contractId ?? null;
  if (next === (asset.contractId ?? null)) return;

  const units = await models.AssetUnit.findAll({
    where: { assetId: asset.id, contractItemId: { [Op.ne]: null } },
    include: [{ association: 'contractItem', attributes: ['id', 'contractId'] }],
  });

  const conflicting = units.filter((unit) => unit.contractItem?.contractId !== next);
  if (conflicting.length === 0) return;

  const count = `${conflicting.length} asset unit(s)`;

  throw new ConflictError(
    next
      ? `This asset cannot be moved to another contract: ${count} were procured through contract items belonging to a different one`
      : `This asset's procurement reference cannot be cleared: ${count} still reference a contract item`
  );
}

async function create(body, principal, { models = getModels() } = {}) {
  // P3 (§64.3): an asset with no unit is outside a Kajur's or Toolman's reach at
  // once — they register through a request, or add a unit to one they can see.
  assertCanCreateStandaloneAsset(principal);
  const institutionId = defaultInstitutionFor(principal, body.institutionId);
  assertCanAssignInstitution(principal, institutionId);

  await assertLeafClassification(body.classificationId, { models, institutionId });
  await assertReferences(body, models);

  const asset = await models.Asset.create({
    ...body,
    institutionId,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  });

  return detail(asset.id, principal, { models });
}

async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const asset = await getById(id, principal, { models });
  // P3 (§64.3): the whole asset — not while another department has units of it.
  await assertAssetWideChange(principal, asset);

  if (body.institutionId !== undefined) {
    assertCanAssignInstitution(principal, body.institutionId);
  }

  if (
    body.classificationId &&
    normalizeCharKey(body.classificationId) !== normalizeCharKey(asset.classificationId)
  ) {
    // Against the institution the asset will have once this update lands, not
    // the one it has now — moving institution and reclassifying in one call
    // must be judged on the result.
    const institutionId =
      body.institutionId === undefined ? asset.institutionId : body.institutionId;
    await assertLeafClassification(body.classificationId, { models, institutionId });
  }

  await assertReferences(body, models);
  await assertContractChangeAllowed(asset, body, models);

  /**
   * Moving an asset to another institution clears every unit's department —
   * Phase 20 (`CR-003` §6.4), REQ-ORG-004, `BR-007`.
   *
   * There is deliberately NO remapping. Institution A's `TKJ` and Institution
   * B's `TKJ` are different departments that happen to share a code, so
   * "translating" one to the other would invent an organizational assignment
   * nobody made. Clearing states the truth: responsibility has not been
   * reassigned in the new institution yet.
   *
   * Transactional because the two writes have to agree. An asset that moved
   * while its units kept departments from the institution it left is exactly the
   * inconsistency `assertDepartmentAssignable` refuses to create on every other
   * path (REQ-NFR-REL-001).
   *
   * Inventory codes are untouched on purpose: REQ-UNIT-008 requires a code to
   * survive an institution move, because it is already on a physical label.
   */
  const movingInstitution =
    body.institutionId !== undefined && body.institutionId !== asset.institutionId;

  await withTransaction(async (transaction) => {
    await asset.update({ ...body, updatedBy: principal.userId }, { transaction });

    if (movingInstitution) {
      /**
       * `individualHooks: true` is REQUIRED, not a tuning choice.
       *
       * `db/auditHooks.js` registers `afterCreate`/`afterUpdate`/`afterDestroy`
       * — instance hooks. A bulk `Model.update` fires `afterBulkUpdate`, which
       * nothing in this codebase listens to, so without this flag stripping the
       * departments off thirty units would leave no audit record at all for a
       * change that removes organizational responsibility from thirty physical
       * items.
       */
      await models.AssetUnit.update(
        { departmentId: null, updatedBy: principal.userId },
        {
          where: { assetId: id, departmentId: { [Op.ne]: null } },
          transaction,
          individualHooks: true,
        }
      );
    }
  });

  return detail(id, principal, { models });
}

/**
 * Soft delete — REQ-ASSET-005, `BR-005`. Units and history are untouched, so
 * traceability survives deactivation.
 */
async function setActive(id, isActive, principal, options = {}) {
  const models = options.models ?? getModels();
  const asset = await getById(id, principal, { models });
  await assertAssetWideChange(principal, asset);

  if (asset.isActive === isActive) {
    throw new ConflictError(`Asset is already ${isActive ? 'active' : 'inactive'}`);
  }

  await asset.update({ isActive, updatedBy: principal.userId });

  return detail(id, principal, { models });
}

module.exports = {
  list,
  detail,
  scope,
  create,
  update,
  deactivate: (id, principal, options) => setActive(id, false, principal, options),
  reactivate: (id, principal, options) => setActive(id, true, principal, options),
  getById,
  serialize,
  SORTABLE,
};
