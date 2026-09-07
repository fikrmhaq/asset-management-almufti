import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, ERROR_CODES } from '@/api/errors';
import * as assetCoreApi from '@/api/assetCore';
import { renderScreen, signInWith } from '@/test/harness';
import {
  FloorPlanEditor,
  pointsToSvg,
  toNormalizedPoint,
} from '@/components/location/FloorPlanEditor';
import { rejectionReason } from '@/components/asset/AttachmentsPanel';
import { LocationsPage } from './LocationsPage';
import { LocationDetailPage } from './LocationDetailPage';

/**
 * Location screens, the floor-plan editor and attachment validation —
 * `07-ui.md` §5.3, §5.4; `IMPLEMENTATION_PLAN.md` §18.5, §18.6, §18.8.
 */

const ALL = [
  'location:read',
  'location:create',
  'location:update',
  'location:deactivate',
  'asset-unit:read',
  'floor-plan:read',
  'floor-plan:update',
  'floor-plan:delete',
  'floor-plan-area:create',
  'floor-plan-area:read',
  'floor-plan-area:delete',
  'classification:read',
];

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
});

const LOCATION = {
  id: 'loc-1',
  name: 'Gedung A',
  classificationId: '117010101002',
  parentLocationId: null,
  isActive: true,
};

const ROOM = { id: 'loc-2', name: 'Ruang 101', parentLocationId: 'loc-1', isActive: true };

beforeEach(() => {
  signInWith(ALL);
  // `descendantsOf` returns the subtree WITHOUT its root, as the server's
  // recursive CTE does; an unfiltered list returns everything.
  vi.spyOn(assetCoreApi.locationsApi, 'list').mockImplementation((params = {}) =>
    Promise.resolve(params.descendantsOf ? page([ROOM]) : page([LOCATION, ROOM]))
  );
  // The collection envelope, like every other collection endpoint — `meta`
  // describes the complete child set, which is what this endpoint returns.
  vi.spyOn(assetCoreApi.locationsApi, 'children').mockResolvedValue(page([ROOM]));
  vi.spyOn(assetCoreApi.locationsApi, 'context').mockResolvedValue({
    path: [LOCATION, ROOM],
    floorPlan: null,
  });
  // jsdom does not implement object URLs.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:plan');
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LocationsPage', () => {
  it('lists locations and shows what each is inside', async () => {
    renderScreen(<LocationsPage />);

    expect(await screen.findByText('Gedung A')).toBeInTheDocument();
    expect(screen.getByText('Top level')).toBeInTheDocument();
  });

  it('names the parent instead of printing part of its id', async () => {
    // The API resolves the parent for exactly this (`parentLocation`). The
    // column used to render `parentLocationId.slice(0, 8)`, which told a reader
    // nothing and was not even unique enough to look up.
    assetCoreApi.locationsApi.list.mockResolvedValue(
      page([LOCATION, { ...ROOM, parentLocation: { id: 'loc-1', name: 'Gedung A' } }])
    );
    renderScreen(<LocationsPage />);

    const row = (await screen.findByText('Ruang 101')).closest('tr');
    expect(within(row).getByRole('link', { name: 'Gedung A' })).toHaveAttribute(
      'href',
      '/locations/loc-1'
    );
    expect(within(row).queryByText(/^loc-1$/)).not.toBeInTheDocument();
  });

  it('says so when the parent is one the caller cannot see', async () => {
    // A scoped caller gets `parentLocation: null` for a parent in another
    // institution (`BR-007`), while `parentLocationId` still says one exists.
    assetCoreApi.locationsApi.list.mockResolvedValue(page([{ ...ROOM, parentLocation: null }]));
    renderScreen(<LocationsPage />);

    expect(await screen.findByText('A location you cannot access')).toBeInTheDocument();
  });

  it('asks the server for the roots of the tree', async () => {
    renderScreen(<LocationsPage />);
    await screen.findByText('Gedung A');

    await userEvent.click(screen.getByRole('button', { name: /switch to tree view/i }));

    // Filtering a page of everything client-side lost any root past the cap.
    await waitFor(() =>
      expect(assetCoreApi.locationsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ rootsOnly: true })
      )
    );
  });

  it('offers a tree view, expanded lazily (REQ-LOC-007)', async () => {
    renderScreen(<LocationsPage />);
    await screen.findByText('Gedung A');

    await userEvent.click(screen.getByRole('button', { name: /switch to tree view/i }));

    // Children are not fetched until a node is expanded.
    expect(assetCoreApi.locationsApi.children).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: /expand gedung a/i }));
    await waitFor(() => expect(assetCoreApi.locationsApi.children).toHaveBeenCalledWith('loc-1'));
  });
});

describe('LocationDetailPage', () => {
  beforeEach(() => {
    vi.spyOn(assetCoreApi.locationsApi, 'get').mockResolvedValue(LOCATION);
    vi.spyOn(assetCoreApi.locationsApi, 'units').mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockRejectedValue(
      new ApiError({ code: ERROR_CODES.NOT_FOUND, message: 'none', status: 404 })
    );
  });

  const renderDetail = () =>
    renderScreen(<LocationDetailPage />, { path: '/locations/:id', route: '/locations/loc-1' });

  it('shows Info, Units and Floor plan tabs', async () => {
    renderDetail();

    expect(await screen.findByRole('tab', { name: 'Info' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Units' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Floor plan' })).toBeInTheDocument();
  });

  it('says the unit list includes everything inside (DEC-004)', async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole('tab', { name: 'Units' }));

    expect(
      await screen.findByText(/everything here and in every location inside this one/i)
    ).toBeInTheDocument();
  });

  /**
   * A unit deep in the hierarchy must never look like it lives at the location
   * being viewed. The location column is the whole point of the descendant view.
   */
  it('shows where each unit actually is, and marks it as inside rather than here', async () => {
    assetCoreApi.locationsApi.units.mockResolvedValue(
      page([
        {
          id: 'unit-aaaa1111',
          assetId: 'asset-1',
          lifecycleState: 'ACTIVE',
          currentLocationId: 'loc-2',
          currentLocation: { id: 'loc-2', name: 'Ruang 101' },
          asset: { id: 'asset-1', name: 'Komputer' },
        },
        {
          id: 'unit-bbbb2222',
          assetId: 'asset-2',
          lifecycleState: 'ACTIVE',
          currentLocationId: 'loc-1',
          currentLocation: { id: 'loc-1', name: 'Gedung A' },
          asset: { id: 'asset-2', name: 'Proyektor' },
        },
      ])
    );

    renderDetail();
    await userEvent.click(await screen.findByRole('tab', { name: 'Units' }));

    const inside = (await screen.findByText('Komputer')).closest('tr');
    const here = screen.getByText('Proyektor').closest('tr');

    expect(within(inside).getByRole('link', { name: 'Ruang 101' })).toBeInTheDocument();
    expect(within(inside).getByText('Inside')).toBeInTheDocument();
    expect(within(here).getByText('Here')).toBeInTheDocument();
  });

  it('narrows to the location itself on request (REQ-LOC-005)', async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole('tab', { name: 'Units' }));
    await screen.findByText(/everything here and in every location inside/i);

    await userEvent.click(screen.getByRole('button', { name: 'Here only' }));

    await waitFor(() =>
      expect(assetCoreApi.locationsApi.units).toHaveBeenCalledWith('loc-1', { scope: 'direct' })
    );
  });

  it('lists the locations directly inside this one', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: 'Gedung A' });
    expect(await screen.findByRole('link', { name: /Ruang 101/ })).toBeInTheDocument();
  });

  it('hides tabs the caller cannot read', async () => {
    signInWith(['location:read']);
    renderDetail();

    await screen.findByRole('tab', { name: 'Info' });
    expect(screen.queryByRole('tab', { name: 'Units' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Floor plan' })).not.toBeInTheDocument();
  });
});

describe('FloorPlanEditor (§5.4)', () => {
  const PLAN = {
    id: 'plan-1',
    locationId: 'loc-1',
    fileName: 'lantai-1.png',
    areas: [
      {
        id: 'area-1',
        locationId: 'loc-2',
        polygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.1 },
          { x: 0.4, y: 0.5 },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.spyOn(assetCoreApi.locationsApi, 'downloadFloorPlan').mockResolvedValue(new Blob(['x']));
  });

  const renderEditor = () => renderScreen(<FloorPlanEditor locationId="loc-1" />);

  it('offers an upload when there is no plan yet (REQ-LOC-009)', async () => {
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockRejectedValue(
      new ApiError({ code: ERROR_CODES.NOT_FOUND, message: 'none', status: 404 })
    );

    renderEditor();

    // A 404 is "no plan", not an error state.
    expect(await screen.findByText('No floor plan yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload floor plan/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders each area as a polygon over the image', async () => {
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockResolvedValue(PLAN);

    const { container } = renderEditor();

    await screen.findByAltText(/floor plan of this location/i);
    const polygons = container.querySelectorAll('polygon');
    expect(polygons).toHaveLength(1);
    // Normalized points are used directly — the viewBox is 0..1.
    expect(polygons[0].getAttribute('points')).toBe('0.1,0.1 0.4,0.1 0.4,0.5');
  });

  /**
   * The plan on screen belongs to one location; the unit is at another, deeper
   * one. Both must be legible, and the second must never be faked when it is not
   * drawn on the plan.
   */
  it('highlights the area for the location someone came to find', async () => {
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockResolvedValue({
      ...PLAN,
      areas: [{ ...PLAN.areas[0], location: { id: 'loc-2', name: 'Ruang 101' } }],
    });

    renderScreen(<FloorPlanEditor locationId="loc-1" highlightLocationId="loc-2" readOnly />);

    const banner = await screen.findByText(/is highlighted on this plan/i);
    expect(banner).toHaveTextContent('Ruang 101');
    // And the list entry for it is called out too, not only the shape.
    expect(screen.getByText('— highlighted')).toBeInTheDocument();
  });

  it('says the location is not drawn rather than inventing a shape', async () => {
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockResolvedValue({ ...PLAN, areas: [] });

    const { container } = renderScreen(
      <FloorPlanEditor locationId="loc-1" highlightLocationId="loc-9" readOnly />
    );

    expect(await screen.findByText(/does not mark out the exact location/i)).toBeInTheDocument();
    expect(container.querySelectorAll('polygon')).toHaveLength(0);
  });

  it('offers no editing controls when the plan is only being viewed', async () => {
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockResolvedValue(PLAN);

    renderScreen(<FloorPlanEditor locationId="loc-1" highlightLocationId="loc-2" readOnly />);

    await screen.findByAltText(/floor plan of this location/i);
    expect(screen.queryByRole('button', { name: /draw an area/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /replace floor plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove floor plan/i })).not.toBeInTheDocument();
  });

  it('labels an area from the location the API resolved, at any depth', async () => {
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockResolvedValue({
      ...PLAN,
      // Not in the descendant page the picker loaded — the area's own payload is
      // what names it, so depth cannot make a shape render as a UUID.
      areas: [
        {
          ...PLAN.areas[0],
          locationId: 'loc-deep',
          location: { id: 'loc-deep', name: 'Storage C' },
        },
      ],
    });

    renderScreen(<FloorPlanEditor locationId="loc-1" />);

    expect(await screen.findByText('Storage C')).toBeInTheDocument();
  });

  it('restricts the area location picker to descendants (REQ-LOC-012)', async () => {
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockResolvedValue(PLAN);

    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: /draw an area/i }));

    const select = await screen.findByLabelText(/room this area represents/i);
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: /Ruang 101/ })).toBeInTheDocument()
    );
    // The location itself is not offered — an area cannot represent its own plan.
    expect(within(select).queryByRole('option', { name: /Gedung A/ })).not.toBeInTheDocument();
  });

  it('needs three points and a location before an area can be saved', async () => {
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockResolvedValue(PLAN);
    const create = vi.spyOn(assetCoreApi.locationsApi, 'createArea').mockResolvedValue({});

    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: /draw an area/i }));

    expect(screen.getByRole('button', { name: 'Save area' })).toBeDisabled();

    // The keyboard alternative to clicking the image (§8).
    for (const [x, y] of [
      [0.2, 0.2],
      [0.6, 0.2],
      [0.6, 0.7],
    ]) {
      await userEvent.clear(screen.getByLabelText('Point X'));
      await userEvent.type(screen.getByLabelText('Point X'), String(x));
      await userEvent.clear(screen.getByLabelText('Point Y'));
      await userEvent.type(screen.getByLabelText('Point Y'), String(y));
      await userEvent.click(screen.getByRole('button', { name: 'Add point' }));
    }

    // Three points but still no location chosen.
    expect(screen.getByRole('button', { name: 'Save area' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText(/room this area represents/i), 'loc-2');
    await userEvent.click(screen.getByRole('button', { name: 'Save area' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('loc-1', {
        locationId: 'loc-2',
        polygon: [
          { x: 0.2, y: 0.2 },
          { x: 0.6, y: 0.2 },
          { x: 0.6, y: 0.7 },
        ],
      })
    );
  });

  it('lists areas as a keyboard-navigable alternative to the drawing (§8)', async () => {
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockResolvedValue(PLAN);

    renderEditor();

    // Anchored, so this is the area's own toggle rather than its delete button
    // ("Delete area for Ruang 101").
    const areaButton = await screen.findByRole('button', { name: /^Ruang 101/ });
    expect(areaButton).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(areaButton);
    expect(areaButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('hides drawing and deletion from a read-only caller', async () => {
    signInWith(['location:read', 'floor-plan:read', 'floor-plan-area:read']);
    vi.spyOn(assetCoreApi.locationsApi, 'floorPlan').mockResolvedValue(PLAN);

    renderEditor();
    await screen.findByAltText(/floor plan of this location/i);

    expect(screen.queryByRole('button', { name: /draw an area/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove floor plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /replace floor plan/i })).not.toBeInTheDocument();
  });
});

describe('coordinate helpers', () => {
  it('normalizes a pointer position against the image box', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };

    expect(toNormalizedPoint({ clientX: 300, clientY: 150 }, rect)).toEqual({ x: 0.5, y: 0.5 });
    // Clamped to the image, so a drag past the edge cannot store an out-of-range
    // point the server would reject.
    expect(toNormalizedPoint({ clientX: 0, clientY: 0 }, rect)).toEqual({ x: 0, y: 0 });
    expect(toNormalizedPoint({ clientX: 9999, clientY: 9999 }, rect)).toEqual({ x: 1, y: 1 });
  });

  it('serializes a polygon for SVG', () => {
    expect(
      pointsToSvg([
        { x: 0, y: 0.5 },
        { x: 1, y: 1 },
      ])
    ).toBe('0,0.5 1,1');
  });
});

describe('attachment validation (§18.8, REQ-FILE-004)', () => {
  it('rejects a disallowed type before uploading', () => {
    expect(rejectionReason({ name: 'shell.sh', size: 10 })).toMatch(/not allowed/);
    expect(rejectionReason({ name: 'noextension', size: 10 })).toMatch(/not allowed/);
  });

  it('rejects a file over the documented limit', () => {
    expect(rejectionReason({ name: 'big.pdf', size: 11 * 1024 * 1024 })).toMatch(
      /larger than 10 MB/
    );
  });

  it('accepts the documented types within the limit', () => {
    for (const name of ['photo.jpg', 'doc.pdf', 'sheet.xlsx', 'plan.png']) {
      expect(rejectionReason({ name, size: 1024 }), name).toBeNull();
    }
  });
});
