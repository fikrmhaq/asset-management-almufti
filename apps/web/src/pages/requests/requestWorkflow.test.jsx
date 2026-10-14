import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import { ApiError } from '@/api/errors';
import { renderScreen, signInWith } from '@/test/harness';
import { RequestsPage } from './RequestsPage';
import { RequestDetailPage } from './RequestDetailPage';

/**
 * Workflow screens — Phase 38 (`CR-014` §6), `07-ui.md` §5.10: submit and
 * discard, the step timeline, decision and acquisition dialogs, cancel, and
 * "Awaiting my action". Actions follow the server's `actions` and `canAct`.
 */

const ME = { id: 'user-1', username: 'tester', firstName: 'Test', lastName: 'User' };
const KS = { id: 'user-ks', firstName: 'Siti', lastName: 'Aminah' };

const NONE = {
  edit: false,
  submit: false,
  discard: false,
  cancel: false,
  changeDestination: false,
};

const step = (overrides) => ({
  id: 'step-1',
  sequence: 1,
  stepType: 'DECIDE',
  actorPositionCode: 'KEPALA_SEKOLAH',
  procurementMode: null,
  skipIfRequesterIsActor: false,
  state: 'PENDING',
  skipReason: null,
  comment: null,
  activatedAt: null,
  completedAt: null,
  actedByUserId: null,
  actedBy: null,
  actedAs: null,
  resolvedActors: [],
  vacant: false,
  canAct: false,
  ...overrides,
});

const request = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  requestNumber: 'REQ/2026/0001',
  category: 'COMMON',
  title: 'Proyektor',
  justification: null,
  status: 'SUBMITTED',
  requesterUserId: ME.id,
  requester: ME,
  requesterAssignmentId: 'pa-1',
  requesterAssignmentCurrent: true,
  requesterPositionCode: 'COMMON_TEACHER',
  requesterDepartment: null,
  department: null,
  destinationLocationId: null,
  destination: null,
  neededBy: null,
  workflowDefinitionId: 'wf-1',
  closedAt: null,
  closeReason: null,
  items: [],
  steps: [],
  actions: NONE,
  ...overrides,
});

function renderDetail(data) {
  vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
  return renderScreen(<RequestDetailPage />, {
    route: `/requests/${data.id}`,
    path: '/requests/:id',
  });
}

beforeEach(() => {
  signInWith(
    [
      'request:read',
      'request:submit',
      'request:cancel',
      'request-step:decide',
      'request-step:complete',
    ],
    { id: ME.id, institutionId: 'inst-1', isSystemWide: false }
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('submit and discard', () => {
  it('submits the requester’s draft after confirmation', async () => {
    renderDetail(
      request({ status: 'DRAFT', workflowDefinitionId: null, actions: { ...NONE, submit: true } })
    );
    const submit = vi.spyOn(requestsApi, 'submit').mockResolvedValue(request());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Submit' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Submit' })
    );

    await waitFor(() => expect(submit).toHaveBeenCalledWith('req-1'));
  });

  /** P1 (§64): the same blockers as on the edit page, and Submit held back. */
  it('shows the blockers on the request page and disables Submit', async () => {
    renderDetail(
      request({
        status: 'DRAFT',
        workflowDefinitionId: null,
        actions: { ...NONE, submit: true },
        submitBlockers: [
          {
            code: 'NO_ITEMS',
            field: 'items',
            message: 'A request needs at least one item',
            fixedBy: 'REQUESTER',
          },
          {
            code: 'NO_WORKFLOW',
            field: 'category',
            message: 'No process is configured for this request',
            fixedBy: 'ADMINISTRATOR',
          },
        ],
      })
    );

    const blockers = await screen.findByTestId('submit-blockers');
    expect(within(blockers).getByText('Add at least one item.')).toBeInTheDocument();
    expect(within(blockers).getByText('Administrator action needed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('shows no blockers and an enabled Submit when nothing is in the way', async () => {
    renderDetail(
      request({
        status: 'DRAFT',
        workflowDefinitionId: null,
        actions: { ...NONE, submit: true },
        submitBlockers: [],
      })
    );

    expect(await screen.findByRole('button', { name: 'Submit' })).toBeEnabled();
    expect(screen.queryByTestId('submit-blockers')).not.toBeInTheDocument();
  });

  it('shows the refusal in the server’s words when no process is configured', async () => {
    renderDetail(
      request({ status: 'DRAFT', workflowDefinitionId: null, actions: { ...NONE, submit: true } })
    );
    vi.spyOn(requestsApi, 'submit').mockRejectedValue(
      new ApiError({
        code: 'CONFLICT',
        status: 409,
        message: 'No process is configured for this request',
        details: [
          {
            field: 'category',
            issue: 'no process is configured for this requester context and category',
          },
        ],
      })
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Submit' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Submit' })
    );

    expect(await screen.findByText('This request could not be submitted')).toBeInTheDocument();
    expect(
      screen.getByText(/no process is configured for this requester context/)
    ).toBeInTheDocument();
  });

  it('requires a reason to discard a draft', async () => {
    renderDetail(request({ status: 'DRAFT', actions: { ...NONE, discard: true } }));
    const cancel = vi
      .spyOn(requestsApi, 'cancel')
      .mockResolvedValue(request({ status: 'CANCELLED' }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Discard draft' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
    expect(within(dialog).getByText('A reason is required.')).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'Salah input');
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith('req-1', 'Salah input'));
  });
});

describe('the step timeline', () => {
  it('shows each state honestly: vacant, skipped, done by mode, closed', async () => {
    renderDetail(
      request({
        steps: [
          step({ id: 's1', sequence: 1, state: 'SKIPPED', skipReason: 'SELF' }),
          step({
            id: 's2',
            sequence: 2,
            actorPositionCode: 'WAKASEK_KURIKULUM',
            state: 'ACTIVE',
            vacant: true,
          }),
          step({
            id: 's3',
            sequence: 3,
            stepType: 'PROCURE',
            procurementMode: 'EXTERNAL',
            actorPositionCode: 'WAKASEK_SARPRAS',
            state: 'DONE',
            actedBy: KS,
            actedAs: { id: 'pa-x', positionCode: 'WAKASEK_SARPRAS', department: null },
            completedAt: '2026-09-26T03:00:00.000Z',
          }),
          step({
            id: 's4',
            sequence: 4,
            stepType: 'REGISTER',
            actorPositionCode: 'WAKASEK_SARPRAS',
            state: 'CLOSED',
          }),
        ],
      })
    );

    const skipped = await screen.findByTestId('step-1');
    expect(
      within(skipped).getByText(/Skipped — the requester holds this position/)
    ).toBeInTheDocument();

    const vacant = screen.getByTestId('step-2');
    expect(within(vacant).getByText('Position vacant')).toBeInTheDocument();
    expect(within(vacant).getByText(/never skipped/)).toBeInTheDocument();

    const procure = screen.getByTestId('step-3');
    // A neutral step name — "Acquisition completed" is only the action's label.
    expect(
      within(procure).getByText('Acquisition (external) — Wakasek Sarpras')
    ).toBeInTheDocument();
    expect(
      within(procure).getByText(/Declared by Siti Aminah as Wakasek Sarpras/)
    ).toBeInTheDocument();

    const closed = screen.getByTestId('step-4');
    expect(within(closed).getByText('Not completed')).toBeInTheDocument();
    expect(within(closed).queryByText('Done')).not.toBeInTheDocument();
  });

  it('offers Approve and Reject only when the server says the caller can act', async () => {
    renderDetail(
      request({
        steps: [
          step({
            id: 's1',
            state: 'ACTIVE',
            resolvedActors: [{ userId: 'x', name: 'Siti Aminah' }],
            canAct: false,
          }),
        ],
      })
    );

    expect(await screen.findByText('Waiting for Siti Aminah.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('requires a comment to reject, and records an approval', async () => {
    renderDetail(request({ steps: [step({ id: 's1', state: 'ACTIVE', canAct: true })] }));
    const decide = vi.spyOn(requestsApi, 'decide').mockResolvedValue(request());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(within(dialog).getByText('A comment is required to reject.')).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Comment/), 'Tidak ada anggaran');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    // Item notes belong to a revision request only: none with a rejection.
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith('s1', 'REJECT', 'Tidak ada anggaran', [])
    );
  });

  it('labels the acquisition action by its mode, and calls complete — never a fulfilment', async () => {
    renderDetail(
      request({
        status: 'APPROVED',
        steps: [
          step({
            id: 's3',
            sequence: 1,
            stepType: 'PROCURE',
            procurementMode: 'INTERNAL',
            actorPositionCode: 'WAKASEK_SARPRAS',
            state: 'ACTIVE',
            canAct: true,
          }),
        ],
      })
    );
    const complete = vi
      .spyOn(requestsApi, 'complete')
      .mockResolvedValue(request({ status: 'APPROVED' }));
    const user = userEvent.setup();

    expect(await screen.findByText(/not fulfilled until receipt/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Procurement completed' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/does not mean the request is fulfilled/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Declare completed' }));

    await waitFor(() => expect(complete).toHaveBeenCalledWith('s3', null));
  });
});

describe('cancel and the destination', () => {
  it('cancels with a reason when the server allows it', async () => {
    renderDetail(request({ actions: { ...NONE, cancel: true } }));
    const cancel = vi
      .spyOn(requestsApi, 'cancel')
      .mockResolvedValue(request({ status: 'CANCELLED' }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Cancel request' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Tidak jadi');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith('req-1', 'Tidak jadi'));
  });

  it('offers no cancel, discard, submit or destination change when the server says no', async () => {
    renderDetail(request({ status: 'APPROVED' }));

    await screen.findByText('REQ/2026/0001 — Proyektor');
    for (const name of ['Cancel request', 'Discard draft', 'Submit', 'Change destination']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('shows the reason on an ended request', async () => {
    renderDetail(
      request({
        status: 'CANCELLED',
        closedAt: '2026-09-26T02:00:00.000Z',
        closeReason: 'Anggaran dialihkan',
      })
    );

    expect(await screen.findByText(/Anggaran dialihkan/)).toBeInTheDocument();
  });
});

describe('needs my action (was: awaiting my action)', () => {
  it('asks the server for awaiting=me', async () => {
    const list = vi.spyOn(requestsApi, 'list').mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });

    renderScreen(<RequestsPage scope="awaiting" />);

    expect(await screen.findByText('Needs my action')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ awaiting: 'me' }));
  });
});
