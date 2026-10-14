import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';

import { requestsApi } from '@/api/requests';
import { renderScreen, signInWith } from '@/test/harness';
import { RequestDetailPage } from './RequestDetailPage';
import { RequestsPage } from './RequestsPage';

/**
 * Receipt, reversal and closing the remainder — Phase 41 (`CR-014` §5.5, §7.4),
 * `07-ui.md` §5.10. Every action follows the server's flags: `actions.receive`,
 * `actions.close`, and each link's `canReverse`. Receipt is never worded as
 * arrival. Placement at receipt (REQ-REQUEST-024) is `receiptPlacement.test.jsx`.
 */

const ME = { id: 'user-1', username: 'guru', firstName: 'Guru', lastName: 'Umum' };
const OVERSEER = { id: 'user-2', firstName: 'Rina', lastName: 'Sarpras' };

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

const registerStep = {
  id: 'step-r',
  sequence: 2,
  stepType: 'REGISTER',
  actorPositionCode: 'WAKASEK_KESISWAAN',
  procurementMode: null,
  skipIfRequesterIsActor: false,
  state: 'DONE',
  skipReason: null,
  comment: null,
  activatedAt: '2026-09-25T00:00:00.000Z',
  completedAt: '2026-09-25T00:00:00.000Z',
  actedByUserId: 'x',
  actedBy: OVERSEER,
  actedAs: { id: 'pa', positionCode: 'WAKASEK_KESISWAAN', department: null },
  resolvedActors: [],
  vacant: false,
  canAct: false,
};

const item = (overrides = {}) => ({
  id: 'item-1',
  requestId: 'req-1',
  lineNo: 1,
  description: 'Kursi',
  specification: null,
  quantityRequested: 3,
  quantityCancelled: 0,
  quantityRequired: 3,
  quantityRegistered: 3,
  quantityNotYetRegistered: 0,
  quantityReceived: 1,
  quantityPending: 1,
  quantityBlocked: 1,
  quantityReceiptNotRecorded: 2,
  quantityNotYetReceived: 2,
  quantityCancellableByClose: 1,
  quantityCancellableUnregistered: 0,
  quantityCancellableBlocked: 1,
  measurementUnit: null,
  estimatedUnitPrice: null,
  classification: null,
  ...overrides,
});

const request = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  requestNumber: 'REQ/2026/0002',
  category: 'COMMON',
  title: 'Kursi',
  justification: null,
  status: 'PARTIALLY_FULFILLED',
  requesterUserId: ME.id,
  requester: ME,
  requesterAssignmentId: 'pa-1',
  requesterAssignmentCurrent: true,
  requesterPositionCode: 'COMMON_TEACHER',
  requesterDepartment: null,
  departmentId: null,
  department: null,
  destinationLocationId: null,
  destination: null,
  neededBy: null,
  workflowDefinitionId: 'wf-1',
  createdAt: '2026-09-20T01:00:00.000Z',
  closedAt: null,
  closeReason: null,
  closeEvents: [],
  items: [item()],
  steps: [registerStep],
  actions: NONE,
  ...overrides,
});

const unit = (code, overrides = {}) => ({
  id: `unit-${code}`,
  inventoryCode: code,
  asset: { id: 'asset-1', name: 'Kursi kerja' },
  department: null,
  currentLocation: null,
  lifecycleState: 'REGISTERED',
  isActive: true,
  ...overrides,
});

const receiptOf = (overrides = {}) => ({
  id: 'rc-1',
  receivedOn: '2026-09-24',
  recordedAt: '2026-09-25T02:00:00.000Z',
  recordedBy: ME,
  note: null,
  reversedAt: null,
  reversedBy: null,
  reversalReason: null,
  ...overrides,
});

const links = () => [
  {
    id: 'l-1',
    requestItemId: 'item-1',
    linkedAt: '2026-09-25T00:00:00.000Z',
    linkedBy: OVERSEER,
    assetUnit: unit('INV-1'),
    canUnlink: false,
    receipt: receiptOf(),
    receipts: [
      receiptOf({
        id: 'rc-0',
        reversedAt: '2026-09-25T01:00:00.000Z',
        reversedBy: OVERSEER,
        reversalReason: 'Salah unit',
      }),
      receiptOf(),
    ],
    receivable: false,
    canReverse: false,
  },
  {
    id: 'l-2',
    requestItemId: 'item-1',
    linkedAt: '2026-09-25T00:00:00.000Z',
    linkedBy: OVERSEER,
    assetUnit: unit('INV-2'),
    canUnlink: false,
    receipt: null,
    receipts: [],
    receivable: true,
    canReverse: false,
  },
  {
    id: 'l-3',
    requestItemId: 'item-1',
    linkedAt: '2026-09-25T00:00:00.000Z',
    linkedBy: OVERSEER,
    assetUnit: unit('INV-3', { lifecycleState: 'DISPOSED' }),
    canUnlink: false,
    receipt: null,
    receipts: [],
    receivable: false,
    canReverse: false,
  },
];

const PERMS = [
  'request:read',
  'request:receive',
  'request:close',
  'request:oversee',
  'request-receipt:reverse',
  'request-item-unit:read',
];

function renderDetail(data, rows = links()) {
  vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
  vi.spyOn(requestsApi, 'listItemUnits').mockResolvedValue(rows);
  renderScreen(<RequestDetailPage />, { route: `/requests/${data.id}`, path: '/requests/:id' });
}

beforeEach(() => {
  signInWith(PERMS, { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('receipt on the request view', () => {
  it('offers "Record receipt" and "Close remainder" only when the server says so', async () => {
    renderDetail(request());
    expect(await screen.findByText('REQ/2026/0002 — Kursi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record receipt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close remainder' })).not.toBeInTheDocument();
  });

  it('shows the receipt figures, each receipt, its reversal history, and never "not arrived"', async () => {
    renderDetail(request());

    expect(
      await screen.findByRole('columnheader', { name: 'Receipt recorded' })
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Not yet received' })).toBeInTheDocument();
    expect(await screen.findByText(/^Receipt recorded — received on/)).toBeInTheDocument();
    expect(screen.getByText(/reversed by Rina Sarpras on .*: Salah unit/)).toBeInTheDocument();
    expect(screen.getByText('Receipt not yet recorded')).toBeInTheDocument();
    expect(screen.getByText('Cannot be received')).toBeInTheDocument();
    expect(screen.queryByText(/not arrived|belum tiba/i)).not.toBeInTheDocument();
  });

  it('warns when registered units can no longer be received', async () => {
    renderDetail(request());
    expect(
      await screen.findByText(/1 registered unit can no longer be received/)
    ).toBeInTheDocument();
  });

  /** The multipart body the dialog sent, as plain values. */
  const sent = (receive) => {
    const formData = receive.mock.calls[0][1];
    return {
      assetUnitIds: formData.getAll('assetUnitIds'),
      receivedOn: formData.get('receivedOn'),
      placement: formData.get('placement'),
      description: formData.get('description'),
      photos: formData.getAll('photos').map((file) => file.name),
    };
  };
  const png = (name = 'bukti.png') => new File(['png'], name, { type: 'image/png' });

  it('records receipt with a description and photos; no placement without an intended place', async () => {
    renderDetail(request({ actions: { ...NONE, receive: true } }));
    const receive = vi.spyOn(requestsApi, 'receive').mockResolvedValue(request());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Record receipt' }));
    const dialog = await screen.findByRole('dialog');
    // The disposed unit is shown but cannot be chosen.
    expect(await within(dialog).findByRole('checkbox', { name: 'INV-3' })).toBeDisabled();
    expect(within(dialog).queryByRole('checkbox', { name: 'INV-1' })).not.toBeInTheDocument();
    // No intended place on this request: placement is not asked (migration 057).
    expect(within(dialog).queryByTestId('receipt-placement')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/no intended place recorded/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Note/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(within(dialog).getByText('Choose at least one unit.')).toBeInTheDocument();
    expect(within(dialog).getByText('A description is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Add at least one photo.')).toBeInTheDocument();
    expect(receive).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('checkbox', { name: /Select every unit/ }));
    await user.type(within(dialog).getByLabelText(/Description/), 'Sudah di ruang guru');
    await user.upload(within(dialog).getByLabelText('Add photos'), [png('a.png'), png('b.png')]);
    expect(within(dialog).getByTestId('receipt-photos')).toHaveTextContent('a.png');
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));

    await waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect(receive.mock.calls[0][0]).toBe('req-1');
    expect(sent(receive)).toEqual({
      assetUnitIds: ['unit-INV-2'],
      receivedOn: format(new Date(), 'yyyy-MM-dd'),
      placement: null,
      description: 'Sudah di ruang guru',
      photos: ['a.png', 'b.png'],
    });
  });

  it('asks placement against the intended place, and sends it', async () => {
    renderDetail(
      request({
        actions: { ...NONE, receive: true },
        destinationLocationId: 'loc-1',
        destination: { id: 'loc-1', name: 'Lab TKJ' },
      })
    );
    const receive = vi.spyOn(requestsApi, 'receive').mockResolvedValue(request());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Record receipt' }));
    const dialog = await screen.findByRole('dialog');
    const placement = within(dialog).getByTestId('receipt-placement');
    expect(placement).toHaveTextContent('Intended place for this request: Lab TKJ');

    await user.click(await within(dialog).findByRole('checkbox', { name: /Select every unit/ }));
    await user.type(within(dialog).getByLabelText(/Description/), 'Masih di gudang');
    await user.upload(within(dialog).getByLabelText('Add photos'), png());
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(within(dialog).getByText('Choose where the units are.')).toBeInTheDocument();
    expect(receive).not.toHaveBeenCalled();

    await user.click(within(placement).getByRole('radio', { name: 'Not at the intended place' }));
    expect(within(dialog).getByText(/why they are not at the intended place/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));

    await waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect(sent(receive)).toMatchObject({
      placement: 'NOT_AT_INTENDED_PLACE',
      description: 'Masih di gudang',
      photos: ['bukti.png'],
    });
  });

  it('clears each required message as soon as its field is satisfied (UAT)', async () => {
    renderDetail(
      request({
        actions: { ...NONE, receive: true },
        destinationLocationId: 'loc-1',
        destination: { id: 'loc-1', name: 'Lab TKJ' },
      })
    );
    const receive = vi.spyOn(requestsApi, 'receive').mockResolvedValue(request());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Record receipt' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('checkbox', { name: /Select every unit/ });
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    const messages = [
      'Choose at least one unit.',
      'Choose where the units are.',
      'A description is required.',
      'Add at least one photo.',
    ];
    for (const message of messages) {
      expect(within(dialog).getByText(message)).toBeInTheDocument();
    }

    await user.click(within(dialog).getByRole('checkbox', { name: 'INV-2' }));
    expect(within(dialog).queryByText(messages[0])).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: 'At the intended place' }));
    expect(within(dialog).queryByText(messages[1])).not.toBeInTheDocument();

    // Blank is still not a description: the message stays until real text.
    await user.type(within(dialog).getByLabelText(/Description/), '   ');
    expect(within(dialog).getByText(messages[2])).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Description/), 'Di lab');
    expect(within(dialog).queryByText(messages[2])).not.toBeInTheDocument();

    await user.upload(within(dialog).getByLabelText('Add photos'), png());
    expect(within(dialog).queryByText(messages[3])).not.toBeInTheDocument();

    // Nothing was sent while correcting; the rules are unchanged on submit.
    expect(receive).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    await waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect(sent(receive)).toMatchObject({
      assetUnitIds: ['unit-INV-2'],
      placement: 'AT_INTENDED_PLACE',
      description: 'Di lab',
      photos: ['bukti.png'],
    });
  });

  it('keeps the unit message when the selection is emptied again', async () => {
    renderDetail(request({ actions: { ...NONE, receive: true } }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Record receipt' }));
    const dialog = await screen.findByRole('dialog');
    const all = await within(dialog).findByRole('checkbox', { name: /Select every unit/ });
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(within(dialog).getByText('Choose at least one unit.')).toBeInTheDocument();

    await user.click(all);
    expect(within(dialog).queryByText('Choose at least one unit.')).not.toBeInTheDocument();
    await user.click(all);
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(within(dialog).getByText('Choose at least one unit.')).toBeInTheDocument();
  });

  it('accepts only JPG or PNG photos, at most five', async () => {
    renderDetail(request({ actions: { ...NONE, receive: true } }));
    const user = userEvent.setup({ applyAccept: false });

    await user.click(await screen.findByRole('button', { name: 'Record receipt' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Add photos');

    await user.upload(input, new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }));
    expect(within(dialog).getByText(/scan.pdf: only JPG or PNG/)).toBeInTheDocument();
    expect(within(dialog).queryByTestId('receipt-photos')).not.toBeInTheDocument();

    await user.upload(
      input,
      Array.from({ length: 6 }, (_, i) => png(`p${i}.png`))
    );
    expect(
      within(within(dialog).getByTestId('receipt-photos')).getAllByRole('listitem')
    ).toHaveLength(5);
    expect(within(dialog).getByText('At most 5 photos.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add photos' })).toBeDisabled();
  });
});

describe('receipt confirmations on the request view (migration 057)', () => {
  const confirmation = (overrides = {}) => ({
    id: 'rcf-1',
    placement: 'AT_INTENDED_PLACE',
    description: 'Laptop sudah di lab',
    destination: { id: 'loc-1', name: 'Lab TKJ (saat itu)' },
    receivedOn: '2026-09-24',
    confirmedBy: ME,
    confirmedAt: '2026-09-25T02:00:00.000Z',
    state: 'ACTIVE',
    units: [
      { assetUnitId: 'unit-INV-1', inventoryCode: 'INV-1', receiptId: 'rc-1', reversed: false },
    ],
    photos: [{ id: 'doc-p1', fileName: 'depan.png', fileType: 'image/png', fileSize: 3 }],
    ...overrides,
  });

  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} })
    );
  });

  it('shows each confirmation with its snapshot place, units and photos — and no delete', async () => {
    signInWith([...PERMS, 'request-document:read', 'request-document:delete'], {
      id: ME.id,
      institutionId: 'inst-1',
      isSystemWide: false,
    });
    vi.spyOn(requestsApi, 'listDocuments').mockResolvedValue([]);
    const download = vi
      .spyOn(requestsApi, 'downloadDocument')
      .mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    renderDetail(
      request({
        // The request's CURRENT destination differs: the snapshot is shown.
        destination: { id: 'loc-2', name: 'Bengkel' },
        receiptConfirmations: [
          confirmation({
            id: 'rcf-old',
            description: 'Foto salah',
            state: 'SUPERSEDED',
            units: [
              {
                assetUnitId: 'unit-INV-1',
                inventoryCode: 'INV-1',
                receiptId: 'rc-0',
                reversed: true,
              },
            ],
            photos: [{ id: 'doc-p0', fileName: 'salah.png', fileType: 'image/png', fileSize: 3 }],
          }),
          confirmation({ placement: 'NOT_AT_INTENDED_PLACE' }),
        ],
      })
    );

    const section = await screen.findByTestId('receipt-confirmations');
    const old = within(section).getByTestId('confirmation-rcf-old');
    expect(old).toHaveTextContent('Superseded');
    expect(old).toHaveTextContent('Foto salah');
    expect(old).toHaveTextContent('INV-1 (receipt reversed)');
    const current = within(section).getByTestId('confirmation-rcf-1');
    expect(current).toHaveTextContent('Active');
    expect(current).toHaveTextContent('Not at the intended place — Lab TKJ (saat itu)');
    expect(current).toHaveTextContent('Confirmed by Guru Umum');

    expect(await within(current).findByRole('img', { name: 'depan.png' })).toBeInTheDocument();
    await waitFor(() => expect(download).toHaveBeenCalledWith('doc-p1'));
    expect(within(section).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('shows the photo names only without request-document:read', async () => {
    const download = vi.spyOn(requestsApi, 'downloadDocument');
    renderDetail(
      request({ receiptConfirmations: [confirmation({ destination: null, placement: null })] })
    );

    const section = await screen.findByTestId('receipt-confirmations');
    expect(section).toHaveTextContent('No intended place was recorded');
    expect(section).toHaveTextContent('depan.png');
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it('shows nothing when there is no confirmation', async () => {
    renderDetail(request({ receiptConfirmations: [] }));
    await screen.findByRole('heading', { name: /REQ\/2026\/0002|Kursi/ });
    expect(screen.queryByTestId('receipt-confirmations')).not.toBeInTheDocument();
  });
});

describe('closing the remainder', () => {
  it('previews what is cancelled and the outcome, and requires a reason', async () => {
    renderDetail(
      request({
        actions: { ...NONE, close: true },
        items: [item({ quantityPending: 0, quantityReceiptNotRecorded: 1 })],
      })
    );
    const close = vi.spyOn(requestsApi, 'closeRemainder').mockResolvedValue(request());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Close remainder' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('close-preview')).toHaveTextContent(
      'cancels 1 (0 not yet registered, 1 cannot be received)'
    );
    expect(within(dialog).getByTestId('close-outcome')).toHaveTextContent(
      'The request will be Closed now.'
    );

    await user.click(within(dialog).getByRole('button', { name: 'Close remainder' }));
    expect(within(dialog).getByText('A reason is required.')).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'Unit rusak');
    await user.click(within(dialog).getByRole('button', { name: 'Close remainder' }));
    await waitFor(() => expect(close).toHaveBeenCalledWith('req-1', 'Unit rusak'));
  });

  it('says the request stays open while receivable units remain', async () => {
    renderDetail(request({ actions: { ...NONE, close: true } }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Close remainder' }));
    expect(
      within(await screen.findByRole('dialog')).getByTestId('close-outcome')
    ).toHaveTextContent('stays open until 1 more receipt is recorded');
  });

  it('shows an ended request with its first reason, and every close', async () => {
    renderDetail(
      request({
        status: 'CLOSED',
        closedAt: '2026-09-25T05:00:00.000Z',
        closeReason: 'Pertama',
        closeEvents: [
          { id: 'c1', reason: 'Pertama', closedAt: '2026-09-25T04:00:00.000Z', closedBy: OVERSEER },
          { id: 'c2', reason: 'Kedua', closedAt: '2026-09-25T05:00:00.000Z', closedBy: OVERSEER },
        ],
      })
    );

    expect(await screen.findByText(/Ended on .*: Pertama/)).toBeInTheDocument();
    const history = screen.getByTestId('close-events');
    expect(within(history).getByText(/Closed by Rina Sarpras on .*: Pertama/)).toBeInTheDocument();
    expect(within(history).getByText(/Closed by Rina Sarpras on .*: Kedua/)).toBeInTheDocument();
  });
});

describe('a REGISTER step closed by closing the remainder (D41-3)', () => {
  it('says the remainder was closed while the request is still open, and "ended" once it has', async () => {
    const closedStep = {
      ...registerStep,
      state: 'CLOSED',
      actedByUserId: null,
      actedBy: null,
      actedAs: null,
    };
    renderDetail(request({ steps: [closedStep] }));
    expect(
      await screen.findByText(
        'Not completed — the remainder was closed, so nothing is left to register.'
      )
    ).toBeInTheDocument();
  });

  it('keeps the ended wording on an ended request', async () => {
    const closedStep = {
      ...registerStep,
      state: 'CLOSED',
      actedByUserId: null,
      actedBy: null,
      actedAs: null,
    };
    renderDetail(
      request({ status: 'CLOSED', closedAt: '2026-09-25T05:00:00.000Z', steps: [closedStep] })
    );
    expect(
      await screen.findByText('Not completed — the request ended before this step was finished.')
    ).toBeInTheDocument();
  });
});

describe('reversing a receipt', () => {
  it('is offered only where canReverse, and needs a reason', async () => {
    const rows = links();
    rows[0].canReverse = true;
    renderDetail(request(), rows);
    const reverse = vi.spyOn(requestsApi, 'reverseReceipt').mockResolvedValue(request());
    const user = userEvent.setup();

    const buttons = await screen.findAllByRole('button', { name: 'Reverse receipt' });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse receipt' }));
    expect(within(dialog).getByText('A reason is required.')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Reason/), 'Salah catat');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse receipt' }));
    await waitFor(() => expect(reverse).toHaveBeenCalledWith('rc-1', 'Salah catat'));
  });
});

describe('the requests list (D41-6)', () => {
  it('shows received / required, and nothing for a draft', async () => {
    vi.spyOn(requestsApi, 'list').mockResolvedValue({
      data: [
        { ...request(), quantityReceived: 1, quantityRequired: 3 },
        {
          ...request({ id: 'r-2', requestNumber: 'REQ/2026/0009', status: 'DRAFT' }),
          quantityReceived: 0,
          quantityRequired: 2,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    });
    renderScreen(<RequestsPage />);

    expect(await screen.findByRole('columnheader', { name: 'Received' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('1 / 3')).toBeInTheDocument();
    expect(within(rows[2]).getAllByText('—').length).toBeGreaterThan(0);
  });
});
