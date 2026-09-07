'use strict';

/**
 * Request schemas for reporting — `06-api.md` §9, REQ-REPORT-001–008.
 *
 * §9 documents the eight endpoints but NO query parameters, unlike §5.1, §6.2,
 * §7.2 and §7.3 which enumerate theirs. Each report therefore declares only the
 * filters its own source can support, and every one is an addition to the §9
 * contract recorded in `DEC-051` for §22.5 to reconcile.
 */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');
const { BORROWING_STATUSES, CONDITIONS, LIFECYCLE_STATES } = require('../../db/enums');
const { MONTH_PATTERN } = require('../../domain/businessMonth');

const uuid = z.string().uuid('must be a UUID');

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    'must be a real calendar date'
  );

/**
 * The grouped reports take one filter and return no page: a grouping over five
 * conditions or seven lifecycle states is bounded and complete, so paginating it
 * would only let a caller ask for half an answer (`DEC-053`).
 */
const groupedReport = z.object({ institutionId: uuid.optional() });

/**
 * `/reports/by-location-condition` — REQ-REPORT-010, `CR-012`.
 *
 * `rollUp` mirrors `GET /locations/:id/units`'s `scope=direct|all`, expressed as
 * a boolean because this report has no single location to scope to. `false`
 * contributes nothing rather than meaning "exclude descendants", so
 * `?rollUp=false` and an absent parameter cannot diverge.
 */
const locationConditionReport = z.object({
  institutionId: uuid.optional(),
  departmentId: uuid.optional(),
  locationId: uuid.optional(),
  rollUp: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  status: z.enum(['active', 'inactive']).optional(),
});

/** `/reports/inventory` — a row list, so it paginates (REQ-NFR-PERF-002). */
const inventoryReport = listQuerySchema({
  institutionId: uuid.optional(),
  classificationId: z.string().trim().max(12).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),
});

/**
 * `/reports/borrowings` — REQ-REPORT-007, "active AND historical".
 *
 * This report HAS a date range even though `GET /borrowings` does not
 * (`GAP-011`): the report is new surface, so nothing is being contradicted.
 * The range applies to `borrow_date`.
 */
const borrowingReport = listQuerySchema({
  institutionId: uuid.optional(),
  status: z.enum(BORROWING_STATUSES).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

/**
 * `/reports/procurement-traceability` — REQ-REPORT-008.
 *
 * `traced=false` finds assets with NO procurement record, which is the
 * documented REQ-ASSET-011 exception (donated, self-constructed, migrated) and
 * the thing a traceability review actually needs to see.
 */
const procurementReport = listQuerySchema({
  institutionId: uuid.optional(),
  contractId: uuid.optional(),
  supplierId: uuid.optional(),
  traced: z.enum(['true', 'false']).optional(),
});

/**
 * `/reports/inventory-units` — the unit-level inventory list (`CR-009`).
 *
 * `departmentId` is here and NOT on `/reports/inventory` for a reason: a
 * department belongs to a unit, not to an asset (`04-data-model.md` §5.3.5), so
 * this is the first report whose rows can carry one. It exists for the
 * institution administrator printing ONE department's sheet — a PIC-scoped
 * caller is already narrowed to their own by `unitScopeFilter` and needs no
 * parameter.
 *
 * Narrowing only, like every other filter: a department outside the caller's
 * scope yields an empty report rather than someone else's rows.
 */
/**
 * `YYYY-MM`, in the institution's business timezone — `CR-012` `DEC-L`.
 *
 * Validated here rather than in the service so a malformed month answers `400`
 * naming the field, instead of being silently replaced by the current one.
 * `businessMonth.parseMonth` applies the same pattern; this is the one that
 * produces the error message.
 */
const businessMonth = z
  .string()
  .trim()
  .regex(MONTH_PATTERN, 'must be a month in YYYY-MM form, e.g. 2026-08');

const unitInventoryFilters = {
  institutionId: uuid.optional(),
  // A UUID since `CR-003` made the department code institution-local.
  departmentId: uuid.optional(),
  classificationId: z.string().trim().max(12).optional(),
  condition: z.enum(CONDITIONS).optional(),
  lifecycleState: z.enum(LIFECYCLE_STATES).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),

  /**
   * Location and assessment filters — `CR-012`, REQ-REPORT-009 as amended.
   *
   * They exist so every aggregate on the dashboard has somewhere to drill down
   * to, and so the list behind a coverage figure and the inventory itself are
   * the same rows under the same scope rules.
   *
   * `locationScope` is named rather than assumed: `GET /asset-units` matches
   * `current_location_id` exactly while `GET /locations/:id/units` includes
   * descendants, and a filter that silently picked one would be wrong half the
   * time. `direct` is the default, matching this report's sibling.
   */
  locationId: uuid.optional(),
  locationScope: z.enum(['direct', 'all']).optional(),
  assessedIn: businessMonth.optional(),
  unassessedIn: businessMonth.optional(),
};

const unitInventoryReport = listQuerySchema(unitInventoryFilters);

/**
 * The export takes the same filters and NO pagination (`CR-009` `DEC-D`).
 *
 * Accepting `page`/`pageSize` would reintroduce exactly the defect the endpoint
 * exists to fix — an inventory list that stops at row 100 — so they are refused
 * as unknown fields rather than ignored.
 */
const unitInventoryExport = z.object(unitInventoryFilters).strict();

/**
 * `/reports/assessment-coverage` and `/reports/assessment-activity` —
 * REQ-REPORT-011/012, `CR-012`.
 *
 * `month` is optional and defaults to the current business month, so the
 * dashboard's most common request carries no parameter at all. A malformed
 * value is a `400` rather than a silent fallback: reporting last month's
 * figures under this month's heading is worse than refusing.
 */
const assessmentReport = z.object({
  month: businessMonth.optional(),
  institutionId: uuid.optional(),
  departmentId: uuid.optional(),
});

module.exports = {
  groupedReport,
  locationConditionReport,
  assessmentReport,
  inventoryReport,
  unitInventoryReport,
  unitInventoryExport,
  borrowingReport,
  procurementReport,
};
