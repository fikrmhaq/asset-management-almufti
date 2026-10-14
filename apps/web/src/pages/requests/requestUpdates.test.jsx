import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import { requestsApi } from '@/api/requests';
import { changeLanguage, t } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { Sidebar } from '@/components/shell/Sidebar';
import { RequestsPage } from './RequestsPage';
import { RequestDetailPage } from './RequestDetailPage';
import { updateText } from './updateText';

/**
 * Request Updates on screen — P6 (`IMPLEMENTATION_PLAN.md` §64.6),
 * REQ-REQUEST-017. Quiet "Updates • N" apart from the solid "Needs my action";
 * a row says what changed and who did it; the request page lists what happened
 * since the last view and marks that one request seen.
 */

const ME = { id: 'user-1', username: 'guru', firstName: 'Guru', lastName: 'TKJ' };
const KEPALA = { id: 'user-2', username: 'kepsek', firstName: 'Bu', lastName: 'Kepala' };
const SARPRAS = { id: 'user-3', username: 'sarpras', firstName: 'Pak', lastName: 'Sarpras' };
const TKJ = { id: 'dept-tkj', code: 'TKJ', name: 'Teknik Komputer' };

const event = (kind, extra = {}) => ({
  kind,
  at: '2026-09-29T08:00:00.000Z',
  count: 1,
  by: SARPRAS,
  ...extra,
});

const row = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  requestNumber: 'REQ/2026/0004',
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
  updates: { total: 0, events: [] },
  ...overrides,
});

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
});

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

const detail = (overrides = {}) => ({
  ...row(),
  justification: null,
  requesterAssignmentId: 'pa-1',
  requesterAssignmentCurrent: true,
  destinationLocationId: null,
  destination: null,
  neededBy: null,
  items: [],
  steps: [],
  closeEvents: [],
  receiptConfirmations: [],
  actions: NONE,
  actionsNeeded: [],
  unseenUpdates: { since: '2026-09-29T00:00:00.000Z', events: [] },
  ...overrides,
});

beforeEach(() => {
  signInWith(['request:read', 'request:receive'], {
    id: ME.id,
    institutionId: 'inst-1',
    isSystemWide: false,
  });
  vi.spyOn(requestsApi, 'listDocuments').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the navigation (P6)', () => {
  it('shows "Updates • 2" quietly, apart from the solid action count', async () => {
    requestsApi.attention.mockResolvedValue({ actionNeeded: 1, updated: 2 });
    renderScreen(<Sidebar />);

    expect(await screen.findByRole('link', { name: 'Updates (2)' })).toBeInTheDocument();
    expect(screen.getByTestId('nav-count-updates')).toHaveTextContent('• 2');
    expect(screen.getByTestId('nav-count-updates').className).not.toMatch(/bg-primary/);
    expect(screen.getByRole('link', { name: 'Needs my action (1)' })).toBeInTheDocument();
    expect(screen.getByTestId('nav-count-actionsNeeded').className).toMatch(/bg-primary/);
  });

  it('keeps the two counts independent', async () => {
    requestsApi.attention.mockResolvedValue({ actionNeeded: 0, updated: 3 });
    renderScreen(<Sidebar />);
    expect(await screen.findByRole('link', { name: 'Updates (3)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Needs my action' })).toBeInTheDocument();
    expect(screen.queryByTestId('nav-count-actionsNeeded')).not.toBeInTheDocument();
  });
});

describe('the list (P6)', () => {
  it('asks for updated=me, and says what changed and who did it', async () => {
    const list = vi.spyOn(requestsApi, 'list').mockResolvedValue(
      page([
        row({
          updates: {
            total: 3,
            events: [event('UNITS_REGISTERED', { count: 2 }), event('ACQUISITION_DECLARED')],
          },
        }),
      ])
    );
    renderScreen(<RequestsPage scope="updates" />);

    const cell = await screen.findByTestId('updates-req-1');
    expect(cell).toHaveTextContent('2 units registered by Pak Sarpras');
    expect(cell).toHaveTextContent('+2 more');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ updated: 'me' }));
    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument();
  });

  it('keeps an action and an update apart on one row', async () => {
    vi.spyOn(requestsApi, 'list').mockResolvedValue(
      page([
        row({
          actionsNeeded: [{ kind: 'RECEIVE' }],
          updates: { total: 1, events: [event('UNITS_REGISTERED', { count: 1 })] },
        }),
        row({ id: 'req-2', requestNumber: 'REQ/2026/0005' }),
      ])
    );
    renderScreen(<RequestsPage scope="mine" />);

    expect(await screen.findByTestId('actions-needed-req-1')).toHaveTextContent('Record receipt');
    expect(screen.getByTestId('updates-req-1')).toHaveTextContent(
      '1 unit registered by Pak Sarpras'
    );
    expect(screen.getByTestId('updates-req-1')).not.toHaveTextContent('Record receipt');
    expect(screen.getByTestId('updates-req-2')).toHaveTextContent('—');
  });
});

describe('the request page (P6)', () => {
  const render = (data) => {
    const get = vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
    vi.spyOn(requestsApi, 'listItemUnits').mockResolvedValue([]);
    const view = renderScreen(<RequestDetailPage />, {
      route: '/requests/req-1',
      path: '/requests/:id',
    });
    return { get, ...view };
  };

  it('lists what happened since the last view, and marks this request seen once', async () => {
    const { get, queryClient } = render(
      detail({
        department: TKJ,
        unseenUpdates: {
          since: '2026-09-29T00:00:00.000Z',
          events: [
            event('RECEIPT_REVERSED', { count: 1 }),
            event('STEP_DECIDED', { detail: 'APPROVED', extra: 'KAJUR', by: KEPALA }),
          ],
        },
      })
    );

    const box = await screen.findByTestId('since-last-view');
    expect(within(box).getByText('Receipt of 1 unit reversed by Pak Sarpras')).toBeInTheDocument();
    expect(within(box).getByText(/Approved by Bu Kepala as Kajur/)).toBeInTheDocument();
    await waitFor(() => expect(requestsApi.markViewed).toHaveBeenCalledWith('req-1'));

    // Once seen, the server answers with nothing new — the list stays for the visit.
    get.mockResolvedValue(detail({ department: TKJ }));
    await queryClient.invalidateQueries({ queryKey: ['request', 'req-1'] });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('since-last-view')).toBeInTheDocument();
    expect(requestsApi.markViewed).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when nothing is new, and still marks the view', async () => {
    render(detail());
    await screen.findByText(/REQ\/2026\/0004/);
    expect(screen.queryByTestId('since-last-view')).not.toBeInTheDocument();
    await waitFor(() => expect(requestsApi.markViewed).toHaveBeenCalledWith('req-1'));
  });
});

describe('the wording (P6)', () => {
  it('names every kind of update, with who did it', () => {
    const cases = [
      [
        event('STEP_DECIDED', { detail: 'REJECTED', extra: 'KEPALA_SEKOLAH', by: KEPALA }),
        /Rejected by Bu Kepala as/,
      ],
      [event('ACQUISITION_DECLARED'), 'Acquisition completed by Pak Sarpras'],
      [event('REGISTRATION_COMPLETED'), 'Registration completed by Pak Sarpras'],
      [event('UNITS_REGISTERED', { count: 3 }), '3 units registered by Pak Sarpras'],
      [event('RECEIPT_RECORDED', { count: 2, by: ME }), 'Receipt of 2 units recorded by Guru TKJ'],
      [event('RECEIPT_REVERSED', { count: 1 }), 'Receipt of 1 unit reversed by Pak Sarpras'],
      [event('DOCUMENT_ADDED', { detail: 'INVOICE', by: ME }), 'Invoice added by Guru TKJ'],
      [event('REMAINDER_CLOSED', { extra: 'Rusak' }), 'Remainder closed by Pak Sarpras: Rusak'],
      [event('REQUEST_ENDED', { detail: 'CLOSED' }), /^Request closed — by Pak Sarpras$/],
    ];
    for (const [entry, expected] of cases) {
      const text = updateText(t, entry);
      if (expected instanceof RegExp) expect(text).toMatch(expected);
      else expect(text).toBe(expected);
    }
  });

  it('speaks Indonesian', () => {
    changeLanguage('id');
    expect(updateText(t, event('UNITS_REGISTERED', { count: 2 }))).toBe(
      '2 unit didaftarkan oleh Pak Sarpras'
    );
    expect(updateText(t, event('DOCUMENT_ADDED', { detail: 'INVOICE' }))).toBe(
      'Faktur ditambahkan oleh Pak Sarpras'
    );
  });
});
