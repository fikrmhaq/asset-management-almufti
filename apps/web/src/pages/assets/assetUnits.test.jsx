import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as assetCoreApi from '@/api/assetCore';
import { renderScreen, signInWith } from '@/test/harness';
import { AssetUnitsPage } from './AssetUnitsPage';
import { ScanLandingPage } from './ScanLandingPage';

/**
 * The Asset Unit collection screen — `CR-005`.
 *
 * The distinction under test is the one the whole change exists to draw:
 *
 *   Asset       master resource, `asset:read`
 *   Asset Unit  operational resource, `asset-unit:read`
 *
 * A Department PIC holds the second and not the first, so this screen has to be
 * fully usable without any ability to open an Asset. Nothing here is a security
 * assertion — the server scopes the list, and `23-pic-operational-scope.test.js`
 * proves it. These check that the interface does not offer a caller something
 * the server will refuse, and does not hide something it will allow.
 */

const PIC = [
  'asset-unit:read',
  'asset-unit:update',
  'asset-unit:record-history',
  'location:read',
  'classification:read',
];

const INSTITUTION = [...PIC, 'asset:read', 'department:read'];

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
});

/** A unit with a department and a location — the ordinary case. */
const PLACED = {
  id: 'unit-1',
  assetId: 'asset-1',
  inventoryCode: 'ALPHA/2026/0001',
  description: 'Lab machine',
  departmentId: 'dept-tkj',
  department: { id: 'dept-tkj', code: 'TKJ', name: 'Teknik Komputer' },
  lifecycleState: 'ACTIVE',
  currentCondition: 'GOOD',
  currentLocationId: 'loc-1',
  currentLocation: { id: 'loc-1', name: 'Lab 1' },
  isActive: true,
  asset: { id: 'asset-1', name: 'Laptop Dell' },
};

/**
 * The unit this endpoint exists for: registered, never given a location, on no
 * borrowing. Before `CR-005` it appeared in no list in the application.
 */
const STRANDED = {
  ...PLACED,
  id: 'unit-2',
  inventoryCode: 'ALPHA/2026/0002',
  description: null,
  currentLocationId: null,
  currentLocation: undefined,
  currentCondition: null,
};

beforeEach(() => {
  signInWith(PIC, { isPicScoped: true, picDepartments: [PLACED.department] });

  vi.spyOn(assetCoreApi.assetUnitsApi, 'list').mockResolvedValue(page([PLACED, STRANDED]));
  // The location filter's labels. Mocked so the screen never reaches the real
  // client, which jsdom refuses as a cross-origin request.
  vi.spyOn(assetCoreApi.locationsApi, 'list').mockResolvedValue(
    page([{ id: 'loc-1', name: 'Lab 1', isActive: true }])
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetUnitsPage', () => {
  it('lists units with their asset, department and location', async () => {
    renderScreen(<AssetUnitsPage />);

    expect(await screen.findByText('ALPHA/2026/0001')).toBeInTheDocument();
    // Both rows belong to the same asset, which is the ordinary case.
    expect(screen.getAllByText('Laptop Dell')).toHaveLength(2);
    expect(screen.getAllByText('TKJ')).toHaveLength(2);
    expect(screen.getByText('Lab 1')).toBeInTheDocument();
  });

  /** The gap `CR-005` closes — such a unit had no list to appear in. */
  it('shows a unit that has no recorded location, and says so', async () => {
    renderScreen(<AssetUnitsPage />);

    expect(await screen.findByText('ALPHA/2026/0002')).toBeInTheDocument();
    expect(screen.getByText(/no location recorded/i)).toBeInTheDocument();
  });

  it('links each unit to its detail page', async () => {
    renderScreen(<AssetUnitsPage />);

    const link = await screen.findByRole('link', { name: 'ALPHA/2026/0001' });
    expect(link).toHaveAttribute('href', '/assets/asset-1/units/unit-1');
  });

  /**
   * The asset name is context about a unit the caller already holds. Rendering
   * it as a link without `asset:read` would send them to `ForbiddenPage` — the
   * exact dead end this change set out to remove.
   */
  it('shows the asset name as plain text without asset:read', async () => {
    renderScreen(<AssetUnitsPage />);

    expect((await screen.findAllByText('Laptop Dell')).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('link', { name: 'Laptop Dell' })).toHaveLength(0);
  });

  it('links the asset name for a caller who can open it', async () => {
    signInWith(INSTITUTION);
    renderScreen(<AssetUnitsPage />);

    const links = await screen.findAllByRole('link', { name: 'Laptop Dell' });
    expect(links[0]).toHaveAttribute('href', '/assets/asset-1');
  });

  /**
   * The picker is fed from `picDepartments` on the session (`DEC-095`), because
   * a PIC-scoped role cannot call `GET /departments`.
   */
  it('offers the caller their own departments as a filter', async () => {
    renderScreen(<AssetUnitsPage />);
    await screen.findByText('ALPHA/2026/0001');

    // Present because `picDepartments` rides on the session; a caller with no
    // posts gets no control at all (below).
    expect(screen.getByLabelText(/department/i)).toBeInTheDocument();
  });

  /**
   * Driven through the URL rather than the widget: `SelectFilter` renders a
   * Radix combobox, which `userEvent.selectOptions` cannot operate. The URL is
   * the real contract anyway — `useListParams` is what turns it into a request,
   * and a shared filtered link has to work.
   */
  /** REQ-REQUEST-024: received and not placed — derived by the server. */
  it('forwards the needs-placement filter to the server', async () => {
    renderScreen(<AssetUnitsPage />, { route: '/?needsPlacement=true' });

    expect(await screen.findByLabelText('Placement')).toBeInTheDocument();
    await waitFor(() =>
      expect(assetCoreApi.assetUnitsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ needsPlacement: 'true' })
      )
    );
  });

  it('forwards a department filter to the server', async () => {
    renderScreen(<AssetUnitsPage />, { route: '/?departmentId=dept-tkj' });

    // Narrowing only. It cannot widen the result — that is the server's job,
    // and `23-pic-operational-scope.test.js` proves it there.
    await waitFor(() =>
      expect(assetCoreApi.assetUnitsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ departmentId: 'dept-tkj' })
      )
    );
  });

  it('hides the department filter when the caller holds no posts', async () => {
    signInWith(INSTITUTION);
    renderScreen(<AssetUnitsPage />);
    await screen.findByText('ALPHA/2026/0001');

    expect(screen.queryByLabelText(/department/i)).not.toBeInTheDocument();
  });

  it('sends filters to the server rather than filtering in the table', async () => {
    const { router } = renderScreen(<AssetUnitsPage />);
    await screen.findByText('ALPHA/2026/0001');

    await userEvent.type(screen.getByRole('searchbox'), 'ALPHA');

    await waitFor(() =>
      expect(assetCoreApi.assetUnitsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'ALPHA' })
      )
    );
    // And it lands in the URL, so a filtered view survives a refresh.
    expect(router.state.location.search).toContain('q=ALPHA');
  });
});

describe('ScanLandingPage — where a failed scan sends you (CR-005 §6)', () => {
  beforeEach(() => {
    vi.spyOn(assetCoreApi.assetUnitsApi, 'byCode').mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'NOT_FOUND' })
    );
  });

  it('offers the unit list to a caller who cannot browse assets', async () => {
    renderScreen(<ScanLandingPage />, { path: '/u/:inventoryCode', route: '/u/NOPE' });

    const link = await screen.findByRole('link', { name: /browse asset units/i });
    expect(link).toHaveAttribute('href', '/asset-units');
  });

  it('still offers the asset list to a caller who can browse assets', async () => {
    signInWith(INSTITUTION);
    renderScreen(<ScanLandingPage />, { path: '/u/:inventoryCode', route: '/u/NOPE' });

    const link = await screen.findByRole('link', { name: /browse assets/i });
    expect(link).toHaveAttribute('href', '/assets');
  });
});
