import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import { visibleNavigation } from '@/navigation';
import { renderScreen, signInWith } from '@/test/harness';
import { RequestsPage } from './RequestsPage';
import { RequestFormPage } from './RequestFormPage';
import { RequestDetailPage } from './RequestDetailPage';

/**
 * Request drafting screens — Phase 37 (`CR-014`), `07-ui.md` §5.10,
 * REQ-REQUEST-002 – REQ-REQUEST-006, REQ-REQUEST-015.
 */

const REQUESTER = [
  'request:read',
  'request:create',
  'request:update',
  'request-item:create',
  'request-item:update',
  'request-item:delete',
];

const TKJ = { id: 'dept-tkj', code: 'TKJ', name: 'Teknik Komputer' };
const ME = { id: 'user-1', username: 'tester', firstName: 'Test', lastName: 'User' };

const ALL_CATEGORIES = ['COMMON', 'JURUSAN', 'KBM', 'EKSKUL'];

const categories = (typical, configured = [], eligible = ALL_CATEGORIES) =>
  ALL_CATEGORIES.map((category) => ({
    category,
    typical: typical.includes(category),
    processConfigured: configured.includes(category),
    departmentRequired: category === 'JURUSAN',
    eligible: eligible.includes(category),
  }));

const COMMON_CONTEXT = {
  assignmentId: 'pa-common',
  institutionId: 'inst-1',
  positionCode: 'COMMON_TEACHER',
  department: null,
  departmentRule: 'OPTIONAL',
  typicalCategories: ['COMMON', 'KBM', 'EKSKUL'],
  // The server's enforced rule (P2, §64.2): never JURUSAN.
  categories: categories(['COMMON', 'KBM', 'EKSKUL'], ['COMMON'], ['COMMON', 'KBM', 'EKSKUL']),
  defaultDestinations: [{ id: 'loc-lab', name: 'Lab Komputer' }],
};

/** A context that may request every category; JURUSAN is merely not typical. */
const KEPALA_CONTEXT = {
  assignmentId: 'pa-kepala',
  institutionId: 'inst-1',
  positionCode: 'KEPALA_SEKOLAH',
  department: null,
  departmentRule: 'OPTIONAL',
  typicalCategories: ['COMMON', 'KBM', 'EKSKUL'],
  categories: categories(['COMMON', 'KBM', 'EKSKUL'], ['COMMON']),
  defaultDestinations: [],
};

const JURUSAN_CONTEXT = {
  assignmentId: 'pa-jurusan',
  institutionId: 'inst-1',
  positionCode: 'JURUSAN_TEACHER',
  department: TKJ,
  departmentRule: 'LOCKED',
  typicalCategories: ['COMMON', 'JURUSAN'],
  // The server's enforced rule (UAT decision, 2026-09-28): COMMON and JURUSAN only.
  categories: categories(['COMMON', 'JURUSAN'], [], ['COMMON', 'JURUSAN']),
  defaultDestinations: [],
};

const request = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  requestNumber: 'REQ/2026/0001',
  category: 'COMMON',
  title: 'Proyektor kelas',
  justification: null,
  status: 'DRAFT',
  requesterUserId: ME.id,
  requester: ME,
  requesterAssignmentId: 'pa-common',
  requesterAssignmentCurrent: true,
  requesterPositionCode: 'COMMON_TEACHER',
  requesterDepartmentId: null,
  requesterDepartment: null,
  departmentId: null,
  department: null,
  destinationLocationId: null,
  destination: null,
  neededBy: null,
  workflowDefinitionId: null,
  createdAt: '2026-09-25T02:00:00.000Z',
  updatedAt: '2026-09-25T02:00:00.000Z',
  items: [],
  ...overrides,
});

const item = (overrides = {}) => ({
  id: 'item-1',
  requestId: 'req-1',
  lineNo: 1,
  description: 'Proyektor',
  specification: null,
  quantityRequested: 2,
  quantityCancelled: 0,
  quantityRequired: 2,
  measurementUnitId: null,
  measurementUnit: null,
  estimatedUnitPrice: null,
  classificationId: null,
  classification: null,
  ...overrides,
});

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: rows.length ? 1 : 0 },
});

beforeEach(() => {
  signInWith(REQUESTER, { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('navigation', () => {
  const requestsGroup = (permissions) =>
    visibleNavigation(new Set(permissions)).find((g) => g.labelKey === 'nav.groups.requests');

  it('shows My requests, Needs my action and Updates with request:read, and All requests only with request:oversee', () => {
    expect(requestsGroup(['request:read']).items.map((i) => i.to)).toEqual([
      '/requests',
      '/requests/awaiting',
      '/requests/updates',
    ]);
    expect(requestsGroup(['request:read', 'request:oversee']).items.map((i) => i.to)).toEqual([
      '/requests',
      '/requests/awaiting',
      '/requests/updates',
      '/requests/all',
    ]);
  });

  it('hides the group from a caller without the codes — as for a PIC-scoped user', () => {
    expect(requestsGroup(['asset-unit:read', 'borrowing:read'])).toBeUndefined();
  });
});

describe('the list', () => {
  it('lists the caller’s own requests with their context and status', async () => {
    const list = vi
      .spyOn(requestsApi, 'list')
      .mockResolvedValue(
        page([request({ requesterPositionCode: 'JURUSAN_TEACHER', requesterDepartment: TKJ })])
      );

    renderScreen(<RequestsPage />);

    expect(await screen.findByRole('link', { name: 'REQ/2026/0001' })).toHaveAttribute(
      'href',
      '/requests/req-1'
    );
    expect(screen.getByText('Teacher — Jurusan Teknik Komputer')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ mine: 'true' }));
  });

  it('asks for everything the caller may see on All requests', async () => {
    const list = vi.spyOn(requestsApi, 'list').mockResolvedValue(page([]));

    renderScreen(<RequestsPage scope="all" />);

    expect(await screen.findByText('No requests')).toBeInTheDocument();
    expect(list.mock.calls[0][0]).not.toHaveProperty('mine');
  });
});

describe('the form — a new draft', () => {
  function renderNew() {
    return renderScreen(<RequestFormPage />, {
      route: '/requests/new',
      path: '/requests/new',
      extraRoutes: [{ path: '/requests/:id/edit', element: <p>edit page</p> }],
    });
  }

  it('hides the context choice when there is only one, and pre-fills the destination', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [COMMON_CONTEXT] });
    const create = vi.spyOn(requestsApi, 'create').mockResolvedValue(request());
    const user = userEvent.setup();

    renderNew();

    expect(await screen.findByText('Teacher — common subjects')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Requested as/ })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Title/), 'Proyektor kelas');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        requesterAssignmentId: 'pa-common',
        category: 'COMMON',
        title: 'Proyektor kelas',
        justification: null,
        destinationLocationId: 'loc-lab',
        neededBy: null,
        departmentId: null,
      })
    );
    expect(await screen.findByText('edit page')).toBeInTheDocument();
  });

  it('offers a teacher of common subjects COMMON, KBM and EKSKUL — never JURUSAN (P2)', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [COMMON_CONTEXT] });

    renderNew();

    const select = await screen.findByRole('combobox', { name: /Category/ });
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => o.value)).toEqual(['COMMON', 'KBM', 'EKSKUL']);
    expect(options.every((o) => !o.disabled)).toBe(true);
  });

  it('lists typical categories first and keeps every eligible category selectable', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [KEPALA_CONTEXT] });

    renderNew();

    const select = await screen.findByRole('combobox', { name: /Category/ });
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => o.value)).toEqual(['COMMON', 'KBM', 'EKSKUL', 'JURUSAN']);
    expect(options.every((o) => !o.disabled)).toBe(true);
  });

  it('notes an eligible but unusual category without blocking it', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [KEPALA_CONTEXT] });
    const user = userEvent.setup();

    renderNew();

    await user.selectOptions(await screen.findByRole('combobox', { name: /Category/ }), 'JURUSAN');
    expect(screen.getByText(/not typical for/)).toBeInTheDocument();
  });

  it('warns — without blocking — when no process is configured', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [COMMON_CONTEXT] });
    const create = vi.spyOn(requestsApi, 'create').mockResolvedValue(request());
    const user = userEvent.setup();

    renderNew();

    const select = await screen.findByRole('combobox', { name: /Category/ });
    expect(screen.queryByText(/No process is currently configured/)).not.toBeInTheDocument();

    await user.selectOptions(select, 'KBM');
    expect(
      screen.getByText(
        'No process is currently configured for this category. You can save this as a draft, but it cannot be submitted yet.'
      )
    ).toBeInTheDocument();

    await user.selectOptions(select, 'KBM');
    await user.type(screen.getByLabelText(/Title/), 'Alat peraga');
    const save = screen.getByRole('button', { name: 'Save draft' });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ category: 'KBM' }))
    );
  });

  it('offers a Jurusan teacher only COMMON and JURUSAN, and moves off KBM on switching', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({
      contexts: [COMMON_CONTEXT, JURUSAN_CONTEXT],
    });
    const user = userEvent.setup();

    renderNew();

    const category = await screen.findByRole('combobox', { name: /Category/ });
    // A teacher of common subjects: never JURUSAN (P2, §64.2).
    expect(
      within(category)
        .getAllByRole('option')
        .map((o) => o.value)
    ).toEqual(['COMMON', 'KBM', 'EKSKUL']);
    await user.selectOptions(category, 'KBM');

    await user.selectOptions(screen.getByRole('combobox', { name: /Requested as/ }), 'pa-jurusan');

    const narrowed = screen.getByRole('combobox', { name: /Category/ });
    expect(
      within(narrowed)
        .getAllByRole('option')
        .map((o) => o.value)
    ).toEqual(['COMMON', 'JURUSAN']);
    await waitFor(() => expect(narrowed).toHaveValue('COMMON'));
  });

  it('offers the context choice with several, and locks a department-bound context’s department', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({
      contexts: [COMMON_CONTEXT, JURUSAN_CONTEXT],
    });
    const create = vi.spyOn(requestsApi, 'create').mockResolvedValue(request());
    const user = userEvent.setup();

    renderNew();

    const context = await screen.findByRole('combobox', { name: /Requested as/ });
    await user.selectOptions(context, 'pa-jurusan');

    expect(screen.getByText('Teknik Komputer')).toBeInTheDocument();
    expect(screen.getByText(/Fixed by the capacity/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Department/ })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Title/), 'Router');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ requesterAssignmentId: 'pa-jurusan' });
    expect(create.mock.calls[0][0]).not.toHaveProperty('departmentId');
  });

  it('explains when the caller holds no school position', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [] });

    renderNew();

    expect(await screen.findByText('You hold no school position')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });
});

describe('the form — editing a draft and its items', () => {
  function renderEdit(data) {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [COMMON_CONTEXT] });
    vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
    return renderScreen(<RequestFormPage />, {
      route: `/requests/${data.id}/edit`,
      path: '/requests/:id/edit',
    });
  }

  /**
   * UAT, 2026-09-28: the draft is completed in one place — information, items
   * AND documents — straight after it is created, without a refresh or a detour
   * to the request page. Upload follows the server's flag, as there.
   */
  it('shows the draft’s documents on the edit page, with upload where the server allows it', async () => {
    signInWith([...REQUESTER, 'request-document:read', 'request-document:create'], {
      id: ME.id,
      institutionId: 'inst-1',
      isSystemWide: false,
    });
    vi.spyOn(requestsApi, 'listDocuments').mockResolvedValue([]);
    renderEdit(request({ actions: { uploadDocument: true } }));

    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument();
  });

  it('offers no upload on the edit page when the server says no', async () => {
    signInWith([...REQUESTER, 'request-document:read'], {
      id: ME.id,
      institutionId: 'inst-1',
      isSystemWide: false,
    });
    vi.spyOn(requestsApi, 'listDocuments').mockResolvedValue([]);
    renderEdit(request({ actions: { uploadDocument: false } }));

    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload document' })).not.toBeInTheDocument();
  });

  /**
   * P1 (§64): Submit on the edit page, held back by the server's blockers —
   * the requester's as a checklist, an administrator's apart.
   */
  const DRAFT_ACTIONS = { edit: true, submit: true, discard: true, uploadDocument: false };
  const NO_ITEMS = {
    code: 'NO_ITEMS',
    field: 'items',
    message: 'A request needs at least one item',
    fixedBy: 'REQUESTER',
  };
  const NO_WORKFLOW = {
    code: 'NO_WORKFLOW',
    field: 'category',
    message: 'No process is configured for this request',
    fixedBy: 'ADMINISTRATOR',
  };

  it('offers Submit on the edit page, enabled once nothing blocks it, and submits from there', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [COMMON_CONTEXT] });
    vi.spyOn(requestsApi, 'get').mockResolvedValue(
      request({ items: [item()], actions: DRAFT_ACTIONS, submitBlockers: [] })
    );
    const submit = vi
      .spyOn(requestsApi, 'submit')
      .mockResolvedValue(request({ status: 'SUBMITTED', actions: {} }));
    const { router } = renderScreen(<RequestFormPage />, {
      route: '/requests/req-1/edit',
      path: '/requests/:id/edit',
      // Where a successful submission lands.
      extraRoutes: [{ path: '/requests/:id', element: <p>request page</p> }],
    });
    const user = userEvent.setup();

    const section = await screen.findByTestId('submit-section');
    expect(within(section).getByText(/Ready to submit/)).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Submit' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Submit' })
    );

    await waitFor(() => expect(submit).toHaveBeenCalledWith('req-1'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/requests/req-1'));
  });

  it('disables Submit with a checklist when there is no item', async () => {
    renderEdit(request({ actions: DRAFT_ACTIONS, submitBlockers: [NO_ITEMS] }));

    const section = await screen.findByTestId('submit-section');
    expect(within(section).getByText('Can’t submit yet')).toBeInTheDocument();
    expect(within(section).getByText('Add at least one item.')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('shows a missing workflow as the administrator’s, apart from the requester’s checklist', async () => {
    renderEdit(request({ items: [item()], actions: DRAFT_ACTIONS, submitBlockers: [NO_WORKFLOW] }));

    const section = await screen.findByTestId('submit-section');
    expect(within(section).getByText('Administrator action needed')).toBeInTheDocument();
    expect(
      within(section).getByText(/No approval process is configured for Common requests/)
    ).toBeInTheDocument();
    expect(within(section).queryByText('Can’t submit yet')).not.toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('says a category cannot be requested in this capacity', async () => {
    renderEdit(
      request({
        items: [item()],
        category: 'KBM',
        actions: DRAFT_ACTIONS,
        submitBlockers: [
          {
            code: 'CATEGORY_NOT_ELIGIBLE',
            field: 'category',
            message: 'This category cannot be requested in this capacity',
            fixedBy: 'REQUESTER',
          },
        ],
      })
    );

    const section = await screen.findByTestId('submit-section');
    expect(within(section).getByText(/can’t be requested in the capacity/)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('clears the blocker once an item is added, with no refresh', async () => {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [COMMON_CONTEXT] });
    vi.spyOn(requestsApi, 'get')
      .mockResolvedValueOnce(request({ actions: DRAFT_ACTIONS, submitBlockers: [NO_ITEMS] }))
      .mockResolvedValue(request({ items: [item()], actions: DRAFT_ACTIONS, submitBlockers: [] }));
    vi.spyOn(requestsApi, 'addItem').mockResolvedValue(item());
    renderScreen(<RequestFormPage />, {
      route: '/requests/req-1/edit',
      path: '/requests/:id/edit',
    });
    const user = userEvent.setup();

    expect(await screen.findByText('Add at least one item.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Description/), 'Proyektor');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByText('Add at least one item.')).not.toBeInTheDocument()
    );
    expect(
      within(screen.getByTestId('submit-section')).getByRole('button', { name: 'Submit' })
    ).toBeEnabled();
  });

  it('holds Submit back while the form has unsaved changes', async () => {
    renderEdit(request({ items: [item()], actions: DRAFT_ACTIONS, submitBlockers: [] }));
    const user = userEvent.setup();

    const title = await screen.findByLabelText(/Title/);
    await user.type(title, ' baru');

    const section = screen.getByTestId('submit-section');
    expect(within(section).getByText(/Save your changes before submitting/)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('offers no Submit section where the server offers no submit', async () => {
    renderEdit(request({ actions: { ...DRAFT_ACTIONS, submit: false } }));
    await screen.findByRole('button', { name: 'Add item' });
    expect(screen.queryByTestId('submit-section')).not.toBeInTheDocument();
  });

  it('adds an item with a whole-number quantity only (Q1)', async () => {
    renderEdit(request());
    const add = vi.spyOn(requestsApi, 'addItem').mockResolvedValue(item());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Description/), 'Proyektor');
    const quantity = within(dialog).getByLabelText(/Quantity/);
    await user.clear(quantity);
    await user.type(quantity, '1.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText(/whole number/)).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();

    await user.clear(quantity);
    await user.type(quantity, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith('req-1', {
        description: 'Proyektor',
        specification: null,
        // REQ-REQUEST-019: none given.
        referenceUrl: null,
        quantityRequested: 3,
        measurementUnitId: null,
        estimatedUnitPrice: null,
        classificationId: null,
      })
    );
  });

  it('shows requested, cancelled and required — and no registered or received figure (E5)', async () => {
    renderEdit(request({ items: [item()] }));

    const row = await screen.findByTestId('item-1');
    expect(within(row).getAllByText('2')).toHaveLength(2);
    expect(within(row).getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/Registered/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Received/i)).not.toBeInTheDocument();
  });

  it('removes an item after confirmation', async () => {
    renderEdit(request({ items: [item()] }));
    const remove = vi.spyOn(requestsApi, 'removeItem').mockResolvedValue(undefined);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('item-1'));
  });

  it('says when the context has ended, and still lets the draft be edited (E9)', async () => {
    renderEdit(request({ requesterAssignmentCurrent: false }));

    expect(await screen.findByText(/no longer hold the position/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});

describe('the draft view', () => {
  function renderDetail(data) {
    vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
    return renderScreen(<RequestDetailPage />, {
      route: `/requests/${data.id}`,
      path: '/requests/:id',
    });
  }

  it('shows the header and items, with the actions the server allows', async () => {
    renderDetail(
      request({
        items: [item()],
        department: TKJ,
        steps: [],
        actions: {
          edit: true,
          submit: true,
          discard: true,
          cancel: false,
          changeDestination: false,
        },
      })
    );

    expect(await screen.findByText('REQ/2026/0001 — Proyektor kelas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/requests/req-1/edit'
    );
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument();
  });

  it('offers no Edit on someone else’s request', async () => {
    renderDetail(
      request({
        requesterUserId: 'someone-else',
        status: 'SUBMITTED',
        steps: [],
        actions: {
          edit: false,
          submit: false,
          discard: false,
          cancel: false,
          changeDestination: false,
        },
      })
    );

    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });
});
