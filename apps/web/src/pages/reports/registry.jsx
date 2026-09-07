import { Link } from 'react-router-dom';

import { reportsApi } from '@/api/reporting';
import { formatDate } from '@/lib/dates';
import { StatusBadge } from '@/components/ui/badge';

import { CONDITIONS } from '../assets/AssetsPage';
import { formatDepartment } from '../assets/referenceOptions';

/**
 * The reports — `07-ui.md` §5.7, REQ-REPORT-001–008, plus the unit inventory
 * added by `CR-009`.
 *
 * One declaration each, driving four things that must not disagree: the landing
 * page's cards, the `/reports/:report` screen, the table, and the export.
 * `07-ui.md` §5.7 lists the routes; this registry is why there is one route and
 * N entries rather than N route definitions.
 *
 * STRINGS HERE ARE TRANSLATION KEYS, NOT WORDS. This is a module-scope constant,
 * evaluated while the module graph loads and long before a language is chosen —
 * a word captured here would never change again. `key` names the entry's copy
 * under `reports.items.*`; `header`, `label` and `emptyLabel` are full key
 * paths, resolved by whichever screen renders them.
 *
 * A `cell` or `value` function that needs words takes `t` as its second
 * argument, for the same reason: it runs during render, where a language exists.
 *
 * `kind` selects the envelope the screen expects (`DEC-053`):
 *
 *   'rows'   `{ data, meta }` — paginated, filterable, sortable
 *   'groups' `{ groups, totals }` — a complete breakdown, no page
 *
 * `permission` is what the caller must hold to open it, defaulting to
 * `report:read`. It mirrors the server exactly (`CR-010`), and the landing page
 * and the routes read it — a card linking to a 403 is worse than no card.
 *
 * `filters` names controls the screen knows how to render; each maps 1:1 onto a
 * parameter the endpoint actually accepts (`DEC-051`). Nothing is listed here
 * that the API cannot answer — there is no department or location filter,
 * because no report has a parameter for one.
 *
 * `columns` serve the table AND the client-side export, so a CSV can never drift
 * from what the screen showed.
 *
 * `exportAll` opts an entry OUT of that path: the export is taken by the server
 * over the whole filtered set instead (`CR-009` `DEC-D`), because some reports
 * are printed and a printed list that stops at one page is not the list.
 */

const countColumn = { key: 'count', header: 'reports.columns.count', align: 'right' };

export const REPORTS = [
  {
    slug: 'inventory',
    key: 'inventory',
    kind: 'rows',
    fetch: (params) => reportsApi.inventory(params),
    filters: ['q', 'classification', 'institution', 'status'],
    searchPlaceholder: 'reports.items.inventory.searchPlaceholder',
    columns: [
      {
        key: 'name',
        header: 'reports.columns.asset',
        sortField: 'name',
        cell: (row) => (
          <Link to={`/assets/${row.id}`} className="hover:underline">
            {row.name}
          </Link>
        ),
      },
      {
        key: 'classificationName',
        header: 'reports.columns.classification',
        cell: (row) => (
          <span>
            {row.classificationName ?? '—'}
            <span className="block font-mono text-xs text-muted-foreground">
              {row.classificationId}
            </span>
          </span>
        ),
        value: (row) => row.classificationName ?? row.classificationId,
      },
      {
        key: 'institutionName',
        header: 'reports.columns.institution',
        value: (row) => row.institutionName ?? '',
      },
      { key: 'unitCount', header: 'reports.columns.assetUnits', align: 'right' },
      {
        key: 'isActive',
        header: 'common.fields.status',
        cell: (row) => <StatusBadge value={row.isActive ? 'active' : 'inactive'} />,
        value: (row) => (row.isActive ? 'active' : 'inactive'),
      },
    ],
  },

  /**
   * The unit-level inventory list — `CR-009`.
   *
   * One row per physical item, where `inventory` above is one row per asset.
   * `exportAll` is what routes the export button at the server rather than at
   * the rows on screen: this is the report someone prints, and a printed
   * inventory that stops at row 100 is not one.
   *
   * The screen shows the columns a person reads; the workbook carries the full
   * RPS layout, including the photograph, which no table column can.
   */
  {
    slug: 'inventory-units',
    key: 'inventoryUnits',
    kind: 'rows',
    /**
     * `asset-unit:read`, not `report:read` — `CR-010` `DEC-A`.
     *
     * Its rows ARE Asset Units, narrowed by the same scope as the unit list, so
     * that is the code the server requires. The visible consequence: a
     * Department PIC can open this report and no other, because the `CR-004`
     * ceiling admits `asset-unit:read` and excludes `report:read`.
     */
    permission: 'asset-unit:read',
    fetch: (params) => reportsApi.inventoryUnits(params),
    exportAll: (params) => reportsApi.inventoryUnitsExport(params),
    filters: ['q', 'classification', 'institution', 'status'],
    searchPlaceholder: 'reports.items.inventoryUnits.searchPlaceholder',
    columns: [
      {
        key: 'inventoryCode',
        header: 'reports.columns.inventoryCode',
        sortField: 'inventoryCode',
        cell: (row, t) =>
          row.inventoryCode ? (
            <Link
              to={`/assets/${row.assetId}/units/${row.unitId}`}
              className="font-mono text-xs hover:underline"
            >
              {row.inventoryCode}
            </Link>
          ) : (
            <span className="text-muted-foreground">{t('common.states.notAssigned')}</span>
          ),
        value: (row) => row.inventoryCode ?? '',
      },
      { key: 'assetName', header: 'reports.columns.asset' },
      {
        key: 'departmentName',
        header: 'reports.columns.department',
        cell: (row, t) =>
          formatDepartment({ code: row.departmentCode, name: row.departmentName }) ?? (
            <span className="text-muted-foreground">{t('reports.values.unassigned')}</span>
          ),
        value: (row, t) =>
          formatDepartment({ code: row.departmentCode, name: row.departmentName }) ??
          t('reports.values.unassigned'),
      },
      {
        key: 'locationName',
        header: 'reports.columns.location',
        cell: (row, t) => row.locationName ?? t('reports.values.notRecorded'),
        value: (row, t) => row.locationName ?? t('reports.values.notRecorded'),
      },
      {
        key: 'condition',
        header: 'reports.columns.condition',
        cell: (row, t) =>
          row.condition ? (
            <StatusBadge value={row.condition} />
          ) : (
            <span className="text-muted-foreground">{t('reports.values.notRecorded')}</span>
          ),
        value: (row, t) => row.condition ?? t('reports.values.notRecorded'),
      },
      {
        key: 'lifecycleState',
        header: 'reports.columns.lifecycleState',
        cell: (row) => <StatusBadge value={row.lifecycleState} />,
        value: (row) => row.lifecycleState,
      },
    ],
  },

  {
    slug: 'status',
    key: 'status',
    kind: 'groups',
    fetch: (params) => reportsApi.status(params),
    filters: ['institution'],
    chart: true,
    columns: [{ key: 'label', header: 'reports.columns.lifecycleState' }, countColumn],
    totals: [
      { key: 'assets', label: 'reports.totalLabels.assets' },
      { key: 'activeAssets', label: 'reports.totalLabels.activeAssets' },
      { key: 'inactiveAssets', label: 'reports.totalLabels.inactiveAssets' },
      { key: 'units', label: 'reports.totalLabels.units' },
    ],
  },

  {
    slug: 'by-classification',
    key: 'byClassification',
    kind: 'groups',
    fetch: (params) => reportsApi.byClassification(params),
    filters: ['institution'],
    // §5.7 asks for a chart/table toggle here specifically; both are shown,
    // which is the same information without a control to operate.
    chart: true,
    columns: [
      {
        key: 'label',
        header: 'reports.columns.classification',
        cell: (row) => (
          <span>
            {row.label}
            <span className="block font-mono text-xs text-muted-foreground">{row.key}</span>
          </span>
        ),
      },
      countColumn,
    ],
    totals: [
      { key: 'classifications', label: 'reports.totalLabels.classifications' },
      { key: 'assets', label: 'reports.totalLabels.assets' },
    ],
  },

  {
    slug: 'by-organization',
    key: 'byOrganization',
    kind: 'groups',
    fetch: (params) => reportsApi.byOrganization(params),
    filters: ['institution'],
    // Counts UNITS: institution is on the asset, department on the unit, so the
    // unit is the only row carrying both (`04-data-model.md` §5.3.4, §5.3.5).
    groupKey: (group) => `${group.institutionId ?? 'none'}:${group.departmentId ?? 'none'}`,
    columns: [
      {
        key: 'institutionName',
        header: 'reports.columns.institution',
        cell: (row) => row.institutionName ?? <span className="text-muted-foreground">—</span>,
        value: (row) => row.institutionName ?? '',
      },
      {
        key: 'departmentName',
        header: 'reports.columns.department',
        // `Name (CODE)`, matching the unit detail screen. Phase 20 (`CR-003`)
        // made the code institution-local, so it is the label people recognise
        // and two institutions may legitimately show the same one.
        cell: (row, t) =>
          formatDepartment({ code: row.departmentCode, name: row.departmentName }) ?? (
            <span className="text-muted-foreground">{t('reports.values.unassigned')}</span>
          ),
        value: (row, t) =>
          formatDepartment({ code: row.departmentCode, name: row.departmentName }) ??
          t('reports.values.unassigned'),
      },
      countColumn,
    ],
    totals: [
      { key: 'units', label: 'reports.totalLabels.units' },
      { key: 'institutions', label: 'reports.totalLabels.institutions' },
    ],
  },

  {
    slug: 'by-location',
    key: 'byLocation',
    kind: 'groups',
    fetch: (params) => reportsApi.byLocation(params),
    filters: ['institution'],
    emptyLabel: 'reports.values.noLocation',
    columns: [
      {
        key: 'label',
        header: 'reports.columns.location',
        cell: (row, t) =>
          row.key ? (
            <Link to={`/locations/${row.key}`} className="hover:underline">
              {row.label}
            </Link>
          ) : (
            <span className="text-muted-foreground">{t('reports.values.noLocation')}</span>
          ),
        value: (row, t) => row.label ?? t('reports.values.noLocation'),
      },
      countColumn,
    ],
    totals: [
      { key: 'units', label: 'reports.totalLabels.units' },
      { key: 'locations', label: 'reports.totalLabels.locations' },
      { key: 'unlocated', label: 'reports.totalLabels.unlocated' },
    ],
  },

  {
    slug: 'by-condition',
    key: 'byCondition',
    kind: 'groups',
    fetch: (params) => reportsApi.byCondition(params),
    filters: ['institution'],
    chart: true,
    emptyLabel: 'reports.values.notRecorded',
    columns: [
      {
        key: 'label',
        header: 'reports.columns.condition',
        cell: (row, t) =>
          row.key ? (
            <StatusBadge value={row.key} />
          ) : (
            <span className="text-muted-foreground">{t('reports.values.notRecorded')}</span>
          ),
        value: (row, t) => row.label ?? t('reports.values.notRecorded'),
      },
      countColumn,
    ],
    totals: [
      { key: 'units', label: 'reports.totalLabels.units' },
      { key: 'unrecorded', label: 'reports.totalLabels.unrecorded' },
    ],
  },

  /**
   * `CR-012` — REQ-REPORT-010/011/012.
   *
   * `asset-unit:read`, like the unit inventory and for the same reason
   * (`CR-010` `DEC-A`): all three count Asset Units, and the server narrows
   * them to the caller's own departments. A Department PIC therefore sees four
   * cards in this section rather than one.
   *
   * The dashboard renders the same three endpoints as cards. This is where they
   * are filterable, deep-linkable and exportable — the dashboard shows the
   * current month, this shows any of them.
   */
  {
    slug: 'by-location-condition',
    key: 'byLocationCondition',
    kind: 'groups',
    permission: 'asset-unit:read',
    fetch: (params) => reportsApi.byLocationCondition(params),
    filters: ['institution', 'rollUp'],
    emptyLabel: 'reports.values.noLocation',
    columns: [
      {
        key: 'label',
        header: 'reports.columns.location',
        cell: (row, t) =>
          row.key ? (
            <Link to={`/locations/${row.key}`} className="hover:underline">
              {row.label}
            </Link>
          ) : (
            <span className="text-muted-foreground">{t('reports.values.noLocation')}</span>
          ),
        value: (row, t) => row.label ?? t('reports.values.noLocation'),
      },
      // One column per stored condition. These are CONDITIONS, not lifecycle
      // states — `UNDER_MAINTENANCE` belongs to a different axis entirely.
      ...CONDITIONS.map((condition) => ({
        key: `condition-${condition}`,
        header: `enums.condition.${condition}`,
        align: 'right',
        cell: (row) => row.counts[condition],
        value: (row) => row.counts[condition],
      })),
      {
        key: 'unrecorded',
        header: 'reports.values.notRecorded',
        align: 'right',
        cell: (row) => row.unrecorded,
        value: (row) => row.unrecorded,
      },
      {
        key: 'total',
        header: 'reports.totalLabels.units',
        align: 'right',
        cell: (row) => row.total,
        value: (row) => row.total,
      },
    ],
    totals: [
      { key: 'units', label: 'reports.totalLabels.units' },
      { key: 'locations', label: 'reports.totalLabels.locations' },
      { key: 'unlocated', label: 'reports.totalLabels.unlocated' },
    ],
  },

  {
    slug: 'assessment-coverage',
    key: 'assessmentCoverage',
    kind: 'groups',
    permission: 'asset-unit:read',
    fetch: (params) => reportsApi.assessmentCoverage(params),
    filters: ['institution', 'month'],
    columns: [
      {
        key: 'code',
        header: 'common.fields.department',
        cell: (row) => `${row.code} — ${row.label}`,
        value: (row) => `${row.code} — ${row.label}`,
      },
      {
        key: 'responsible',
        header: 'dashboard.assessment.responsible',
        cell: (row, t) =>
          row.responsible
            ? `${row.responsible.firstName} ${row.responsible.lastName}`
            : t('dashboard.assessment.unassignedPic'),
        value: (row, t) =>
          row.responsible
            ? `${row.responsible.firstName} ${row.responsible.lastName}`
            : t('dashboard.assessment.unassignedPic'),
      },
      {
        key: 'applicable',
        header: 'reports.totalLabels.units',
        align: 'right',
        cell: (row) => row.applicable,
        value: (row) => row.applicable,
      },
      {
        key: 'assessed',
        header: 'dashboard.assessment.coverage',
        align: 'right',
        cell: (row) => `${row.assessed}/${row.applicable}`,
        value: (row) => `${row.assessed}/${row.applicable}`,
      },
      {
        key: 'unassessed',
        header: 'dashboard.assessment.unassessed',
        align: 'right',
        cell: (row) => row.unassessed,
        value: (row) => row.unassessed,
      },
      {
        /**
         * A department with no responsible user shows NO PERCENTAGE — it has
         * not failed to assess its units, it has nobody to ask (`DEC-I`). One
         * with no units reads "no units" rather than 0%.
         */
        key: 'state',
        header: 'common.fields.status',
        cell: (row, t) =>
          row.state === 'TRACKED'
            ? `${Math.round(row.coverage * 100)}%`
            : t(
                row.state === 'NO_UNITS'
                  ? 'dashboard.assessment.noUnits'
                  : 'dashboard.assessment.noResponsibleUser'
              ),
        value: (row, t) =>
          row.state === 'TRACKED'
            ? `${Math.round(row.coverage * 100)}%`
            : t(
                row.state === 'NO_UNITS'
                  ? 'dashboard.assessment.noUnits'
                  : 'dashboard.assessment.noResponsibleUser'
              ),
      },
    ],
    totals: [
      { key: 'applicable', label: 'reports.totalLabels.units' },
      { key: 'assessed', label: 'dashboard.assessment.coverage' },
      { key: 'unassessed', label: 'dashboard.assessment.unassessed' },
    ],
  },

  {
    slug: 'assessment-activity',
    key: 'assessmentActivity',
    kind: 'groups',
    permission: 'asset-unit:read',
    fetch: (params) => reportsApi.assessmentActivity(params),
    filters: ['institution', 'month'],
    columns: [
      {
        key: 'user',
        header: 'common.fields.user',
        cell: (row) => (row.user ? `${row.user.firstName} ${row.user.lastName}` : row.label),
        value: (row) => (row.user ? `${row.user.firstName} ${row.user.lastName}` : row.label),
      },
      // `entries` and `uniqueUnits` are separate columns, always. Activity is
      // not coverage, and one presented alone would be read as the other.
      {
        key: 'entries',
        header: 'dashboard.assessment.entries',
        align: 'right',
        cell: (row) => row.entries,
        value: (row) => row.entries,
      },
      {
        key: 'uniqueUnits',
        header: 'dashboard.assessment.uniqueUnits',
        align: 'right',
        cell: (row) => row.uniqueUnits,
        value: (row) => row.uniqueUnits,
      },
      {
        key: 'lastAt',
        header: 'dashboard.assessment.lastActivity',
        cell: (row) => (row.lastAt ? formatDate(row.lastAt) : '—'),
        value: (row) => (row.lastAt ? formatDate(row.lastAt) : ''),
      },
    ],
    totals: [
      { key: 'contributors', label: 'common.fields.user' },
      { key: 'entries', label: 'dashboard.assessment.entries' },
      { key: 'assessed', label: 'dashboard.assessment.coverage' },
    ],
  },

  {
    slug: 'borrowings',
    key: 'borrowings',
    kind: 'rows',
    fetch: (params) => reportsApi.borrowings(params),
    filters: ['borrowingStatus', 'overdue', 'institution', 'dateRange'],
    columns: [
      {
        key: 'borrowerName',
        header: 'reports.columns.borrower',
        cell: (row) => (
          <Link to={`/operations/borrowings/${row.id}`} className="hover:underline">
            {row.borrowerName}
          </Link>
        ),
      },
      { key: 'borrowerContact', header: 'reports.columns.contact' },
      {
        key: 'borrowDate',
        header: 'reports.columns.borrowed',
        sortField: 'borrowDate',
        cell: (row) => formatDate(row.borrowDate),
        value: (row) => row.borrowDate,
      },
      {
        key: 'expectedReturnDate',
        header: 'reports.columns.due',
        sortField: 'expectedReturnDate',
        cell: (row, t) => (
          <span>
            {formatDate(row.expectedReturnDate)}
            {row.isOverdue ? (
              <span className="block text-xs text-destructive">{t('reports.values.pastDue')}</span>
            ) : null}
          </span>
        ),
        value: (row) => row.expectedReturnDate,
      },
      {
        key: 'actualReturnDate',
        header: 'reports.columns.returned',
        cell: (row) => (row.actualReturnDate ? formatDate(row.actualReturnDate) : '—'),
        value: (row) => row.actualReturnDate ?? '',
      },
      { key: 'unitCount', header: 'reports.columns.assetUnits', align: 'right' },
      {
        key: 'status',
        header: 'common.fields.status',
        sortField: 'status',
        cell: (row) => <StatusBadge value={row.status} />,
      },
    ],
  },

  {
    slug: 'procurement-traceability',
    key: 'procurementTraceability',
    kind: 'rows',
    fetch: (params) => reportsApi.procurementTraceability(params),
    filters: ['traced', 'institution'],
    rowId: (row) => row.assetId,
    columns: [
      {
        key: 'assetName',
        header: 'reports.columns.asset',
        sortField: 'name',
        cell: (row) => (
          <Link to={`/assets/${row.assetId}`} className="hover:underline">
            {row.assetName}
          </Link>
        ),
      },
      {
        key: 'contractNumber',
        header: 'reports.columns.contract',
        cell: (row, t) =>
          row.contractId ? (
            <Link to={`/procurement/contracts/${row.contractId}`} className="hover:underline">
              {row.contractNumber}
            </Link>
          ) : (
            <span className="text-muted-foreground">{t('reports.values.noProcurement')}</span>
          ),
        value: (row) => row.contractNumber ?? '',
      },
      {
        key: 'supplierName',
        header: 'reports.columns.supplier',
        value: (row) => row.supplierName ?? '',
      },
      {
        key: 'contractDate',
        header: 'reports.columns.contractDate',
        cell: (row) => (row.contractDate ? formatDate(row.contractDate) : '—'),
        value: (row) => row.contractDate ?? '',
      },
      { key: 'unitCount', header: 'reports.columns.assetUnits', align: 'right' },
      {
        key: 'tracedUnitCount',
        header: 'reports.columns.tracedUnits',
        align: 'right',
        // A gap between the two is the finding this report exists for
        // (REQ-PROC-006): units registered outside the procurement flow.
        cell: (row) => (
          <span className={row.tracedUnitCount < row.unitCount ? 'text-warning-foreground' : ''}>
            {row.tracedUnitCount}
          </span>
        ),
      },
    ],
  },
];

export function findReport(slug) {
  return REPORTS.find((report) => report.slug === slug);
}

/** What a report requires. `report:read` unless it says otherwise (`CR-010`). */
export function permissionFor(report) {
  return report.permission ?? 'report:read';
}

/**
 * Every permission that opens at least one report.
 *
 * The Reports section is reachable by anyone holding ANY of these, rather than
 * by `report:read` alone: a Department PIC holds `asset-unit:read` and can open
 * the unit inventory, and gating the section on the old single code would hide
 * the one report they are entitled to.
 */
export const REPORT_PERMISSIONS = [...new Set(REPORTS.map(permissionFor))];
