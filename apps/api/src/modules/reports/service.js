'use strict';

/**
 * Reporting use cases — `IMPLEMENTATION_PLAN.md` §21.0, `06-api.md` §9;
 * REQ-REPORT-001–008.
 *
 * READ-ONLY throughout. This module runs `SELECT` and nothing else: there is no
 * create, update or delete path anywhere in it, and none may be added.
 *
 * Two response shapes, per `DEC-053`:
 *
 *   GROUPED  `{ groups: [...], totals: {...} }` — bounded categorical breakdowns
 *            (status, classification, organization, location, condition). They
 *            do not paginate: a grouping over five conditions is complete, and
 *            paginating it would only let a caller ask for half an answer.
 *   ROWS     `{ rows, pagination }` — inventory, borrowings and procurement
 *            traceability are lists of records and page like any other list
 *            (REQ-NFR-PERF-002).
 *
 * The five groupings are bound SQL rather than ORM aggregation, following the
 * precedent already set for the recursive queries in `domain/locationRules.js`
 * and `modules/classifications/service.js`: a `GROUP BY` across a join is
 * exactly where the query builder obscures more than it helps, and the scope
 * predicate is a bound parameter in every one of them.
 *
 * ORGANIZATION SCOPE (`BR-007`) reaches each report differently, because the
 * column is not in the same place:
 *
 *   assets        `assets.institution_id`
 *   asset units   through their parent asset — `asset_units` has no institution
 *   borrowings    `borrowings.institution_id` (NOT NULL)
 *
 * `resolveInstitution` is the single place that decides which institution a
 * report is answered for, so no report can quietly forget the caller's scope.
 */

const { Op, literal } = require('sequelize');

const { getModels, normalizeCharKey } = require('../../db/models');
const { CONDITIONS } = require('../../db/enums');
const { getSequelize } = require('../../db/sequelize');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, containsAny, dateRange, equals } = require('../../query/filtering');
const { organizationScope } = require('../../auth/principal');
const {
  assertCanAssignInstitution,
  unitScopeFilter,
  unitDepartmentScope,
} = require('../../domain/scope');
const { descendantIds } = require('../../domain/locationRules');
const { resolveMonth, formatMonth } = require('../../domain/businessMonth');
const {
  NON_ASSESSABLE_STATES,
  QUALIFYING_ENTRY_TYPE,
  binder,
  unitScopeDepartmentIds,
  applicableUnitsCte,
  manualEntriesCte,
  picCanRecordPredicate,
  assessedUnitIdsSubquery,
} = require('../../domain/assessment');
const { HOLDING_STATUSES } = require('../../domain/borrowingLifecycle');
const { ValidationError } = require('../../errors');
const storage = require('../../services/storage');
const { buildInventarisWorkbook } = require('./inventarisWorkbook');

/** Today as `YYYY-MM-DD`, matching how a SQL `DATE` is exchanged. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The institution a report is answered for — `NULL` meaning "every institution".
 *
 * A scoped caller always gets their own, and naming someone else's is a
 * `VALIDATION_ERROR` rather than a silently empty report: the caller pointed at
 * a field they control, so the response points back at it (`06-api.md` §1.4).
 * A system-wide caller gets what they asked for, or everything.
 */
function resolveInstitution(params, principal) {
  const scope = organizationScope(principal);

  if (params.institutionId) {
    assertCanAssignInstitution(principal, params.institutionId);
    return params.institutionId;
  }

  return scope.unrestricted ? null : scope.institutionId;
}

/** Runs one bound `SELECT`. */
async function select(sql, bind, sequelize) {
  return sequelize.query(sql, { bind, type: sequelize.QueryTypes.SELECT });
}

const toCount = (value) => Number(value ?? 0);

// --- Grouped reports ---------------------------------------------------------

/**
 * REQ-REPORT-002 — counts grouped by status.
 *
 * "Status" is two different things in this system, and the report carries both:
 * an Asset Unit has a `lifecycle_state` (REQ-LIFE-001) and every record has an
 * `is_active` flag (§1.7). The groups are the lifecycle states, because that is
 * the operationally interesting breakdown; the active/inactive split is in the
 * totals.
 */
async function status(params, principal, options = {}) {
  const sequelize = options.sequelize ?? getSequelize();
  const institutionId = resolveInstitution(params, principal);

  const groups = await select(
    `SELECT u.lifecycle_state AS key, COUNT(*)::int AS count
       FROM public.asset_units u
       JOIN public.assets a ON a.id = u.asset_id
      WHERE ($1::uuid IS NULL OR a.institution_id = $1)
      GROUP BY u.lifecycle_state
      ORDER BY count DESC, key`,
    [institutionId],
    sequelize
  );

  const [totals] = await select(
    `SELECT
        (SELECT COUNT(*)::int FROM public.assets a
          WHERE ($1::uuid IS NULL OR a.institution_id = $1)) AS assets,
        (SELECT COUNT(*)::int FROM public.assets a
          WHERE a.is_active AND ($1::uuid IS NULL OR a.institution_id = $1)) AS active_assets,
        (SELECT COUNT(*)::int FROM public.asset_units u
           JOIN public.assets a ON a.id = u.asset_id
          WHERE ($1::uuid IS NULL OR a.institution_id = $1)) AS units`,
    [institutionId],
    sequelize
  );

  return {
    groups: groups.map((row) => ({
      key: row.key,
      label: row.key,
      count: toCount(row.count),
    })),
    totals: {
      assets: toCount(totals.assets),
      activeAssets: toCount(totals.active_assets),
      inactiveAssets: toCount(totals.assets) - toCount(totals.active_assets),
      units: toCount(totals.units),
    },
  };
}

/** REQ-REPORT-003 — assets grouped by classification. */
async function byClassification(params, principal, options = {}) {
  const sequelize = options.sequelize ?? getSequelize();
  const institutionId = resolveInstitution(params, principal);

  // `classification_id` is CHAR(12), which PostgreSQL blank-pads, so it is
  // trimmed here exactly as `normalizeCharKey` trims it everywhere else.
  const groups = await select(
    `SELECT btrim(a.classification_id) AS key, c.name AS label, COUNT(*)::int AS count
       FROM public.assets a
       LEFT JOIN ref.asset_classifications c ON c.id = a.classification_id
      WHERE ($1::uuid IS NULL OR a.institution_id = $1)
      GROUP BY btrim(a.classification_id), c.name
      ORDER BY count DESC, label NULLS LAST`,
    [institutionId],
    sequelize
  );

  return {
    groups: groups.map((row) => ({
      key: row.key,
      label: row.label ?? row.key,
      count: toCount(row.count),
    })),
    totals: {
      classifications: groups.length,
      assets: groups.reduce((sum, row) => sum + toCount(row.count), 0),
    },
  };
}

/**
 * REQ-REPORT-004 — grouped by institution AND department.
 *
 * Necessarily counts UNITS, not assets: `institution_id` is on the Asset while
 * `department_id` is on the Asset Unit (`04-data-model.md` §5.3.4, §5.3.5), so
 * the unit is the only row that carries both. The rows are flat — one per
 * institution/department pair — and the UI nests them (`07-ui.md` §5.7).
 */
async function byOrganization(params, principal, options = {}) {
  const sequelize = options.sequelize ?? getSequelize();
  const institutionId = resolveInstitution(params, principal);

  const groups = await select(
    // `department_id` is a UUID since Phase 20 (`CR-003`); the `btrim` this
    // query used to apply belonged to the old `VARCHAR(8)` natural key. `code`
    // joins the report to the label a person actually recognises.
    `SELECT a.institution_id      AS institution_id,
            i.name                AS institution_name,
            i.code                AS institution_code,
            u.department_id       AS department_id,
            d.code                AS department_code,
            d.name                AS department_name,
            COUNT(*)::int         AS count
       FROM public.asset_units u
       JOIN public.assets a ON a.id = u.asset_id
       LEFT JOIN public.institutions i ON i.id = a.institution_id
       LEFT JOIN public.departments d ON d.id = u.department_id
      WHERE ($1::uuid IS NULL OR a.institution_id = $1)
      GROUP BY a.institution_id, i.name, i.code, u.department_id, d.code, d.name
      ORDER BY institution_name NULLS LAST, department_name NULLS LAST`,
    [institutionId],
    sequelize
  );

  return {
    groups: groups.map((row) => ({
      institutionId: row.institution_id,
      institutionName: row.institution_name,
      institutionCode: row.institution_code,
      departmentId: row.department_id,
      departmentCode: row.department_code,
      departmentName: row.department_name,
      count: toCount(row.count),
    })),
    totals: {
      units: groups.reduce((sum, row) => sum + toCount(row.count), 0),
      institutions: new Set(groups.map((row) => row.institution_id)).size,
    },
  };
}

/**
 * REQ-REPORT-005 — units grouped by their current location.
 *
 * A unit with no recorded location is its own group with a `null` key, not an
 * omission: "nothing is recorded for these forty units" is the finding a
 * location review most needs.
 */
async function byLocation(params, principal, options = {}) {
  const sequelize = options.sequelize ?? getSequelize();
  const institutionId = resolveInstitution(params, principal);

  const groups = await select(
    `SELECT u.current_location_id AS key, l.name AS label, COUNT(*)::int AS count
       FROM public.asset_units u
       JOIN public.assets a ON a.id = u.asset_id
       LEFT JOIN public.locations l ON l.id = u.current_location_id
      WHERE ($1::uuid IS NULL OR a.institution_id = $1)
      GROUP BY u.current_location_id, l.name
      ORDER BY count DESC, label NULLS LAST`,
    [institutionId],
    sequelize
  );

  return {
    groups: groups.map((row) => ({
      key: row.key,
      label: row.label,
      count: toCount(row.count),
    })),
    totals: {
      locations: groups.filter((row) => row.key !== null).length,
      units: groups.reduce((sum, row) => sum + toCount(row.count), 0),
      unlocated: toCount(groups.find((row) => row.key === null)?.count),
    },
  };
}

/** REQ-REPORT-006 — units grouped by condition; `null` is "not recorded". */
async function byCondition(params, principal, options = {}) {
  const sequelize = options.sequelize ?? getSequelize();
  const institutionId = resolveInstitution(params, principal);

  const groups = await select(
    `SELECT u.current_condition AS key, COUNT(*)::int AS count
       FROM public.asset_units u
       JOIN public.assets a ON a.id = u.asset_id
      WHERE ($1::uuid IS NULL OR a.institution_id = $1)
      GROUP BY u.current_condition
      ORDER BY count DESC, key NULLS LAST`,
    [institutionId],
    sequelize
  );

  return {
    groups: groups.map((row) => ({
      key: row.key,
      label: row.key,
      count: toCount(row.count),
    })),
    totals: {
      units: groups.reduce((sum, row) => sum + toCount(row.count), 0),
      unrecorded: toCount(groups.find((row) => row.key === null)?.count),
    },
  };
}

// --- Assessment and distribution reports (`CR-012`) --------------------------

/*
 * THESE THREE APPLY THE ASSET UNIT DEPARTMENT SCOPE INSIDE THE AGGREGATION, AND
 * THE EIGHT REPORTS ABOVE DO NOT (`CR-012` `DEC-N`).
 *
 * That difference is deliberate and load-bearing. The reports above filter on
 * `assets.institution_id` alone, which is sufficient ONLY because `report:read`
 * sits outside the `CR-004` ceiling and no PIC-scoped caller can reach them.
 * These require `asset-unit:read`, which the ceiling admits — so a PIC-scoped
 * caller DOES reach them, and each must narrow to that caller's own departments
 * the way `GET /asset-units` does.
 *
 * The narrowing goes in the aggregating `WHERE`, never as a filter over rows
 * that have already been grouped: the latter would hide rows while leaking the
 * totals computed from them.
 *
 * Do not copy the eight above when adding a ninth.
 */

/** Every location beneath `rootId`, inclusive — the `rollUp` closure. */
async function locationSubtree(rootId, models) {
  return [rootId, ...(await descendantIds(rootId, { models }))];
}

/**
 * REQ-REPORT-010 — units by location, broken down by condition.
 *
 * `/reports/by-location` and `/reports/by-condition` each answer one axis of
 * this; neither can answer "which room holds the damaged items", which is the
 * question asked before a repair round.
 *
 * TOTALS ARE COUNTED OVER THE UNITS, NOT SUMMED FROM THE GROUPS. Under
 * `rollUp` a unit in a room is also counted in its building and in the campus
 * above that, so the groups deliberately overlap and their sum is meaningless.
 * The totals come from the same filtered set counted once.
 */
async function byLocationCondition(params, principal, options = {}) {
  const sequelize = options.sequelize ?? getSequelize();
  const models = options.models ?? getModels();
  const institutionId = resolveInstitution(params, principal);
  const departmentIds = unitScopeDepartmentIds(principal);

  const locationIds = params.locationId
    ? params.rollUp
      ? await locationSubtree(params.locationId, models)
      : [params.locationId]
    : null;

  const bind = binder();
  const institution = bind.add(institutionId);
  const scoped = bind.add(departmentIds);
  const department = bind.add(params.departmentId ?? null);
  const locations = bind.add(locationIds);
  const status = bind.add(params.status ?? null);

  /**
   * `scoped_units` is every unit the caller may see that passes the filters.
   * Both aggregates below read it, so the groups and the totals cannot be
   * computed over different sets — which is the defect that would let a
   * percentage exceed 100 or a total disagree with its own breakdown.
   */
  /**
   * The CTE BODY only, with no leading `WITH`.
   *
   * The roll-up branch needs `WITH RECURSIVE`, which in PostgreSQL introduces
   * the whole CTE list rather than one member of it — so the keyword cannot be
   * baked into this fragment and each statement supplies its own.
   */
  const scopedUnits = `
    SELECT u.id, u.current_location_id, u.current_condition
      FROM public.asset_units u
      JOIN public.assets a ON a.id = u.asset_id
     WHERE (${institution}::uuid  IS NULL OR a.institution_id = ${institution}::uuid)
       AND (${scoped}::uuid[]     IS NULL OR u.department_id  = ANY (${scoped}::uuid[]))
       AND (${department}::uuid   IS NULL OR u.department_id  = ${department}::uuid)
       AND (${locations}::uuid[]  IS NULL OR u.current_location_id = ANY (${locations}::uuid[]))
       AND (${status}::text       IS NULL
            OR u.is_active = (${status}::text = 'active'))
  `;

  /**
   * Under `rollUp` a location's counts include everything beneath it, resolved
   * through the same recursive walk `domain/locationRules.js` uses for
   * `GET /locations/:id/units?scope=all`. The self-row in the closure is what
   * makes a leaf still count its own units.
   *
   * Unlocated units have no ancestor to roll into, so they are unioned back as
   * their own group rather than vanishing — the same bucket
   * `/reports/by-location` reports as `unlocated`.
   */
  const groupSql = params.rollUp
    ? `
      WITH RECURSIVE scoped_units AS (${scopedUnits}),
      /*
       * The ancestor closure: every location paired with itself and with each
       * of its descendants. The self-row is what keeps a leaf counting its own
       * units. Same walk as domain/locationRules.js descendantIds, taken over
       * every location at once rather than one subtree.
       */
      tree AS (
        SELECT id AS ancestor_id, id AS descendant_id FROM public.locations
        UNION ALL
        SELECT t.ancestor_id, l.id
          FROM public.locations l
          JOIN tree t ON l.parent_location_id = t.descendant_id
      )
      SELECT t.ancestor_id AS key, l.name AS label, l.parent_location_id AS parent_id,
             u.current_condition AS condition, COUNT(*)::int AS count
        FROM scoped_units u
        JOIN tree t ON t.descendant_id = u.current_location_id
        JOIN public.locations l ON l.id = t.ancestor_id
       GROUP BY t.ancestor_id, l.name, l.parent_location_id, u.current_condition
      UNION ALL
      -- Unlocated units have no ancestor to roll into, so they are added back
      -- as their own group rather than disappearing from the report.
      SELECT NULL, NULL, NULL, u.current_condition, COUNT(*)::int
        FROM scoped_units u
       WHERE u.current_location_id IS NULL
       GROUP BY u.current_condition
    `
    : `
      WITH scoped_units AS (${scopedUnits})
      SELECT u.current_location_id AS key, l.name AS label, l.parent_location_id AS parent_id,
             u.current_condition AS condition, COUNT(*)::int AS count
        FROM scoped_units u
        LEFT JOIN public.locations l ON l.id = u.current_location_id
       GROUP BY u.current_location_id, l.name, l.parent_location_id, u.current_condition
    `;

  const [cells, [totals]] = await Promise.all([
    select(groupSql, bind.values, sequelize),
    select(
      `WITH scoped_units AS (${scopedUnits})
       SELECT COUNT(*)::int AS units,
              COUNT(*) FILTER (WHERE current_location_id IS NULL)::int AS unlocated,
              COUNT(*) FILTER (WHERE current_condition IS NULL)::int   AS unrecorded,
              COUNT(DISTINCT current_location_id)::int                 AS locations
         FROM scoped_units`,
      bind.values,
      sequelize
    ),
  ]);

  // Pivot: one row per location, one column per condition. Done here rather
  // than in SQL because the column set is the enum, which the database would
  // have to be told about anyway.
  const groups = new Map();

  for (const cell of cells) {
    const key = cell.key ?? null;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: cell.label ?? null,
        parentId: cell.parent_id ?? null,
        counts: Object.fromEntries(CONDITIONS.map((condition) => [condition, 0])),
        unrecorded: 0,
        total: 0,
      });
    }

    const group = groups.get(key);
    const count = toCount(cell.count);

    if (cell.condition === null) group.unrecorded += count;
    else group.counts[cell.condition] = (group.counts[cell.condition] ?? 0) + count;

    group.total += count;
  }

  return {
    groups: [...groups.values()].sort(
      (a, b) => b.total - a.total || String(a.label ?? '￿').localeCompare(String(b.label ?? '￿'))
    ),
    totals: {
      units: toCount(totals?.units),
      locations: toCount(totals?.locations),
      unlocated: toCount(totals?.unlocated),
      unrecorded: toCount(totals?.unrecorded),
      rollUp: Boolean(params.rollUp),
    },
  };
}

/**
 * The business month a report is answered for.
 *
 * The schema has already refused anything but `YYYY-MM`, so an invalid value
 * cannot reach here; this applies the default and hands back the UTC instants
 * every query compares against.
 */
function resolveReportMonth(params) {
  const { bounds } = resolveMonth(params.month);
  return bounds;
}

/** `{ id, username, firstName, lastName }` — never the password hash. */
function serializePerson(row, prefix) {
  if (!row[`${prefix}_id`]) return null;

  return {
    id: row[`${prefix}_id`],
    username: row[`${prefix}_username`],
    firstName: row[`${prefix}_first_name`],
    lastName: row[`${prefix}_last_name`],
  };
}

/**
 * REQ-REPORT-011 — each department's progress against REQ-COND-006.
 *
 * COVERAGE COUNTS UNIQUE ASSET UNITS (`DEC-E`). Two people assessing the same
 * unit produce two entries and one unit of coverage; the figure is never a sum
 * of per-user entry counts. `assessment-activity` reports the entries.
 */
async function assessmentCoverage(params, principal, options = {}) {
  const sequelize = options.sequelize ?? getSequelize();
  const institutionId = resolveInstitution(params, principal);
  const departmentIds = unitScopeDepartmentIds(principal);
  const month = resolveReportMonth(params);

  const bind = binder();
  const applicable = applicableUnitsCte(bind, {
    institutionId,
    departmentIds,
    departmentId: params.departmentId ?? null,
    monthEnd: month.end,
  });
  const manual = manualEntriesCte(bind, { monthStart: month.start, monthEnd: month.end });

  // Bound after the CTEs so the placeholders they allocated keep their numbers.
  const institution = bind.add(institutionId);
  const scoped = bind.add(departmentIds);
  const department = bind.add(params.departmentId ?? null);

  const sql = `
    WITH applicable AS (${applicable}),
         manual AS (${manual}),
         applicable_agg AS (
           SELECT department_id,
                  COUNT(*)::int AS applicable,
                  COUNT(*) FILTER (WHERE lifecycle_state = 'BORROWED')::int AS applicable_borrowed
             FROM applicable
            GROUP BY department_id
         ),
         /*
          * Collapsed to one row per unit FIRST. A unit assessed by the PIC and
          * again by an administrator must count once for coverage and must not
          * also appear in assessed_by_others -- that column exists to explain
          * the units nobody responsible has looked at, not to double-report the
          * ones they have.
          */
         manual_per_unit AS (
           SELECT department_id,
                  asset_unit_id,
                  bool_or(by_pic)      AS by_pic,
                  bool_or(NOT by_pic)  AS by_other,
                  MAX(created_at) FILTER (WHERE by_pic) AS last_pic_at
             FROM manual
            GROUP BY department_id, asset_unit_id
         ),
         manual_agg AS (
           SELECT department_id,
                  COUNT(*) FILTER (WHERE by_pic)::int                      AS assessed,
                  COUNT(*) FILTER (WHERE NOT by_pic AND by_other)::int     AS assessed_by_others,
                  MAX(last_pic_at)                                         AS last_assessment_at
             FROM manual_per_unit
            GROUP BY department_id
         )
    SELECT d.id, d.code, d.name, d.is_active,
           pic.id         AS pic_id,
           pic.username   AS pic_username,
           pic.first_name AS pic_first_name,
           pic.last_name  AS pic_last_name,
           ${picCanRecordPredicate('d')} AS pic_can_record,
           COALESCE(aa.applicable, 0)          AS applicable,
           COALESCE(aa.applicable_borrowed, 0) AS applicable_borrowed,
           COALESCE(ma.assessed, 0)            AS assessed,
           COALESCE(ma.assessed_by_others, 0)  AS assessed_by_others,
           ma.last_assessment_at
      FROM public.departments d
      LEFT JOIN applicable_agg aa ON aa.department_id = d.id
      LEFT JOIN manual_agg     ma ON ma.department_id = d.id
      LEFT JOIN public.users  pic ON pic.id = d.current_pic_user_id
     WHERE (${institution}::uuid IS NULL OR d.institution_id = ${institution}::uuid)
       AND (${scoped}::uuid[]    IS NULL OR d.id = ANY (${scoped}::uuid[]))
       AND (${department}::uuid  IS NULL OR d.id = ${department}::uuid)
       /*
        * A deactivated department still holding applicable units is REPORTED,
        * not dropped: its units would otherwise disappear from every coverage
        * figure while remaining someone's responsibility. One with nothing left
        * on its books is simply gone.
        */
       AND (d.is_active = true OR COALESCE(aa.applicable, 0) > 0)
     ORDER BY d.code
  `;

  const rows = await select(sql, bind.values, sequelize);

  const groups = rows.map((row) => {
    const applicableCount = toCount(row.applicable);
    const assessed = toCount(row.assessed);
    const eligible = Boolean(row.pic_id) && row.pic_can_record === true;

    return {
      key: row.id,
      code: row.code,
      label: row.name,
      isActive: row.is_active,
      /**
       * `NO_UNITS` outranks `NO_RESPONSIBLE_USER`: a department with nothing to
       * assess has no gap to explain, and asking someone to staff it because of
       * a compliance screen would be noise.
       */
      state: applicableCount === 0 ? 'NO_UNITS' : eligible ? 'TRACKED' : 'NO_RESPONSIBLE_USER',
      responsible: serializePerson(row, 'pic'),
      applicable: applicableCount,
      applicableBorrowed: toCount(row.applicable_borrowed),
      assessed,
      unassessed: applicableCount - assessed,
      // Units nobody responsible has assessed, but somebody has. Diagnostic
      // only — never added into `assessed` (`DEC-G`).
      assessedByOthers: toCount(row.assessed_by_others),
      // `null`, not `0`: a department with no units has no coverage to report,
      // and a red 0% would describe a problem that does not exist.
      coverage: applicableCount === 0 ? null : assessed / applicableCount,
      lastAssessmentAt: row.last_assessment_at ?? null,
    };
  });

  const totals = groups.reduce(
    (sum, group) => ({
      departments: sum.departments + 1,
      tracked: sum.tracked + (group.state === 'TRACKED' ? 1 : 0),
      withoutResponsibleUser:
        sum.withoutResponsibleUser + (group.state === 'NO_RESPONSIBLE_USER' ? 1 : 0),
      applicable: sum.applicable + group.applicable,
      assessed: sum.assessed + group.assessed,
      unassessed: sum.unassessed + group.unassessed,
    }),
    {
      departments: 0,
      tracked: 0,
      withoutResponsibleUser: 0,
      applicable: 0,
      assessed: 0,
      unassessed: 0,
    }
  );

  return {
    groups,
    totals: {
      ...totals,
      coverage: totals.applicable === 0 ? null : totals.assessed / totals.applicable,
      month: formatMonth(month),
      monthStart: month.start,
      monthEnd: month.end,
      timeZone: month.timeZone,
    },
    unassigned: await unassignedUnits({ institutionId, month, principal, sequelize }),
  };
}

/**
 * Units belonging to no department — `DEC-K`.
 *
 * A SIBLING OF `groups`, never a row inside it: a pseudo-department would sort
 * into the table and read as one.
 *
 * `null` for a PIC-scoped caller, and deliberately not a zeroed block.
 * `unitScopeFilter`'s `IN (…)` never matches `NULL`, so they cannot open a
 * single unit inside it — a count they can neither explain nor act on is noise,
 * and an institution-wide total they have no business seeing.
 *
 * NO `assessed` OR `coverage` FIELD. Under `DEC-F` a qualifying assessment must
 * be authored by the department's PIC, and these units have no department — so
 * coverage is not zero for them, it is undefined, and reporting `assessed: 0`
 * would read as a failure rather than as the categorisation gap it is. What is
 * reported instead is whether anyone has looked at them at all.
 */
async function unassignedUnits({ institutionId, month, principal, sequelize }) {
  // Any department-narrowed caller — PIC, or a Kajur / Toolman (P3, §64.3).
  if (unitDepartmentScope(principal)) return null;

  const bind = binder();
  const institution = bind.add(institutionId);
  const excluded = bind.add(NON_ASSESSABLE_STATES);
  const before = bind.add(month.end);
  const entryType = bind.add(QUALIFYING_ENTRY_TYPE);
  const from = bind.add(month.start);
  const until = bind.add(month.end);

  const [row] = await select(
    `
    WITH unassigned AS (
      SELECT u.id, u.lifecycle_state
        FROM public.asset_units u
        JOIN public.assets a ON a.id = u.asset_id
       WHERE u.department_id IS NULL
         AND u.is_active = true
         AND u.lifecycle_state::text <> ALL (${excluded}::text[])
         AND u.created_at < ${before}
         AND (${institution}::uuid IS NULL OR a.institution_id = ${institution}::uuid)
    )
    SELECT COUNT(*)::int AS applicable,
           COUNT(*) FILTER (WHERE lifecycle_state = 'BORROWED')::int AS applicable_borrowed,
           (SELECT COUNT(DISTINCT h.asset_unit_id)::int
              FROM public.longitudinal_history h
              JOIN unassigned un ON un.id = h.asset_unit_id
             WHERE h.entry_type::text = ${entryType}
               AND h.created_by IS NOT NULL
               AND h.created_at >= ${from}
               AND h.created_at <  ${until}) AS with_manual_entry
      FROM unassigned
    `,
    bind.values,
    sequelize
  );

  return {
    applicable: toCount(row?.applicable),
    applicableBorrowed: toCount(row?.applicable_borrowed),
    withManualEntry: toCount(row?.with_manual_entry),
  };
}

/**
 * REQ-REPORT-012 — who recorded assessments, and how many.
 *
 * ACTIVITY IS NOT COVERAGE. `entries` and `uniqueUnits` are reported as separate
 * figures because presenting either alone invites the reader to mistake one for
 * the other: a person who recorded a unit three times has three entries and one
 * unit, and only the second is what compliance is measured on.
 *
 * `contribution` divides by the department's covered units, NOT by total
 * entries — the latter would reward re-recording the same item.
 */
async function assessmentActivity(params, principal, options = {}) {
  const sequelize = options.sequelize ?? getSequelize();
  const institutionId = resolveInstitution(params, principal);
  const departmentIds = unitScopeDepartmentIds(principal);
  const month = resolveReportMonth(params);

  const bind = binder();
  const applicable = applicableUnitsCte(bind, {
    institutionId,
    departmentIds,
    departmentId: params.departmentId ?? null,
    monthEnd: month.end,
  });
  const manual = manualEntriesCte(bind, { monthStart: month.start, monthEnd: month.end });

  const sql = `
    WITH applicable AS (${applicable}),
         manual AS (${manual}),
         per_user_unit AS (
           SELECT created_by, asset_unit_id, bool_or(by_pic) AS by_pic
             FROM manual
            GROUP BY created_by, asset_unit_id
         )
    SELECT m.created_by     AS actor_id,
           actor.username   AS actor_username,
           actor.first_name AS actor_first_name,
           actor.last_name  AS actor_last_name,
           COUNT(*)::int                            AS entries,
           (SELECT COUNT(*)::int FROM per_user_unit p
             WHERE p.created_by = m.created_by)      AS unique_units,
           (SELECT COUNT(*)::int FROM per_user_unit p
             WHERE p.created_by = m.created_by AND p.by_pic) AS qualifying_units,
           MAX(m.created_at)                        AS last_at
      FROM manual m
      LEFT JOIN public.users actor ON actor.id = m.created_by
     GROUP BY m.created_by, actor.username, actor.first_name, actor.last_name
     ORDER BY entries DESC, actor.username
  `;

  /**
   * The department's covered total, recomputed here rather than passed in, so
   * `contribution` divides by the same number the coverage report shows for the
   * same parameters. Two derivations of one figure would eventually disagree.
   */
  const coveredSql = `
    WITH applicable AS (${applicable}),
         manual AS (${manual})
    SELECT COUNT(DISTINCT asset_unit_id)::int AS assessed
      FROM manual WHERE by_pic
  `;

  const [rows, [covered]] = await Promise.all([
    select(sql, bind.values, sequelize),
    select(coveredSql, bind.values, sequelize),
  ]);

  const assessed = toCount(covered?.assessed);

  const groups = rows.map((row) => {
    const qualifyingUnits = toCount(row.qualifying_units);

    return {
      key: row.actor_id,
      label: row.actor_username ?? null,
      user: serializePerson(row, 'actor'),
      /**
       * `PIC` when any of this person's entries counted for the department they
       * were recorded against. Derived from the entries rather than from the
       * current assignment, so someone who has since handed over still reads as
       * the person who was responsible at the time.
       */
      relationship: qualifyingUnits > 0 ? 'PIC' : 'INSTITUTION',
      entries: toCount(row.entries),
      uniqueUnits: toCount(row.unique_units),
      qualifyingUnits,
      /**
       * Share of the department's COVERED units, so contributions may sum above
       * 100% when two people assessed the same unit. That is arithmetically
       * correct and is the signal an administrator wants; `totals.assessed` is
       * returned beside it so the overlap is legible rather than confusing.
       */
      contribution: assessed === 0 ? null : qualifyingUnits / assessed,
      lastAt: row.last_at ?? null,
    };
  });

  return {
    groups,
    totals: {
      contributors: groups.length,
      entries: groups.reduce((sum, group) => sum + group.entries, 0),
      assessed,
      month: formatMonth(month),
      monthStart: month.start,
      monthEnd: month.end,
      timeZone: month.timeZone,
    },
  };
}

// --- Row reports -------------------------------------------------------------

/**
 * `assessedIn` / `unassessedIn` on the unit inventory — `CR-012`,
 * REQ-REPORT-009 as amended.
 *
 * THE DRILL-DOWN MUST RECONCILE WITH THE FIGURE IT WAS REACHED THROUGH. A
 * coverage cell says "4 unassessed"; clicking it must list exactly those four.
 * So `unassessedIn` applies the SAME applicable predicate the coverage
 * denominator uses (`DEC-J`) — active, assessable, already registered, and
 * belonging to a department — rather than merely "has no qualifying entry",
 * which would also sweep in disposed units and units nobody is responsible for.
 *
 * `assessedIn` is the complement over the same set, so the two partition the
 * denominator exactly and neither can quietly omit a unit.
 */
function assessmentFilter(value, { assessed }) {
  const { bounds } = resolveMonth(value);
  const subquery = literal(
    assessedUnitIdsSubquery({ monthStart: bounds.start, monthEnd: bounds.end })
  );

  return {
    id: assessed ? { [Op.in]: subquery } : { [Op.notIn]: subquery },
    isActive: true,
    departmentId: { [Op.ne]: null },
    lifecycleState: { [Op.notIn]: NON_ASSESSABLE_STATES },
    createdAt: { [Op.lt]: bounds.end },
  };
}

/** Unit counts for one page of assets, in one query rather than N. */
async function unitCountsFor(assetIds, models, { tracedOnly = false } = {}) {
  if (assetIds.length === 0) return new Map();

  const rows = await models.AssetUnit.findAll({
    attributes: ['assetId', [models.AssetUnit.sequelize.fn('COUNT', '*'), 'count']],
    where: {
      assetId: { [Op.in]: assetIds },
      ...(tracedOnly ? { contractItemId: { [Op.ne]: null } } : {}),
    },
    group: ['asset_id'],
    raw: true,
  });

  return new Map(rows.map((row) => [row.assetId, toCount(row.count)]));
}

/**
 * REQ-REPORT-001 — the asset inventory.
 *
 * A row list rather than a grouping, so it pages. Each row carries its unit
 * count, which is what makes it an inventory rather than a second asset list.
 */
async function inventory(params, principal, options = {}) {
  const models = options.models ?? getModels();
  const institutionId = resolveInstitution(params, principal);

  const findOptions = toFindOptions(params, {
    filters: {
      status: activeStatus(),
      q: (value) => containsAny(['name', 'description'], value),
      classificationId: (value) => equals('classificationId', value),
    },
    sortable: ['name', 'createdAt', 'updatedAt'],
    defaultSort: [['name', 'ASC']],
  });

  if (institutionId) {
    findOptions.where = { [Op.and]: [findOptions.where, { institutionId }] };
  }

  const { rows, pagination } = await paginate(models.Asset, findOptions, {
    include: [
      { association: 'classification', attributes: ['id', 'name'] },
      { association: 'institution', attributes: ['id', 'name', 'code'] },
    ],
  });

  const counts = await unitCountsFor(
    rows.map((row) => row.id),
    models
  );

  return {
    rows: rows.map((asset) => ({
      id: asset.id,
      name: asset.name,
      classificationId: normalizeCharKey(asset.classificationId),
      classificationName: asset.classification?.name ?? null,
      institutionId: asset.institutionId ?? null,
      institutionName: asset.institution?.name ?? null,
      isActive: asset.isActive,
      unitCount: counts.get(asset.id) ?? 0,
    })),
    pagination,
  };
}

/**
 * The unit-level inventory list — `CR-009`.
 *
 * ONE ROW PER PHYSICAL ITEM, which is the whole point: `inventory` above answers
 * "how many kinds of thing do we own", and this answers "which items are they".
 * Its `unitCount` column is exactly the collapsing being undone here.
 *
 * DEPARTMENT SCOPE IS THE EXISTING RULE, not a new one. `unitScopeFilter`
 * narrows a PIC-scoped caller to their own departments and yields `{}` for
 * everyone else, so "a department sees only its own assets" needs no branch
 * here — and the `departmentId` filter, which an institution administrator uses
 * to print one department, composes with it rather than replacing it. A PIC
 * naming another department gets nothing, which is the narrowing-only rule.
 *
 * @param {{sequelize?: object, models?: object, limit?: number}} options
 *        `limit` is the export path (`DEC-D`): no page, one bounded read.
 */
async function inventoryUnits(params, principal, options = {}) {
  const models = options.models ?? getModels();
  const institutionId = resolveInstitution(params, principal);

  /**
   * Descendants are resolved BEFORE the filters are built — `CR-012`.
   *
   * `toFindOptions` composes synchronous predicates, and the subtree is a query.
   * Resolving it here keeps the filter itself a plain `IN`, and keeps the two
   * meanings of "at this location" explicit rather than assumed: `direct`
   * matches `current_location_id` exactly, as `GET /asset-units` does, and `all`
   * includes everything beneath it, as `GET /locations/:id/units` does.
   */
  const locationIds =
    params.locationId && params.locationScope === 'all'
      ? await locationSubtree(params.locationId, models)
      : params.locationId
        ? [params.locationId]
        : null;

  const findOptions = toFindOptions(params, {
    filters: {
      status: activeStatus(),
      q: (value) => containsAny(['description', 'inventoryCode'], value),
      departmentId: (value) => equals('departmentId', value),
      condition: (value) => equals('currentCondition', value),
      lifecycleState: (value) => equals('lifecycleState', value),
      locationId: () => ({ currentLocationId: { [Op.in]: locationIds } }),
      // Handled together with `locationId`, so it contributes no filter of its
      // own and cannot widen anything when supplied alone.
      locationScope: () => undefined,
      assessedIn: (value) => assessmentFilter(value, { assessed: true }),
      unassessedIn: (value) => assessmentFilter(value, { assessed: false }),
    },
    sortable: ['inventoryCode', 'createdAt', 'updatedAt'],
    // The printed sheet is read in code order, and a NULL code sorts last so a
    // unit still awaiting one is visible at the end rather than buried.
    defaultSort: [['inventoryCode', 'ASC']],
  });

  /**
   * The institution and the classification live on the ASSET, so neither can be
   * a unit-level `where`. Both narrow the required include below instead, which
   * is an inner join and therefore filters the units as intended.
   */
  /**
   * `Reflect.ownKeys`, NOT `Object.keys` — fixed in Phase 32.
   *
   * `buildWhere` returns a plain object for ONE filter and `{ [Op.and]: [...] }`
   * for two or more. `Op.and` is a Symbol, so `Object.keys` reports zero keys on
   * the second shape and the guard below discarded the caller's entire filter
   * set the moment they supplied a second one — silently, with a `200` and a
   * complete list.
   *
   * Organization scope was never affected: `unitScopeFilter` is a separate
   * element carrying a string key, and the institution narrows the required
   * `asset` include. So this was a wrong answer, not a leak — but a wrong answer
   * that looked authoritative, and `CR-012`'s drill-downs combine filters by
   * design (`locationId` + `condition`, `unassessedIn` + `departmentId`).
   */
  const conditions = [findOptions.where, unitScopeFilter(principal)].filter(
    (condition) => Reflect.ownKeys(condition).length > 0
  );

  findOptions.where = conditions.length > 1 ? { [Op.and]: conditions } : (conditions[0] ?? {});

  const include = [
    {
      association: 'asset',
      required: true,
      attributes: ['id', 'name', 'description', 'classificationId', 'institutionId', 'contractId'],
      where: {
        ...(institutionId ? { institutionId } : {}),
        ...(params.classificationId
          ? { classificationId: normalizeCharKey(params.classificationId) }
          : {}),
      },
      include: [
        { association: 'classification', attributes: ['id', 'name'] },
        { association: 'institution', attributes: ['id', 'name', 'code'] },
        {
          association: 'contract',
          attributes: ['id', 'contractDate'],
          include: [{ association: 'fundingSource', attributes: ['id', 'name', 'code'] }],
        },
      ],
    },
    { association: 'department', attributes: ['id', 'code', 'name'] },
    { association: 'currentLocation', attributes: ['id', 'name'] },
  ];

  const serialize = (unit, index, offset = 0) => ({
    no: offset + index + 1,
    unitId: unit.id,
    assetId: unit.asset?.id ?? null,
    assetName: unit.asset?.name ?? null,
    description: unit.asset?.description ?? null,
    classificationId: normalizeCharKey(unit.asset?.classificationId),
    classificationName: unit.asset?.classification?.name ?? null,
    institutionName: unit.asset?.institution?.name ?? null,
    departmentCode: unit.department?.code ?? null,
    departmentName: unit.department?.name ?? null,
    fundingSourceName: unit.asset?.contract?.fundingSource?.name ?? null,
    // The acquisition date, which only a contract carries. Deliberately NOT
    // falling back to the registration date (`DEC-A`): they are different facts.
    contractDate: unit.asset?.contract?.contractDate ?? null,
    inventoryCode: unit.inventoryCode ?? null,
    condition: unit.currentCondition ?? null,
    lifecycleState: unit.lifecycleState,
    locationName: unit.currentLocation?.name ?? null,
    isActive: unit.isActive,
  });

  if (options.limit) {
    const rows = await models.AssetUnit.findAll({
      where: findOptions.where,
      order: findOptions.order,
      include,
      // One over the ceiling, so the caller can be told it was exceeded rather
      // than handed a silently truncated inventory.
      limit: options.limit + 1,
    });

    return { rows: rows.map((unit, index) => serialize(unit, index)), pagination: null };
  }

  const { rows, pagination } = await paginate(models.AssetUnit, findOptions, { include });
  const offset = (pagination.page - 1) * pagination.pageSize;

  return { rows: rows.map((unit, index) => serialize(unit, index, offset)), pagination };
}

/**
 * The photograph for each exported row — `CR-009` `DEC-F`.
 *
 * Resolved for the whole export in TWO queries rather than one per row: an
 * inventory of five thousand units would otherwise be five thousand round trips
 * before a single cell is written.
 *
 * UNIT FIRST, THEN ITS ASSET. Attachments hang off the asset with the unit
 * optional (`04-data-model.md`), so most photographs describe the kind of thing
 * rather than the individual item — four laptop units share one picture until
 * someone photographs each. That is the honest rendering of what is recorded,
 * and the report's description says so rather than hiding it.
 *
 * NON-IMAGES ARE IGNORED, not listed. A PDF invoice is a wrong answer in a
 * column whose only job is a photograph.
 */
const PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png']);

async function photoIndexFor(rows, models) {
  const unitIds = rows.map((row) => row.unitId);
  const assetIds = [...new Set(rows.map((row) => row.assetId).filter(Boolean))];

  const attachments = await models.Attachment.findAll({
    where: {
      fileType: { [Op.in]: PHOTO_TYPES },
      [Op.or]: [{ assetUnitId: { [Op.in]: unitIds } }, { assetId: { [Op.in]: assetIds } }],
    },
    attributes: ['id', 'assetId', 'assetUnitId', 'fileType', 'storageReference'],
    // Oldest first, so "the first photograph" is stable between two exports of
    // the same data rather than depending on the row order the planner chose.
    order: [['createdAt', 'ASC']],
  });

  const byUnit = new Map();
  const byAsset = new Map();

  for (const attachment of attachments) {
    const target = attachment.assetUnitId ? byUnit : byAsset;
    const key = attachment.assetUnitId ?? attachment.assetId;
    if (!target.has(key)) target.set(key, attachment);
  }

  return { byUnit, byAsset };
}

/**
 * Reads one row's photograph off disk.
 *
 * A file the database knows about but the disk does not yields `null` rather
 * than failing the export: one lost attachment must not cost an administrator
 * the whole inventory sheet, and the empty cell is visible.
 */
function photoLoaderFor(index, cache = new Map()) {
  return async (row) => {
    const attachment = index.byUnit.get(row.unitId) ?? index.byAsset.get(row.assetId);
    if (!attachment) return null;

    if (!cache.has(attachment.id)) {
      try {
        cache.set(attachment.id, await storage.read(attachment.storageReference));
      } catch {
        cache.set(attachment.id, null);
      }
    }

    const buffer = cache.get(attachment.id);
    if (!buffer) return null;

    return {
      id: attachment.id,
      buffer,
      extension: attachment.fileType === 'image/png' ? 'png' : 'jpeg',
    };
  };
}

/**
 * The maintenance history behind the `PERAWATAN` sheet — `CR-011`.
 *
 * TWO QUERIES FOR THE WHOLE EXPORT, not two per row. The unit ids are already
 * resolved by the time this runs, so both are single bounded reads over ids in
 * hand; a five-thousand-unit sheet costs two round trips, not ten thousand.
 *
 * `longitudinal_history` is a PERIOD table — `effective_from`/`effective_to`,
 * closed and reopened in one transaction by `applyStateChange` — so "the
 * condition at the end of September" is the period covering that date, exactly,
 * rather than an approximation from the nearest entry.
 */

/**
 * Descriptions the application wrote itself — `CR-011` `DEC-E`.
 *
 * Matched by SHAPE, not by lifecycle state, which is a refinement on the CR: the
 * return path takes `description ?? \`Returned from borrowing …\``, so a human
 * note recorded at the moment of a return would be discarded by a
 * state-based rule. These two patterns include a UUID, so a human note only
 * matches by reproducing the format exactly.
 */
const MACHINE_WRITTEN = [
  /^Borrowed by .+ \(borrowing [0-9a-f-]{36}\)$/i,
  /^Returned from borrowing [0-9a-f-]{36}$/i,
];

const isMachineWritten = (description) =>
  MACHINE_WRITTEN.some((pattern) => pattern.test(String(description ?? '').trim()));

/**
 * A description that says nothing.
 *
 * `longitudinal_history.description` is NOT NULL, so a recorder with nothing to
 * add types a placeholder — `-` is the one in the current data. That is not an
 * observation, and a `keterangan` column repeating it down the sheet is noise
 * where an empty cell is information. Nothing with a letter or a digit in it is
 * discarded.
 */
const isPlaceholder = (description) => !/[\p{L}\p{N}]/u.test(String(description ?? ''));

/**
 * The months a sheet covers: twelve, ending with the month it is exported in
 * (`DEC-C`). Each carries the instant its month ends, which is what a snapshot
 * is taken at.
 */
function monthWindow(at = new Date(), count = 12) {
  const months = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - offset, 1));
    // The first instant of the NEXT month, so "covering month end" is a single
    // half-open comparison and no date arithmetic has to know month lengths.
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

    months.push({ year: start.getUTCFullYear(), month: start.getUTCMonth(), start, end });
  }

  return months;
}

async function maintenanceHistoryFor(rows, months, models) {
  const unitIds = rows.map((row) => row.unitId);
  if (unitIds.length === 0) return new Map();

  const windowStart = months[0].start;
  const windowEnd = months.at(-1).end;

  const [periods, movements] = await Promise.all([
    models.LongitudinalHistory.findAll({
      where: {
        assetUnitId: { [Op.in]: unitIds },
        effectiveFrom: { [Op.lt]: windowEnd },
        [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gt]: windowStart } }],
      },
      attributes: [
        'assetUnitId',
        'condition',
        'description',
        'entryType',
        'effectiveFrom',
        'effectiveTo',
      ],
      order: [['effectiveFrom', 'ASC']],
    }),
    /**
     * EVERY assignment, not only the ones inside the window.
     *
     * A unit's FIRST placement is not a move — nothing was relocated, the item
     * simply arrived somewhere. Distinguishing it needs the earliest assignment
     * whenever it happened, which may predate the window, so the filter is
     * applied after the read rather than in SQL.
     */
    models.AssetUnitLocation.findAll({
      where: { assetUnitId: { [Op.in]: unitIds } },
      attributes: ['assetUnitId', 'assignedAt'],
      order: [['assignedAt', 'ASC']],
    }),
  ]);

  const byUnit = new Map(unitIds.map((id) => [id, { periods: [], movements: [] }]));

  for (const period of periods) byUnit.get(period.assetUnitId)?.periods.push(period);
  for (const move of movements) byUnit.get(move.assetUnitId)?.movements.push(move.assignedAt);

  const result = new Map();

  for (const [unitId, { periods: unitPeriods, movements: allAssignments }] of byUnit) {
    // Everything after the first placement is a move; the first one is arrival.
    const moves = allAssignments.slice(1);

    result.set(
      unitId,
      months.map(({ start, end }) => {
        /**
         * The snapshot: the period covering the LAST instant of the month
         * (`DEC-A`). A unit never assessed leaves this null, which is a third
         * state distinct from `B` and visibly blank on the sheet.
         */
        const covering = unitPeriods.find(
          (period) =>
            period.effectiveFrom < end && (!period.effectiveTo || period.effectiveTo >= end)
        );

        /**
         * Notes are OBSERVATIONS RECORDED THIS MONTH, never the carried-forward
         * snapshot's text — repeating a note from three months ago in every
         * column since is not a record of anything. A `SYSTEM` row (receipt
         * placement, REQ-REQUEST-024) is no observation at all: excluded by
         * what wrote it, not by the shape of its text.
         */
        const notes = unitPeriods
          .filter(
            (period) =>
              period.effectiveFrom >= start &&
              period.effectiveFrom < end &&
              period.entryType !== 'SYSTEM' &&
              !isMachineWritten(period.description) &&
              !isPlaceholder(period.description)
          )
          .map((period) => period.description)
          .filter(Boolean);

        return {
          condition: covering?.condition ?? null,
          // One tick, not a count: a unit moved twice in a month moved.
          moved: moves.some((assignedAt) => assignedAt >= start && assignedAt < end),
          note: [...new Set(notes)].join('; '),
        };
      })
    );
  }

  return result;
}

/**
 * The department the exported sheet belongs to, as `Name (CODE)`.
 *
 * DERIVED FROM THE ROWS, NOT FROM `params.departmentId`. The filter is only one
 * of the two ways a sheet ends up covering one department: a PIC-scoped user
 * passes no filter at all and is narrowed by `unitScopeFilter`, and their sheet
 * is exactly the one that most needs naming — it is printed and filed as that
 * department's inventory. Reading the answer off the rows covers both, and
 * cannot disagree with what was actually exported.
 *
 * Empty when the rows span several departments, or none: the title line says
 * what the sheet IS, and "TKJ" over a sheet holding three departments would be
 * worse than saying nothing. A PIC of several departments gets the same
 * treatment, which is correct — one sheet, several departments, no single name.
 */
function departmentScopeOf(rows) {
  const named = rows.filter((row) => row.departmentName || row.departmentCode);
  if (named.length === 0 || named.length !== rows.length) return '';

  const distinct = new Set(named.map((row) => `${row.departmentName}|${row.departmentCode}`));
  if (distinct.size !== 1) return '';

  const [{ departmentName, departmentCode }] = named;
  return departmentCode ? `${departmentName} (${departmentCode})` : departmentName;
}

/**
 * The unit inventory as a spreadsheet — `CR-009` `DEC-D`.
 *
 * The whole filtered set, never a page: an inventory list that stops at row 100
 * is not an inventory list, which is the defect this endpoint exists to fix. The
 * ceiling is therefore the only bound, and exceeding it is an error naming the
 * count rather than a silent truncation.
 */
const EXPORT_ROW_LIMIT = 5000;

async function inventoryUnitsExport(params, principal, options = {}) {
  const models = options.models ?? getModels();

  const { rows } = await inventoryUnits(params, principal, {
    ...options,
    limit: EXPORT_ROW_LIMIT,
  });

  /**
   * A `VALIDATION_ERROR`, not a `413`.
   *
   * `CR-009` proposed 413, but `06-api.md` §1.4 enumerates the error codes and
   * the envelope maps each to one status — adding a code is a contract change
   * this feature does not need. The refusal is genuinely about a parameter the
   * caller controls, and it names the one to change, which is what every other
   * refusal in this API does.
   */
  if (rows.length > EXPORT_ROW_LIMIT) {
    throw new ValidationError(
      `This export covers more than ${EXPORT_ROW_LIMIT.toLocaleString('en-US')} units`,
      [
        {
          field: 'departmentId',
          issue:
            'narrow the report before exporting — by department, classification or condition — ' +
            'and export each part in turn',
        },
      ]
    );
  }

  const index = await photoIndexFor(rows, models);

  const institution = rows.find((row) => row.institutionName)?.institutionName ?? null;
  const departmentLabel = departmentScopeOf(rows);

  // The maintenance tab, over the same rows in the same order (`CR-011`).
  const months = monthWindow();
  const history = await maintenanceHistoryFor(rows, months, models);

  const buffer = await buildInventarisWorkbook(
    rows,
    {
      institutionName: institution,
      scopeLabel: departmentLabel,
      year: new Date().getFullYear(),
    },
    photoLoaderFor(index),
    { months, history }
  );

  return { buffer, rowCount: rows.length, institutionName: institution, departmentLabel };
}

/**
 * REQ-REPORT-007 — active AND historical borrowings.
 *
 * `overdue=true` is derived the same way `GET /borrowings` derives it
 * (`DEC-016`): still holding its units past the expected return date, whether or
 * not the Phase 8 sweep has stamped the status yet.
 */
async function borrowings(params, principal, options = {}) {
  const models = options.models ?? getModels();
  const institutionId = resolveInstitution(params, principal);

  const findOptions = toFindOptions(params, {
    filters: {
      status: (value) => equals('status', value),
      dateFrom: (value, all) => dateRange('borrowDate', { from: value, to: all.dateTo }),
      dateTo: (value, all) => (all.dateFrom ? undefined : dateRange('borrowDate', { to: value })),
      overdue: (value) =>
        value === 'true'
          ? { status: { [Op.in]: HOLDING_STATUSES }, expectedReturnDate: { [Op.lt]: today() } }
          : undefined,
    },
    sortable: ['borrowDate', 'expectedReturnDate', 'status', 'createdAt'],
    defaultSort: [['borrowDate', 'DESC']],
  });

  if (institutionId) {
    findOptions.where = { [Op.and]: [findOptions.where, { institutionId }] };
  }

  const { rows, pagination } = await paginate(models.Borrowing, findOptions, {
    include: [{ association: 'institution', attributes: ['id', 'name', 'code'] }],
  });

  const ids = rows.map((row) => row.id);
  const itemCounts =
    ids.length === 0
      ? []
      : await models.BorrowingItem.findAll({
          attributes: ['borrowingId', [models.BorrowingItem.sequelize.fn('COUNT', '*'), 'count']],
          where: { borrowingId: { [Op.in]: ids } },
          group: ['borrowing_id'],
          raw: true,
        });

  const counts = new Map(itemCounts.map((row) => [row.borrowingId, toCount(row.count)]));
  const cutoff = today();

  return {
    rows: rows.map((borrowing) => ({
      id: borrowing.id,
      borrowerName: borrowing.borrowerName,
      borrowerContact: borrowing.borrowerContact,
      borrowDate: borrowing.borrowDate,
      expectedReturnDate: borrowing.expectedReturnDate,
      actualReturnDate: borrowing.actualReturnDate ?? null,
      status: borrowing.status,
      institutionId: borrowing.institutionId,
      institutionName: borrowing.institution?.name ?? null,
      unitCount: counts.get(borrowing.id) ?? 0,
      // Derived, not stored: true while the record still holds its units past
      // the expected return date (REQ-BORROW-012).
      isOverdue:
        HOLDING_STATUSES.includes(borrowing.status) && borrowing.expectedReturnDate < cutoff,
    })),
    pagination,
  };
}

/**
 * REQ-REPORT-008 — assets traced to their procurement records.
 *
 * `traced=false` is the useful half of this report: it lists assets with NO
 * contract, which REQ-ASSET-011 documents as a legitimate case (donated,
 * self-constructed, migrated) and which a traceability review has to be able to
 * separate from an oversight.
 */
async function procurementTraceability(params, principal, options = {}) {
  const models = options.models ?? getModels();
  const institutionId = resolveInstitution(params, principal);

  const findOptions = toFindOptions(params, {
    filters: {
      contractId: (value) => equals('contractId', value),
      traced: (value) =>
        value === 'true' ? { contractId: { [Op.ne]: null } } : { contractId: null },
    },
    sortable: ['name', 'createdAt'],
    defaultSort: [['name', 'ASC']],
  });

  if (institutionId) {
    findOptions.where = { [Op.and]: [findOptions.where, { institutionId }] };
  }

  // A supplier filter reaches the asset only through its contract, so that
  // include becomes required — which also excludes untraced assets, correctly:
  // an asset with no contract has no supplier either.
  const contractInclude = {
    association: 'contract',
    attributes: ['id', 'contractNumber', 'contractDate', 'supplierId'],
    required: Boolean(params.supplierId),
    ...(params.supplierId ? { where: { supplierId: params.supplierId } } : {}),
    include: [{ association: 'supplier', attributes: ['id', 'name'] }],
  };

  const { rows, pagination } = await paginate(models.Asset, findOptions, {
    include: [contractInclude],
    distinct: true,
  });

  const ids = rows.map((row) => row.id);
  const [allUnits, tracedUnits] = await Promise.all([
    unitCountsFor(ids, models),
    unitCountsFor(ids, models, { tracedOnly: true }),
  ]);

  return {
    rows: rows.map((asset) => ({
      assetId: asset.id,
      assetName: asset.name,
      classificationId: normalizeCharKey(asset.classificationId),
      institutionId: asset.institutionId ?? null,
      contractId: asset.contractId ?? null,
      contractNumber: asset.contract?.contractNumber ?? null,
      contractDate: asset.contract?.contractDate ?? null,
      supplierId: asset.contract?.supplierId ?? null,
      supplierName: asset.contract?.supplier?.name ?? null,
      unitCount: allUnits.get(asset.id) ?? 0,
      // Units carrying a `contract_item_id` (REQ-PROC-006). A gap between this
      // and `unitCount` is exactly what a traceability review looks for.
      tracedUnitCount: tracedUnits.get(asset.id) ?? 0,
    })),
    pagination,
  };
}

module.exports = {
  status,
  byClassification,
  byOrganization,
  byLocation,
  byCondition,
  byLocationCondition,
  assessmentCoverage,
  assessmentActivity,
  inventory,
  inventoryUnits,
  inventoryUnitsExport,
  EXPORT_ROW_LIMIT,
  borrowings,
  procurementTraceability,
  resolveInstitution,
  // The PERAWATAN month snapshots, exposed for the tests that hold its notes
  // to observations only (REQ-REQUEST-024).
  maintenanceHistoryFor,
  monthWindow,
};
