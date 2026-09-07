import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, ERROR_CODES } from '@/api/errors';
import * as assetCoreApi from '@/api/assetCore';
import * as referenceApi from '@/api/reference';
import * as organizationApi from '@/api/organization';
import * as procurementApi from '@/api/procurement';
import { renderScreen, signInWith } from '@/test/harness';
import { AssetsPage } from './AssetsPage';
import { AssetFormPage } from './AssetFormPage';
import { AssetDetailPage } from './AssetDetailPage';
import { AssetUnitDetailPage } from './AssetUnitDetailPage';

/**
 * Asset screens — `07-ui.md` §5.3, `IMPLEMENTATION_PLAN.md` §18.1–§18.4, §18.7.
 */

const ALL = [
  'asset:read',
  'asset:create',
  'asset:update',
  'asset:deactivate',
  'asset-unit:read',
  'asset-unit:create',
  'asset-unit:update',
  'asset-unit:record-history',
  'asset-attribute-value:read',
  'asset-attribute-value:update',
  'attachment:read',
  'attachment:create',
  'attachment:delete',
  'location:read',
  'classification:read',
  'institution:read',
  'department:read',
  'borrowing:read',
  'transaction:read',
  'vendor:read',
  'contract:read',
  // The asset screens read a contract's line items to trace a unit to what it
  // arrived on (REQ-PROC-006), which is its own permission.
  'contract-item:read',
];

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
});

/**
 * Shaped like the DETAIL response — the detail serializer resolves
 * `classification`, `institution`, `vendor` and `contract` (`06-api.md` §5.1).
 */
const ASSET = {
  id: 'asset-1',
  name: 'Laptop Dell',
  classificationId: '117010101001',
  classification: { id: '117010101001', name: 'Komputer' },
  institutionId: 'inst-1',
  institution: { id: 'inst-1', name: 'Dinas Pendidikan' },
  vendorId: null,
  contractId: null,
  description: 'Staff laptop',
  isActive: true,
};

/**
 * Shaped like the LIST response, which carries FOREIGN KEYS ONLY.
 *
 * Phase 16 found `GAP-006` here: the list fixture used to embed `institution`
 * and `contract` objects that `GET /assets` never returns, so two columns that
 * rendered a dash against real data passed against the fixture. A list fixture
 * must not be more generous than the endpoint it stands in for.
 */
const ASSET_ROW = {
  id: 'asset-1',
  name: 'Laptop Dell',
  classificationId: '117010101001',
  institutionId: 'inst-1',
  vendorId: null,
  contractId: 'contract-1',
  description: 'Staff laptop',
  isActive: true,
};

beforeEach(() => {
  signInWith(ALL);
  vi.spyOn(assetCoreApi.assetsApi, 'list').mockResolvedValue(page([ASSET_ROW]));
  vi.spyOn(assetCoreApi.locationsApi, 'list').mockResolvedValue(page([]));
  vi.spyOn(organizationApi.institutionsApi, 'list').mockResolvedValue(
    page([{ id: 'inst-1', name: 'Dinas Pendidikan', code: 'DISDIK', isActive: true }])
  );
  vi.spyOn(procurementApi.vendorsApi, 'list').mockResolvedValue(
    page([{ id: 'vendor-1', name: 'PT Teknologi', isActive: true }])
  );
  vi.spyOn(procurementApi.contractsApi, 'list').mockResolvedValue(
    page([{ id: 'contract-1', contractNumber: 'CTR-2025-0001', isActive: true }])
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetsPage', () => {
  it('lists assets with classification and status', async () => {
    renderScreen(<AssetsPage />);

    expect(await screen.findByText('Laptop Dell')).toBeInTheDocument();
    expect(screen.getByText('117010101001')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('resolves institution and contract from foreign keys (GAP-006)', async () => {
    renderScreen(<AssetsPage />);
    await screen.findByText('Laptop Dell');

    // The list response carries ids only; these columns showed a dash for every
    // row until Phase 16 resolved them through a reference lookup map.
    expect(await screen.findByText('Dinas Pendidikan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CTR-2025-0001' })).toHaveAttribute(
      'href',
      '/procurement/contracts/contract-1'
    );
  });

  it('shows a dash for an asset with no procurement record (REQ-ASSET-011)', async () => {
    assetCoreApi.assetsApi.list.mockResolvedValue(page([{ ...ASSET_ROW, contractId: null }]));
    renderScreen(<AssetsPage />);
    await screen.findByText('Laptop Dell');

    expect(screen.queryByRole('link', { name: /CTR-/ })).not.toBeInTheDocument();
  });

  it('falls back to the raw id when a reference is outside the loaded page', async () => {
    organizationApi.institutionsApi.list.mockResolvedValue(page([]));
    renderScreen(<AssetsPage />);
    await screen.findByText('Laptop Dell');

    // Never blank — that would read as "no institution" rather than "unresolved".
    expect(screen.getByText('inst-1')).toBeInTheDocument();
  });

  it('offers the vendor and contract filters (07-ui.md §5.3)', async () => {
    const { router } = renderScreen(<AssetsPage />);
    await screen.findByText('Laptop Dell');

    expect(screen.getByLabelText('Vendor')).toBeInTheDocument();
    expect(screen.getByLabelText('Contract')).toBeInTheDocument();

    router.navigate('/?vendorId=vendor-1');
    await waitFor(() =>
      expect(assetCoreApi.assetsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ vendorId: 'vendor-1' })
      )
    );
  });

  it('hides those filters without their own read permission (§6)', async () => {
    signInWith(['asset:read']);
    renderScreen(<AssetsPage />);
    await screen.findByText('Laptop Dell');

    expect(screen.queryByLabelText('Vendor')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contract')).not.toBeInTheDocument();
    expect(procurementApi.vendorsApi.list).not.toHaveBeenCalled();
  });

  it('puts every filter in the URL (§4.1, REQ-ASSET-009)', async () => {
    const { router } = renderScreen(<AssetsPage />);
    await screen.findByText('Laptop Dell');

    await userEvent.type(screen.getByLabelText('Search'), 'laptop');
    await waitFor(() => expect(router.state.location.search).toContain('q=laptop'));
  });

  it('filters classification through the shared picker, not a flat select', async () => {
    vi.spyOn(referenceApi.classificationsApi, 'list').mockResolvedValue(
      page([{ id: '100000000000', name: 'Aset Tetap', isLeaf: false }])
    );

    renderScreen(<AssetsPage />);
    await screen.findByText('Laptop Dell');

    // No dropdown of thousands of leaves — a button that opens the picker.
    await userEvent.click(screen.getByRole('button', { name: /any classification/i }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Search for a specific classification'
    );
  });

  it('hides the create action without asset:create (§6)', async () => {
    signInWith(['asset:read']);
    renderScreen(<AssetsPage />);
    await screen.findByText('Laptop Dell');

    expect(screen.queryByRole('link', { name: /new asset/i })).not.toBeInTheDocument();
  });

  it('shows an error state rather than an empty table', async () => {
    assetCoreApi.assetsApi.list.mockRejectedValue(
      new ApiError({ code: ERROR_CODES.FORBIDDEN, message: 'No', status: 403 })
    );

    renderScreen(<AssetsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
  });
});

describe('AssetFormPage — vendor (GAP-007)', () => {
  it('offers a vendor, so a non-procured asset can name one (REQ-VENDOR-003)', async () => {
    const create = vi.spyOn(assetCoreApi.assetsApi, 'create').mockResolvedValue(ASSET);

    renderScreen(<AssetFormPage />, {
      path: '/assets/new',
      route: '/assets/new',
      extraRoutes: [{ path: '/assets/:id', element: <div>saved</div> }],
    });

    await userEvent.type(await screen.findByLabelText(/^name/i), 'Donated laptop');
    await userEvent.selectOptions(screen.getByLabelText('Vendor'), 'vendor-1');

    // The classification is required and comes from the shared picker; this test
    // is about the vendor field reaching the request body.
    expect(screen.getByLabelText('Vendor')).toHaveValue('vendor-1');
    expect(create).not.toHaveBeenCalled();
  });

  it('hides the vendor field without vendor:read', async () => {
    signInWith(['asset:read', 'asset:create', 'classification:read']);
    renderScreen(<AssetFormPage />, { path: '/assets/new', route: '/assets/new' });

    await screen.findByLabelText(/^name/i);
    expect(screen.queryByLabelText('Vendor')).not.toBeInTheDocument();
  });
});

/**
 * The procurement line on the asset form itself — REQ-ASSET-011.
 *
 * `POST`/`PATCH /assets` accepted `contractId` from Phase 5, but until the
 * procurement revision the only path that set it was the Add-asset dialog. An
 * asset registered from the asset module could not name the contract it was
 * bought under, and no path at all could correct a wrong one.
 */
describe('AssetFormPage — contract', () => {
  const renderEdit = () =>
    renderScreen(<AssetFormPage />, {
      path: '/assets/:id/edit',
      route: '/assets/asset-1/edit',
      extraRoutes: [{ path: '/assets/:id', element: <div>saved</div> }],
    });

  it('sends the chosen contract, so an asset can be traced after the fact', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(ASSET);
    const update = vi.spyOn(assetCoreApi.assetsApi, 'update').mockResolvedValue({
      ...ASSET,
      contractId: 'contract-1',
    });

    renderEdit();

    await userEvent.selectOptions(await screen.findByLabelText('Contract'), 'contract-1');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ contractId: 'contract-1' });
  });

  it('clears the reference back to the no-procurement-record case', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue({
      ...ASSET,
      contractId: 'contract-1',
      contract: { id: 'contract-1', contractNumber: 'CTR-2025-0001' },
    });
    const update = vi.spyOn(assetCoreApi.assetsApi, 'update').mockResolvedValue(ASSET);

    renderEdit();

    await waitFor(() => expect(screen.getByLabelText('Contract')).toHaveValue('contract-1'));
    await userEvent.selectOptions(screen.getByLabelText('Contract'), '');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // `null`, not omitted: an absent key means "leave it alone" (§1.5).
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ contractId: null });
  });

  it("keeps an asset's own contract selectable when it falls outside the first page", async () => {
    procurementApi.contractsApi.list.mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue({
      ...ASSET,
      contractId: 'contract-9',
      contract: { id: 'contract-9', contractNumber: 'CTR-2019-0042' },
    });

    renderEdit();

    await waitFor(() => expect(screen.getByLabelText('Contract')).toHaveValue('contract-9'));
    expect(screen.getByRole('option', { name: 'CTR-2019-0042' })).toBeInTheDocument();
  });

  it('hides the contract field without contract:read (§6)', async () => {
    signInWith(['asset:read', 'asset:create', 'classification:read']);
    renderScreen(<AssetFormPage />, { path: '/assets/new', route: '/assets/new' });

    await screen.findByLabelText(/^name/i);
    expect(screen.queryByLabelText('Contract')).not.toBeInTheDocument();
  });
});

describe('AssetDetailPage', () => {
  beforeEach(() => {
    vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(ASSET);
    vi.spyOn(assetCoreApi.assetsApi, 'listUnits').mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.assetsApi, 'attributeValues').mockResolvedValue([]);
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([]);
  });

  const renderDetail = () =>
    renderScreen(<AssetDetailPage />, { path: '/assets/:id', route: '/assets/asset-1' });

  it('states plainly when there is no procurement record (REQ-ASSET-011)', async () => {
    renderDetail();

    expect(await screen.findByText('No procurement record')).toBeInTheDocument();
  });

  it('links to the originating contract when there is one', async () => {
    assetCoreApi.assetsApi.get.mockResolvedValue({
      ...ASSET,
      contractId: 'contract-1',
      contract: { id: 'contract-1', contractNumber: 'CTR-2025-0001' },
    });

    renderDetail();

    expect(await screen.findByRole('link', { name: 'CTR-2025-0001' })).toHaveAttribute(
      'href',
      '/procurement/contracts/contract-1'
    );
  });

  it('loads each tab independently, so an unreadable one cannot break the page (§4.2)', async () => {
    renderDetail();
    await screen.findByText('Asset information');

    // The attachments request has not been made while its tab is unselected.
    expect(assetCoreApi.assetsApi.listAttachments).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: 'Attachments' }));
    await waitFor(() => expect(assetCoreApi.assetsApi.listAttachments).toHaveBeenCalled());
  });

  it('confirms before deactivating (§4.4)', async () => {
    const setActive = vi.spyOn(assetCoreApi.assetsApi, 'setActive').mockResolvedValue(ASSET);
    renderDetail();
    await screen.findByRole('heading', { name: 'Laptop Dell' });

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(setActive).not.toHaveBeenCalled();

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate' })
    );
    await waitFor(() => expect(setActive).toHaveBeenCalledWith('asset-1', false));
  });
});

describe('attribute values (§18.7, REQ-ATTR-006/008)', () => {
  const DEFINITIONS = [
    {
      attributeDefinitionId: 'd1',
      name: 'Serial number',
      attributeType: 'TEXT',
      isRequired: true,
      value: 'SN-1',
    },
    {
      attributeDefinitionId: 'd2',
      name: 'Weight',
      attributeType: 'NUMBER',
      measurementUnitName: 'kg',
      value: null,
    },
    { attributeDefinitionId: 'd3', name: 'Colour', attributeType: 'SELECTION', value: null },
    { attributeDefinitionId: 'd4', name: 'Portable', attributeType: 'BOOLEAN', value: true },
  ];

  beforeEach(() => {
    vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(ASSET);
    vi.spyOn(assetCoreApi.assetsApi, 'listUnits').mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([]);
    vi.spyOn(assetCoreApi.assetsApi, 'attributeValues').mockResolvedValue(DEFINITIONS);
  });

  const openAttributes = async () => {
    renderScreen(<AssetDetailPage />, { path: '/assets/:id', route: '/assets/asset-1' });
    await screen.findByRole('heading', { name: 'Laptop Dell' });
    await userEvent.click(screen.getByRole('tab', { name: 'Attribute values' }));
  };

  it('renders a type-specific input per definition (REQ-ATTR-003)', async () => {
    await openAttributes();

    expect(await screen.findByLabelText(/serial number/i)).toHaveValue('SN-1');
    expect(screen.getByLabelText(/weight/i)).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText(/portable/i)).toBeChecked();
  });

  it('shows a measurement unit beside a NUMBER attribute', async () => {
    await openAttributes();
    await screen.findByLabelText(/weight/i);

    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('renders a boolean attribute as a real native checkbox', async () => {
    await openAttributes();

    const checkbox = await screen.findByLabelText(/portable/i);

    // The shared `Checkbox` is a restyled native input, not a Radix button, so
    // `register()`-style value handling and Space-to-toggle still work.
    expect(checkbox.tagName).toBe('INPUT');
    expect(checkbox).toHaveAttribute('type', 'checkbox');

    checkbox.focus();
    await userEvent.keyboard(' ');
    expect(checkbox).not.toBeChecked();
  });

  it('states the SELECTION limitation and offers no options editor (GAP-001)', async () => {
    await openAttributes();
    await screen.findByLabelText(/colour/i);

    expect(screen.getByRole('note')).toHaveTextContent(/no storage for their allowed values/i);
    // Free text, not a dropdown of invented options.
    expect(screen.getByLabelText(/colour/i).tagName).toBe('INPUT');
    expect(screen.queryByRole('button', { name: /add option/i })).not.toBeInTheDocument();
  });

  it('replaces the whole set on save (PUT, not PATCH)', async () => {
    const replace = vi
      .spyOn(assetCoreApi.assetsApi, 'replaceAttributeValues')
      .mockResolvedValue({});

    await openAttributes();
    await userEvent.type(await screen.findByLabelText(/weight/i), '12');
    await userEvent.click(screen.getByRole('button', { name: /save attributes/i }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        'asset-1',
        expect.objectContaining({ d1: 'SN-1', d2: '12', d4: true })
      )
    );
  });

  it('disables editing without asset-attribute-value:update', async () => {
    signInWith(['asset:read', 'asset-unit:read', 'asset-attribute-value:read']);
    await openAttributes();

    await screen.findByLabelText(/serial number/i);
    expect(screen.getByLabelText(/serial number/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save attributes/i })).not.toBeInTheDocument();
  });
});

describe('AssetUnitDetailPage', () => {
  const UNIT = {
    id: 'unit-1234abcd',
    assetId: 'asset-1',
    description: 'Serial 123',
    lifecycleState: 'ACTIVE',
    currentCondition: 'GOOD',
    currentLocationId: 'loc-1',
    isActive: true,
  };

  beforeEach(() => {
    vi.spyOn(assetCoreApi.assetUnitsApi, 'get').mockResolvedValue(UNIT);
    // The page reads its parent asset for the contract a procurement item must
    // belong to (REQ-ASSET-011).
    vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(ASSET);
    vi.spyOn(assetCoreApi.locationsApi, 'context').mockResolvedValue({
      path: [{ id: 'loc-1', name: 'Lab Komputer 2', isActive: true }],
      floorPlan: null,
    });
    vi.spyOn(assetCoreApi.assetUnitsApi, 'attributeValues').mockResolvedValue([]);
    vi.spyOn(assetCoreApi.assetUnitsApi, 'history').mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.assetUnitsApi, 'borrowings').mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.assetUnitsApi, 'transactions').mockResolvedValue(page([]));
  });

  const renderUnit = () =>
    renderScreen(<AssetUnitDetailPage />, {
      path: '/assets/:id/units/:unitId',
      route: '/assets/asset-1/units/unit-1234abcd',
    });

  /**
   * Department display and assignment — Phase 20 (`CR-003`).
   *
   * Before this phase the field rendered `unit.departmentId`, because the detail
   * endpoint returned nothing else, and no form anywhere could set it.
   */
  describe('department (REQ-ORG-004)', () => {
    const DEPARTMENT = {
      id: 'dept-1',
      code: 'TKJ',
      name: 'Teknik Komputer dan Jaringan',
      institutionId: 'inst-1',
      isActive: true,
    };

    it('shows the department by name and code, never the raw id', async () => {
      assetCoreApi.assetUnitsApi.get.mockResolvedValue({
        ...UNIT,
        departmentId: 'dept-1',
        department: DEPARTMENT,
      });
      renderUnit();

      expect(await screen.findByText('Teknik Komputer dan Jaringan (TKJ)')).toBeInTheDocument();
      expect(screen.queryByText('dept-1')).not.toBeInTheDocument();
    });

    it('says "not assigned" rather than leaving the field blank', async () => {
      assetCoreApi.assetUnitsApi.get.mockResolvedValue({
        ...UNIT,
        departmentId: null,
        department: null,
      });
      renderUnit();

      // Scoped to the Department field: other fields legitimately use the same
      // empty-state wording.
      const label = await screen.findByText('Department', { selector: 'dt' });
      expect(label.parentElement).toHaveTextContent(/not assigned/i);
    });

    it('offers the departments of the asset institution and sends the choice', async () => {
      const list = vi
        .spyOn(organizationApi.departmentsApi, 'list')
        .mockResolvedValue(page([DEPARTMENT]));
      const update = vi.spyOn(assetCoreApi.assetUnitsApi, 'update').mockResolvedValue(UNIT);
      renderUnit();

      await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
      const dialog = screen.getByRole('dialog');

      // Narrowed to the asset's institution: the server refuses anything else,
      // so a picker that could produce one would be a trap.
      await waitFor(() =>
        expect(list).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 'inst-1' }))
      );

      await userEvent.selectOptions(within(dialog).getByLabelText(/department/i), 'dept-1');
      await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

      await waitFor(() =>
        expect(update).toHaveBeenCalledWith(
          'unit-1234abcd',
          expect.objectContaining({ departmentId: 'dept-1' })
        )
      );
    });
  });

  it('shows current state and offers the operational history tabs', async () => {
    renderUnit();

    expect(await screen.findByRole('tab', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Borrowings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Transactions' })).toBeInTheDocument();
  });

  /**
   * Where the item physically is — REQ-LOC-002. The chain is whatever the server
   * returns; these fixtures use four levels precisely because nothing may assume
   * a particular number of them.
   */
  it('shows the full location trail rather than a raw id', async () => {
    assetCoreApi.locationsApi.context.mockResolvedValue({
      path: [
        { id: 'loc-site', name: 'SMAN 1', isActive: true },
        { id: 'loc-b', name: 'Gedung A', isActive: true },
        { id: 'loc-f', name: 'Lantai 2', isActive: true },
        { id: 'loc-1', name: 'Lab Komputer 2', isActive: true },
      ],
      floorPlan: null,
    });

    renderUnit();

    expect(await screen.findByRole('link', { name: 'Gedung A' })).toHaveAttribute(
      'href',
      '/locations/loc-b'
    );
    expect(screen.getByText('Lab Komputer 2')).toBeInTheDocument();
    expect(screen.queryByText('loc-1')).not.toBeInTheDocument();
  });

  it('links to the ancestor floor plan and names which location it belongs to', async () => {
    assetCoreApi.locationsApi.context.mockResolvedValue({
      path: [
        { id: 'loc-b', name: 'Gedung A', isActive: true },
        { id: 'loc-f', name: 'Lantai 2', isActive: true },
        { id: 'loc-1', name: 'Lab Komputer 2', isActive: true },
      ],
      // The plan belongs to a location two steps above the unit's own.
      floorPlan: { locationId: 'loc-b', floorPlanId: 'plan-1', areaId: 'area-9' },
      floorPlans: [
        {
          locationId: 'loc-b',
          floorPlanId: 'plan-1',
          areaId: 'area-9',
          areaLocationId: 'loc-1',
        },
      ],
    });

    renderUnit();

    const link = await screen.findByRole('link', { name: /view the floor plan of Gedung A/i });
    expect(link).toHaveAttribute('href', '/locations/loc-b/floor-plan?highlight=loc-1');
    expect(screen.getByText(/shown on the plan for Gedung A/i)).toBeInTheDocument();
  });

  /**
   * Tracking a unit from the top of the hierarchy inwards — the reason
   * `floorPlans` exists alongside `floorPlan`.
   */
  it('offers every plan along the chain, each highlighting the next step in', async () => {
    assetCoreApi.locationsApi.context.mockResolvedValue({
      path: [
        { id: 'loc-site', name: 'SMAN 1', isActive: true },
        { id: 'loc-b', name: 'Gedung A', isActive: true },
        { id: 'loc-1', name: 'Lab Komputer 2', isActive: true },
      ],
      floorPlan: { locationId: 'loc-b', floorPlanId: 'plan-2', areaId: 'area-9' },
      floorPlans: [
        // The site plan draws the building, not the lab: a link carrying the
        // unit's own location would find nothing to highlight here, which is
        // exactly what used to happen.
        {
          locationId: 'loc-site',
          floorPlanId: 'plan-1',
          areaId: 'area-1',
          areaLocationId: 'loc-b',
        },
        {
          locationId: 'loc-b',
          floorPlanId: 'plan-2',
          areaId: 'area-9',
          areaLocationId: 'loc-1',
        },
      ],
    });

    renderUnit();

    const trail = await screen.findByRole('list', { name: /floor plans showing this unit/i });
    const links = within(trail).getAllByRole('link');

    // Root-first, so the trail reads the way someone walks the building.
    expect(links.map((link) => link.textContent)).toEqual(['SMAN 1', 'Gedung A']);
    expect(links[0]).toHaveAttribute('href', '/locations/loc-site/floor-plan?highlight=loc-b');
    expect(links[1]).toHaveAttribute('href', '/locations/loc-b/floor-plan?highlight=loc-1');
  });

  it('still links a level that has a plan but draws nothing on the way down', async () => {
    assetCoreApi.locationsApi.context.mockResolvedValue({
      path: [
        { id: 'loc-site', name: 'SMAN 1', isActive: true },
        { id: 'loc-1', name: 'Lab Komputer 2', isActive: true },
      ],
      floorPlan: { locationId: 'loc-site', floorPlanId: 'plan-1', areaId: null },
      floorPlans: [
        { locationId: 'loc-site', floorPlanId: 'plan-1', areaId: null, areaLocationId: null },
      ],
    });

    renderUnit();

    // "It is somewhere in here" is still worth offering, and the highlight falls
    // back to the unit's own location so the viewer says the exact spot is not
    // drawn rather than silently marking nothing.
    const link = await screen.findByRole('link', { name: /view the floor plan of SMAN 1/i });
    expect(link).toHaveAttribute('href', '/locations/loc-site/floor-plan?highlight=loc-1');
    expect(screen.getByText(/which does not mark it out/i)).toBeInTheDocument();
  });

  it('says so plainly when no ancestor has a floor plan', async () => {
    assetCoreApi.locationsApi.context.mockResolvedValue({
      path: [{ id: 'loc-1', name: 'Gudang', isActive: true }],
      floorPlan: null,
    });

    renderUnit();

    expect(await screen.findByText(/no floor plan available/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view on floor plan/i })).not.toBeInTheDocument();
  });

  it('handles a unit with no location without breaking the page', async () => {
    assetCoreApi.assetUnitsApi.get.mockResolvedValue({ ...UNIT, currentLocationId: null });

    renderUnit();

    expect(await screen.findByText(/not recorded/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
  });

  it('hides the operational tabs a caller cannot read', async () => {
    signInWith(['asset-unit:read', 'asset-attribute-value:read']);
    renderUnit();

    await screen.findByRole('tab', { name: 'Overview' });
    expect(screen.queryByRole('tab', { name: 'Borrowings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Transactions' })).not.toBeInTheDocument();
  });

  it('records condition, location and lifecycle as ONE entry (03-domain.md §4.12)', async () => {
    const record = vi.spyOn(assetCoreApi.assetUnitsApi, 'recordHistory').mockResolvedValue({});

    renderUnit();
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }));
    await userEvent.click(await screen.findByRole('button', { name: /record a change/i }));

    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/condition/i), 'FAIR');
    await userEvent.selectOptions(within(dialog).getByLabelText(/lifecycle state/i), 'IN_STORAGE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }));

    // One call carrying all three, not three separate writes.
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith(
        'unit-1234abcd',
        expect.objectContaining({ condition: 'FAIR', lifecycleState: 'IN_STORAGE' })
      )
    );
  });

  it('picks the new location through the hierarchy, not a flat dropdown', async () => {
    const record = vi.spyOn(assetCoreApi.assetUnitsApi, 'recordHistory').mockResolvedValue({});
    assetCoreApi.locationsApi.list.mockResolvedValue({
      data: [{ id: 'loc-9', name: 'Ruang 202', parentLocationId: null }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    renderUnit();
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }));
    await userEvent.click(await screen.findByRole('button', { name: /record a change/i }));

    const dialog = screen.getByRole('dialog');
    // A picker that drills the tree, so a location past the old 100-row page
    // cap is reachable and two rooms of the same name are tellable apart.
    // Reached through its LABEL, which also proves the picker's trigger is
    // still associated with the field the way a plain <select> was.
    const trigger = within(dialog).getByLabelText(/location/i);
    // Not choosing a location means the unit stays where it is, and the trigger
    // says so rather than inviting a choice.
    expect(trigger).toHaveTextContent('Unchanged');

    await userEvent.click(trigger);

    const picker = await screen.findByRole('dialog', { name: /select a location/i });
    await userEvent.click(await within(picker).findByRole('button', { name: 'Ruang 202' }));

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Record' })
    );

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith(
        'unit-1234abcd',
        expect.objectContaining({ locationId: 'loc-9' })
      )
    );
  });

  it('reports a rejected lifecycle transition from the server (REQ-LIFE-002)', async () => {
    vi.spyOn(assetCoreApi.assetUnitsApi, 'recordHistory').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.CONFLICT,
        message: 'An asset unit cannot move from ACTIVE to REGISTERED',
        status: 409,
      })
    );

    renderUnit();
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }));
    await userEvent.click(await screen.findByRole('button', { name: /record a change/i }));

    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/lifecycle state/i), 'REGISTERED');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }));

    expect(
      await screen.findByText('An asset unit cannot move from ACTIVE to REGISTERED')
    ).toBeInTheDocument();
  });

  it('hides the record action without asset-unit:record-history', async () => {
    signInWith(['asset-unit:read']);
    renderUnit();

    await userEvent.click(await screen.findByRole('tab', { name: 'History' }));
    expect(screen.queryByRole('button', { name: /record a change/i })).not.toBeInTheDocument();
  });
});

/**
 * The unit's own procurement line — REQ-PROC-006.
 *
 * `POST /assets/:id/units` accepted `contractItemId` from Phase 5 and the
 * Add-unit dialog never sent it; `PATCH /asset-units/:id` rejected it outright,
 * so a unit registered outside the procurement flow could never be traced to the
 * line item it arrived on. Both are addressed here.
 */
describe('asset unit → contract item', () => {
  const CONTRACTED = {
    ...ASSET,
    contractId: 'contract-1',
    contract: { id: 'contract-1', contractNumber: 'CTR-2025-0001' },
  };

  const ITEMS = [
    { id: 'item-1', assetName: 'Laptop 14"', quantity: '10.00', unitType: 'unit' },
    { id: 'item-2', assetName: 'Proyektor', quantity: null, unitType: null },
  ];

  beforeEach(() => {
    vi.spyOn(procurementApi.contractsApi, 'listItems').mockResolvedValue(page(ITEMS));
    vi.spyOn(assetCoreApi.assetsApi, 'listUnits').mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.assetsApi, 'attributeValues').mockResolvedValue([]);
    vi.spyOn(assetCoreApi.assetsApi, 'listAttachments').mockResolvedValue([]);
  });

  const renderDetail = () =>
    renderScreen(<AssetDetailPage />, { path: '/assets/:id', route: '/assets/asset-1' });

  it('offers the contract items when adding a unit to a procured asset', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(CONTRACTED);
    const createUnit = vi
      .spyOn(assetCoreApi.assetsApi, 'createUnit')
      .mockResolvedValue({ id: 'unit-9' });

    renderDetail();
    await userEvent.click(await screen.findByRole('tab', { name: 'Units' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add unit' }));

    const dialog = screen.getByRole('dialog');
    // The ordered quantity is part of the label: two items on one contract can
    // share an asset name.
    expect(await within(dialog).findByRole('option', { name: /Laptop 14" — 10/ })).toBeVisible();

    await userEvent.selectOptions(within(dialog).getByLabelText('Procurement item'), 'item-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createUnit).toHaveBeenCalled());
    expect(createUnit.mock.calls[0][1]).toMatchObject({ contractItemId: 'item-1' });
  });

  it('offers no line item when the asset has no procurement record', async () => {
    vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(ASSET);

    renderDetail();
    await userEvent.click(await screen.findByRole('tab', { name: 'Units' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add unit' }));

    expect(screen.queryByLabelText('Procurement item')).not.toBeInTheDocument();
    expect(procurementApi.contractsApi.listItems).not.toHaveBeenCalled();
  });

  /**
   * The manually supplied part of the inventory code — `CR-007`, REQ-ORG-007.
   *
   * The form learns whether to ask from the `unitRegistration` hint on the asset
   * detail, never from the format itself: `inventory-code-format:read` is an
   * administration permission a registrar has no reason to hold.
   */
  describe('number composition (CR-007)', () => {
    const asking = (overrides = {}) => ({
      ...ASSET,
      unitRegistration: {
        numberComposition: { required: true, perUnit: true, maxLength: 16, ...overrides },
      },
    });

    it('asks for one when the institution format uses it, and sends what was typed', async () => {
      vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(asking());
      const createUnit = vi
        .spyOn(assetCoreApi.assetsApi, 'createUnit')
        .mockResolvedValue({ id: 'unit-9' });

      renderDetail();
      await userEvent.click(await screen.findByRole('tab', { name: 'Units' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Add unit' }));

      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/Number composition/), '001-02-03');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(createUnit).toHaveBeenCalled());
      expect(createUnit.mock.calls[0][1]).toMatchObject({ numberComposition: '001-02-03' });
    });

    it('never sends the field to an institution that did not ask for it', async () => {
      vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue({
        ...ASSET,
        unitRegistration: { numberComposition: { required: false } },
      });
      const createUnit = vi
        .spyOn(assetCoreApi.assetsApi, 'createUnit')
        .mockResolvedValue({ id: 'unit-9' });

      renderDetail();
      await userEvent.click(await screen.findByRole('tab', { name: 'Units' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Add unit' }));

      expect(screen.queryByLabelText(/Number composition/)).not.toBeInTheDocument();

      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(createUnit).toHaveBeenCalled());
      // Strict write bodies: an unexpected key is a 400, not something ignored.
      expect(createUnit.mock.calls[0][1]).not.toHaveProperty('numberComposition');
    });

    /**
     * A duplicate answers `409` naming `numberComposition`, not `inventoryCode`
     * — the composition is the half the caller can actually change.
     */
    it('reports a duplicate against the field the caller typed', async () => {
      vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(asking());
      vi.spyOn(assetCoreApi.assetsApi, 'createUnit').mockRejectedValue(
        new ApiError({
          code: ERROR_CODES.CONFLICT,
          message: 'That inventory code has already been issued',
          status: 409,
          details: [{ field: 'numberComposition', issue: 'a unit already carries that code' }],
        })
      );

      renderDetail();
      await userEvent.click(await screen.findByRole('tab', { name: 'Units' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Add unit' }));

      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/Number composition/), '001-02-03');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

      expect(await screen.findByText(/a unit already carries that code/i)).toBeInTheDocument();
    });
  });

  describe('on the unit itself', () => {
    const UNIT = {
      id: 'unit-1234abcd',
      assetId: 'asset-1',
      description: 'Serial 123',
      contractItemId: null,
      lifecycleState: 'ACTIVE',
      currentCondition: 'GOOD',
      currentLocationId: 'loc-1',
      isActive: true,
    };

    beforeEach(() => {
      vi.spyOn(assetCoreApi.assetUnitsApi, 'get').mockResolvedValue(UNIT);
      vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(CONTRACTED);
      vi.spyOn(assetCoreApi.locationsApi, 'context').mockResolvedValue({
        path: [{ id: 'loc-1', name: 'Lab Komputer 2', isActive: true }],
        floorPlan: null,
      });
      vi.spyOn(assetCoreApi.assetUnitsApi, 'attributeValues').mockResolvedValue([]);
      vi.spyOn(assetCoreApi.assetUnitsApi, 'history').mockResolvedValue(page([]));
      vi.spyOn(assetCoreApi.assetUnitsApi, 'borrowings').mockResolvedValue(page([]));
      vi.spyOn(assetCoreApi.assetUnitsApi, 'transactions').mockResolvedValue(page([]));
    });

    const renderUnit = () =>
      renderScreen(<AssetUnitDetailPage />, {
        path: '/assets/:id/units/:unitId',
        route: '/assets/asset-1/units/unit-1234abcd',
      });

    it('names the line item and its contract rather than showing a raw id', async () => {
      assetCoreApi.assetUnitsApi.get.mockResolvedValue({ ...UNIT, contractItemId: 'item-2' });

      renderUnit();

      expect(await screen.findByText('Proyektor')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'CTR-2025-0001' })).toHaveAttribute(
        'href',
        '/procurement/contracts/contract-1'
      );
    });

    it('attaches a line item to a unit that was never traced to one', async () => {
      const update = vi.spyOn(assetCoreApi.assetUnitsApi, 'update').mockResolvedValue(UNIT);

      renderUnit();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

      const dialog = screen.getByRole('dialog');
      await userEvent.selectOptions(
        await within(dialog).findByLabelText('Procurement item'),
        'item-1'
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls[0][1]).toMatchObject({ contractItemId: 'item-1' });
    });

    /**
     * Sending `null` for a control the caller never saw would clear a
     * procurement line they had no way to see, let alone intend to remove.
     */
    it('leaves the line item alone when the field was never offered', async () => {
      assetCoreApi.assetsApi.get.mockResolvedValue(ASSET);
      assetCoreApi.assetUnitsApi.get.mockResolvedValue({ ...UNIT, contractItemId: 'item-1' });
      const update = vi.spyOn(assetCoreApi.assetUnitsApi, 'update').mockResolvedValue(UNIT);

      renderUnit();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).queryByLabelText('Procurement item')).not.toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls[0][1]).not.toHaveProperty('contractItemId');
    });
  });
});

/**
 * PIC-scoped sessions — Phase 22 (`CR-003` §5.7, §6).
 *
 * The screen must not offer what the server will refuse. Two consequences:
 * the department picker comes from the session rather than `GET /departments`,
 * and the department control is absent from the edit dialog entirely.
 */
describe('AssetUnitDetailPage — PIC-scoped caller', () => {
  const UNIT = {
    id: 'unit-1234abcd',
    assetId: 'asset-1',
    description: 'Serial 123',
    lifecycleState: 'ACTIVE',
    currentCondition: 'GOOD',
    currentLocationId: null,
    departmentId: 'dept-1',
    department: { id: 'dept-1', code: 'TKJ', name: 'Teknik Komputer dan Jaringan' },
    isActive: true,
  };

  beforeEach(() => {
    // Same permissions an ordinary caller would hold — only the tier differs.
    signInWith(['asset-unit:read', 'asset-unit:update', 'asset-unit:record-history'], {
      isPicScoped: true,
      picDepartments: [{ id: 'dept-1', code: 'TKJ', name: 'Teknik Komputer dan Jaringan' }],
      institutionId: 'inst-1',
    });

    vi.spyOn(assetCoreApi.assetUnitsApi, 'get').mockResolvedValue(UNIT);
    vi.spyOn(assetCoreApi.assetsApi, 'get').mockResolvedValue(ASSET);
    vi.spyOn(assetCoreApi.assetUnitsApi, 'attributeValues').mockResolvedValue([]);
    vi.spyOn(assetCoreApi.assetUnitsApi, 'history').mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.assetUnitsApi, 'borrowings').mockResolvedValue(page([]));
    vi.spyOn(assetCoreApi.assetUnitsApi, 'transactions').mockResolvedValue(page([]));
  });

  const renderUnit = () =>
    renderScreen(<AssetUnitDetailPage />, {
      path: '/assets/:id/units/:unitId',
      route: '/assets/asset-1/units/unit-1234abcd',
    });

  it('offers no department control at all', async () => {
    renderUnit();

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');

    // Absent rather than present-and-rejected: a PIC-scoped caller may not move
    // a unit between departments in any direction (`CR-003` §6).
    expect(within(dialog).queryByLabelText(/department/i)).not.toBeInTheDocument();
  });

  it('never asks the server for the department list', async () => {
    const list = vi.spyOn(organizationApi.departmentsApi, 'list');
    renderUnit();

    await screen.findByText('Teknik Komputer dan Jaringan (TKJ)');

    // The picker is fed from the session, so the role needs no department:read.
    expect(list).not.toHaveBeenCalled();
  });

  it('still shows which department the unit belongs to', async () => {
    renderUnit();

    expect(await screen.findByText('Teknik Komputer dan Jaringan (TKJ)')).toBeInTheDocument();
  });
});
