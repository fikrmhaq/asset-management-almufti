import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, ERROR_CODES } from '@/api/errors';
import * as reportingApi from '@/api/reporting';
import * as organizationApi from '@/api/organization';
import { toCsv } from '@/lib/csv';
import { t } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { REPORTS } from './registry';
import { ReportsPage } from './ReportsPage';
import { ReportPage } from './ReportPage';
import { InstitutionMetrics } from '../dashboard/InstitutionMetrics';

/**
 * Reporting screens — `07-ui.md` §5.7, `IMPLEMENTATION_PLAN.md` §21.1–§21.3.
 */

const ALL = [
  'report:read',
  // Every role that holds `report:read` in practice also holds this, and since
  // `CR-010` it is what opens the unit inventory report.
  'asset-unit:read',
  'institution:read',
  'classification:read',
  'asset:read',
];

const page = (rows, meta = {}) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1, ...meta },
});

const STATUS_REPORT = {
  groups: [
    { key: 'ACTIVE', label: 'ACTIVE', count: 7 },
    { key: 'REGISTERED', label: 'REGISTERED', count: 3 },
  ],
  totals: { assets: 4, activeAssets: 3, inactiveAssets: 1, units: 10 },
};

const CONDITION_REPORT = {
  groups: [
    { key: 'GOOD', label: 'GOOD', count: 6 },
    { key: null, label: null, count: 4 },
  ],
  totals: { units: 10, unrecorded: 4 },
};

beforeEach(() => {
  signInWith(ALL);

  vi.spyOn(reportingApi.reportsApi, 'status').mockResolvedValue(STATUS_REPORT);
  vi.spyOn(reportingApi.reportsApi, 'byCondition').mockResolvedValue(CONDITION_REPORT);
  vi.spyOn(reportingApi.reportsApi, 'byClassification').mockResolvedValue({
    groups: [{ key: '117010101001', label: 'Aspal', count: 2 }],
    totals: { classifications: 1, assets: 2 },
  });
  vi.spyOn(reportingApi.reportsApi, 'byOrganization').mockResolvedValue({
    groups: [
      {
        institutionId: 'inst-1',
        institutionName: 'Dinas Pendidikan',
        departmentId: null,
        departmentName: null,
        count: 5,
      },
    ],
    totals: { units: 5, institutions: 1 },
  });
  vi.spyOn(reportingApi.reportsApi, 'byLocation').mockResolvedValue({
    groups: [
      { key: 'loc-1', label: 'Ruang Server', count: 3 },
      { key: null, label: null, count: 2 },
    ],
    totals: { units: 5, locations: 1, unlocated: 2 },
  });
  vi.spyOn(reportingApi.reportsApi, 'inventory').mockResolvedValue(
    page([
      {
        id: 'asset-1',
        name: 'Laptop Dell',
        classificationId: '117010101001',
        classificationName: 'Aspal',
        institutionId: 'inst-1',
        institutionName: 'Dinas Pendidikan',
        isActive: true,
        unitCount: 3,
      },
    ])
  );
  vi.spyOn(reportingApi.reportsApi, 'borrowings').mockResolvedValue(
    page([
      {
        id: 'brw-1',
        borrowerName: 'Andi',
        borrowerContact: '0812',
        borrowDate: '2026-08-01',
        expectedReturnDate: '2026-08-10',
        actualReturnDate: null,
        status: 'ACTIVE',
        unitCount: 2,
        isOverdue: true,
      },
    ])
  );
  vi.spyOn(reportingApi.reportsApi, 'procurementTraceability').mockResolvedValue(
    page([
      {
        assetId: 'asset-1',
        assetName: 'Komputer',
        contractId: 'con-1',
        contractNumber: 'SPK/2026/001',
        contractDate: '2026-08-01',
        supplierName: 'CV Sumber Jaya',
        unitCount: 3,
        tracedUnitCount: 1,
      },
    ])
  );

  vi.spyOn(organizationApi.institutionsApi, 'list').mockResolvedValue(
    page([{ id: 'inst-1', name: 'Dinas Pendidikan', code: 'DISDIK', isActive: true }])
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CSV export (DEC-052)', () => {
  it('quotes every field and doubles embedded quotes', () => {
    const csv = toCsv(
      [
        { key: 'name', header: 'Name' },
        { key: 'note', header: 'Note' },
      ],
      [
        { name: 'A, B', note: 'He said "hi"' },
        { name: 'Line\nbreak', note: null },
      ]
    );

    expect(csv.split('\r\n')[0]).toBe('"Name","Note"');
    expect(csv).toContain('"A, B"');
    expect(csv).toContain('"He said ""hi"""');
    // A null is an empty field, not the text "null".
    expect(csv.split('\r\n')[2]).toBe('"Line\nbreak",""');
  });

  it('uses the column value mapper when one is declared', () => {
    const csv = toCsv(
      [
        {
          key: 'isActive',
          header: 'Status',
          value: (row) => (row.isActive ? 'active' : 'inactive'),
        },
      ],
      [{ isActive: false }]
    );

    expect(csv).toContain('"inactive"');
  });
});

describe('ReportsPage', () => {
  it('lists every registered report, linked to its own route', async () => {
    renderScreen(<ReportsPage />);

    for (const report of REPORTS) {
      // The registry holds a translation key, not a title — it is a module-scope
      // constant built before a language exists. Resolving it here is what the
      // page itself does.
      const title = t(`reports.items.${report.key}.title`);
      // A key that resolved to nothing would fall back to its last segment, and
      // "title" is not a report name.
      expect(title).not.toBe('title');

      /**
       * Found by ROUTE, then checked for its title — not the other way round.
       *
       * Since `CR-009` the titles are no longer unique as substrings: "Inventory"
       * is a strict prefix of "Inventory (per unit)", so no name matcher,
       * anchored or otherwise, can separate the two cards. The slug is what is
       * actually unique, and "every report has a card linking to its own route,
       * labelled with its own title" is the invariant worth asserting anyway.
       */
      const link = screen
        .getAllByRole('link')
        .find((element) => element.getAttribute('href') === `/reports/${report.slug}`);

      expect(link, `no card links to /reports/${report.slug}`).toBeDefined();
      expect(link).toHaveTextContent(title);
    }

    // Nine through `CR-009`/`CR-010`; twelve since `CR-012` added the location
    // and condition matrix, assessment coverage and assessment activity.
    expect(REPORTS).toHaveLength(12);
  });

  /**
   * Per-report permissions — `CR-010`.
   *
   * The unit inventory requires `asset-unit:read` because its rows ARE Asset
   * Units; the other eight require `report:read`. That is what lets a Department
   * PIC — whose permissions the `CR-004` ceiling reduces to a set containing the
   * first and not the second — open the one report they are entitled to.
   */
  describe('cards are filtered by permission (CR-010)', () => {
    const cardHrefs = () =>
      screen
        .queryAllByRole('link')
        .map((element) => element.getAttribute('href'))
        .filter((href) => href?.startsWith('/reports/'));

    it('shows a PIC-scoped caller only the reports whose subject is their own units', async () => {
      // The effective set a Department PIC actually has: the ceiling strips
      // `report:read` however the role was granted.
      signInWith(['asset-unit:read', 'classification:read']);
      renderScreen(<ReportsPage />);

      /*
        One card under `CR-010`; four since `CR-012`, which added three more
        reports counting Asset Units. All four are narrowed to the caller's own
        departments by the server, and the eight `report:read` aggregates remain
        absent — the ceiling is unchanged and no permission code was added.
      */
      expect(cardHrefs()).toEqual([
        '/reports/inventory-units',
        '/reports/by-location-condition',
        '/reports/assessment-coverage',
        '/reports/assessment-activity',
      ]);
    });

    it('hides the unit inventory from a caller holding only report:read', async () => {
      signInWith(['report:read']);
      renderScreen(<ReportsPage />);

      const hrefs = cardHrefs();
      expect(hrefs).not.toContain('/reports/inventory-units');
      expect(hrefs).toContain('/reports/status');
      expect(hrefs).toHaveLength(8);
    });

    it('shows nothing at all to a caller holding neither', async () => {
      signInWith(['classification:read']);
      renderScreen(<ReportsPage />);

      expect(cardHrefs()).toHaveLength(0);
    });
  });
});

describe('ReportPage — grouped reports (DEC-053)', () => {
  const renderReport = (slug) =>
    renderScreen(<ReportPage />, { path: '/reports/:report', route: `/reports/${slug}` });

  it('renders totals, a chart and a table for the status report', async () => {
    renderReport('status');

    expect(await screen.findByRole('heading', { name: 'Status' })).toBeInTheDocument();

    // Totals block, from the aggregate envelope — awaited, because the header
    // and filters render before the query resolves.
    expect(await screen.findByText('Active assets')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();

    // The chart renders its numbers as TEXT, which is what makes it accessible
    // and what makes it assertable here at all (`DEC-048`).
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: 'Lifecycle state' })).toBeInTheDocument();
  });

  it('shows no pagination for a bounded grouping', async () => {
    renderReport('by-condition');
    await screen.findByRole('columnheader', { name: 'Condition' });

    expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument();
  });

  it('labels a null group rather than dropping it', async () => {
    renderReport('by-location');

    expect(await screen.findByText('No location recorded')).toBeInTheDocument();
    expect(screen.getByText('Ruang Server')).toBeInTheDocument();
  });

  it('groups by institution and department (REQ-REPORT-004)', async () => {
    renderReport('by-organization');

    expect(await screen.findByText('Dinas Pendidikan')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('sends the institution filter to the endpoint', async () => {
    renderScreen(<ReportPage />, {
      path: '/reports/:report',
      route: '/reports/status?institutionId=inst-1',
    });

    await waitFor(() =>
      expect(reportingApi.reportsApi.status).toHaveBeenCalledWith({ institutionId: 'inst-1' })
    );
  });
});

describe('ReportPage — row reports', () => {
  const renderReport = (slug, search = '') =>
    renderScreen(<ReportPage />, {
      path: '/reports/:report',
      route: `/reports/${slug}${search}`,
    });

  it('paginates the inventory and shows unit counts', async () => {
    renderReport('inventory');

    expect(await screen.findByRole('link', { name: 'Laptop Dell' })).toHaveAttribute(
      'href',
      '/assets/asset-1'
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
  });

  it('marks an overdue loan on the borrowing report', async () => {
    renderReport('borrowings');

    expect(await screen.findByRole('link', { name: 'Andi' })).toBeInTheDocument();
    expect(screen.getByText('Past due')).toBeInTheDocument();
  });

  it('shows an asset with no procurement record as such', async () => {
    reportingApi.reportsApi.procurementTraceability.mockResolvedValue(
      page([
        {
          assetId: 'asset-2',
          assetName: 'Donated',
          contractId: null,
          contractNumber: null,
          contractDate: null,
          supplierName: null,
          unitCount: 1,
          tracedUnitCount: 0,
        },
      ])
    );

    renderReport('procurement-traceability');

    expect(await screen.findByText('No procurement record')).toBeInTheDocument();
  });

  it('renders only the filters the endpoint actually accepts (DEC-051)', async () => {
    renderReport('borrowings');
    await screen.findByRole('link', { name: 'Andi' });

    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Overdue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Any start date' })).toBeInTheDocument();

    // §21.3 lists department and location filters; no report has a parameter
    // for either, so neither control exists rather than doing nothing.
    expect(screen.queryByLabelText('Department')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Location')).not.toBeInTheDocument();
  });

  it('forwards every list param to the endpoint', async () => {
    renderReport('borrowings', '?status=ACTIVE&overdue=true');

    await waitFor(() =>
      expect(reportingApi.reportsApi.borrowings).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ACTIVE', overdue: 'true' })
      )
    );
  });

  it('offers export only when there is something to export', async () => {
    renderReport('inventory');
    await screen.findByRole('link', { name: 'Laptop Dell' });

    expect(screen.getByRole('button', { name: /export csv/i })).toBeEnabled();

    reportingApi.reportsApi.inventory.mockResolvedValue(page([]));
    renderReport('inventory');

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /export csv/i }).at(-1)).toBeDisabled()
    );
  });

  it('surfaces a failure as an error state', async () => {
    reportingApi.reportsApi.inventory.mockRejectedValue(
      new ApiError({ code: ERROR_CODES.FORBIDDEN, message: 'No', status: 403 })
    );

    renderReport('inventory');

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
  });
});

/**
 * The unit inventory report — `CR-009`.
 *
 * Its export is the only one in the module that goes to the SERVER, because it
 * is the only one that must cover more than the page on screen.
 */
describe('ReportPage — unit inventory (CR-009)', () => {
  const UNIT_ROWS = [
    {
      no: 1,
      unitId: 'unit-1',
      assetId: 'asset-1',
      assetName: 'LAPTOP ACER',
      inventoryCode: 'ALM-1-2026-00042',
      departmentCode: 'TKJ',
      departmentName: 'Teknik Komputer',
      locationName: 'RPS 5',
      condition: 'GOOD',
      lifecycleState: 'ACTIVE',
    },
    {
      no: 2,
      unitId: 'unit-2',
      assetId: 'asset-1',
      assetName: 'LAPTOP ACER',
      inventoryCode: null,
      departmentCode: null,
      departmentName: null,
      locationName: null,
      condition: null,
      lifecycleState: 'REGISTERED',
    },
  ];

  const renderUnits = () =>
    renderScreen(<ReportPage />, {
      path: '/reports/:report',
      route: '/reports/inventory-units',
    });

  beforeEach(() => {
    vi.spyOn(reportingApi.reportsApi, 'inventoryUnits').mockResolvedValue(page(UNIT_ROWS));
  });

  it('lists one row per physical unit, not per asset', async () => {
    renderUnits();

    // Both rows are the SAME asset — which is the whole point of the report.
    expect(await screen.findByText('ALM-1-2026-00042')).toBeInTheDocument();
    expect(screen.getAllByText('LAPTOP ACER')).toHaveLength(2);
    expect(screen.getByText('Teknik Komputer (TKJ)')).toBeInTheDocument();
  });

  it('names what a unit has not got rather than leaving it blank', async () => {
    renderUnits();
    await screen.findByText('ALM-1-2026-00042');

    // A unit with no code yet is a real state, and a blank cell reads as a bug.
    expect(screen.getByText('Not assigned')).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  });

  it('exports through the server, over the filters rather than the page', async () => {
    const exportCall = vi
      .spyOn(reportingApi.reportsApi, 'inventoryUnitsExport')
      .mockResolvedValue({ blob: new Blob(['x']), filename: 'inventaris-2026-08-28.xlsx' });

    renderScreen(<ReportPage />, {
      path: '/reports/:report',
      route: '/reports/inventory-units?page=2&status=active',
    });

    await screen.findByText('ALM-1-2026-00042');
    await userEvent.click(screen.getByRole('button', { name: /export workbook/i }));

    await waitFor(() => expect(exportCall).toHaveBeenCalled());

    const sent = exportCall.mock.calls[0][0];
    expect(sent).toMatchObject({ status: 'active' });
    // The export is the whole matching set by definition; a page would put back
    // exactly the defect it exists to fix.
    expect(sent).not.toHaveProperty('page');
    expect(sent).not.toHaveProperty('pageSize');
  });

  it('says the export covers everything, not just this page', async () => {
    renderUnits();
    await screen.findByText('ALM-1-2026-00042');

    expect(screen.getByText(/not only this page/i)).toBeInTheDocument();
  });

  it('surfaces a refusal to export rather than failing silently', async () => {
    vi.spyOn(reportingApi.reportsApi, 'inventoryUnitsExport').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'This export covers more than 5,000 units',
        status: 400,
        details: [{ field: 'departmentId', issue: 'narrow the report before exporting' }],
      })
    );

    renderUnits();
    await screen.findByText('ALM-1-2026-00042');
    await userEvent.click(screen.getByRole('button', { name: /export workbook/i }));

    expect(await screen.findByText(/more than 5,000 units/i)).toBeInTheDocument();
  });
});

describe('ReportPage — unknown slug (DEC-056)', () => {
  it('says so rather than rendering an empty screen', async () => {
    renderScreen(<ReportPage />, { path: '/reports/:report', route: '/reports/nonsense' });

    expect(await screen.findByText(/No report called/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to reports/i })).toBeInTheDocument();
  });
});

/**
 * The dashboard's institution-wide card — `DEC-049`, and `07-ui.md` §5.9 since
 * `CR-012` gave the dashboard a specification.
 *
 * These figures did not change when `CR-012` split the dashboard into
 * permission-gated cards; they moved into `InstitutionMetrics`, which is what
 * `report:read` now opens. Asserted against that component directly, so this
 * file keeps testing the reports it always tested rather than the card registry
 * around them (`pages/dashboard/dashboard.test.jsx` covers that).
 */
describe('InstitutionMetrics — what report:read opens on the dashboard (DEC-049)', () => {
  it('builds every metric from report endpoints only', async () => {
    renderScreen(<InstitutionMetrics />);

    const assets = (await screen.findByText('Assets')).closest('li');
    expect(within(assets).getByText('4')).toBeInTheDocument(); // totals.assets
    expect(within(assets).getByText('3 active')).toBeInTheDocument();
    expect(screen.getByText('Asset units')).toBeInTheDocument();

    // Both breakdowns come from the same reports the screens use.
    expect(reportingApi.reportsApi.status).toHaveBeenCalled();
    expect(reportingApi.reportsApi.byCondition).toHaveBeenCalled();
    expect(reportingApi.reportsApi.borrowings).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: 'true' })
    );
  });

  it('links each metric to the report it came from', async () => {
    renderScreen(<InstitutionMetrics />);
    await screen.findByText('Assets');

    expect(screen.getByRole('link', { name: /assets/i })).toHaveAttribute(
      'href',
      '/reports/inventory'
    );
  });

  it('shows an error state when the source report fails', async () => {
    reportingApi.reportsApi.status.mockRejectedValue(
      new ApiError({ code: ERROR_CODES.FORBIDDEN, message: 'No', status: 403 })
    );

    renderScreen(<InstitutionMetrics />);

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
  });

  /**
   * Assets by classification. Like every other figure here it comes from a
   * report endpoint, and the card links to the report the rest of the rows
   * live in — the catalogue is far too large to put on a dashboard.
   */
  describe('assets by classification', () => {
    it('charts the classification report and links to it', async () => {
      renderScreen(<InstitutionMetrics />);

      const card = (await screen.findByText('Assets by classification')).closest('section');

      expect(within(card).getByText('Aspal')).toBeInTheDocument();
      expect(within(card).getByRole('link', { name: /full report/i })).toHaveAttribute(
        'href',
        '/reports/by-classification'
      );
      expect(reportingApi.reportsApi.byClassification).toHaveBeenCalled();
    });

    it('shows the largest ten, not the whole catalogue', async () => {
      reportingApi.reportsApi.byClassification.mockResolvedValue({
        // Ascending on purpose: the endpoint orders by code, so the card cannot
        // rely on the response order to find the largest.
        groups: Array.from({ length: 14 }, (_, index) => ({
          key: String(index).padStart(12, '0'),
          label: `Class ${index}`,
          count: index + 1,
        })),
        totals: { classifications: 14, assets: 105 },
      });

      renderScreen(<InstitutionMetrics />);

      const card = (await screen.findByText('Assets by classification')).closest('section');

      expect(within(card).getByText('Class 13')).toBeInTheDocument(); // largest
      expect(within(card).getByText('Class 4')).toBeInTheDocument(); // tenth
      expect(within(card).queryByText('Class 3')).not.toBeInTheDocument(); // eleventh
    });

    it('fails on its own without taking the rest of the dashboard down', async () => {
      reportingApi.reportsApi.byClassification.mockRejectedValue(
        new ApiError({ code: ERROR_CODES.FORBIDDEN, message: 'No', status: 403 })
      );

      renderScreen(<InstitutionMetrics />);

      // The metrics still render: each card owns its own query.
      expect(await screen.findByText('Assets')).toBeInTheDocument();
      const card = screen.getByText('Assets by classification').closest('section');
      expect(within(card).getByRole('alert')).toBeInTheDocument();
    });
  });
});
