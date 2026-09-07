'use strict';

/**
 * Reporting endpoints — `06-api.md` §9, `IMPLEMENTATION_PLAN.md` §21.0.
 *
 * READ-ONLY. Only `GET` is mounted here, and only `report:read` guards it: §9
 * documents one permission resource for all eight reports, not one per report.
 *
 * Two response envelopes (`DEC-053`): the five bounded groupings answer
 * `{ data: { groups, totals } }` through `sendItem`, and the three row reports
 * answer the standard paginated `{ data, meta }` through `sendList`.
 */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendList, sendSpreadsheet } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

/**
 * `inventaris-<scope>-<date>.xlsx`.
 *
 * The scope segment is reduced to the identifier alphabet rather than quoted: a
 * department may legitimately be called `Teknik Komputer & Jaringan`, and a
 * `Content-Disposition` filename carrying a quote or a semicolon is a header
 * injection, not a filename.
 */
function exportFilename(scopeLabel) {
  const date = new Date().toISOString().slice(0, 10);
  const scope = String(scopeLabel ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase();

  return scope ? `inventaris-${scope}-${date}.xlsx` : `inventaris-${date}.xlsx`;
}

/**
 * A bounded grouping: one filter, no page, `{ groups, totals }`.
 *
 * `schema` and `permission` are parameters because `CR-012` added three
 * groupings whose subject is the Asset Unit rather than the registry, and which
 * take their own filters. The five original callers pass neither and keep
 * exactly what they had.
 */
function grouped(handler, schema = schemas.groupedReport, permission = 'report:read') {
  return [
    requirePermission(permission),
    validate({ query: schema }),
    asyncHandler(async (req, res) => {
      sendItem(res, await handler(req.query, req.principal));
    }),
  ];
}

/**
 * A row list: paged like every other list (REQ-NFR-PERF-002).
 *
 * `permission` defaults to `report:read` because eight of the nine reports are
 * aggregates over the registry and that is the code for reading one. A report
 * whose rows ARE a domain entity declares that entity's code instead
 * (`CR-010` `DEC-A`).
 */
function rows(schema, handler, permission = 'report:read') {
  return [
    requirePermission(permission),
    validate({ query: schema }),
    asyncHandler(async (req, res) => {
      const result = await handler(req.query, req.principal);
      sendList(res, result.rows, result.pagination);
    }),
  ];
}

function reportsRouter() {
  const router = Router();

  router.get('/inventory', ...rows(schemas.inventoryReport, service.inventory));

  /**
   * `asset-unit:read`, NOT `report:read` — `CR-010` `DEC-A`.
   *
   * §1.3 derives a permission from the resource actually being acted on, and
   * this reads Asset Units: it is the `/asset-units` list in another column
   * layout, narrowed row by row by the same `unitScopeFilter`. The precedent is
   * `GET /assets/:id/attachments` requiring `attachment:read` rather than
   * `asset:read`.
   *
   * The consequence that matters: a Department PIC can open it. `report:read`
   * is excluded from the `CR-004` ceiling because the other eight reports are
   * institution-wide aggregates over assets a PIC cannot reach — true of them,
   * never true of this one. The ceiling itself is unchanged.
   */
  router.get(
    '/inventory-units',
    ...rows(schemas.unitInventoryReport, service.inventoryUnits, 'asset-unit:read')
  );

  /**
   * The spreadsheet export — `CR-009` `DEC-D`.
   *
   * Declared BEFORE `/inventory-units` would matter if that route took a
   * parameter; it does not, so the order is only for reading. What matters is
   * that this is the API's first non-JSON response: it leaves the `{ data }`
   * envelope (`06-api.md` §1.3) because a spreadsheet cannot be wrapped in one,
   * and the envelope's purpose — a predictable shape for a client to unwrap —
   * does not apply to a file the browser saves.
   *
   * Same permission and same scope as the report it exports. An export can never
   * reach a row the report would not have shown.
   */
  router.get(
    '/inventory-units/export',
    // The same code as the report it exports (`CR-010`): an export must never be
    // reachable by someone who could not have read the rows it contains.
    requirePermission('asset-unit:read'),
    validate({ query: schemas.unitInventoryExport }),
    asyncHandler(async (req, res) => {
      const { buffer, departmentLabel } = await service.inventoryUnitsExport(
        req.query,
        req.principal
      );

      sendSpreadsheet(res, buffer, exportFilename(departmentLabel));
    })
  );

  router.get('/status', ...grouped(service.status));
  router.get('/by-classification', ...grouped(service.byClassification));
  router.get('/by-organization', ...grouped(service.byOrganization));
  router.get('/by-location', ...grouped(service.byLocation));
  router.get('/by-condition', ...grouped(service.byCondition));
  router.get('/borrowings', ...rows(schemas.borrowingReport, service.borrowings));
  router.get(
    '/procurement-traceability',
    ...rows(schemas.procurementReport, service.procurementTraceability)
  );

  /**
   * `CR-012` — three groupings, all on `asset-unit:read`.
   *
   * The same derivation as `/inventory-units` above (`CR-010` `DEC-A`): the
   * permission follows the resource being read, and all three count Asset
   * Units. A Department PIC therefore opens them, narrowed to their own
   * departments by `unitScopeDepartmentIds` inside each aggregation.
   *
   * `assessment-activity` reports per-user figures, so its gating deserves
   * saying out loud: `GET /asset-units/:id/history` already returns `createdBy`
   * on every entry, and a PIC-scoped caller may already read the history of
   * every unit in their departments. The report performs an aggregation they
   * could already do by hand — it discloses nothing new, and gating it on
   * `report:read` would withhold from a department the record of its own work.
   *
   * The `CR-004` ceiling is unchanged and no permission code was added.
   */
  router.get(
    '/by-location-condition',
    ...grouped(service.byLocationCondition, schemas.locationConditionReport, 'asset-unit:read')
  );
  router.get(
    '/assessment-coverage',
    ...grouped(service.assessmentCoverage, schemas.assessmentReport, 'asset-unit:read')
  );
  router.get(
    '/assessment-activity',
    ...grouped(service.assessmentActivity, schemas.assessmentReport, 'asset-unit:read')
  );

  return router;
}

module.exports = { reportsRouter };
