'use strict';

/**
 * Organization scope enforcement — `BR-007`, `DR-009`, REQ-AUTHZ-004/005.
 *
 * `05-infrastructure.md` §12.3 is explicit that this is enforced in the query
 * layer and that no infrastructure control substitutes for it. Phase 3 built the
 * decision (`principal.scopeWhere`); this is where it starts being applied,
 * because Phase 5 is the first phase whose records carry an `institution_id`.
 *
 * Two rules, and both matter:
 *
 *   1. Reads are FILTERED. A record outside the caller's scope must not appear
 *      in a list, and must answer `404` on direct access — `06-api.md` §1.4 says
 *      NOT_FOUND covers "outside the caller's org scope", so out-of-scope is
 *      indistinguishable from absent and existence does not leak.
 *   2. Writes are CHECKED. A caller must not create or move a record into an
 *      institution they cannot reach.
 */

const { Op, literal } = require('sequelize');

const { NotFoundError, ValidationError } = require('../errors');
const { organizationScope } = require('../auth/principal');
const { getSequelize } = require('../db/sequelize');

/**
 * A `where` fragment restricting a query to the caller's scope.
 *
 * @param {import('../auth/principal').Principal} principal
 * @param {string} [column]
 * @returns {object} `{}` when a system-wide role lifts the scope
 */
function scopeFilter(principal, column = 'institutionId') {
  const scope = organizationScope(principal);
  return scope.unrestricted ? {} : { [column]: scope.institutionId };
}

/** Whether the caller may act on a record belonging to `institutionId`. */
function canAccessInstitution(principal, institutionId) {
  const scope = organizationScope(principal);
  if (scope.unrestricted) return true;
  return (institutionId ?? null) === scope.institutionId;
}

/**
 * Guards a record already loaded from the database.
 *
 * Throws `NotFoundError`, never `ForbiddenError`: confirming that a record
 * exists but belongs to someone else is itself a disclosure.
 *
 * @throws {NotFoundError}
 */
function assertCanAccess(principal, record, { label = 'Resource', column = 'institutionId' } = {}) {
  if (!record) throw new NotFoundError(`${label} not found`);

  if (!canAccessInstitution(principal, record[column])) {
    throw new NotFoundError(`${label} not found`);
  }

  return record;
}

/**
 * Guards an institution supplied in a request body.
 *
 * A `VALIDATION_ERROR` here rather than `NOT_FOUND`: the caller named a value in
 * a field they control, so the response points at the field.
 *
 * @throws {ValidationError}
 */
function assertCanAssignInstitution(principal, institutionId, { field = 'institutionId' } = {}) {
  if (canAccessInstitution(principal, institutionId)) return;

  throw new ValidationError('You cannot assign a record to that institution', [
    { field, issue: 'is outside your organization scope (BR-007)' },
  ]);
}

/**
 * The institution a new record should carry when the caller did not name one.
 *
 * A scoped caller creating a record without naming an institution gets their
 * own, which is what makes the common case correct by default rather than by
 * the caller remembering.
 */
function defaultInstitutionFor(principal, supplied) {
  if (supplied !== undefined) return supplied;
  const scope = organizationScope(principal);
  return scope.unrestricted ? null : scope.institutionId;
}

// --- Asset Unit record scope — Phase 22 (`CR-003` §6.2), REQ-AUTHZ-007 -------

/**
 * The three tiers, applied to Asset Units.
 *
 * System-wide and institution callers are unaffected by everything below: their
 * reach is decided by `institution_id` on the parent Asset, exactly as before.
 * A PIC-scoped caller reaches ONLY units whose `department_id` is a department
 * they are CURRENTLY the person in charge of.
 *
 * Two mechanisms, matching the `scopeFilter` / `assertCanAccess` pair that
 * already exists for institutions, because units are reached two different ways:
 * three list paths query `asset_units` directly, and everything else goes
 * through `assetUnits/service.js getById`. A filter alone would leave the record
 * paths open; a guard alone would leave the lists open.
 */

/**
 * A `where` fragment narrowing an Asset Unit query to the caller's reach.
 *
 * Contributes NOTHING for system-wide and institution callers — their scope is
 * already applied through the parent record, and adding a second condition here
 * would silently change what those lists mean.
 *
 * @returns {object} `{}` unless the caller is PIC-scoped
 */
function unitScopeFilter(principal) {
  const scope = organizationScope(principal);
  if (!scope.picScoped) return {};

  /**
   * `IN (…)` never matches NULL, which is precisely the rule: a unit with no
   * department has no departmental responsibility, so a PIC-scoped user must not
   * reach it (`CR-003` §5.5). That is not a side effect being relied on — it is
   * stated here because a future rewrite to `Op.or` would quietly reverse it.
   *
   * An empty set yields `IN ()`, which matches nothing. A PIC-scoped user who
   * holds no post reaches no units, which is correct.
   */
  return { departmentId: { [Op.in]: [...scope.picDepartmentIds] } };
}

/**
 * Guards a unit already loaded from the database.
 *
 * `NotFoundError`, like `assertCanAccess`: a unit the caller may not reach must
 * be indistinguishable from one that does not exist. That matters most on the
 * QR scan path, where REQ-UNIT-011 already requires a code from another
 * institution to look identical to a code never issued.
 *
 * @throws {NotFoundError}
 */
function assertCanAccessUnit(principal, unit, { label = 'Asset unit' } = {}) {
  const scope = organizationScope(principal);
  if (!scope.picScoped) return unit;

  if (!unit?.departmentId || !scope.picDepartmentIds.has(unit.departmentId)) {
    throw new NotFoundError(`${label} not found`);
  }

  return unit;
}

/**
 * Guards a department supplied in a request body.
 *
 * A PIC-scoped caller may not set `departmentId` AT ALL — not to another
 * department, not to their own, and not to null (`CR-003` `DEC-097`). Moving a
 * unit between departments is an institution-scoped act: allowing a PIC to do it
 * would let them pull units into their own scope, or push an inconvenient one
 * out of it, which is the whole boundary this draws.
 *
 * `CR-003` carried an `allowOwn` exception for unit creation. `CR-004` OQ-1
 * forbids `asset-unit:create` to PIC-scoped roles outright, so that branch had
 * no reachable caller left and was removed: a dead branch that grants a
 * capability the model forbids is the kind of thing that gets switched back on
 * by accident.
 *
 * `ValidationError` rather than `ForbiddenError`, following
 * `assertCanAssignInstitution`: the caller named a value in a field they
 * control, so the response points at the field.
 *
 * @throws {ValidationError}
 */
function assertCanAssignDepartment(principal, departmentId, { field = 'departmentId' } = {}) {
  if (!organizationScope(principal).picScoped) return;

  throw new ValidationError("You cannot change an asset unit's department", [
    {
      field,
      issue: 'moving a unit between departments requires institution scope (CR-003)',
    },
  ]);
}

// --- Operational-record scope — `CR-004` §4, §5, REQ-AUTHZ-007 ---------------

/**
 * How to reach the Asset Units a record is built from.
 *
 * `allowEmptyForCreator` is the empty-DRAFT rule (`CR-004` §4.3) and is true for
 * Borrowings alone: a borrowing header is created before its items, so without
 * it a PIC-scoped user would create one and get `404` on the very next request.
 * Transactions require `items.min(1)` at create, so an empty one cannot exist and
 * the exception would invent a state the domain does not have.
 */
const BORROWING_COVERAGE = {
  itemTable: '"public"."borrowing_items"',
  parentColumn: '"borrowing_id"',
  parentTable: '"Borrowing"',
  allowEmptyForCreator: true,
};

const TRANSACTION_COVERAGE = {
  itemTable: '"public"."transaction_items"',
  parentColumn: '"transaction_id"',
  parentTable: '"Transaction"',
  allowEmptyForCreator: false,
};

/**
 * `true` when the record identified by `parentRef` holds NO unit outside the
 * caller's departments — the all-or-nothing rule of `CR-004` §9.
 *
 * `parentRef` is whatever the surrounding SQL calls the parent's id: a column
 * reference for a list filter, an escaped literal for a single-record guard.
 *
 * Expressed as `NOT EXISTS (a disqualifying unit)` rather than "every unit
 * qualifies" because SQL has no universal quantifier, and because the
 * negated-existential form is the one Postgres satisfies with the existing
 * `idx_borrowing_items_unit` / `idx_transaction_items_unit`.
 *
 * `department_id IS NULL` IS MATCHED EXPLICITLY, AND MUST STAY THAT WAY.
 * Leaving NULL to `NOT IN` would invert the rule rather than merely weaken it:
 * `NULL NOT IN (…)` evaluates to UNKNOWN, the `NOT EXISTS` would never see the
 * row, and a record holding an unassigned unit would be judged IN scope — the
 * exact opposite of `CR-004` §10. Two tests pin this behaviour.
 */
function noForeignUnitSql(spec, parentRef, departmentIds, sequelize) {
  const { itemTable, parentColumn } = spec;

  /**
   * A caller holding no post reaches no unit, so any record WITH items is out of
   * scope. Branched rather than generated: `NOT IN ()` is a syntax error in
   * Postgres, so an empty list cannot be spelled at all.
   */
  if (departmentIds.length === 0) {
    return `NOT ${hasItemsSql(spec, parentRef)}`;
  }

  const ids = departmentIds.map((id) => sequelize.escape(id)).join(', ');

  return `NOT EXISTS (
    SELECT 1 FROM ${itemTable} i
    JOIN "public"."asset_units" u ON u."id" = i."asset_unit_id"
    WHERE i.${parentColumn} = ${parentRef}
      AND (u."department_id" IS NULL OR u."department_id" NOT IN (${ids})))`;
}

/** `true` when the record holds at least one item. */
function hasItemsSql(spec, parentRef) {
  return `EXISTS (SELECT 1 FROM ${spec.itemTable} i WHERE i.${spec.parentColumn} = ${parentRef})`;
}

/**
 * A `where` fragment narrowing a Borrowing or Transaction list to the caller's
 * reach — `CR-004` §4.4, §5.
 *
 * Contributes NOTHING for system-wide and institution callers, exactly like
 * `unitScopeFilter`: their scope is already applied through `institution_id`,
 * and a second condition here would silently change what those lists mean.
 *
 * @param {object} spec `BORROWING_COVERAGE` or `TRANSACTION_COVERAGE`
 * @returns {object} `{}` unless the caller is PIC-scoped
 */
function unitCoverageFilter(principal, spec, { sequelize = getSequelize() } = {}) {
  const scope = organizationScope(principal);
  if (!scope.picScoped) return {};

  const parentRef = `${spec.parentTable}."id"`;
  const clauses = [noForeignUnitSql(spec, parentRef, [...scope.picDepartmentIds], sequelize)];

  if (spec.allowEmptyForCreator) {
    /**
     * The empty-DRAFT rule (`CR-004` §4.3), conjunctive with the clause above.
     * It can therefore never widen access to a record holding any unit — not
     * even one the caller created — so it leaks nothing: an empty borrowing
     * contains no Asset Unit information at all.
     */
    clauses.push(
      `(${hasItemsSql(spec, parentRef)} OR ${spec.parentTable}."created_by" = ${sequelize.escape(
        principal.userId
      )})`
    );
  }

  return { [Op.and]: clauses.map((sql) => literal(`(${sql})`)) };
}

/**
 * Guards a Borrowing or Transaction already loaded from the database.
 *
 * `NotFoundError`, never `ForbiddenError` — `CR-004` §12. A record holding
 * another department's unit is not "visible but off-limits"; it is outside the
 * caller's record set entirely, and a `403` would confirm its existence to
 * someone whose scope says it does not exist for them. That is precisely why
 * `assertNotPicScoped` was deleted rather than retargeted.
 *
 * Runs AFTER `assertCanAccess`, so a cross-institution id still answers `404`
 * for the institution reason and the two rules stay independently testable.
 *
 * The creator half of the empty-DRAFT rule is decided in JavaScript rather than
 * SQL: the record is already loaded, so comparing `createdBy` here is both
 * cheaper and clearer than teaching the query about a table alias it does not
 * have in a bare `SELECT`.
 *
 * @throws {NotFoundError}
 */
async function assertCanAccessByUnits(principal, record, spec, options = {}) {
  const { label = 'Resource', sequelize = getSequelize(), transaction } = options;

  const scope = organizationScope(principal);
  if (!scope.picScoped) return record;
  if (!record) throw new NotFoundError(`${label} not found`);

  const parentRef = sequelize.escape(record.id);

  const [row] = await sequelize.query(
    `SELECT ${noForeignUnitSql(
      spec,
      parentRef,
      [...scope.picDepartmentIds],
      sequelize
    )} AS "noForeignUnit", ${hasItemsSql(spec, parentRef)} AS "hasItems"`,
    { type: sequelize.QueryTypes.SELECT, transaction }
  );

  const covered =
    row.noForeignUnit &&
    (row.hasItems || (spec.allowEmptyForCreator && record.createdBy === principal.userId));

  if (!covered) throw new NotFoundError(`${label} not found`);

  return record;
}

module.exports = {
  scopeFilter,
  canAccessInstitution,
  assertCanAccess,
  assertCanAssignInstitution,
  defaultInstitutionFor,
  unitScopeFilter,
  assertCanAccessUnit,
  assertCanAssignDepartment,
  BORROWING_COVERAGE,
  TRANSACTION_COVERAGE,
  unitCoverageFilter,
  assertCanAccessByUnits,
};
