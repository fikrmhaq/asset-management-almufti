import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '@/api/errors';
import { consumablesApi } from '@/api/consumables';
import { requestsApi } from '@/api/requests';
import { assetUnitsApi } from '@/api/assetCore';
import { lookupApis } from '@/api/reference';
import { visibleNavigation } from '@/navigation';
import { changeLanguage, DEFAULT_LANGUAGE } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { ConsumablesPage } from './ConsumablesPage';
import { ConsumableDetailPage } from './ConsumableDetailPage';
import { RequestFormPage } from '@/pages/requests/RequestFormPage';
import { RequestDetailPage } from '@/pages/requests/RequestDetailPage';
import { AssetUnitsPage } from '@/pages/assets/AssetUnitsPage';
import { UnitLabelsPage } from '@/pages/assets/UnitLabelsPage';

/**
 * Consumables on screen — `IMPLEMENTATION_PLAN.md` §73. The master and its
 * stock (receive, adjust with a reason, the history); a consumable line on the
 * existing request form; issuing against it; and labels for selected units.
 */

const REAM = { id: 'mu-ream', name: 'rim' };
const PAPER = {
  id: 'con-1',
  institutionId: 'inst-1',
  name: 'Kertas A4',
  description: null,
  measurementUnitId: REAM.id,
  measurementUnit: REAM,
  quantityOnHand: 25,
  isActive: true,
};
const ME = { id: 'user-1', username: 'sarpras', firstName: 'Sarpras', lastName: 'Satu' };

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
});

afterEach(async () => {
  vi.restoreAllMocks();
  await changeLanguage(DEFAULT_LANGUAGE);
});

describe('the consumable master and its stock', () => {
  const STOCK = [
    'consumable:read',
    'consumable:create',
    'consumable:update',
    'consumable:deactivate',
    'consumable:manage-stock',
  ];

  it('is in the navigation for consumable:read only', () => {
    const labels = (codes) =>
      visibleNavigation(new Set(codes))
        .flatMap((group) => group.items)
        .map((entry) => entry.labelKey);
    expect(labels(['consumable:read'])).toContain('nav.items.consumables');
    expect(labels(['request:create'])).not.toContain('nav.items.consumables');
  });

  it('lists name, unit, stock on hand and status', async () => {
    signInWith(STOCK, { institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(consumablesApi, 'list').mockResolvedValue(page([PAPER]));
    renderScreen(<ConsumablesPage />);

    expect(await screen.findByText('Kertas A4')).toBeInTheDocument();
    expect(screen.getByText('rim')).toBeInTheDocument();
    expect(screen.getByTestId('on-hand-con-1')).toHaveTextContent('25');
  });

  it('creates one with a name and unit — and asks for no inventory code', async () => {
    signInWith(STOCK, { institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(consumablesApi, 'list').mockResolvedValue(page([]));
    vi.spyOn(lookupApis['measurement-units'], 'list').mockResolvedValue(page([REAM]));
    const create = vi.spyOn(consumablesApi, 'create').mockResolvedValue(PAPER);
    const user = userEvent.setup();
    renderScreen(<ConsumablesPage />, {
      extraRoutes: [{ path: '/consumables/:id', element: <p>detail</p> }],
    });

    await user.click(await screen.findByRole('button', { name: 'New consumable' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText(/inventory code/i)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(create).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Name/), 'Kertas A4');
    await within(dialog).findByRole('option', { name: 'rim' });
    await user.selectOptions(within(dialog).getByLabelText(/Unit of measure/), REAM.id);
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Kertas A4',
        measurementUnitId: REAM.id,
        description: null,
      })
    );
    expect(await screen.findByText('detail')).toBeInTheDocument();
  });

  function renderDetail(permissions = STOCK) {
    signInWith(permissions, { institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(consumablesApi, 'get').mockResolvedValue(PAPER);
    vi.spyOn(consumablesApi, 'movements').mockResolvedValue(
      page([
        {
          id: 'mv-2',
          movementType: 'ISSUE',
          quantity: -8,
          balanceAfter: 17,
          request: { id: 'req-9', requestNumber: 'REQ/2026/0009', lineNo: 1 },
          note: null,
          createdBy: ME,
          createdAt: '2026-10-05T04:00:00.000Z',
        },
        {
          id: 'mv-1',
          movementType: 'RECEIPT',
          quantity: 25,
          balanceAfter: 25,
          request: null,
          note: 'Pembelian toko',
          createdBy: ME,
          createdAt: '2026-10-05T03:00:00.000Z',
        },
      ])
    );
    return renderScreen(<ConsumableDetailPage />, {
      route: '/consumables/con-1',
      path: '/consumables/:id',
    });
  }

  it('shows the stock and its history, each issue linked to its request', async () => {
    renderDetail();

    expect(await screen.findByTestId('on-hand')).toHaveTextContent('25');
    expect(await screen.findByText('Issued')).toBeInTheDocument();
    expect(screen.getByText('-8')).toBeInTheDocument();
    expect(screen.getByText('+25')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request REQ/2026/0009, line 1' })).toHaveAttribute(
      'href',
      '/requests/req-9'
    );
    expect(screen.getByText('Pembelian toko')).toBeInTheDocument();
  });

  it('receives a whole, positive quantity', async () => {
    const receive = vi.spyOn(consumablesApi, 'receive').mockResolvedValue(PAPER);
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Receive stock' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Quantity/), '-3');
    await user.click(within(dialog).getByRole('button', { name: 'Receive stock' }));
    expect(receive).not.toHaveBeenCalled();

    const quantity = within(dialog).getByLabelText(/Quantity/);
    await user.clear(quantity);
    await user.type(quantity, '10');
    await user.click(within(dialog).getByRole('button', { name: 'Receive stock' }));
    await waitFor(() =>
      expect(receive).toHaveBeenCalledWith('con-1', { quantity: 10, note: null })
    );
  });

  it('adjusts only with a reason, either way', async () => {
    const adjust = vi.spyOn(consumablesApi, 'adjust').mockResolvedValue(PAPER);
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Adjust stock' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Quantity/), '-2');
    await user.click(within(dialog).getByRole('button', { name: 'Adjust stock' }));
    expect(await within(dialog).findByText('A reason is required')).toBeInTheDocument();
    expect(adjust).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'Stock opname fisik');
    await user.click(within(dialog).getByRole('button', { name: 'Adjust stock' }));
    await waitFor(() =>
      expect(adjust).toHaveBeenCalledWith('con-1', { quantity: -2, reason: 'Stock opname fisik' })
    );
  });

  it('offers no stock change without consumable:manage-stock', async () => {
    renderDetail(['consumable:read']);

    expect(await screen.findByTestId('on-hand')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive stock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust stock' })).not.toBeInTheDocument();
  });
});

// --- On the existing request ---------------------------------------------------

const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request-item:create',
  'request-item:update',
  'request-item:delete',
];
const COMMON_CONTEXT = {
  assignmentId: 'pa-common',
  institutionId: 'inst-1',
  positionCode: 'COMMON_TEACHER',
  department: null,
  departmentRule: 'OPTIONAL',
  typicalCategories: ['COMMON'],
  categories: [
    {
      category: 'COMMON',
      typical: true,
      processConfigured: true,
      departmentRequired: false,
      eligible: true,
    },
  ],
  defaultDestinations: [],
};
const request = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  requestNumber: 'REQ/2026/0001',
  category: 'COMMON',
  title: 'ATK kelas',
  justification: null,
  status: 'DRAFT',
  requesterUserId: 'user-2',
  requester: { id: 'user-2', username: 'guru', firstName: 'Guru', lastName: 'A' },
  requesterAssignmentId: 'pa-common',
  requesterAssignmentCurrent: true,
  requesterPositionCode: 'COMMON_TEACHER',
  departmentId: null,
  department: null,
  destinationLocationId: null,
  destination: null,
  neededBy: null,
  createdAt: '2026-10-05T02:00:00.000Z',
  updatedAt: '2026-10-05T02:00:00.000Z',
  items: [],
  steps: [],
  actions: { edit: true },
  ...overrides,
});
const paperLine = (overrides = {}) => ({
  id: 'item-1',
  requestId: 'req-1',
  lineNo: 1,
  description: 'Kertas A4',
  specification: null,
  referenceUrl: null,
  quantityRequested: 10,
  quantityCancelled: 0,
  quantityRequired: 10,
  measurementUnitId: REAM.id,
  measurementUnit: REAM,
  estimatedUnitPrice: null,
  classificationId: null,
  classification: null,
  consumableId: PAPER.id,
  consumable: { id: PAPER.id, name: 'Kertas A4', isActive: true },
  quantityIssued: 0,
  quantityNotYetIssued: 10,
  ...overrides,
});

describe('a consumable line on the existing request form', () => {
  it('names a consumable: no description or classification, its unit on the quantity', async () => {
    signInWith(REQUESTER, { id: 'user-2', institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [COMMON_CONTEXT] });
    vi.spyOn(requestsApi, 'get').mockResolvedValue(request());
    vi.spyOn(consumablesApi, 'options').mockResolvedValue([
      { id: PAPER.id, institutionId: 'inst-1', name: 'Kertas A4', measurementUnit: REAM },
    ]);
    const add = vi.spyOn(requestsApi, 'addItem').mockResolvedValue(paperLine());
    const user = userEvent.setup();
    renderScreen(<RequestFormPage />, {
      route: '/requests/req-1/edit',
      path: '/requests/:id/edit',
    });

    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const dialog = screen.getByRole('dialog');
    await user.click(
      await within(dialog).findByRole('radio', { name: 'Consumable (issued from stock)' })
    );
    expect(within(dialog).queryByLabelText(/^Description/)).not.toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Consumable/ }),
      PAPER.id
    );
    expect(within(dialog).getByLabelText('Quantity (rim)*', { exact: false })).toBeInTheDocument();
    const quantity = within(dialog).getByLabelText(/Quantity/);
    await user.clear(quantity);
    await user.type(quantity, '10');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith('req-1', {
        consumableId: PAPER.id,
        specification: null,
        referenceUrl: null,
        quantityRequested: 10,
        estimatedUnitPrice: null,
        classificationId: null,
      })
    );
  });

  it('is edited in a revision like any line: the quantity changes, the line stays', async () => {
    signInWith(REQUESTER, { id: 'user-2', institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [COMMON_CONTEXT] });
    vi.spyOn(requestsApi, 'get').mockResolvedValue(
      request({ status: 'REVISION_REQUESTED', items: [paperLine()] })
    );
    vi.spyOn(consumablesApi, 'options').mockResolvedValue([
      { id: PAPER.id, institutionId: 'inst-1', name: 'Kertas A4', measurementUnit: REAM },
    ]);
    const update = vi.spyOn(requestsApi, 'updateItem').mockResolvedValue(paperLine());
    const user = userEvent.setup();
    renderScreen(<RequestFormPage />, {
      route: '/requests/req-1/edit',
      path: '/requests/:id/edit',
    });

    expect(await screen.findByTestId('item-consumable-1')).toHaveTextContent('Consumable');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    const quantity = within(dialog).getByLabelText(/Quantity/);
    await user.clear(quantity);
    await user.type(quantity, '5');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toBe('item-1');
    expect(update.mock.calls[0][1]).toMatchObject({ consumableId: PAPER.id, quantityRequested: 5 });
    expect(update.mock.calls[0][1]).not.toHaveProperty('description');
  });
});

describe('issuing against the request', () => {
  const approved = (actions = { issue: true }) =>
    request({
      status: 'APPROVED',
      items: [paperLine({ quantityIssued: 2, quantityNotYetIssued: 8 })],
      steps: [
        { id: 's-1', stepType: 'DECIDE', state: 'APPROVED', resolvedActors: [], sequence: 1 },
        { id: 's-3', stepType: 'REGISTER', state: 'CLOSED', resolvedActors: [], sequence: 3 },
      ],
      actions,
    });

  function renderApproved(data, permissions = ['request:read', 'consumable:manage-stock']) {
    signInWith(permissions, { id: 'user-1', institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
    return renderScreen(<RequestDetailPage />, { route: '/requests/req-1', path: '/requests/:id' });
  }

  it('shows what was issued, and issues the actual quantity — never more than remains', async () => {
    const issue = vi.spyOn(requestsApi, 'issue').mockResolvedValue(approved({}));
    const user = userEvent.setup();
    renderApproved(approved());

    expect(await screen.findByTestId('item-issued-1')).toHaveTextContent('2 issued');
    await user.click(screen.getByRole('button', { name: 'Issue consumables' }));
    const dialog = screen.getByRole('dialog');
    const quantity = within(dialog).getByLabelText(/1\. Kertas A4/);
    expect(quantity).toHaveValue(8);

    await user.clear(quantity);
    await user.type(quantity, '9');
    await user.click(within(dialog).getByRole('button', { name: 'Issue' }));
    expect(await within(dialog).findByText('Line 1 needs only 8 more.')).toBeInTheDocument();
    expect(issue).not.toHaveBeenCalled();

    await user.clear(quantity);
    await user.type(quantity, '6');
    await user.click(within(dialog).getByRole('button', { name: 'Issue' }));
    await waitFor(() =>
      expect(issue).toHaveBeenCalledWith('req-1', {
        items: [{ requestItemId: 'item-1', quantity: 6 }],
        note: null,
      })
    );
  });

  // UAT 2026-10-05: "Not enough stock" alone did not say which line was short.
  it('says which consumable is short when the server refuses the issue', async () => {
    vi.spyOn(requestsApi, 'issue').mockRejectedValue(
      new ApiError({
        code: 'CONFLICT',
        status: 409,
        message: 'Not enough stock',
        details: [{ field: 'quantity', issue: 'Kertas A4 has 2 on hand; 8 cannot be taken' }],
      })
    );
    const user = userEvent.setup();
    renderApproved(approved());

    await user.click(await screen.findByRole('button', { name: 'Issue consumables' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Issue' }));

    expect(await within(dialog).findByText('Not enough stock')).toBeInTheDocument();
    expect(within(dialog).getByTestId('issue-refusal')).toHaveTextContent(
      'Kertas A4 has 2 on hand; 8 cannot be taken'
    );
  });

  it('is not offered when the server says no', async () => {
    renderApproved(approved({ issue: false }));

    expect(await screen.findByTestId('item-issued-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue consumables' })).not.toBeInTheDocument();
  });
});

// --- Labels for selected units -------------------------------------------------

describe('labels for selected units', () => {
  const unit = (id, code) => ({
    id,
    assetId: 'asset-1',
    inventoryCode: code,
    asset: { id: 'asset-1', name: 'Laptop' },
    department: null,
    currentLocation: null,
    currentLocationId: null,
    lifecycleState: 'ACTIVE',
    currentCondition: 'GOOD',
    isActive: true,
  });

  it('selects units and opens one sheet for them, in the order picked', async () => {
    signInWith(['asset-unit:read'], { institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(assetUnitsApi, 'list').mockResolvedValue(
      page([unit('u-1', 'INV-1'), unit('u-2', 'INV-2'), unit('u-3', null)])
    );
    const user = userEvent.setup();
    const { router } = renderScreen(<AssetUnitsPage />, {
      route: '/asset-units',
      path: '/asset-units',
      extraRoutes: [{ path: '/asset-units/labels', element: <p>labels</p> }],
    });

    await screen.findByText('INV-1');
    // A unit with no inventory code cannot be labelled, so it has no box.
    expect(screen.queryByRole('checkbox', { name: /Select null/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select INV-2 for printing' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select INV-1 for printing' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Print labels \(2\)/ }));

    expect(await screen.findByText('labels')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?ids=u-2,u-1');
  });

  it('prints each selected unit’s own label from the batch endpoint', async () => {
    signInWith(['asset-unit:read'], { institutionId: 'inst-1', isSystemWide: false });
    const labels = vi.spyOn(assetUnitsApi, 'labels').mockResolvedValue([
      { assetUnitId: 'u-2', inventoryCode: 'INV-2', assetName: 'Laptop' },
      { assetUnitId: 'u-1', inventoryCode: 'INV-1', assetName: 'Laptop' },
    ]);
    renderScreen(<UnitLabelsPage />, {
      route: '/asset-units/labels?ids=u-2,u-1',
      path: '/asset-units/labels',
    });

    expect(await screen.findByLabelText('Label for INV-2')).toBeInTheDocument();
    expect(screen.getByLabelText('Label for INV-1')).toBeInTheDocument();
    expect(labels).toHaveBeenCalledWith(['u-2', 'u-1']);
  });

  it('says so when nothing is selected', async () => {
    signInWith(['asset-unit:read'], { institutionId: 'inst-1', isSystemWide: false });
    const labels = vi.spyOn(assetUnitsApi, 'labels');
    renderScreen(<UnitLabelsPage />, { route: '/asset-units/labels', path: '/asset-units/labels' });

    expect(await screen.findByText('No units selected')).toBeInTheDocument();
    expect(labels).not.toHaveBeenCalled();
  });
});
