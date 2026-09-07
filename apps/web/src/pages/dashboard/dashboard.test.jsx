import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import { renderScreen, signInWith, signOut } from '@/test/harness';
import { reportsApi } from '@/api/reporting';

import { DashboardPage } from './DashboardPage';
import { DASHBOARD_CARDS, DASHBOARD_PERMISSIONS, visibleCards } from './cards';

/**
 * Dashboard — `07-ui.md` §5.9, `CR-012` `DEC-P`. TC-COND-006, TC-REPORT-010/012.
 *
 * The dashboard is the ONE screen `CR-012` opens to a caller who could not
 * previously reach it, so what is pinned here is which cards each tier gets —
 * and, just as importantly, that a caller never issues a request for a card they
 * cannot open. The previous version fired five unconditional report queries,
 * which is exactly what a PIC-scoped caller could not do.
 */

const COVERAGE = {
  groups: [
    {
      key: 'dept-1',
      code: 'TKJ',
      label: 'Teknik Komputer',
      isActive: true,
      state: 'TRACKED',
      responsible: { id: 'u9', username: 'budi', firstName: 'Budi', lastName: 'Santoso' },
      applicable: 4,
      applicableBorrowed: 0,
      assessed: 3,
      unassessed: 1,
      assessedByOthers: 1,
      coverage: 0.75,
      lastAssessmentAt: '2026-08-20T02:00:00.000Z',
    },
    {
      key: 'dept-2',
      code: 'TKR',
      label: 'Teknik Kendaraan',
      isActive: true,
      state: 'NO_RESPONSIBLE_USER',
      responsible: null,
      applicable: 2,
      applicableBorrowed: 0,
      assessed: 0,
      unassessed: 2,
      assessedByOthers: 0,
      coverage: 0,
      lastAssessmentAt: null,
    },
    {
      key: 'dept-3',
      code: 'ADM',
      label: 'Administrasi',
      isActive: true,
      state: 'NO_UNITS',
      responsible: null,
      applicable: 0,
      applicableBorrowed: 0,
      assessed: 0,
      unassessed: 0,
      assessedByOthers: 0,
      coverage: null,
      lastAssessmentAt: null,
    },
  ],
  totals: { departments: 3, applicable: 6, assessed: 3, unassessed: 3, month: '2026-08' },
  unassigned: { applicable: 5, applicableBorrowed: 1, withManualEntry: 2 },
};

const ACTIVITY = {
  groups: [
    {
      key: 'u9',
      label: 'budi',
      user: { id: 'u9', username: 'budi', firstName: 'Budi', lastName: 'Santoso' },
      relationship: 'PIC',
      entries: 5,
      uniqueUnits: 3,
      qualifyingUnits: 3,
      contribution: 1,
      lastAt: '2026-08-20T02:00:00.000Z',
    },
    {
      key: 'u2',
      label: 'admin',
      user: { id: 'u2', username: 'admin', firstName: 'Ana', lastName: 'Admin' },
      relationship: 'INSTITUTION',
      entries: 1,
      uniqueUnits: 1,
      qualifyingUnits: 0,
      contribution: 0,
      lastAt: '2026-08-19T02:00:00.000Z',
    },
  ],
  totals: { contributors: 2, entries: 6, assessed: 3, month: '2026-08' },
};

const MATRIX = {
  groups: [
    {
      key: 'loc-1',
      label: 'Ruang 101',
      parentId: null,
      counts: { GOOD: 2, FAIR: 0, POOR: 0, DAMAGED: 1, UNSERVICEABLE: 0 },
      unrecorded: 0,
      total: 3,
    },
    {
      key: null,
      label: null,
      parentId: null,
      counts: { GOOD: 0, FAIR: 0, POOR: 0, DAMAGED: 0, UNSERVICEABLE: 0 },
      unrecorded: 2,
      total: 2,
    },
  ],
  totals: { units: 5, locations: 1, unlocated: 2, unrecorded: 2, rollUp: false },
};

function stubReports() {
  return {
    coverage: vi.spyOn(reportsApi, 'assessmentCoverage').mockResolvedValue(COVERAGE),
    activity: vi.spyOn(reportsApi, 'assessmentActivity').mockResolvedValue(ACTIVITY),
    matrix: vi.spyOn(reportsApi, 'byLocationCondition').mockResolvedValue(MATRIX),
    status: vi.spyOn(reportsApi, 'status').mockResolvedValue({
      groups: [],
      totals: { assets: 10, activeAssets: 9, units: 20 },
    }),
    byCondition: vi.spyOn(reportsApi, 'byCondition').mockResolvedValue({ groups: [], totals: {} }),
    byClassification: vi
      .spyOn(reportsApi, 'byClassification')
      .mockResolvedValue({ groups: [], totals: {} }),
    borrowings: vi
      .spyOn(reportsApi, 'borrowings')
      .mockResolvedValue({ data: [], meta: { total: 0 } }),
  };
}

let stubs;

beforeEach(() => {
  stubs = stubReports();
});

afterEach(() => {
  vi.restoreAllMocks();
  signOut();
});

describe('the card registry (CR-012 DEC-P)', () => {
  it('derives the permission set from the cards themselves', () => {
    expect(DASHBOARD_PERMISSIONS).toEqual([...new Set(DASHBOARD_CARDS.map((c) => c.permission))]);
    // The whole point of the change: `asset-unit:read` opens the front door.
    expect(DASHBOARD_PERMISSIONS).toContain('asset-unit:read');
    expect(DASHBOARD_PERMISSIONS).toContain('report:read');
  });

  it('hides the unassigned card from a PIC-scoped caller', () => {
    const can = () => true;

    expect(visibleCards(can, false).map((card) => card.id)).toContain('unassigned-units');
    expect(visibleCards(can, true).map((card) => card.id)).not.toContain('unassigned-units');
  });

  it('gives a caller with only asset-unit:read the three assessment cards', () => {
    const can = (code) => code === 'asset-unit:read';

    expect(visibleCards(can, true).map((card) => card.id)).toEqual([
      'assessment-coverage',
      'assessment-activity',
      'location-condition',
    ]);
  });
});

describe('an institution administrator', () => {
  beforeEach(() => {
    signInWith(['asset-unit:read', 'report:read']);
  });

  it('sees the assessment cards and the institution metrics', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/monthly assessment coverage/i)).toBeInTheDocument();
    expect(await screen.findByText(/assessment activity/i)).toBeInTheDocument();
    expect(await screen.findByText(/units by location and condition/i)).toBeInTheDocument();
    expect(await screen.findByText(/units by lifecycle state/i)).toBeInTheDocument();
  });

  it('shows the unassigned-units card', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/units with no department/i)).toBeInTheDocument();
  });

  it('renders coverage as a proportion AND both counts', async () => {
    renderScreen(<DashboardPage />);

    // A percentage alone cannot distinguish 3 of 4 from 300 of 400.
    expect(await screen.findByText('3/4')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  /** `DEC-I` — the state that must never read as a failing percentage. */
  it('shows no percentage for a department with no person in charge', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/no person in charge/i)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('says "no units" rather than zero per cent', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/^no units$/i)).toBeInTheDocument();
  });

  /** `DEC-G` — the figure that explains a shortfall instead of hiding it. */
  it('explains units assessed by someone other than the department', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/do not count towards coverage/i)).toBeInTheDocument();
  });

  /**
   * ACTIVITY IS NOT COVERAGE. Both numbers must be on screen, in their own
   * columns, or a reader will take one for the other.
   */
  it('shows entries and unique units as separate figures', async () => {
    renderScreen(<DashboardPage />);

    // Scoped to the activity card: "Budi Santoso" is also the responsible person
    // on the coverage table above, and the two are different facts.
    const card = (await screen.findByRole('heading', { name: /assessment activity/i })).closest(
      'section'
    );
    const row = (await within(card).findByText('Budi Santoso')).closest('tr');

    expect(row).toHaveTextContent('5');
    expect(row).toHaveTextContent('3');
    // And the covered total is stated beside the list, so an overlap reads as
    // an overlap rather than as an error.
    expect(screen.getByText(/3 unit\(s\) covered this month/i)).toBeInTheDocument();
  });

  it('marks a contributor who was not the department PIC', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/not the department’s PIC/i)).toBeInTheDocument();
  });

  it('links an unassessed count to the units behind it', async () => {
    renderScreen(<DashboardPage />);

    // The card title renders before its query resolves, so wait for a value
    // that only the response can supply.
    await screen.findByText('TKJ');

    const link = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href')?.includes('unassessedIn'));
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toContain('departmentId=dept-1');
  });
});

describe('a department (PIC-scoped) caller', () => {
  beforeEach(() => {
    signInWith(['asset-unit:read'], { isPicScoped: true, isSystemWide: false });
  });

  it('reaches the dashboard at all', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/monthly assessment coverage/i)).toBeInTheDocument();
  });

  it('sees a description naming their own departments', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/departments you are responsible for/i)).toBeInTheDocument();
  });

  /**
   * Cards they cannot open are ABSENT, not present-and-refusing — and the
   * requests behind them are never issued. A `403` the user never sees is still
   * a request the server had to refuse.
   */
  it('does not see the institution-wide metrics, and does not request them', async () => {
    renderScreen(<DashboardPage />);

    await screen.findByText(/monthly assessment coverage/i);

    expect(screen.queryByText(/units by lifecycle state/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/assets by classification/i)).not.toBeInTheDocument();
    expect(stubs.status).not.toHaveBeenCalled();
    expect(stubs.byClassification).not.toHaveBeenCalled();
    expect(stubs.borrowings).not.toHaveBeenCalled();
  });

  it('does not see the unassigned-units card', async () => {
    renderScreen(<DashboardPage />);

    await screen.findByText(/monthly assessment coverage/i);

    expect(screen.queryByText(/units with no department/i)).not.toBeInTheDocument();
  });
});

describe('a caller with only report:read', () => {
  beforeEach(() => {
    signInWith(['report:read']);
  });

  it('sees the institution metrics and none of the assessment cards', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/units by lifecycle state/i)).toBeInTheDocument();
    expect(screen.queryByText(/monthly assessment coverage/i)).not.toBeInTheDocument();
    expect(stubs.coverage).not.toHaveBeenCalled();
    expect(stubs.matrix).not.toHaveBeenCalled();
  });
});

describe('the location and condition matrix (REQ-REPORT-010)', () => {
  beforeEach(() => {
    signInWith(['asset-unit:read']);
  });

  it('renders a column per condition and a row per location', async () => {
    renderScreen(<DashboardPage />);

    const row = (await screen.findByText('Ruang 101')).closest('tr');

    expect(row).toHaveTextContent('2');
    expect(row).toHaveTextContent('1');
  });

  it('shows unlocated units rather than dropping them', async () => {
    renderScreen(<DashboardPage />);

    expect(await screen.findByText(/no location recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/2 with no location/i)).toBeInTheDocument();
  });

  it('links a cell to the units behind it', async () => {
    renderScreen(<DashboardPage />);

    await screen.findByText('Ruang 101');

    const link = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href')?.includes('condition=GOOD'));
    expect(link.getAttribute('href')).toContain('locationId=loc-1');
  });
});

describe('failure is contained', () => {
  beforeEach(() => {
    signInWith(['asset-unit:read', 'report:read']);
  });

  it('a failing card does not take its siblings down', async () => {
    stubs.coverage.mockRejectedValue(new Error('boom'));

    renderScreen(<DashboardPage />);

    // The matrix still renders even though coverage failed.
    await waitFor(() =>
      expect(screen.getByText(/units by location and condition/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/monthly assessment coverage/i)).toBeInTheDocument();
  });
});
