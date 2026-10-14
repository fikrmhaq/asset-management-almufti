import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import { t } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { RequestDetailPage } from './RequestDetailPage';
import { RequestFormPage } from './RequestFormPage';
import { updateText } from './updateText';

/**
 * Request Revision on screen — REQ-REQUEST-018 (`IMPLEMENTATION_PLAN.md` §65).
 * Everything follows the server: `canAct`, `actions.resubmit`, `revision`,
 * `previousCycles`, `actionsNeeded`. The screens word it and send the calls.
 */

const ME = { id: 'user-1', username: 'tester', firstName: 'Test', lastName: 'User' };
const SARPRAS = { id: 'user-s', username: 'sarpras', firstName: 'Budi', lastName: 'Santoso' };
const TKJ = { id: 'dept-tkj', code: 'TKJ', name: 'Teknik Komputer' };

const NONE = {
  edit: false,
  submit: false,
  resubmit: false,
  discard: false,
  cancel: false,
  changeDestination: false,
};

const ITEMS = [
  {
    id: 'item-1',
    lineNo: 1,
    description: 'Proyektor',
    quantityRequested: 1,
    quantityCancelled: 0,
    quantityRequired: 1,
  },
  {
    id: 'item-2',
    lineNo: 2,
    description: 'Layar',
    quantityRequested: 1,
    quantityCancelled: 0,
    quantityRequired: 1,
  },
];

const step = (overrides) => ({
  id: 'step-1',
  cycle: 1,
  sequence: 1,
  stepType: 'DECIDE',
  actorPositionCode: 'WAKASEK_SARPRAS',
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

const REVISION = {
  stepId: 'step-1',
  cycle: 1,
  sequence: 1,
  actorPositionCode: 'WAKASEK_SARPRAS',
  requestedBy: SARPRAS,
  actedAs: { id: 'pa-s', positionCode: 'WAKASEK_SARPRAS', department: null },
  requestedAt: '2026-10-02T03:00:00.000Z',
  reason: 'Spesifikasi kurang jelas',
  itemNotes: [
    {
      id: 'n1',
      requestItemId: 'item-1',
      lineNo: 1,
      itemDescription: 'Proyektor',
      note: 'Sebutkan merek',
    },
    { id: 'n2', requestItemId: null, lineNo: 3, itemDescription: 'Kabel', note: 'Tidak perlu' },
  ],
};

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
  workflowDefinitionId: 'wf-1',
  closedAt: null,
  closeReason: null,
  items: ITEMS,
  steps: [],
  cycle: 1,
  revision: null,
  previousCycles: [],
  actions: NONE,
  ...overrides,
});

/** A request returned for revision, as the server shows it to its requester. */
const returned = (overrides = {}) =>
  request({
    status: 'REVISION_REQUESTED',
    steps: [
      step({
        state: 'RETURNED',
        comment: REVISION.reason,
        actedBy: SARPRAS,
        actedAs: REVISION.actedAs,
        completedAt: REVISION.requestedAt,
      }),
      step({ id: 'step-2', sequence: 2, actorPositionCode: 'KEPALA_SEKOLAH', state: 'CLOSED' }),
    ],
    revision: REVISION,
    actions: { ...NONE, edit: true, resubmit: true, cancel: true },
    submitBlockers: [],
    actionsNeeded: [{ kind: 'RESUBMIT', blocked: false }],
    ...overrides,
  });

function renderDetail(data) {
  vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
  vi.spyOn(requestsApi, 'markViewed').mockResolvedValue(undefined);
  return renderScreen(<RequestDetailPage />, {
    route: `/requests/${data.id}`,
    path: '/requests/:id',
  });
}

beforeEach(() => {
  signInWith(
    [
      'request:read',
      'request:update',
      'request:submit',
      'request:cancel',
      'request-step:decide',
      'request-item:create',
      'request-item:update',
      'request-item:delete',
    ],
    { id: ME.id, institutionId: 'inst-1', isSystemWide: false }
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requesting a revision', () => {
  it('offers it beside Approve and Reject only to the step’s actor', async () => {
    renderDetail(request({ steps: [step({ state: 'ACTIVE', canAct: false })] }));
    await screen.findByTestId('step-1');
    expect(screen.queryByRole('button', { name: 'Request revision' })).not.toBeInTheDocument();
  });

  it('requires a reason, and sends only the item notes written', async () => {
    renderDetail(request({ steps: [step({ state: 'ACTIVE', canAct: true })] }));
    const decide = vi.spyOn(requestsApi, 'decide').mockResolvedValue(returned());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Request revision' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Return this request for revision?')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Request revision' }));
    expect(
      within(dialog).getByText('A reason is required to request a revision.')
    ).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/What must change/), 'Spesifikasi kurang jelas');
    await user.type(within(dialog).getByLabelText('Line 2 — Layar'), 'Ukuran berapa?');
    await user.click(within(dialog).getByRole('button', { name: 'Request revision' }));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(
        'step-1',
        'REQUEST_REVISION',
        'Spesifikasi kurang jelas',
        [{ requestItemId: 'item-2', note: 'Ukuran berapa?' }]
      )
    );
  });
});

describe('a request returned for revision', () => {
  it('shows who returned it, why, and the notes per item — including a removed item', async () => {
    renderDetail(returned());

    const banner = await screen.findByTestId('revision-banner');
    expect(within(banner).getByText('Returned for revision')).toBeInTheDocument();
    expect(
      within(banner).getByText(/Returned by Budi Santoso as Wakasek Sarpras/)
    ).toBeInTheDocument();
    expect(within(banner).getByText('Spesifikasi kurang jelas')).toBeInTheDocument();
    const notes = within(banner).getByTestId('revision-item-notes');
    expect(within(notes).getByText('Sebutkan merek')).toBeInTheDocument();
    expect(within(notes).getByText(/Line 3 — Kabel \(since removed\)/)).toBeInTheDocument();

    // On the item's own line, too.
    expect(screen.getByTestId('item-revision-note-1')).toHaveTextContent(
      'Revision note: Sebutkan merek'
    );
    expect(screen.getByText('Revision requested')).toBeInTheDocument();
  });

  it('words the returned round honestly in the timeline', async () => {
    renderDetail(returned());
    const first = await screen.findByTestId('step-1');
    expect(within(first).getAllByText('Returned for revision').length).toBeGreaterThan(0);
    expect(within(first).getByText(/Returned for revision by Budi Santoso/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId('step-2')).getByText(/returned for revision in this round/)
    ).toBeInTheDocument();
  });

  it('asks the requester to revise and resubmit, and resubmits after confirmation', async () => {
    renderDetail(returned());
    const submit = vi.spyOn(requestsApi, 'submit').mockResolvedValue(request());
    const user = userEvent.setup();

    expect(await screen.findByRole('link', { name: 'Revise' })).toHaveAttribute(
      'href',
      '/requests/req-1/edit'
    );
    const banner = screen.getByTestId('action-needed-banner');
    await user.click(within(banner).getByRole('button', { name: 'Revise and resubmit' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Resubmit this request?')).toBeInTheDocument();
    expect(within(dialog).getByText(/starts again from the first step/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Resubmit' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith('req-1'));
  });

  it('holds Resubmit back while something blocks it', async () => {
    renderDetail(
      returned({
        submitBlockers: [{ code: 'NO_ITEMS', field: 'items', message: 'x', fixedBy: 'REQUESTER' }],
        actionsNeeded: [{ kind: 'RESUBMIT', blocked: true }],
      })
    );
    expect(await screen.findByRole('button', { name: 'Resubmit' })).toBeDisabled();
    expect(
      within(screen.getByTestId('submit-blockers')).getByText('Add at least one item.')
    ).toBeInTheDocument();
  });
});

describe('earlier approval rounds', () => {
  it('lists each earlier round as decided, with why it was returned', async () => {
    renderDetail(
      request({
        cycle: 2,
        steps: [step({ id: 'c2-1', cycle: 2, state: 'ACTIVE' })],
        previousCycles: [
          {
            cycle: 1,
            startedAt: '2026-10-01T02:00:00.000Z',
            steps: [
              step({ state: 'RETURNED', actedBy: SARPRAS, completedAt: REVISION.requestedAt }),
              step({
                id: 'step-2',
                sequence: 2,
                actorPositionCode: 'KEPALA_SEKOLAH',
                state: 'CLOSED',
              }),
            ],
            revision: REVISION,
          },
        ],
      })
    );

    expect(await screen.findByRole('heading', { name: 'Process — Round 2' })).toBeInTheDocument();
    const rounds = screen.getByTestId('earlier-rounds');
    expect(within(rounds).getByText('Round 1')).toBeInTheDocument();
    expect(within(rounds).getByText('Returned for revision')).toBeInTheDocument();
    expect(within(rounds).getByText('Spesifikasi kurang jelas')).toBeInTheDocument();
    // History only: the current round's banner is not shown for it.
    expect(screen.queryByTestId('revision-banner')).not.toBeInTheDocument();
  });
});

describe('revising on the edit page', () => {
  const CONTEXT = {
    assignmentId: 'pa-common',
    institutionId: 'inst-1',
    positionCode: 'COMMON_TEACHER',
    department: null,
    departmentRule: 'OPTIONAL',
    typicalCategories: ['COMMON', 'KBM', 'EKSKUL'],
    categories: ['COMMON', 'KBM', 'EKSKUL'].map((category) => ({
      category,
      typical: true,
      processConfigured: true,
      departmentRequired: false,
      eligible: true,
    })),
    defaultDestinations: [],
  };

  function renderEdit(data) {
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [CONTEXT] });
    vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
    return renderScreen(<RequestFormPage />, {
      route: `/requests/${data.id}/edit`,
      path: '/requests/:id/edit',
    });
  }

  it('edits a returned request with its category fixed, and resubmits from the page', async () => {
    renderEdit(returned());

    expect(await screen.findByText('Revise REQ/2026/0001')).toBeInTheDocument();
    expect(screen.getByTestId('revision-banner')).toBeInTheDocument();
    expect(screen.getByLabelText(/Category/)).toBeDisabled();
    expect(screen.getByText(/keeps the process it was submitted under/)).toBeInTheDocument();
    const section = screen.getByTestId('submit-section');
    expect(within(section).getByRole('button', { name: 'Resubmit' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument();
  });

  it('shows the department fixed when a frozen step is decided within it', async () => {
    renderEdit(
      returned({
        requesterPositionCode: 'WAKASEK_KURIKULUM',
        category: 'JURUSAN',
        departmentId: TKJ.id,
        department: TKJ,
        steps: [step({ actorPositionCode: 'KAJUR', state: 'RETURNED' })],
      })
    );

    expect(await screen.findByText('Teknik Komputer')).toBeInTheDocument();
    expect(screen.getByText(/decided within this department/)).toBeInTheDocument();
  });
});

describe('updates in words', () => {
  it('names a revision request and a resubmission', () => {
    expect(
      updateText(t, {
        kind: 'STEP_DECIDED',
        detail: 'RETURNED',
        extra: 'KEPALA_SEKOLAH',
        by: { firstName: 'Siti', lastName: 'Aminah' },
      })
    ).toBe('Returned for revision by Siti Aminah as Kepala Sekolah');
    expect(
      updateText(t, { kind: 'REQUEST_RESUBMITTED', by: { firstName: 'Test', lastName: 'User' } })
    ).toBe('Resubmitted by Test User — the approval starts again');
  });
});
