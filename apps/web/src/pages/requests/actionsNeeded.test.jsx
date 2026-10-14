import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import { changeLanguage } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { Sidebar } from '@/components/shell/Sidebar';
import { RequestsPage } from './RequestsPage';
import { RequestDetailPage } from './RequestDetailPage';

/**
 * Action Needed on screen — P5 (`IMPLEMENTATION_PLAN.md` §64.5),
 * REQ-REQUEST-016. The server decides every action (`actionsNeeded`); the
 * screens name it: "Needs my action (N)" in the navigation, a chip per row, a
 * banner on the request with the page's own control.
 */

const ME = { id: 'user-1', username: 'guru', firstName: 'Guru', lastName: 'TKJ' };
const NONE = {
  edit: false,
  submit: false,
  discard: false,
  cancel: false,
  changeDestination: false,
  uploadDocument: false,
  receive: false,
  close: false,
};

const row = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  requestNumber: 'REQ/2026/0005',
  category: 'COMMON',
  title: 'Kursi',
  status: 'APPROVED',
  requesterUserId: ME.id,
  requester: ME,
  requesterPositionCode: 'COMMON_TEACHER',
  requesterDepartment: null,
  department: null,
  itemCount: 1,
  quantityRequired: 2,
  quantityReceived: 0,
  createdAt: '2026-09-28T00:00:00.000Z',
  actionsNeeded: [],
  ...overrides,
});

const page = (rows, total = rows.length) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total, totalPages: 1 },
});

const detail = (overrides = {}) => ({
  ...row(),
  justification: null,
  requesterAssignmentId: 'pa-1',
  requesterAssignmentCurrent: true,
  destinationLocationId: null,
  destination: null,
  neededBy: null,
  items: [
    {
      id: 'item-1',
      requestId: 'req-1',
      lineNo: 1,
      description: 'Kursi',
      quantityRequested: 2,
      quantityCancelled: 0,
      quantityRequired: 2,
      quantityRegistered: 2,
      quantityReceived: 0,
      quantityPending: 2,
      quantityBlocked: 0,
      quantityCancellableByClose: 0,
      quantityCancellableBlocked: 0,
    },
  ],
  steps: [],
  closeEvents: [],
  receiptConfirmations: [],
  actions: NONE,
  ...overrides,
});

beforeEach(() => {
  signInWith(['request:read', 'request:receive', 'request:submit'], {
    id: ME.id,
    institutionId: 'inst-1',
    isSystemWide: false,
  });
  vi.spyOn(requestsApi, 'listDocuments').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the navigation count (P5)', () => {
  it('reads "Needs my action (3)" from the attention count', async () => {
    const attention = requestsApi.attention.mockResolvedValue({ actionNeeded: 3, updated: 0 });
    renderScreen(<Sidebar />);

    expect(await screen.findByRole('link', { name: 'Needs my action (3)' })).toBeInTheDocument();
    expect(screen.getByTestId('nav-count-actionsNeeded')).toHaveTextContent('3');
    expect(attention).toHaveBeenCalled();
  });

  it('shows no count when nothing needs the caller', async () => {
    renderScreen(<Sidebar />);

    expect(await screen.findByRole('link', { name: 'Needs my action' })).toBeInTheDocument();
    expect(screen.queryByTestId('nav-count-actionsNeeded')).not.toBeInTheDocument();
  });
});

describe('the list chips (P5)', () => {
  it('names each needed action, and says when a draft cannot be submitted yet', async () => {
    vi.spyOn(requestsApi, 'list').mockResolvedValue(
      page([
        row({ id: 'a', actionsNeeded: [{ kind: 'RECEIVE' }] }),
        row({
          id: 'b',
          requestNumber: 'REQ/2026/0006',
          status: 'DRAFT',
          actionsNeeded: [{ kind: 'SUBMIT', blocked: true }],
        }),
        row({ id: 'c', requestNumber: 'REQ/2026/0007', actionsNeeded: [] }),
        row({
          id: 'd',
          requestNumber: 'REQ/2026/0008',
          actionsNeeded: [{ kind: 'REGISTER', stepId: 's' }, { kind: 'CLOSE' }],
        }),
      ])
    );
    renderScreen(<RequestsPage scope="awaiting" />);

    expect(await screen.findByTestId('actions-needed-a')).toHaveTextContent('Record receipt');
    expect(screen.getByTestId('actions-needed-b')).toHaveTextContent('Submit draft');
    expect(screen.getByTestId('actions-needed-b')).toHaveTextContent("Can't submit yet");
    expect(screen.getByTestId('actions-needed-c')).toHaveTextContent('—');
    expect(screen.getByTestId('actions-needed-d')).toHaveTextContent('Register units');
    expect(screen.getByTestId('actions-needed-d')).toHaveTextContent('Close remainder');
  });

  it('labels every kind, in Indonesian too', async () => {
    const all = ['SUBMIT', 'DECIDE', 'PROCURE', 'REGISTER', 'RECEIVE', 'CLOSE'].map((kind) => ({
      kind,
    }));
    vi.spyOn(requestsApi, 'list').mockResolvedValue(page([row({ actionsNeeded: all })]));
    const { unmount } = renderScreen(<RequestsPage scope="awaiting" />);
    const cell = await screen.findByTestId('actions-needed-req-1');
    for (const label of [
      'Submit draft',
      'Approve',
      'Declare acquisition',
      'Register units',
      'Record receipt',
      'Close remainder',
    ]) {
      expect(cell).toHaveTextContent(label);
    }
    expect(screen.getByText('Needs my action')).toBeInTheDocument();
    unmount();

    changeLanguage('id');
    renderScreen(<RequestsPage scope="awaiting" />);
    const cellId = await screen.findByTestId('actions-needed-req-1');
    for (const label of ['Ajukan draf', 'Setujui', 'Catat penerimaan', 'Tutup sisa']) {
      expect(cellId).toHaveTextContent(label);
    }
    expect(screen.getByText('Perlu tindakan saya')).toBeInTheDocument();
  });
});

describe('the request banner (P5)', () => {
  const renderDetail = (data) => {
    vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
    vi.spyOn(requestsApi, 'listItemUnits').mockResolvedValue([]);
    renderScreen(<RequestDetailPage />, { route: '/requests/req-1', path: '/requests/:id' });
  };

  it('offers Record receipt with the page’s own dialog', async () => {
    renderDetail(
      detail({ actions: { ...NONE, receive: true }, actionsNeeded: [{ kind: 'RECEIVE' }] })
    );
    const banner = await screen.findByTestId('action-needed-banner');
    await userEvent.click(within(banner).getByRole('button', { name: 'Record receipt' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows a blocked Submit draft, disabled, pointing at what is missing', async () => {
    renderDetail(
      detail({
        status: 'DRAFT',
        actions: { ...NONE, submit: true, edit: true },
        submitBlockers: [
          {
            code: 'NO_ITEMS',
            field: 'items',
            message: 'Add at least one item',
            fixedBy: 'REQUESTER',
          },
        ],
        actionsNeeded: [{ kind: 'SUBMIT', blocked: true }],
      })
    );
    const banner = await screen.findByTestId('action-needed-banner');
    expect(within(banner).getByRole('button', { name: 'Submit draft' })).toBeDisabled();
    expect(within(banner).getByText(/Can't submit yet/)).toBeInTheDocument();
  });

  it('takes a step’s actor to the step instead of acting for them', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderDetail(
      detail({
        status: 'SUBMITTED',
        steps: [
          {
            id: 'step-1',
            sequence: 1,
            stepType: 'DECIDE',
            actorPositionCode: 'KEPALA_SEKOLAH',
            state: 'ACTIVE',
            resolvedActors: [{ userId: ME.id, name: 'Guru TKJ' }],
            vacant: false,
            canAct: true,
          },
        ],
        actionsNeeded: [{ kind: 'DECIDE', stepId: 'step-1' }],
      })
    );
    const banner = await screen.findByTestId('action-needed-banner');
    expect(within(banner).getByText('Approve')).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole('button', { name: 'Go there' }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(document.getElementById('request-step-step-1')).not.toBeNull();
  });

  it('is absent when nothing is needed, even with possible actions', async () => {
    renderDetail(detail({ actions: { ...NONE, changeDestination: true, close: true } }));
    await screen.findByText(/REQ\/2026\/0005/);
    expect(screen.queryByTestId('action-needed-banner')).not.toBeInTheDocument();
  });
});
