'use strict';

/**
 * Asset unit use cases — `IMPLEMENTATION_PLAN.md` §11.4–§11.6;
 * `06-api.md` §5.2; REQ-UNIT-001–006, REQ-LOC-002–005, REQ-COND-002–004,
 * REQ-LIFE-001–004.
 *
 * The Asset Unit is the individually tracked physical item. Its current state is
 * denormalized onto the row for query performance, and its history is the
 * append-only record behind it.
 */

const { Op } = require('sequelize');

const { getModels, normalizeCharKey } = require('../../db/models');
const { HISTORY_ENTRY_TYPES } = require('../../db/enums');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, equals, containsAny } = require('../../query/filtering');
const { assertTransition } = require('../../domain/lifecycle');
const {
  assertCanAccess,
  scopeFilter,
  unitScopeFilter,
  assertCanAccessUnit,
  assertCanAssignDepartment,
} = require('../../domain/scope');
const { assertDepartmentAssignable } = require('../../domain/departmentRules');
const { allocateCodes } = require('../../domain/inventoryCode');
const {
  buildPrefix,
  formatFor,
  formatHasSequence,
  formatUsesComposition,
  tokensIn,
} = require('../../domain/inventoryCodeFormat');
const assetService = require('../assets/service');

const SORTABLE = ['createdAt', 'updatedAt', 'lifecycleState'];

/**
 * EVERY ENTRY HERE IS A FILTER, NOT A SCOPE.
 *
 * `departmentId` in particular narrows within whatever the caller may already
 * reach — it can never widen it. Scope is applied separately and unconditionally
 * (`unitScopeFilter`, plus the institution check on the parent asset), so
 * omitting or changing a filter cannot reveal a unit the caller could not
 * otherwise see (`CR-005` §1). The two must not be confused: this object is
 * built from user input.
 */
const FILTERS = {
  status: activeStatus(),
  departmentId: (value) => equals('departmentId', value),
  lifecycleState: (value) => equals('lifecycleState', value),
  condition: (value) => equals('currentCondition', value),
  locationId: (value) => equals('currentLocationId', value),
  q: (value) => containsAny(['inventoryCode', 'description'], value),
};

function serialize(unit) {
  return {
    id: unit.id,
    assetId: unit.assetId,
    // The printable identity (REQ-UNIT-007). Null when the unit's asset has no
    // institution, so there is nothing to build a code from.
    inventoryCode: unit.inventoryCode ?? null,
    /**
     * What the code was built from, where the format asked for one (`CR-007`).
     * Set once at registration and refused on update: correcting it would repair
     * nothing, since the code it produced is already permanent and already on a
     * printed label (REQ-UNIT-008).
     */
    numberComposition: unit.numberComposition ?? null,
    description: unit.description ?? null,
    contractItemId: unit.contractItemId ?? null,
    departmentId: unit.departmentId ?? null,
    /**
     * `null` when unassigned, and also whenever the association was not loaded.
     * `departmentId` remains the authority on whether one exists — the same
     * convention `currentLocation` and `parentLocation` already follow.
     *
     * It exists because `departmentId` alone forces every client to render a
     * UUID or issue a request per row to turn it into something a person can
     * read. Phase 20 (`CR-003` §1.4): the detail endpoint previously returned
     * only the raw id, which is why the unit screen displayed one.
     */
    department: unit.department
      ? { id: unit.department.id, code: unit.department.code, name: unit.department.name }
      : null,
    lifecycleState: unit.lifecycleState,
    currentCondition: unit.currentCondition ?? null,
    currentLocationId: unit.currentLocationId ?? null,
    isActive: unit.isActive,
    createdBy: unit.createdBy ?? null,
    updatedBy: unit.updatedBy ?? null,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
    // Present only when the caller asked for them, as elsewhere. `currentLocation`
    // is what makes a list of units say WHERE each one is rather than only that
    // it is somewhere beneath the location being viewed (REQ-LOC-005).
    asset: unit.asset ? { id: unit.asset.id, name: unit.asset.name } : undefined,
    currentLocation: unit.currentLocation
      ? { id: unit.currentLocation.id, name: unit.currentLocation.name }
      : undefined,
  };
}

function serializeHistory(entry) {
  return {
    id: entry.id,
    assetUnitId: entry.assetUnitId,
    description: entry.description,
    condition: entry.condition,
    locationId: entry.locationId,
    lifecycleState: entry.lifecycleState ?? null,
    // What produced this row (`CR-012`). Read-only: it is the server's statement
    // about which code path wrote the row, never a claim the caller may make.
    entryType: entry.entryType,
    effectiveFrom: entry.effectiveFrom,
    effectiveTo: entry.effectiveTo ?? null,
    createdBy: entry.createdBy ?? null,
    createdAt: entry.createdAt,
  };
}

function serializeLocationAssignment(row) {
  return {
    id: row.id,
    assetUnitId: row.assetUnitId,
    locationId: row.locationId,
    isCurrent: row.isCurrent,
    assignedAt: row.assignedAt,
    unassignedAt: row.unassignedAt ?? null,
  };
}

/**
 * A unit is scoped through its asset — `asset_units` carries no `institution_id`
 * of its own, so reaching one means being able to reach its asset (`BR-007`).
 */
async function getById(id, principal, { models = getModels() } = {}) {
  const unit = await models.AssetUnit.findByPk(id, {
    include: [
      // `name` is loaded alongside the scoping columns so the detail response can
      // say which asset the unit belongs to; `institutionId` is what the scope
      // check below actually reads. `contractId` is what `assertContractItem`
      // compares a submitted contract item against.
      {
        association: 'asset',
        attributes: ['id', 'name', 'institutionId', 'classificationId', 'contractId'],
      },
      { association: 'currentLocation', attributes: ['id', 'name'] },
      // Phase 20 (`CR-003`): resolved so the response can name the department
      // rather than hand the client a UUID to look up.
      { association: 'department', attributes: ['id', 'code', 'name'] },
    ],
  });

  if (!unit) throw new NotFoundError('Asset unit not found');
  assertCanAccess(principal, unit.asset, { label: 'Asset unit' });
  /**
   * The PIC narrowing, applied AFTER the institution check — Phase 22
   * (`CR-003`). Placing it here covers every record path at once: borrowings,
   * transactions, attribute values, history, location assignment and labels all
   * reach a unit through this function.
   */
  assertCanAccessUnit(principal, unit);

  return unit;
}

const detail = async (id, principal, options) => serialize(await getById(id, principal, options));

/**
 * Every Asset Unit the caller may reach — `06-api.md` §5.2, `CR-005`.
 *
 * The collection endpoint the API did not have. Until now a unit could only be
 * listed under an Asset, a Location or a Contract Item, which made a whole tier
 * unable to find its own records: a PIC-scoped role holds no `asset:read`, no
 * `contract-item:read`, and a unit whose first location has not been recorded
 * has no `current_location_id` to be listed under either. It existed and was
 * invisible.
 *
 * TWO INDEPENDENT SCOPES, both applied here, neither expressible as a filter:
 *
 *   institution   through the parent Asset, which is where `institution_id`
 *                 lives — `asset_units` has no column of its own (`BR-007`)
 *   department    `unitScopeFilter`, contributing nothing for the other two
 *                 tiers and restricting a PIC to their current posts
 *
 * `required: true` on the asset include is what makes the first one a scope
 * rather than a suggestion: it is an INNER JOIN, so a unit whose asset falls
 * outside the caller's institution cannot appear at all.
 *
 * The parent asset's `id` and `name` are returned per row. That is contextual
 * information about a unit the caller is already authorized to hold, not a way
 * to browse assets: there is no way to reach an asset with no unit in scope, and
 * `GET /assets/:id` is unaffected and still answers 403 without `asset:read`.
 */
async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['createdAt', 'DESC']],
  });

  // The department narrowing. Merged AFTER the user's filters so a supplied
  // `departmentId` cannot displace it — `Op.and` of both, never a replacement.
  const scoped = unitScopeFilter(principal);
  options.where = Object.keys(scoped).length
    ? { [Op.and]: [options.where, scoped] }
    : options.where;

  const { rows, pagination } = await paginate(models.AssetUnit, options, {
    include: [
      {
        association: 'asset',
        attributes: ['id', 'name'],
        // The institution scope, as an INNER JOIN. `where: {}` for a
        // system-wide caller, which changes nothing.
        required: true,
        where: scopeFilter(principal),
      },
      { association: 'department', attributes: ['id', 'code', 'name'] },
      { association: 'currentLocation', attributes: ['id', 'name'] },
    ],
    // All three are `belongsTo`, so none can multiply the row count and the
    // count stays correct without `distinct` — the same reasoning
    // `listForAsset` already relies on.
  });

  return { rows: rows.map(serialize), pagination };
}

/** Units belonging to one asset — `06-api.md` §5.1. */
async function listForAsset(assetId, params, principal, { models = getModels() } = {}) {
  await assetService.getById(assetId, principal, { models });

  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['createdAt', 'ASC']],
  });

  // Institution scope came from the asset above; this adds the PIC narrowing —
  // Phase 22. It contributes nothing for the other two tiers.
  options.where = { ...options.where, assetId, ...unitScopeFilter(principal) };

  const { rows, pagination } = await paginate(models.AssetUnit, options, {
    // A `belongsTo` cannot multiply the row count, so the join needs no
    // `distinct` — the same reasoning `currentLocation` already relies on.
    // `include` belongs in the third argument: `paginate` reads only the
    // pagination keys off the second one.
    include: [{ association: 'department', attributes: ['id', 'code', 'name'] }],
  });

  return { rows: rows.map(serialize), pagination };
}

/**
 * The unit's procurement line — REQ-PROC-006.
 *
 * Beyond existence, the item must not contradict the asset's own contract
 * (REQ-ASSET-011): a unit claiming to have arrived under contract item X while
 * its asset says it was established under a DIFFERENT contract is a traceability
 * record that disagrees with itself. An asset with no contract is not a
 * contradiction — there is nothing yet to disagree with — so the link is allowed
 * and the asset can be traced later.
 */
async function assertContractItem(contractItemId, asset, models) {
  if (!contractItemId) return;

  const item = await models.ContractItem.findByPk(contractItemId);
  if (!item) {
    throw new ValidationError('The contract item does not exist', [
      { field: 'contractItemId', issue: 'must reference an existing contract item' },
    ]);
  }

  if (asset.contractId && item.contractId !== asset.contractId) {
    throw new ValidationError('The contract item belongs to a different contract', [
      {
        field: 'contractItemId',
        issue: 'must belong to the contract the asset was established under',
      },
    ]);
  }
}

async function create(assetId, body, principal, { models = getModels() } = {}) {
  const asset = await assetService.getById(assetId, principal, { models });

  /**
   * A PIC-scoped caller cannot reach this at all — `CR-004` OQ-1.
   *
   * `asset-unit:create` is outside `PIC_ALLOWED_PERMISSIONS`, so the ceiling
   * suppresses it and the route answers `403` before the service is entered. A
   * PIC manages EXISTING units; registering one is an Asset-administration act.
   *
   * The check below is kept as the second layer rather than deleted: it now
   * refuses any `departmentId` a PIC supplies, exactly as `update` does.
   * `CR-003` gave this call site an `allowOwn` exception, which OQ-1 removed
   * along with the capability that needed it.
   */
  assertCanAssignDepartment(principal, body.departmentId);
  await assertDepartmentAssignable(body.departmentId, asset, { models });
  await assertContractItem(body.contractItemId, asset, models);

  // One transaction: the code is allocated by reading the codes already issued
  // for this institution and year, so the read and the insert have to be atomic
  // or two concurrent registrations mint the same one (REQ-UNIT-007).
  /**
   * Required exactly when the institution's format asks for one, and refused
   * otherwise (`CR-007`). Resolved before the transaction opens so a bad request
   * costs no lock.
   */
  const institution = asset.institutionId
    ? await models.Institution.findByPk(asset.institutionId)
    : null;

  const [numberComposition = null] = resolveCompositions(institution, {
    single: body.numberComposition,
    count: 1,
  });

  const { numberComposition: _supplied, ...unitBody } = body;

  const unit = await withTransaction(
    async (transaction) => {
      const [inventoryCode] = await allocateCodesForAsset(asset, 1, {
        models,
        transaction,
        // The department this unit is about to carry — the format may name it
        // (`CR-006`). Already validated by `assertDepartmentAssignable` above.
        departmentId: body.departmentId ?? null,
        numberCompositions: numberComposition === null ? [] : [numberComposition],
      });

      return models.AssetUnit.create(
        {
          ...unitBody,
          assetId,
          inventoryCode,
          numberComposition,
          createdBy: principal.userId,
          updatedBy: principal.userId,
        },
        { transaction }
      );
    },
    { sequelize: getSequelize() }
  ).catch((error) => {
    throw asDuplicateCodeError(error, numberComposition === null ? [] : [numberComposition]);
  });

  // Re-read rather than serializing the freshly created row: `create` returns an
  // instance with no associations loaded, so a unit created WITH a department
  // would report `department: null` and the client would show "Not assigned" for
  // a unit that has one. `update` has always gone through `detail` for the same
  // reason.
  return detail(unit.id, principal, { models });
}

/**
 * Editable information only — `06-api.md` §5.2 limits this to description,
 * department and the procurement item. Condition, location and lifecycle state
 * are historical facts and change only through `recordHistory`, so they cannot
 * be edited into a state with no record of how they got there (REQ-LIFE-004).
 *
 * `contractItemId` became editable here in the procurement revision. It is a
 * reference, not a historical fact: a unit registered outside the procurement
 * flow — donated, migrated, or simply added from the asset's own Units tab —
 * previously had no way to ever be traced back to the line item it arrived on,
 * because the only path that set it was `POST /contract-items/:id/assets`
 * (REQ-PROC-006).
 */
async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const unit = await getById(id, principal, { models });

  /**
   * A PIC-scoped caller may not change the department AT ALL — Phase 22
   * (`CR-003` §6, client decision 6). Not to another department, not to their
   * own, and not to null.
   *
   * Checked only when the field is actually present: a PIC-scoped user editing
   * a description must not be refused for a field they never sent. `.partial()`
   * makes `undefined` mean "not supplied" and `null` mean "clear it", and the
   * second is as forbidden as any other move.
   */
  if (body.departmentId !== undefined) {
    assertCanAssignDepartment(principal, body.departmentId);
  }

  await assertDepartmentAssignable(body.departmentId, unit.asset, { models });
  await assertContractItem(body.contractItemId, unit.asset, models);

  await unit.update({ ...body, updatedBy: principal.userId });

  return detail(id, principal, { models });
}

async function setActive(id, isActive, principal, options = {}) {
  const models = options.models ?? getModels();
  const unit = await getById(id, principal, { models });

  if (unit.isActive === isActive) {
    throw new ConflictError(`Asset unit is already ${isActive ? 'active' : 'inactive'}`);
  }

  await unit.update({ isActive, updatedBy: principal.userId });

  return detail(id, principal, { models });
}

/** Longitudinal history, newest first — REQ-UNIT-006, REQ-LOC-004, REQ-COND-004. */
async function history(id, params, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  const findOptions = toFindOptions(params, {
    filters: {},
    sortable: ['effectiveFrom', 'createdAt'],
    defaultSort: [['effectiveFrom', 'DESC']],
  });

  const { rows, pagination } = await paginate(models.LongitudinalHistory, {
    ...findOptions,
    where: { assetUnitId: id },
  });

  return { rows: rows.map(serializeHistory), pagination };
}

/** Location assignment history — REQ-LOC-004, §11.5. */
async function locationHistory(id, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  const rows = await models.AssetUnitLocation.findAll({
    where: { assetUnitId: id },
    order: [['assignedAt', 'DESC']],
  });

  return rows.map(serializeLocationAssignment);
}

/**
 * Applies one state change to an already-loaded unit, inside a transaction the
 * caller owns — REQ-LOC-003, REQ-COND-003, REQ-LIFE-002/003.
 *
 * Four writes that must succeed or fail together (REQ-NFR-REL-001):
 *
 *   1. close the previous history row's `effectiveTo`
 *   2. insert the new history row
 *   3. maintain `asset_unit_locations` when the location changed
 *   4. sync the denormalized columns on `asset_units`
 *
 * A partial application would leave the unit's current state disagreeing with
 * its own history, which is the one thing this table exists to prevent.
 *
 * Separated from `recordHistory` so an operation spanning several units —
 * activating or returning a Borrowing (Phase 7) — can apply the same rules to
 * each of them within ONE transaction, rather than reimplementing the write and
 * risking a second definition of what a state change means.
 *
 * `entryType` is REQUIRED — Phase 31 (`CR-012` `DEC-B`), REQ-COND-006. It is a
 * parameter rather than something inferred here because only the CALLER knows
 * why it is writing: this function cannot tell an inspection from a return, and
 * `CR-011` `DEC-E` already demonstrated that guessing it from the description
 * text works for exactly two hardcoded strings and nothing else.
 */
async function applyStateChange(
  unit,
  body,
  principal,
  { models = getModels(), transaction, entryType }
) {
  const id = unit.id;

  /**
   * A programming error, not a request error — hence `Error` rather than
   * `ValidationError`: no caller input reaches this, and answering `400` would
   * blame the client for a missing argument in our own code.
   *
   * This is the guard the absent column default (migration 048) exists to make
   * necessary. Without both, a writer that forgot `entryType` would produce a
   * row that silently counts as a monthly assessment.
   */
  if (!HISTORY_ENTRY_TYPES.includes(entryType)) {
    throw new Error(
      `applyStateChange requires entryType to be one of ${HISTORY_ENTRY_TYPES.join(', ')}; ` +
        `received ${entryType === undefined ? 'undefined' : JSON.stringify(entryType)}. ` +
        'Every history row must state what produced it (CR-012 DEC-B).'
    );
  }

  const current = await models.LongitudinalHistory.findOne({
    where: { assetUnitId: id, effectiveTo: null },
    order: [['effectiveFrom', 'DESC']],
    transaction,
  });

  // Carry forward whatever the caller did not supply.
  const condition = body.condition ?? current?.condition ?? unit.currentCondition;
  const locationId = body.locationId ?? current?.locationId ?? unit.currentLocationId;
  const lifecycleState = body.lifecycleState ?? unit.lifecycleState;

  if (!condition) {
    throw new ValidationError('A condition is required for the first history entry', [
      { field: 'condition', issue: 'is required when the unit has no recorded condition' },
    ]);
  }

  if (!locationId) {
    throw new ValidationError('A location is required for the first history entry', [
      { field: 'locationId', issue: 'is required when the unit has no recorded location' },
    ]);
  }

  const location = await models.Location.findByPk(locationId, { transaction });
  if (!location) {
    throw new ValidationError('The location does not exist', [
      { field: 'locationId', issue: 'must reference an existing location' },
    ]);
  }

  if (body.lifecycleState) assertTransition(unit.lifecycleState, body.lifecycleState);

  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();

  // The new period must not begin before the one it supersedes, or the unit's
  // timeline would run backwards (chk_longitudinal_history_dates would also
  // reject the close, but with a far less useful message).
  if (current && effectiveFrom < current.effectiveFrom) {
    throw new ValidationError('The effective date precedes the current history entry', [
      {
        field: 'effectiveFrom',
        issue: `must be on or after ${current.effectiveFrom.toISOString()}`,
      },
    ]);
  }

  if (current) {
    await current.update({ effectiveTo: effectiveFrom }, { transaction });
  }

  await models.LongitudinalHistory.create(
    {
      assetUnitId: id,
      description: body.description,
      condition,
      locationId,
      lifecycleState,
      entryType,
      effectiveFrom,
      createdBy: principal.userId,
    },
    { transaction }
  );

  if (unit.currentLocationId !== locationId) {
    await models.AssetUnitLocation.update(
      { isCurrent: false, unassignedAt: effectiveFrom },
      { where: { assetUnitId: id, isCurrent: true }, transaction }
    );

    await models.AssetUnitLocation.create(
      { assetUnitId: id, locationId, isCurrent: true, assignedAt: effectiveFrom },
      { transaction }
    );
  }

  await unit.update(
    {
      currentCondition: condition,
      currentLocationId: locationId,
      lifecycleState,
      updatedBy: principal.userId,
    },
    { transaction }
  );
}

/**
 * Records a new state snapshot — `06-api.md` §5.2, REQ-LOC-003, REQ-COND-003,
 * REQ-LIFE-002/003.
 *
 * Deliberately ONE endpoint rather than separate move / change-condition /
 * change-state operations: `LongitudinalHistory` is a single row holding all
 * three together, so moving a unit and changing its condition are the same
 * write. Omitted fields carry forward from the current snapshot.
 *
 * THE ONE WRITER OF `MANUAL` (`CR-012`, REQ-COND-006). A person reached this
 * through `POST /asset-units/:id/history`, which is what a monthly assessment
 * is. `entryType` is set here and is not accepted from the body — the write
 * schema is strict, so a caller that sends it receives a `400` naming the
 * field rather than being able to declare a borrowing return an assessment.
 */
async function recordHistory(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const unit = await getById(id, principal, { models });

  await withTransaction(
    (transaction) =>
      applyStateChange(unit, body, principal, { models, transaction, entryType: 'MANUAL' }),
    { sequelize }
  );

  return detail(id, principal, { models });
}

/**
 * Allocates inventory codes for units about to be registered against `asset`.
 *
 * TWO ABSENCES, AND THEY ARE NOT THE SAME (REQ-UNIT-007).
 *
 * Returns `[null, ...]` when the asset has no institution: there is no
 * institution, therefore no format, and nothing to build a code from. A
 * placeholder would be frozen onto a printed label the moment one is produced.
 * The unit is still registered — it simply cannot be labelled until its asset
 * gains an institution.
 *
 * But when the institution's own format names a value this registration does
 * not have — a department, today — `buildPrefix` THROWS and the registration
 * fails, naming the field. The institution asked for that value in every code;
 * quietly registering a unit that can never be labelled would be a failure
 * discovered at the printer.
 *
 * Shared by this module's single-unit path and the procurement path, which
 * registers `unitCount` units at once. Every unit in such a batch shares this
 * asset, department, institution and year, so they share one prefix — hence one
 * lock and one scan for the whole batch rather than `unitCount` of each.
 */
async function allocateCodesForAsset(
  asset,
  count,
  { models = getModels(), transaction, departmentId = null, numberCompositions = [] }
) {
  if (!asset.institutionId) return Array.from({ length: count }, () => null);

  const institution = await models.Institution.findByPk(asset.institutionId, { transaction });
  if (!institution) return Array.from({ length: count }, () => null);

  const format = formatFor(institution);
  const tokens = tokensIn(format);

  /**
   * Loaded only when the format actually names them — most formats want none of
   * this, and the common registration path should stay at the queries `CR-006`
   * already made. But loaded BEFORE the code is built, because a missing value
   * is reported as a validation error rather than guessed at.
   */
  const department =
    departmentId && tokens.has('DEPARTMENT_CODE')
      ? await models.Department.findByPk(departmentId, { transaction })
      : null;

  const classification = tokens.has('CLASSIFICATION_LEAF_LABEL')
    ? await models.AssetClassification.findByPk(asset.classificationId, { transaction })
    : null;

  /**
   * Two nullable hops: `assets.contract_id` is nullable for donated,
   * self-constructed and migrated assets, and the contract's own funding source
   * is optional. Either absence refuses the registration rather than dropping
   * the segment (`DEC-117`).
   */
  const contract =
    asset.contractId && tokens.has('FUNDING_SOURCE_CODE')
      ? await models.Contract.findByPk(asset.contractId, {
          include: [{ association: 'fundingSource', attributes: ['id', 'code'] }],
          transaction,
        })
      : null;

  const context = {
    institution,
    classificationId: asset.classificationId,
    classificationName: classification?.name ?? null,
    department,
    fundingSourceCode: contract?.fundingSource?.code ?? null,
    at: new Date(),
  };

  /**
   * ONE RENDERER, TWO OUTCOMES — `CR-007` `DEC-123`.
   *
   * `buildPrefix` walks the format and stops at the sequence. When a format has
   * no sequence there is nothing to stop at, so what comes back is not a prefix
   * at all: it is the finished code. That is why this generalises without a
   * second implementation.
   */
  if (!formatHasSequence(format)) {
    // One rendering per unit, because each carries its own typed composition.
    // Where the format uses no composition either, validation would have
    // refused it — a format with neither distinguishing segment cannot be
    // stored (REQ-UNIT-007).
    return numberCompositions.map((numberComposition) =>
      buildPrefix(format, { ...context, numberComposition })
    );
  }

  /**
   * With a sequence, every unit in a batch shares one leading text — including
   * the composition, when the format has one — so the whole batch still costs a
   * single advisory lock and a single scan.
   */
  const prefix = buildPrefix(format, { ...context, numberComposition: numberCompositions[0] });

  return allocateCodes({ prefix, count }, { sequelize: models.AssetUnit.sequelize, transaction });
}

/**
 * Decides what the caller must supply, and refuses what the format did not ask
 * for — `CR-007`, REQ-UNIT-007.
 *
 * Required exactly when the institution's format uses the token, and rejected
 * otherwise: an institution that never asked for a composition should not be
 * able to store one, because it would sit on the row meaning nothing. The route
 * schema cannot express this — it does not know the institution — so it accepts
 * the field and this decides.
 *
 * @param {object|null} institution
 * @param {{ single?: unknown, list?: unknown, count: number }} supplied
 * @returns {string[]} one composition per unit, or an empty array
 */
function resolveCompositions(institution, { single, list, count }) {
  const format = institution ? formatFor(institution) : null;
  const uses = Boolean(format) && formatUsesComposition(format);
  const perUnit = uses && !formatHasSequence(format);

  const provided = single !== undefined && single !== null;
  const providedList = Array.isArray(list);

  if (!uses) {
    if (provided || providedList) {
      throw new ValidationError('This institution does not use a number composition', [
        {
          field: 'numberComposition',
          issue:
            "the institution's inventory code format does not include one, so a value here " +
            'would be stored without ever appearing in a code (REQ-ORG-007)',
        },
      ]);
    }
    return [];
  }

  if (perUnit) {
    /**
     * Registering ONE unit needs one value, whichever regime the format is in —
     * `perUnit` only decides whether a BATCH may share one. The single-unit
     * endpoint therefore sends `numberComposition`, and it is correct.
     */
    if (provided && !providedList && count === 1) return [single];

    if (provided) {
      throw new ValidationError('Each unit needs its own number composition', [
        {
          field: 'numberCompositions',
          issue:
            "this institution's format allocates no sequence, so one value cannot distinguish " +
            `${count} units; supply ${count} values (REQ-UNIT-007)`,
        },
      ]);
    }

    if (!providedList || list.length !== count) {
      throw new ValidationError('Each unit needs its own number composition', [
        {
          // A single unit has nothing to list, so the field it can act on is the
          // singular one.
          field: count === 1 ? 'numberComposition' : 'numberCompositions',
          issue:
            count === 1
              ? "this institution's inventory code format includes one (REQ-ORG-007)"
              : `must contain exactly ${count} value(s), one per unit`,
        },
      ]);
    }

    /**
     * Refused here rather than at the index, so the caller gets one clear error
     * naming the repeat instead of a partially written batch and a `409`.
     */
    const seen = new Set();
    for (const value of list) {
      if (seen.has(value)) {
        throw new ValidationError('Two units cannot share a number composition', [
          {
            field: 'numberCompositions',
            issue: `"${value}" appears more than once, and every unit needs its own code`,
          },
        ]);
      }
      seen.add(value);
    }

    return list;
  }

  // A sequence distinguishes the units, so one value covers the whole batch.
  if (providedList) {
    throw new ValidationError('One number composition covers this batch', [
      {
        field: 'numberComposition',
        issue:
          "this institution's format allocates a sequence, which distinguishes the units; " +
          'supply a single value',
      },
    ]);
  }

  if (!provided) {
    throw new ValidationError('A number composition is required', [
      {
        field: 'numberComposition',
        issue: "this institution's inventory code format includes one (REQ-ORG-007)",
      },
    ]);
  }

  return Array.from({ length: count }, () => single);
}

/**
 * Reports a duplicate code against the field the caller actually wrote.
 *
 * Where a format allocates a sequence, uniqueness holds by construction and this
 * is unreachable. Where it does not, the index is the only guarantee (`BR-020`)
 * — and `translateDatabaseError` would name `inventory_code`, a column no
 * caller supplies. The composition is what they can change.
 */
function asDuplicateCodeError(error, compositions) {
  const isDuplicateCode =
    error?.name === 'SequelizeUniqueConstraintError' &&
    error?.parent?.constraint === 'uq_asset_units_inventory_code';

  if (!isDuplicateCode || compositions.length === 0) return error;

  return new ConflictError('That inventory code has already been issued', [
    {
      field: 'numberComposition',
      issue:
        'a unit already carries the code this number composition produces; ' +
        'choose a different one',
    },
  ]);
}

/**
 * The unit a scanned label resolves to — REQ-UNIT-011, `06-api.md` §5.2.
 *
 * Organization-scoped like every other read: a code belonging to another
 * institution answers `404`, indistinguishable from one that was never issued
 * (`BR-007`, `06-api.md` §1.4). Anyone can hold a phone up to a label; that is
 * exactly why this reveals nothing without a session that reaches the record.
 */
async function getByInventoryCode(inventoryCode, principal, { models = getModels() } = {}) {
  const unit = await models.AssetUnit.findOne({
    where: { inventoryCode },
    include: [
      {
        association: 'asset',
        attributes: ['id', 'name', 'institutionId', 'classificationId', 'contractId'],
      },
      { association: 'currentLocation', attributes: ['id', 'name'] },
    ],
  });

  if (!unit) throw new NotFoundError('Asset unit not found');
  assertCanAccess(principal, unit.asset, { label: 'Asset unit' });
  // The QR scan path (REQ-UNIT-011): a unit outside the caller's reach must be
  // indistinguishable from a code that was never issued.
  assertCanAccessUnit(principal, unit);

  return unit;
}

const detailByCode = async (code, principal, options) =>
  serialize(await getByInventoryCode(code, principal, options));

/**
 * Everything a printed label needs, in one call — REQ-UNIT-009.
 *
 * Deliberately NOT the unit detail. A label carries only what holds for the life
 * of the unit (`BR-021`): location, condition, lifecycle state and holder are
 * absent because a sticker outlives every one of them and cannot be recalled to
 * be corrected.
 *
 * The classification is returned as code AND name. The name can be renamed
 * (REQ-CLASS-016); the code cannot, so a label carrying both stays resolvable
 * after a rename even though its printed name has gone stale.
 */
async function label(id, principal, { models = getModels() } = {}) {
  const unit = await getById(id, principal, { models });
  return buildLabel(unit, { models });
}

async function buildLabel(unit, { models = getModels() } = {}) {
  if (!unit.inventoryCode) {
    throw new ValidationError('This unit has no inventory code, so it cannot be labelled', [
      {
        field: 'institutionId',
        issue:
          "the unit's asset has no owning institution, and an inventory code is built from one; " +
          'set the institution on the asset first (REQ-UNIT-007)',
      },
    ]);
  }

  const [institution, classification, department] = await Promise.all([
    unit.asset.institutionId
      ? models.Institution.findByPk(unit.asset.institutionId)
      : Promise.resolve(null),
    models.AssetClassification.findByPk(unit.asset.classificationId),
    unit.departmentId ? models.Department.findByPk(unit.departmentId) : Promise.resolve(null),
  ]);

  return {
    assetUnitId: unit.id,
    inventoryCode: unit.inventoryCode,
    assetId: unit.asset.id,
    assetName: unit.asset.name,
    institution: institution
      ? { id: institution.id, name: institution.name, code: institution.code }
      : null,
    classification: classification
      ? { id: normalizeCharKey(classification.id), name: classification.name }
      : null,
    // Code AND name, for the reason the classification already gives: a name can
    // be renamed while a code is stable, so a label carrying both stays
    // readable after a rename (`BR-021`). Phase 20 (`CR-003`) made `id` a
    // surrogate UUID, which is meaningless on a printed sticker.
    department: department
      ? { id: department.id, code: department.code, name: department.name }
      : null,
  };
}

/**
 * The label payload for every unit of one asset — REQ-UNIT-010.
 *
 * A complete collection rather than a page (`06-api.md` §1.5): the caller is
 * printing a sheet, and a sheet with page two missing is not a smaller sheet.
 * Units with no code are skipped rather than failing the whole batch — one
 * unlabellable unit should not stop the other eleven being printed.
 */
async function labelsForAsset(assetId, principal, { models = getModels() } = {}) {
  await assetService.getById(assetId, principal, { models });

  const units = await models.AssetUnit.findAll({
    // The PIC narrowing — `CR-004` §6.3. This is the FOURTH surface listing
    // units; the other three took `unitScopeFilter` in Phase 22 and this one
    // was missed, so a PIC-scoped caller could read the code, department and
    // classification of every unit of any asset in their institution — without
    // `asset:read`, since the containment check above is not a permission gate.
    where: { assetId, ...unitScopeFilter(principal) },
    include: [
      {
        association: 'asset',
        attributes: ['id', 'name', 'institutionId', 'classificationId'],
      },
    ],
    order: [['inventoryCode', 'ASC']],
  });

  const labelled = units.filter((unit) => unit.inventoryCode);

  return Promise.all(labelled.map((unit) => buildLabel(unit, { models })));
}

/** The classification a unit's attribute values must belong to (`BR-010`). */
async function classificationFor(unit, { models = getModels() } = {}) {
  const asset = unit.asset ?? (await models.Asset.findByPk(unit.assetId));
  return normalizeCharKey(asset.classificationId);
}

module.exports = {
  list,
  listForAsset,
  detail,
  create,
  update,
  deactivate: (id, principal, options) => setActive(id, false, principal, options),
  reactivate: (id, principal, options) => setActive(id, true, principal, options),
  history,
  locationHistory,
  recordHistory,
  applyStateChange,
  getById,
  getByInventoryCode,
  detailByCode,
  label,
  labelsForAsset,
  allocateCodesForAsset,
  resolveCompositions,
  asDuplicateCodeError,
  classificationFor,
  serialize,
  serializeHistory,
  serializeLocationAssignment,
  SORTABLE,
};
