import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, ERROR_CODES } from '@/api/errors';
import * as procurementApi from '@/api/procurement';
import * as referenceApi from '@/api/reference';
import * as organizationApi from '@/api/organization';
import { renderScreen, signInWith } from '@/test/harness';
import { SuppliersPage } from './SuppliersPage';
import { SupplierDetailPage } from './SupplierDetailPage';
import { ContractsPage } from './ContractsPage';
import { ContractFormPage } from './ContractFormPage';
import { ContractDetailPage } from './ContractDetailPage';
import { defaultUnitCount } from './AddAssetDialog';

/**
 * Procurement screens — `07-ui.md` §5.5, `IMPLEMENTATION_PLAN.md` §19.1–§19.5.
 */

const ALL = [
  'supplier:read',
  'supplier:create',
  'supplier:update',
  'supplier:deactivate',
  'contract:read',
  'contract:create',
  'contract:update',
  'contract:deactivate',
  'contract-item:read',
  'contract-item:create',
  'contract-item:update',
  'contract-item:delete',
  'contract-type:read',
  // The contract form can now create these two inline, so a fully-permissioned
  // caller holds their create codes as well as their read codes.
  'contract-type:create',
  'funding-source:read',
  'funding-source:create',
  'account-code:read',
  'institution:read',
  'vendor:read',
  'asset:read',
  'asset:create',
  'asset-unit:read',
  'asset-unit:create',
  'classification:read',
];

const page = (rows, meta = {}) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1, ...meta },
});

const SUPPLIER = {
  id: 'sup-1',
  name: 'CV Sumber Jaya',
  address: 'Jl. Merdeka 1',
  contactInfo: '0812-0000',
  isActive: true,
};

const CONTRACT = {
  id: 'con-1',
  contractNumber: 'SPK/2026/001',
  supplierId: 'sup-1',
  contractTypeId: 2,
  contractDate: '2026-02-10',
  fundingSourceId: 3,
  // NUMERIC(15,2) arrives as a string from the driver.
  contractValue: '15000000.00',
  receivingDocument: 'BA-01',
  receivingDate: '2026-03-01',
  institutionId: 'inst-1',
  accountCode: '117010101',
  notes: 'Pengadaan komputer',
  isActive: true,
};

const CONTRACT_DETAIL = {
  ...CONTRACT,
  supplier: { id: 'sup-1', name: 'CV Sumber Jaya' },
  contractType: { id: 2, name: 'Pengadaan Langsung' },
  fundingSource: { id: 3, name: 'APBD' },
  institution: { id: 'inst-1', name: 'Dinas Pendidikan', code: 'DISDIK' },
};

const ITEM = {
  id: 'item-1',
  contractId: 'con-1',
  assetName: 'Komputer Desktop',
  specification: 'Core i5, 16GB',
  quantity: 10,
  unitPrice: '7500000.00',
  // A real unit of measure. The old fixture said "unit", which is exactly the
  // ambiguity this screen was reported for: it reads as an Asset Unit.
  unitType: 'piece',
  totalValue: '75000000.00',
};

beforeEach(() => {
  signInWith(ALL);

  vi.spyOn(procurementApi.suppliersApi, 'list').mockResolvedValue(page([SUPPLIER]));
  vi.spyOn(procurementApi.suppliersApi, 'get').mockResolvedValue(SUPPLIER);
  vi.spyOn(procurementApi.contractsApi, 'list').mockResolvedValue(page([CONTRACT]));
  vi.spyOn(procurementApi.contractsApi, 'get').mockResolvedValue(CONTRACT_DETAIL);
  vi.spyOn(procurementApi.contractsApi, 'listItems').mockResolvedValue(page([ITEM]));
  vi.spyOn(procurementApi.contractItemsApi, 'get').mockResolvedValue(ITEM);
  vi.spyOn(procurementApi.contractItemsApi, 'assetUnits').mockResolvedValue(page([]));
  vi.spyOn(procurementApi.vendorsApi, 'list').mockResolvedValue(page([]));

  vi.spyOn(referenceApi.lookupApis['contract-types'], 'list').mockResolvedValue(
    page([{ id: 2, name: 'Pengadaan Langsung' }])
  );
  vi.spyOn(referenceApi.lookupApis['funding-sources'], 'list').mockResolvedValue(
    page([{ id: 3, name: 'APBD' }])
  );
  vi.spyOn(referenceApi.lookupApis['account-codes'], 'list').mockResolvedValue(
    page([{ code: '117010101', name: 'Peralatan dan Mesin' }])
  );
  vi.spyOn(organizationApi.institutionsApi, 'list').mockResolvedValue(
    page([{ id: 'inst-1', name: 'Dinas Pendidikan', code: 'DISDIK', isActive: true }])
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SuppliersPage', () => {
  it('lists suppliers with their status', async () => {
    renderScreen(<SuppliersPage />);

    expect(await screen.findByText('CV Sumber Jaya')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('has no institution filter — suppliers are global (DEC-007)', async () => {
    renderScreen(<SuppliersPage />);
    await screen.findByText('CV Sumber Jaya');

    expect(screen.queryByLabelText(/institution/i)).not.toBeInTheDocument();
  });

  it('creates a supplier, omitting the fields left blank', async () => {
    const create = vi.spyOn(procurementApi.suppliersApi, 'create').mockResolvedValue(SUPPLIER);
    renderScreen(<SuppliersPage />);
    await screen.findByText('CV Sumber Jaya');

    await userEvent.click(screen.getByRole('button', { name: /new supplier/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'PT Baru');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'PT Baru',
        address: undefined,
        contactInfo: undefined,
      })
    );
  });

  it('hides the create action without supplier:create (§6)', async () => {
    signInWith(['supplier:read']);
    renderScreen(<SuppliersPage />);
    await screen.findByText('CV Sumber Jaya');

    expect(screen.queryByRole('button', { name: /new supplier/i })).not.toBeInTheDocument();
  });
});

describe('SupplierDetailPage', () => {
  it('lists the supplier’s contracts (REQ-SUPPLIER-003)', async () => {
    renderScreen(<SupplierDetailPage />, { path: '/:id', route: '/sup-1' });
    await screen.findByRole('heading', { name: 'CV Sumber Jaya' });

    await userEvent.click(screen.getByRole('tab', { name: 'Contracts' }));

    expect(await screen.findByText('SPK/2026/001')).toBeInTheDocument();
    // Scoped to this supplier, not the whole contract table.
    expect(procurementApi.contractsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ supplierId: 'sup-1' })
    );
  });

  it('hides the Contracts tab without contract:read (DEC-032)', async () => {
    signInWith(['supplier:read']);
    renderScreen(<SupplierDetailPage />, { path: '/:id', route: '/sup-1' });
    await screen.findByRole('heading', { name: 'CV Sumber Jaya' });

    expect(screen.queryByRole('tab', { name: 'Contracts' })).not.toBeInTheDocument();
  });

  it('confirms before deactivating and only then calls the API (§4.4)', async () => {
    const setActive = vi
      .spyOn(procurementApi.suppliersApi, 'setActive')
      .mockResolvedValue({ ...SUPPLIER, isActive: false });

    renderScreen(<SupplierDetailPage />, { path: '/:id', route: '/sup-1' });
    await screen.findByRole('heading', { name: 'CV Sumber Jaya' });

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(setActive).not.toHaveBeenCalled();

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate' })
    );
    await waitFor(() => expect(setActive).toHaveBeenCalledWith('sup-1', false));
  });
});

describe('ContractsPage', () => {
  it('resolves the supplier name the list response does not carry (DEC-037)', async () => {
    renderScreen(<ContractsPage />);

    expect(await screen.findByText('SPK/2026/001')).toBeInTheDocument();
    expect(screen.getByText('CV Sumber Jaya')).toBeInTheDocument();
    // Money with separators and two decimals, no currency symbol (DEC-039).
    expect(screen.getByText('15,000,000.00')).toBeInTheDocument();
    expect(screen.getByText('10 Feb 2026')).toBeInTheDocument();
  });

  it('writes filters into the URL so the view survives a refresh (§4.1)', async () => {
    const { router } = renderScreen(<ContractsPage />);
    await screen.findByText('SPK/2026/001');

    await userEvent.type(screen.getByLabelText('Search'), 'SPK');

    await waitFor(() => expect(router.state.location.search).toContain('q=SPK'));
  });

  it('hides the supplier filter from a caller without supplier:read', async () => {
    signInWith(['contract:read']);
    renderScreen(<ContractsPage />);
    await screen.findByText('SPK/2026/001');

    expect(screen.queryByLabelText('Supplier')).not.toBeInTheDocument();
    expect(procurementApi.suppliersApi.list).not.toHaveBeenCalled();
  });

  it('links to the create page only with contract:create (DEC-033)', async () => {
    renderScreen(<ContractsPage />);
    await screen.findByText('SPK/2026/001');
    expect(screen.getByRole('link', { name: /new contract/i })).toHaveAttribute(
      'href',
      '/procurement/contracts/new'
    );

    signInWith(['contract:read']);
    renderScreen(<ContractsPage />);
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /new contract/i })).not.toBeInTheDocument()
    );
  });
});

describe('ContractFormPage', () => {
  it('prefills every field when editing', async () => {
    renderScreen(<ContractFormPage />, { path: '/:id/edit', route: '/con-1/edit' });

    expect(await screen.findByLabelText(/contract number/i)).toHaveValue('SPK/2026/001');
    expect(screen.getByLabelText(/contract value/i)).toHaveValue(15000000);
    // Supplier and contract type are pickers now, not `<select>`s, so what is
    // asserted is what the user actually sees: the record's NAME rather than
    // its opaque id. Account code is still a select — it is keyed by a natural
    // code and is not something anyone creates mid-contract.
    expect(screen.getByLabelText(/^supplier/i)).toHaveTextContent('CV Sumber Jaya');
    expect(screen.getByLabelText(/contract type/i)).toHaveTextContent('Pengadaan Langsung');
    expect(screen.getByLabelText(/account code/i)).toHaveValue('117010101');
    // The picker now carries the `id` its `Field` hands it, so the field label
    // is its accessible name and the stored date is its visible content.
    expect(screen.getByLabelText(/contract date/i)).toHaveTextContent('10 Feb 2026');
  });

  /**
   * The audit's largest systemic finding: a user who reached "Contract type"
   * and found theirs missing had to abandon a half-filled contract, go to
   * reference data, create it, come back and retype everything.
   */
  it('creates a missing contract type without losing the form', async () => {
    const created = vi
      .spyOn(referenceApi.lookupApis['contract-types'], 'create')
      .mockResolvedValue({ id: 9, name: 'Swakelola' });

    renderScreen(<ContractFormPage />, { path: '/new', route: '/new' });

    // Type into the parent form FIRST — this is what used to be lost.
    await userEvent.type(await screen.findByLabelText(/contract number/i), 'SPK/2026/999');

    await userEvent.click(screen.getByLabelText(/contract type/i));
    await userEvent.click(await screen.findByRole('button', { name: 'Create contract type' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Swakelola');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(created).toHaveBeenCalledWith({ name: 'Swakelola' }));

    // The new record is selected, and everything already typed is still there.
    await waitFor(() =>
      expect(screen.getByLabelText(/contract type/i)).toHaveTextContent('Swakelola')
    );
    expect(screen.getByLabelText(/contract number/i)).toHaveValue('SPK/2026/999');
  });

  it('offers no create affordance to a caller who may only read the lookup', async () => {
    // Read but not create — the list is still selectable, the door is absent
    // rather than locked (§6).
    signInWith(ALL.filter((code) => code !== 'contract-type:create'));
    renderScreen(<ContractFormPage />, { path: '/new', route: '/new' });

    await userEvent.click(await screen.findByLabelText(/contract type/i));

    expect(screen.queryByRole('button', { name: 'Create contract type' })).not.toBeInTheDocument();
    expect(await screen.findByText('Pengadaan Langsung')).toBeInTheDocument();
  });

  it('sends numbers as numbers and keeps the institution it was given', async () => {
    const update = vi
      .spyOn(procurementApi.contractsApi, 'update')
      .mockResolvedValue(CONTRACT_DETAIL);

    renderScreen(<ContractFormPage />, {
      path: '/:id/edit',
      route: '/con-1/edit',
      // The form navigates to the detail page on success.
      extraRoutes: [{ path: '/procurement/contracts/:id', element: <div>saved</div> }],
    });
    await screen.findByLabelText(/contract number/i);

    await userEvent.clear(screen.getByLabelText(/contract value/i));
    await userEvent.type(screen.getByLabelText(/contract value/i), '2000000');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'con-1',
        expect.objectContaining({
          contractNumber: 'SPK/2026/001',
          contractDate: '2026-02-10',
          contractValue: 2000000,
          contractTypeId: 2,
          fundingSourceId: 3,
          institutionId: 'inst-1',
        })
      )
    );
  });

  it('maps a server VALIDATION_ERROR onto the offending field (§4.3)', async () => {
    vi.spyOn(procurementApi.contractsApi, 'update').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'invalid',
        status: 400,
        details: [{ field: 'contractNumber', issue: 'must be unique' }],
      })
    );

    renderScreen(<ContractFormPage />, { path: '/:id/edit', route: '/con-1/edit' });
    await screen.findByLabelText(/contract number/i);

    await userEvent.type(screen.getByLabelText(/contract number/i), '-A');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('must be unique')).toBeInTheDocument();
  });

  it('refuses to submit a create with no contract date', async () => {
    const create = vi.spyOn(procurementApi.contractsApi, 'create');
    renderScreen(<ContractFormPage />, { path: '/new', route: '/new' });

    await userEvent.type(await screen.findByLabelText(/contract number/i), 'SPK/2026/002');
    await userEvent.click(screen.getByRole('button', { name: /create contract/i }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(create).not.toHaveBeenCalled();
  });

  it('hides a reference selector the caller cannot read', async () => {
    signInWith(['contract:read', 'contract:update']);
    renderScreen(<ContractFormPage />, { path: '/:id/edit', route: '/con-1/edit' });
    await screen.findByLabelText(/contract number/i);

    expect(screen.queryByLabelText(/^supplier/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/account code/i)).not.toBeInTheDocument();
  });
});

describe('ContractDetailPage', () => {
  it('shows the resolved references and links onward for traceability', async () => {
    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });

    expect(screen.getByRole('link', { name: 'CV Sumber Jaya' })).toHaveAttribute(
      'href',
      '/procurement/suppliers/sup-1'
    );
    expect(screen.getByRole('link', { name: /assets from this contract/i })).toHaveAttribute(
      'href',
      '/assets?contractId=con-1'
    );
    expect(screen.getByText('Pengadaan Langsung')).toBeInTheDocument();
  });

  it('hides the assets link without asset:read', async () => {
    signInWith(['contract:read']);
    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });

    expect(
      screen.queryByRole('link', { name: /assets from this contract/i })
    ).not.toBeInTheDocument();
  });

  it('shows the line items with the server’s derived total (DEC-039)', async () => {
    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });

    await userEvent.click(screen.getByRole('tab', { name: 'Line items' }));

    expect(await screen.findByText('Komputer Desktop')).toBeInTheDocument();
    expect(screen.getByText('7,500,000.00')).toBeInTheDocument();
    expect(screen.getByText('75,000,000.00')).toBeInTheDocument();
    expect(screen.getByText('10 piece')).toBeInTheDocument();
  });

  it('hides the Line items tab without contract-item:read (DEC-032)', async () => {
    signInWith(['contract:read']);
    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });

    expect(screen.queryByRole('tab', { name: 'Line items' })).not.toBeInTheDocument();
  });

  it('surfaces the CONFLICT that protects procurement traceability on delete', async () => {
    vi.spyOn(procurementApi.contractItemsApi, 'remove').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.CONFLICT,
        message: '3 asset unit(s) were procured through it',
        status: 409,
      })
    );

    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });
    await userEvent.click(screen.getByRole('tab', { name: 'Line items' }));
    await screen.findByText('Komputer Desktop');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    );

    expect(await screen.findByText('3 asset unit(s) were procured through it')).toBeInTheDocument();
  });

  it('adds a line item without a contractId in the body', async () => {
    const createItem = vi.spyOn(procurementApi.contractsApi, 'createItem').mockResolvedValue(ITEM);

    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });
    await userEvent.click(screen.getByRole('tab', { name: 'Line items' }));
    await screen.findByText('Komputer Desktop');

    await userEvent.click(screen.getByRole('button', { name: /add line item/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/item name/i), 'Printer');
    await userEvent.type(within(dialog).getByLabelText(/quantity/i), '3');
    await userEvent.type(within(dialog).getByLabelText(/unit price/i), '1500000');
    await userEvent.click(within(dialog).getByRole('button', { name: /add item/i }));

    await waitFor(() =>
      expect(createItem).toHaveBeenCalledWith('con-1', {
        assetName: 'Printer',
        specification: undefined,
        quantity: 3,
        unitPrice: 1500000,
        unitType: undefined,
      })
    );
  });

  it('names the unit of measure as such, not just "Unit"', async () => {
    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });
    await userEvent.click(screen.getByRole('tab', { name: 'Line items' }));
    await screen.findByText('Komputer Desktop');

    await userEvent.click(screen.getByRole('button', { name: /add line item/i }));
    const dialog = screen.getByRole('dialog');

    // A field labelled "Unit" beside "Quantity" is what produced "Unit: 10".
    const unitOfMeasure = within(dialog).getByLabelText(/unit of measure/i);
    expect(unitOfMeasure).toHaveAttribute('placeholder', expect.stringContaining('piece'));
    expect(within(dialog).getByLabelText(/^quantity/i)).toHaveAttribute('type', 'number');
  });

  it('opens the item detail dialog with its procured units (DEC-035)', async () => {
    procurementApi.contractItemsApi.assetUnits.mockResolvedValue(
      page([{ id: 'unit-1234-abcd', assetId: 'asset-1', lifecycleState: 'REGISTERED' }])
    );

    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });
    await userEvent.click(screen.getByRole('tab', { name: 'Line items' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Komputer Desktop' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Asset units')).toBeInTheDocument();
    expect(await within(dialog).findByText('unit-123')).toBeInTheDocument();
  });

  it('hides the units section without asset-unit:read (DEC-032)', async () => {
    signInWith(['contract:read', 'contract-item:read']);
    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });
    await userEvent.click(screen.getByRole('tab', { name: 'Line items' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Komputer Desktop' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Asset units')).not.toBeInTheDocument();
    expect(procurementApi.contractItemsApi.assetUnits).not.toHaveBeenCalled();
  });
});

describe('Add asset from a contract item (REQ-PROC-009)', () => {
  const openDialog = async () => {
    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });
    await userEvent.click(screen.getByRole('tab', { name: 'Line items' }));
    await screen.findByText('Komputer Desktop');
    await userEvent.click(screen.getByRole('button', { name: /add asset/i }));
    return screen.getByRole('dialog');
  };

  it('prefills the name and the unit count from the item (DEC-036)', async () => {
    const dialog = await openDialog();

    expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('Komputer Desktop');
    expect(within(dialog).getByLabelText(/asset units to register/i)).toHaveValue(10);
    expect(within(dialog).getByText(/partial receiving is expected/i)).toBeInTheDocument();
  });

  it('states the order in full, so the count of units is not read as the quantity', async () => {
    const dialog = await openDialog();

    // "10 piece ordered" and "Asset units to register: 10" are two different
    // facts that happen to share a number; the hint has to say which is which.
    expect(within(dialog).getByText(/10 piece ordered/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/tracked individually/i)).toBeInTheDocument();
  });

  it('caps the prefill at the server bound and never below one', () => {
    expect(defaultUnitCount(10)).toBe(10);
    expect(defaultUnitCount(null)).toBe(1);
    expect(defaultUnitCount(0)).toBe(1);
    expect(defaultUnitCount(900)).toBe(500);
  });

  it('will not submit without a classification (DEC-009)', async () => {
    const createAsset = vi.spyOn(procurementApi.contractItemsApi, 'createAsset');
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole('button', { name: /create asset/i }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('posts only what the item cannot supply — the server fills in traceability', async () => {
    const createAsset = vi
      .spyOn(procurementApi.contractItemsApi, 'createAsset')
      .mockResolvedValue({ asset: { id: 'asset-9' }, units: [{ id: 'u1' }, { id: 'u2' }] });

    vi.spyOn(referenceApi.classificationsApi, 'list').mockResolvedValue(
      page([{ id: '100000000000', name: 'Aset Tetap', isLeaf: false }])
    );
    vi.spyOn(referenceApi.classificationsApi, 'searchLeaves').mockResolvedValue(
      page([{ id: '117010101001', name: 'Komputer', isLeaf: true }])
    );

    const dialog = await openDialog();

    // The picker's trigger takes its accessible name from the `Field` label.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Classification' }));
    await userEvent.type(screen.getByPlaceholderText('Search classifications…'), 'kom');
    await userEvent.click(await screen.findByRole('button', { name: /Komputer/ }));

    await userEvent.clear(screen.getByLabelText(/asset units to register/i));
    await userEvent.type(screen.getByLabelText(/asset units to register/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /create asset/i }));

    await waitFor(() =>
      expect(createAsset).toHaveBeenCalledWith('item-1', {
        name: 'Komputer Desktop',
        classificationId: '117010101001',
        vendorId: undefined,
        description: undefined,
        unitCount: 2,
      })
    );

    // No contractId, no contractItemId, no institutionId: the server derives all
    // three (REQ-ASSET-011, REQ-PROC-006, DEC-011).
    const body = createAsset.mock.calls[0][1];
    expect(body).not.toHaveProperty('contractId');
    expect(body).not.toHaveProperty('contractItemId');
    expect(body).not.toHaveProperty('institutionId');

    expect(await screen.findByText('Asset created with 2 units')).toBeInTheDocument();
  });

  /**
   * The manually supplied part of the inventory code, in a batch — `CR-007`,
   * `06-api.md` §6.3.
   *
   * The hint rides on `GET /contract-items/:id`, so the dialog fetches the item
   * rather than trusting the list row it was opened with. `perUnit` is the whole
   * branch: with a sequence one value covers the batch, without one every unit
   * needs its own.
   */
  describe('number composition (CR-007)', () => {
    const asking = (numberComposition) =>
      procurementApi.contractItemsApi.get.mockResolvedValue({ ...ITEM, unitRegistration: { numberComposition } });

    /** Opens the dialog, picks a classification and sets the count to 2. */
    const fillCommonFields = async () => {
      vi.spyOn(referenceApi.classificationsApi, 'list').mockResolvedValue(
        page([{ id: '100000000000', name: 'Aset Tetap', isLeaf: false }])
      );
      vi.spyOn(referenceApi.classificationsApi, 'searchLeaves').mockResolvedValue(
        page([{ id: '117010101001', name: 'Komputer', isLeaf: true }])
      );

      const dialog = await openDialog();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Classification' }));
      await userEvent.type(screen.getByPlaceholderText('Search classifications…'), 'kom');
      await userEvent.click(await screen.findByRole('button', { name: /Komputer/ }));

      await userEvent.clear(screen.getByLabelText(/asset units to register/i));
      await userEvent.type(screen.getByLabelText(/asset units to register/i), '2');

      return dialog;
    };

    it('asks for one value for the whole batch when the format allocates a sequence', async () => {
      asking({ required: true, perUnit: false, maxLength: 16 });
      const createAsset = vi
        .spyOn(procurementApi.contractItemsApi, 'createAsset')
        .mockResolvedValue({ asset: { id: 'asset-9' }, units: [{ id: 'u1' }, { id: 'u2' }] });

      await fillCommonFields();

      await userEvent.type(await screen.findByLabelText(/^number composition/i), '001-02-03');
      await userEvent.click(screen.getByRole('button', { name: /create asset/i }));

      await waitFor(() => expect(createAsset).toHaveBeenCalled());
      expect(createAsset.mock.calls[0][1]).toMatchObject({ numberComposition: '001-02-03' });
      expect(createAsset.mock.calls[0][1]).not.toHaveProperty('numberCompositions');
    });

    it('asks for one value per unit when the format allocates none', async () => {
      asking({ required: true, perUnit: true, maxLength: 16 });
      const createAsset = vi
        .spyOn(procurementApi.contractItemsApi, 'createAsset')
        .mockResolvedValue({ asset: { id: 'asset-9' }, units: [{ id: 'u1' }, { id: 'u2' }] });

      await fillCommonFields();

      await userEvent.type(await screen.findByLabelText(/number compositions/i), '001-02-03\n001-02-04');
      await userEvent.click(screen.getByRole('button', { name: /create asset/i }));

      await waitFor(() => expect(createAsset).toHaveBeenCalled());
      expect(createAsset.mock.calls[0][1]).toMatchObject({
        numberCompositions: ['001-02-03', '001-02-04'],
      });
      expect(createAsset.mock.calls[0][1]).not.toHaveProperty('numberComposition');
    });

    it('will not send a batch whose values do not match the unit count', async () => {
      asking({ required: true, perUnit: true, maxLength: 16 });
      const createAsset = vi.spyOn(procurementApi.contractItemsApi, 'createAsset');

      await fillCommonFields();

      // Two units, one value.
      await userEvent.type(await screen.findByLabelText(/number compositions/i), '001-02-03');
      await userEvent.click(screen.getByRole('button', { name: /create asset/i }));

      expect(await screen.findByText(/exactly one value per unit/i)).toBeInTheDocument();
      expect(createAsset).not.toHaveBeenCalled();
    });

    it('will not let two units share a value, which would render one code', async () => {
      asking({ required: true, perUnit: true, maxLength: 16 });
      const createAsset = vi.spyOn(procurementApi.contractItemsApi, 'createAsset');

      await fillCommonFields();

      await userEvent.type(await screen.findByLabelText(/number compositions/i), '001-02-03\n001-02-03');
      await userEvent.click(screen.getByRole('button', { name: /create asset/i }));

      expect(await screen.findByText(/cannot share a value/i)).toBeInTheDocument();
      expect(createAsset).not.toHaveBeenCalled();
    });

    it('asks for nothing when the institution format uses no composition', async () => {
      asking({ required: false });

      await openDialog();

      expect(screen.queryByLabelText(/number composition/i)).not.toBeInTheDocument();
    });
  });

  it('is hidden unless BOTH asset:create and asset-unit:create are held (DEC-010)', async () => {
    signInWith(['contract:read', 'contract-item:read', 'asset:create']);
    renderScreen(<ContractDetailPage />, { path: '/:id', route: '/con-1' });
    await screen.findByRole('heading', { name: 'SPK/2026/001' });
    await userEvent.click(screen.getByRole('tab', { name: 'Line items' }));
    await screen.findByText('Komputer Desktop');

    expect(screen.queryByRole('button', { name: /add asset/i })).not.toBeInTheDocument();
  });
});
