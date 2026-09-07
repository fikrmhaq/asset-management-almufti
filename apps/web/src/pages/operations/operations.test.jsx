import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, ERROR_CODES } from '@/api/errors';
import * as operationsApi from '@/api/operations';
import * as assetCoreApi from '@/api/assetCore';
import * as referenceApi from '@/api/reference';
import * as organizationApi from '@/api/organization';
import * as procurementApi from '@/api/procurement';
import { renderScreen, signInWith } from '@/test/harness';
import { availableActions } from './borrowingActions';
import { BorrowingsPage } from './BorrowingsPage';
import { BorrowingFormPage } from './BorrowingFormPage';
import { BorrowingDetailPage } from './BorrowingDetailPage';
import { TransactionsPage } from './TransactionsPage';
import { TransactionFormPage } from './TransactionFormPage';
import { TransactionDetailPage } from './TransactionDetailPage';

/**
 * Operations screens — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §20.
 */

const ALL = [
  'borrowing:read',
  'borrowing:create',
  'borrowing:update',
  'borrowing:activate',
  'borrowing:cancel',
  'borrowing:return',
  'borrowing:extend',
  'borrowing-item:read',
  'borrowing-item:create',
  'borrowing-item:delete',
  'transaction:read',
  'transaction:create',
  'transaction-type:read',
  'institution:read',
  'user:read',
  'supplier:read',
  'contract:read',
  'asset:read',
  'asset-unit:read',
];

const page = (rows, meta = {}) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1, ...meta },
});

/** `Field` appends a required marker to the label's text, so anchor around it. */
const BORROWER_LABEL = /^borrower\s*\*?$/i;

const UNIT = {
  id: 'unit-1111-2222',
  assetId: 'asset-1',
  description: 'Laptop #1',
  lifecycleState: 'ACTIVE',
  currentCondition: 'GOOD',
  isActive: true,
};

const STORED_UNIT = { ...UNIT, id: 'unit-3333-4444', lifecycleState: 'IN_STORAGE' };

const DRAFT = {
  id: 'brw-1',
  borrowerName: 'Andi Wijaya',
  borrowerContact: '0812-1111',
  borrowDate: '2026-08-01',
  expectedReturnDate: '2026-08-20',
  actualReturnDate: null,
  responsiblePersonId: null,
  institutionId: 'inst-1',
  description: null,
  status: 'DRAFT',
  institution: { id: 'inst-1', name: 'Dinas Pendidikan', code: 'DISDIK' },
};

const ACTIVE = { ...DRAFT, status: 'ACTIVE' };
const RETURNED = { ...DRAFT, status: 'RETURNED', actualReturnDate: '2026-08-18' };

const TRANSACTION = {
  id: 'txn-1',
  transactionDate: '2026-08-05',
  transactionTypeId: 4,
  description: 'Perbaikan',
  supplierId: null,
  contractId: null,
  institutionId: 'inst-1',
};

const TRANSACTION_DETAIL = {
  ...TRANSACTION,
  transactionType: { id: 4, name: 'Pemeliharaan' },
  institution: { id: 'inst-1', name: 'Dinas Pendidikan', code: 'DISDIK' },
};

beforeEach(() => {
  signInWith(ALL, { institutionId: 'inst-1' });

  vi.spyOn(operationsApi.borrowingsApi, 'list').mockResolvedValue(page([DRAFT]));
  vi.spyOn(operationsApi.borrowingsApi, 'get').mockResolvedValue(DRAFT);
  vi.spyOn(operationsApi.borrowingsApi, 'listItems').mockResolvedValue(
    page([{ id: 'item-1', borrowingId: 'brw-1', assetUnitId: UNIT.id, assetUnit: UNIT }])
  );
  vi.spyOn(operationsApi.transactionsApi, 'list').mockResolvedValue(page([TRANSACTION]));
  vi.spyOn(operationsApi.transactionsApi, 'get').mockResolvedValue(TRANSACTION_DETAIL);
  vi.spyOn(operationsApi.transactionsApi, 'listItems').mockResolvedValue(
    page([
      { id: 'ti-1', transactionId: 'txn-1', assetUnitId: UNIT.id, notes: 'ok', assetUnit: UNIT },
    ])
  );

  vi.spyOn(assetCoreApi.assetsApi, 'list').mockResolvedValue(
    page([{ id: 'asset-1', name: 'Laptop Dell', classificationId: '117010101001', isActive: true }])
  );
  vi.spyOn(assetCoreApi.assetsApi, 'listUnits').mockResolvedValue(page([UNIT]));

  vi.spyOn(referenceApi.lookupApis['transaction-types'], 'list').mockResolvedValue(
    page([{ id: 4, name: 'Pemeliharaan' }])
  );
  vi.spyOn(organizationApi.institutionsApi, 'list').mockResolvedValue(
    page([{ id: 'inst-1', name: 'Dinas Pendidikan', code: 'DISDIK', isActive: true }])
  );
  vi.spyOn(organizationApi.usersApi, 'list').mockResolvedValue(
    page([{ id: 'user-9', username: 'ratna', firstName: 'Ratna', lastName: 'Sari' }])
  );
  vi.spyOn(procurementApi.suppliersApi, 'list').mockResolvedValue(page([]));
  vi.spyOn(procurementApi.contractsApi, 'list').mockResolvedValue(page([]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Picks a real day out of an open `react-day-picker` calendar. */
async function pickDate(triggerName) {
  await userEvent.click(screen.getByRole('button', { name: triggerName }));

  const cells = await screen.findAllByRole('gridcell');
  const day = cells
    .map((cell) => cell.querySelector('button') ?? cell)
    .find((element) => !element.disabled && /^\d+$/.test(element.textContent.trim()));

  await userEvent.click(day);
}

describe('borrowing action visibility (DEC-046, §20.4)', () => {
  it('offers activate and cancel on a DRAFT', () => {
    expect(availableActions('DRAFT').map((action) => action.key)).toEqual(['activate', 'cancel']);
  });

  it('offers return and extend while the units are held', () => {
    expect(availableActions('ACTIVE').map((action) => action.key)).toEqual(['return', 'extend']);
    expect(availableActions('OVERDUE').map((action) => action.key)).toEqual(['return', 'extend']);
  });

  it('offers nothing in a terminal state', () => {
    expect(availableActions('RETURNED')).toEqual([]);
    expect(availableActions('CANCELLED')).toEqual([]);
  });

  it('never offers a way to reach OVERDUE — the sweep writes it', () => {
    for (const status of ['DRAFT', 'ACTIVE', 'OVERDUE', 'RETURNED', 'CANCELLED']) {
      expect(availableActions(status).map((action) => action.key)).not.toContain('overdue');
    }
  });
});

describe('BorrowingsPage', () => {
  it('lists borrowings with dates and status', async () => {
    renderScreen(<BorrowingsPage />);

    expect(await screen.findByText('Andi Wijaya')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('1 Aug 2026')).toBeInTheDocument();
  });

  it('keeps the derived overdue filter separate from status (DEC-043)', async () => {
    renderScreen(<BorrowingsPage />, {
      path: '/operations/borrowings',
      route: '/operations/borrowings?overdue=true',
    });
    await screen.findByText('Andi Wijaya');

    // Two distinct controls, because `overdue` is derived rather than a status.
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Overdue')).toBeInTheDocument();

    expect(operationsApi.borrowingsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: 'true' })
    );
  });

  it('offers no date filters, because the API has none (GAP-011)', async () => {
    renderScreen(<BorrowingsPage />);
    await screen.findByText('Andi Wijaya');

    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  });

  it('hides the create action without borrowing:create (§6)', async () => {
    signInWith(['borrowing:read']);
    renderScreen(<BorrowingsPage />);
    await screen.findByText('Andi Wijaya');

    expect(screen.queryByRole('link', { name: /new borrowing/i })).not.toBeInTheDocument();
  });
});

describe('BorrowingFormPage', () => {
  it('will not submit without the required dates', async () => {
    const create = vi.spyOn(operationsApi.borrowingsApi, 'create');
    renderScreen(<BorrowingFormPage />);

    await userEvent.type(screen.getByLabelText(BORROWER_LABEL), 'Andi');
    await userEvent.type(screen.getByLabelText(/borrower contact/i), '0812');
    await userEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a DRAFT and continues to its detail page', async () => {
    const create = vi
      .spyOn(operationsApi.borrowingsApi, 'create')
      .mockResolvedValue({ ...DRAFT, id: 'brw-new' });

    const { router } = renderScreen(<BorrowingFormPage />, {
      path: '/operations/borrowings/new',
      route: '/operations/borrowings/new',
      extraRoutes: [{ path: '/operations/borrowings/:id', element: <div>detail</div> }],
    });

    await userEvent.type(screen.getByLabelText(BORROWER_LABEL), 'Andi Wijaya');
    await userEvent.type(screen.getByLabelText(/borrower contact/i), '0812-1111');
    await pickDate('Borrow date');
    await pickDate('Expected return');

    await userEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      borrowerName: 'Andi Wijaya',
      borrowerContact: '0812-1111',
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/operations/borrowings/brw-new')
    );
  });
});

describe('BorrowingDetailPage', () => {
  const renderDetail = (route = '/brw-1') =>
    renderScreen(<BorrowingDetailPage />, { path: '/:id', route });

  it('offers activate and cancel on a DRAFT, and nothing else', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Extend' })).not.toBeInTheDocument();
  });

  it('swaps to return and extend once ACTIVE', async () => {
    operationsApi.borrowingsApi.get.mockResolvedValue(ACTIVE);
    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    expect(screen.getByRole('button', { name: 'Record return' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
  });

  it('shows no actions at all on a terminal record (§20.4)', async () => {
    operationsApi.borrowingsApi.get.mockResolvedValue(RETURNED);
    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    for (const name of ['Activate', 'Cancel', 'Record return', 'Extend']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('hides an action the caller cannot perform', async () => {
    signInWith(['borrowing:read', 'borrowing:cancel'], { institutionId: 'inst-1' });
    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('confirms before activating, then calls the endpoint', async () => {
    const activate = vi
      .spyOn(operationsApi.borrowingsApi, 'activate')
      .mockResolvedValue({ ...DRAFT, status: 'ACTIVE' });

    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('moves to BORROWED');
    expect(activate).not.toHaveBeenCalled();

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Activate' })
    );
    await waitFor(() => expect(activate).toHaveBeenCalledWith('brw-1'));
  });

  it('surfaces the state-machine CONFLICT when a unit cannot be borrowed (DEC-013)', async () => {
    vi.spyOn(operationsApi.borrowingsApi, 'activate').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.CONFLICT,
        message: 'A unit in IN_STORAGE cannot move to BORROWED',
        status: 409,
      })
    );

    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Activate' })
    );

    expect(
      await screen.findByText('A unit in IN_STORAGE cannot move to BORROWED')
    ).toBeInTheDocument();
  });

  it('records a return with the date entered', async () => {
    operationsApi.borrowingsApi.get.mockResolvedValue(ACTIVE);
    const record = vi
      .spyOn(operationsApi.borrowingsApi, 'return')
      .mockResolvedValue({ ...ACTIVE, status: 'RETURNED' });

    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    await userEvent.click(screen.getByRole('button', { name: 'Record return' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record return' }));

    await waitFor(() => expect(record).toHaveBeenCalled());
    // The dialog opens pre-filled with today, so a date is always sent.
    expect(record.mock.calls[0][1].actualReturnDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('navigates to the new DRAFT after an extension (DEC-047)', async () => {
    operationsApi.borrowingsApi.get.mockResolvedValue(ACTIVE);
    vi.spyOn(operationsApi.borrowingsApi, 'extend').mockResolvedValue({
      returned: RETURNED,
      borrowing: { ...DRAFT, id: 'brw-next' },
    });

    const { router } = renderScreen(<BorrowingDetailPage />, {
      path: '/operations/borrowings/:id',
      route: '/operations/borrowings/brw-1',
      extraRoutes: [{ path: '/operations/borrowings/brw-next', element: <div>new draft</div> }],
    });
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    await userEvent.click(screen.getByRole('button', { name: 'Extend' }));
    const dialog = screen.getByRole('dialog');
    await pickDate('New expected return');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Extend' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/operations/borrowings/brw-next')
    );
  });

  it('edits the header inline while DRAFT (DEC-042)', async () => {
    const update = vi.spyOn(operationsApi.borrowingsApi, 'update').mockResolvedValue(DRAFT);

    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    const field = screen.getByLabelText(BORROWER_LABEL);
    expect(field).toHaveValue('Andi Wijaya');

    await userEvent.type(field, ' Jr');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'brw-1',
        expect.objectContaining({ borrowerName: 'Andi Wijaya Jr' })
      )
    );
  });

  it('stops offering the edit form once the borrowing is ACTIVE', async () => {
    operationsApi.borrowingsApi.get.mockResolvedValue(ACTIVE);
    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^borrower$/i)).not.toBeInTheDocument();
    // Still displayed, just no longer as an input.
    expect(screen.getAllByText('0812-1111').length).toBeGreaterThan(0);
  });

  it('hides the Units tab without borrowing-item:read (DEC-032)', async () => {
    signInWith(['borrowing:read'], { institutionId: 'inst-1' });
    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    expect(screen.queryByRole('tab', { name: 'Units' })).not.toBeInTheDocument();
    expect(operationsApi.borrowingsApi.listItems).not.toHaveBeenCalled();
  });

  it('derives the timeline from the record itself (DEC-044)', async () => {
    operationsApi.borrowingsApi.get.mockResolvedValue(RETURNED);
    renderDetail();
    await screen.findByRole('heading', { name: 'Andi Wijaya' });

    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('18 Aug 2026')).toBeInTheDocument();
  });
});

describe('Borrowing units (DEC-012, DEC-041)', () => {
  const openUnitsTab = async () => {
    renderScreen(<BorrowingDetailPage />, { path: '/:id', route: '/brw-1' });
    await screen.findByRole('heading', { name: 'Andi Wijaya' });
    await userEvent.click(screen.getByRole('tab', { name: 'Units' }));
    return screen.findByText('Laptop #1');
  };

  it('lists the units the borrowing covers', async () => {
    await openUnitsTab();
    expect(screen.getByText('In use')).toBeInTheDocument();
  });

  it('adds a unit through the asset-first picker', async () => {
    const addItem = vi
      .spyOn(operationsApi.borrowingsApi, 'addItem')
      .mockResolvedValue({ id: 'item-2' });

    assetCoreApi.assetsApi.listUnits.mockResolvedValue(
      page([{ ...UNIT, id: 'unit-9999-0000', description: 'Laptop #2' }])
    );

    await openUnitsTab();
    await userEvent.click(screen.getByRole('button', { name: /add unit/i }));

    // Step 1: the asset. Step 2: its units — there is no global unit list.
    await userEvent.click(await screen.findByRole('button', { name: /Laptop Dell/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Laptop #2/ }));

    await waitFor(() => expect(addItem).toHaveBeenCalledWith('brw-1', 'unit-9999-0000'));
    expect(assetCoreApi.assetsApi.listUnits).toHaveBeenCalledWith(
      'asset-1',
      expect.objectContaining({ lifecycleState: 'ACTIVE' })
    );
  });

  it('refuses a unit that cannot be borrowed, in the picker (DEC-013)', async () => {
    assetCoreApi.assetsApi.listUnits.mockResolvedValue(page([STORED_UNIT]));

    await openUnitsTab();
    await userEvent.click(screen.getByRole('button', { name: /add unit/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Laptop Dell/ }));
    await userEvent.click(screen.getByLabelText(/only units that can be borrowed/i));

    const option = await screen.findByRole('button', { name: /In storage/ });
    expect(option).toBeDisabled();
    expect(option).toHaveTextContent('Only an ACTIVE unit can be borrowed');
  });

  it('offers no add or remove once the composition is fixed (DEC-012)', async () => {
    operationsApi.borrowingsApi.get.mockResolvedValue(ACTIVE);

    renderScreen(<BorrowingDetailPage />, { path: '/:id', route: '/brw-1' });
    await screen.findByRole('heading', { name: 'Andi Wijaya' });
    await userEvent.click(screen.getByRole('tab', { name: 'Units' }));
    await screen.findByText('Laptop #1');

    expect(screen.queryByRole('button', { name: /add unit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

describe('TransactionsPage', () => {
  it('resolves the type name and offers a real date range', async () => {
    renderScreen(<TransactionsPage />);

    expect(await screen.findByText('Perbaikan')).toBeInTheDocument();
    expect(screen.getByText('Pemeliharaan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Any start date' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Any end date' })).toBeInTheDocument();
  });

  it('writes the date range into the URL', async () => {
    const { router } = renderScreen(<TransactionsPage />);
    await screen.findByText('Perbaikan');

    await pickDate('Any start date');

    await waitFor(() => expect(router.state.location.search).toContain('dateFrom='));
  });
});

describe('TransactionFormPage', () => {
  it('always offers supplier and contract, with the reason (DEC-045, GAP-009)', async () => {
    renderScreen(<TransactionFormPage />);

    expect(await screen.findByLabelText(/^supplier/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^contract/i)).toBeInTheDocument();
    expect(screen.getAllByText(/procurement-originated/i).length).toBeGreaterThan(0);
  });

  it('refuses to submit with no units (REQ-TXN-004)', async () => {
    const create = vi.spyOn(operationsApi.transactionsApi, 'create');
    renderScreen(<TransactionFormPage />);

    await pickDate('Transaction date');
    await userEvent.selectOptions(screen.getByLabelText(/^type/i), '4');
    await userEvent.click(screen.getByRole('button', { name: /create transaction/i }));

    expect(await screen.findByText('add at least one asset unit')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('posts the header and its items in one call (DEC-016)', async () => {
    const create = vi
      .spyOn(operationsApi.transactionsApi, 'create')
      .mockResolvedValue({ ...TRANSACTION, id: 'txn-new' });

    const { router } = renderScreen(<TransactionFormPage />, {
      path: '/operations/transactions/new',
      route: '/operations/transactions/new',
      extraRoutes: [{ path: '/operations/transactions/:id', element: <div>detail</div> }],
    });

    await pickDate('Transaction date');
    await userEvent.selectOptions(screen.getByLabelText(/^type/i), '4');

    await userEvent.click(screen.getByRole('button', { name: /add units/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Laptop Dell/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Laptop #1/ }));
    await userEvent.click(screen.getByRole('button', { name: /add 1 unit/i }));

    await userEvent.type(await screen.findByLabelText(/note for unit/i), 'servis');
    await userEvent.click(screen.getByRole('button', { name: /create transaction/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      transactionTypeId: 4,
      items: [{ assetUnitId: UNIT.id, notes: 'servis' }],
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/operations/transactions/txn-new')
    );
  });

  it('lets a transaction name a unit in any lifecycle state', async () => {
    assetCoreApi.assetsApi.listUnits.mockResolvedValue(page([STORED_UNIT]));
    renderScreen(<TransactionFormPage />);

    await userEvent.click(screen.getByRole('button', { name: /add units/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Laptop Dell/ }));

    const option = await screen.findByRole('button', { name: /In storage/ });
    expect(option).toBeEnabled();
    // No borrowable filter is offered here at all.
    expect(screen.queryByLabelText(/only units that can be borrowed/i)).not.toBeInTheDocument();
  });
});

describe('TransactionDetailPage', () => {
  it('shows the record and its units', async () => {
    renderScreen(<TransactionDetailPage />, { path: '/:id', route: '/txn-1' });

    expect(await screen.findByRole('heading', { name: 'Pemeliharaan' })).toBeInTheDocument();
    expect(screen.getByText('Perbaikan')).toBeInTheDocument();
    expect(await screen.findByText('Laptop #1')).toBeInTheDocument();
  });

  it('exposes no way to change it (REQ-TXN-007)', async () => {
    renderScreen(<TransactionDetailPage />, { path: '/:id', route: '/txn-1' });
    await screen.findByRole('heading', { name: 'Pemeliharaan' });

    for (const name of [/edit/i, /delete/i, /deactivate/i, /save/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });
});
