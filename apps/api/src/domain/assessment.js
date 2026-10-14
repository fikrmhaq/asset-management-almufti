'use strict';

/**
 * Monthly assessment — Phase 32 (`CR-012`), REQ-COND-006, REQ-REPORT-011/012.
 *
 * ── The rule, once ─────────────────────────────────────────────────────────
 *
 * Every APPLICABLE asset unit belonging to a department must have at least one
 * QUALIFYING manual assessment during the business month. Compliance is
 * measured on UNIQUE asset units; individual activity is counted separately.
 *
 * ── Why this module exists at all ──────────────────────────────────────────
 *
 * Four places need to agree on what "applicable" and "qualifying" mean: the
 * coverage report, the activity report, the `unassessedIn` filter on the unit
 * inventory, and the `assessedIn` filter beside it. If the drill-down list used
 * even a slightly different predicate from the number it was reached through,
 * the two would disagree in front of the person acting on them — and the
 * discrepancy would be found by a user, not by a test.
 *
 * So the predicates live here as SQL fragments, and every consumer composes the
 * same text. `modules/reports/service.js` owns the reports; this owns what they
 * are counting.
 *
 * ── Bind parameters, not interpolation ─────────────────────────────────────
 *
 * Every caller-supplied value goes through `binder()` and reaches PostgreSQL as
 * a bind parameter. The one exception is documented at
 * `assessedUnitIdsSubquery`, which the Sequelize layer needs as literal text and
 * which interpolates nothing but server-computed `Date` values.
 */

const { unitDepartmentScope } = require('./scope');

/**
 * Lifecycle states that put a unit beyond assessment — `CR-012` `DEC-J`.
 *
 * A disposed or deactivated item cannot be inspected, so counting it would make
 * every department permanently short by the number of things it has thrown away.
 *
 * `BORROWED` is NOT here, deliberately. The department remains responsible for a
 * unit that is out on loan, the borrower can be contacted, and excluding it
 * would let a coverage figure be improved by lending equipment out.
 * `UNDER_MAINTENANCE` is not here either: a unit in for repair is precisely one
 * whose condition someone should be recording.
 */
const NON_ASSESSABLE_STATES = Object.freeze(['DISPOSED', 'DEACTIVATED']);

/** The one entry type that satisfies the obligation — `DEC-A`. */
const QUALIFYING_ENTRY_TYPE = 'MANUAL';

/**
 * Collects bind values and hands back the placeholder for each.
 *
 * Positional binds are easy to get wrong once a query is assembled from
 * fragments — a fragment added in the middle renumbers everything after it.
 * This makes the number an output of adding the value rather than something a
 * human counts.
 */
function binder() {
  const values = [];

  return {
    add(value) {
      values.push(value);
      return `$${values.length}`;
    },
    get values() {
      return values;
    },
  };
}

/**
 * The department ids a raw-SQL aggregate must be narrowed to, or `null` for a
 * caller whose scope is already applied through the institution — `DEC-N`.
 *
 * The SQL counterpart of `domain/scope.js unitScopeFilter`, which returns a
 * Sequelize `where` and cannot be used in a raw aggregate. The two must agree:
 * both narrow a PIC-scoped caller to their CURRENT assignments, and both leave
 * every other tier untouched.
 *
 * An empty array for a PIC holding no post is correct and must not be turned
 * into `null` — `= ANY('{}')` matches nothing, which is exactly their reach.
 *
 * @returns {string[]|null}
 */
function unitScopeDepartmentIds(principal) {
  // PIC scope, or a Kajur / Toolman operating scope (P3, §64.3) — one set.
  const departments = unitDepartmentScope(principal);
  return departments ? [...departments] : null;
}

/**
 * The applicable set — `DEC-J`.
 *
 * A CTE body, not a full statement, so each report can name it and join it more
 * than once without repeating the predicate.
 *
 * `created_at < monthEnd` matters for historical months: a unit registered in
 * September was never assessable in August, and without this every past month
 * would appear to degrade as the estate grows.
 *
 * Institution scope reads `departments.institution_id` rather than
 * `assets.institution_id`. The two cannot disagree — `assertDepartmentAssignable`
 * refuses to attach a department from another institution, and
 * `updateDepartment` refuses to move one — and joining from `departments` is
 * what lets a department with no units still appear as a row.
 */
function applicableUnitsCte(bind, { institutionId, departmentIds, departmentId, monthEnd }) {
  // Bound to locals first, and never inline in the template. A placeholder used
  // twice has to be the SAME placeholder, and `bind.add()` called twice would
  // quietly allocate two.
  const excluded = bind.add(NON_ASSESSABLE_STATES);
  const before = bind.add(monthEnd);
  const institution = bind.add(institutionId);
  const scoped = bind.add(departmentIds);
  const department = bind.add(departmentId);

  return `
    SELECT u.id              AS unit_id,
           u.department_id   AS department_id,
           u.lifecycle_state AS lifecycle_state
      FROM public.asset_units u
      JOIN public.departments d ON d.id = u.department_id
     WHERE u.is_active = true
       -- Compared as text so the bound array needs no enum-array cast.
       AND u.lifecycle_state::text <> ALL (${excluded}::text[])
       AND u.created_at < ${before}
       AND (${institution}::uuid  IS NULL OR d.institution_id  = ${institution}::uuid)
       AND (${scoped}::uuid[]     IS NULL OR u.department_id   = ANY (${scoped}::uuid[]))
       AND (${department}::uuid   IS NULL OR u.department_id   = ${department}::uuid)
  `;
}

/**
 * Whether a history row's author was the department's person in charge WHEN THE
 * ROW WAS WRITTEN — `DEC-F`.
 *
 * THE ASSIGNMENT HISTORY, NOT `is_current`. A handover part-way through a month
 * would otherwise retroactively void everything the outgoing PIC recorded, and
 * the incoming one would inherit a department that appears to have done nothing.
 *
 * This does not contradict `CR-003` §11 or `CR-004`: a closed assignment still
 * grants NO ACCESS anywhere, and nothing here is read by `principal.js`,
 * `unitScopeFilter` or any authorization decision. This is attribution — the
 * other half of the distinction `CR-003` drew between authorization and audit.
 *
 * `EXISTS`, never a join. `setPic` closes the outgoing row with the application
 * clock and opens the new one with the database's `now()`, so two adjacent
 * windows can overlap by the width of that skew; a join would count such a row
 * twice, while `EXISTS` cannot.
 *
 * @param {string} history alias of the `longitudinal_history` row
 * @param {string} department SQL expression yielding the unit's department id
 */
function authoredByPicPredicate(history, department) {
  return `
    EXISTS (
      SELECT 1
        FROM public.department_pic_assignments a
       WHERE a.department_id = ${department}
         AND a.user_id       = ${history}.created_by
         AND a.assigned_at  <= ${history}.created_at
         AND (a.ended_at IS NULL OR ${history}.created_at < a.ended_at)
    )
  `;
}

/**
 * Manual entries written during the month, against the applicable set.
 *
 * `created_at`, NOT `effective_from` — `DEC-D`. `effective_from` may be
 * backdated by the recorder; `created_at` defaults to the moment of the write
 * and is never caller-supplied, so a closed month's figure cannot be edited
 * afterwards. `CR-011`'s maintenance sheet buckets on `effective_from` because
 * it asks a different question — when a state APPLIED — and the two must not be
 * reconciled to each other.
 *
 * `created_by IS NOT NULL` is defensive: no writer produces an authorless
 * history row today, and one that did could not satisfy an obligation that is
 * about who did the work.
 */
function manualEntriesCte(bind, { applicable = 'applicable', monthStart, monthEnd }) {
  const entryType = bind.add(QUALIFYING_ENTRY_TYPE);
  const from = bind.add(monthStart);
  const until = bind.add(monthEnd);

  return `
    SELECT h.asset_unit_id,
           ap.department_id,
           h.created_by,
           h.created_at,
           ${authoredByPicPredicate('h', 'ap.department_id')} AS by_pic
      FROM public.longitudinal_history h
      JOIN ${applicable} ap ON ap.unit_id = h.asset_unit_id
     WHERE h.entry_type::text = ${entryType}
       AND h.created_by IS NOT NULL
       AND h.created_at >= ${from}
       AND h.created_at <  ${until}
  `;
}

/**
 * Whether the department's CURRENT person in charge could record an assessment
 * — the `NO_RESPONSIBLE_USER` half of `DEC-I`.
 *
 * PRESENT TENSE, and only for the department's state. `role_permissions` keeps
 * no history, so there is no way to know what a user held last March; making
 * entry qualification depend on a present-tense permission would mean revoking
 * one today silently rewrites last year's figures. Attribution therefore uses
 * the assignment history (above) and eligibility uses the current grant, and
 * the two are never mixed.
 *
 * Reads the GRANTED set. `asset-unit:record-history` is inside
 * `PIC_ALLOWED_PERMISSIONS`, so granted and effective agree for this code.
 * IF THE ELIGIBILITY PREDICATE IS EVER WIDENED to a code outside the ceiling,
 * this must also apply `isPicAllowed` — the granted set can exceed the effective
 * one for anything the ceiling suppresses.
 *
 * An inactive user is not eligible: they cannot authenticate at all
 * (`resolvePrincipal` returns null), so a department whose PIC has been
 * deactivated has nobody, exactly as if the post were vacant.
 */
function picCanRecordPredicate(department = 'd') {
  return `
    EXISTS (
      SELECT 1
        FROM public.users pic
        JOIN public.user_roles ur       ON ur.user_id = pic.id
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
       WHERE pic.id = ${department}.current_pic_user_id
         AND pic.is_active = true
         AND rp.permission_code = 'asset-unit:record-history'
    )
  `;
}

/**
 * The unit ids with a qualifying assessment in a month, as standalone SQL text.
 *
 * The Sequelize half of the same definition: `/reports/inventory-units` builds a
 * `where` rather than a raw statement, and its `assessedIn` / `unassessedIn`
 * filters need this as a literal subquery.
 *
 * IT INTERPOLATES ONLY `Date` OBJECTS the server computed from a validated
 * `YYYY-MM` (`domain/businessMonth.js`). No caller-supplied text reaches this
 * string. `toISOString()` is applied to values already proven to be Dates, so
 * there is nothing here to escape.
 *
 * It re-joins `asset_units` rather than correlating with the outer query,
 * because Sequelize composes the outer `where` and the subquery cannot rely on
 * an alias it does not control.
 */
function assessedUnitIdsSubquery({ monthStart, monthEnd }) {
  if (!(monthStart instanceof Date) || !(monthEnd instanceof Date)) {
    throw new Error('assessedUnitIdsSubquery requires Date bounds from domain/businessMonth.js');
  }

  return `(
    SELECT h.asset_unit_id
      FROM public.longitudinal_history h
      JOIN public.asset_units su ON su.id = h.asset_unit_id
     WHERE h.entry_type = '${QUALIFYING_ENTRY_TYPE}'
       AND h.created_by IS NOT NULL
       AND h.created_at >= '${monthStart.toISOString()}'
       AND h.created_at <  '${monthEnd.toISOString()}'
       AND ${authoredByPicPredicate('h', 'su.department_id')}
  )`;
}

module.exports = {
  NON_ASSESSABLE_STATES,
  QUALIFYING_ENTRY_TYPE,
  binder,
  unitScopeDepartmentIds,
  applicableUnitsCte,
  authoredByPicPredicate,
  manualEntriesCte,
  picCanRecordPredicate,
  assessedUnitIdsSubquery,
};
