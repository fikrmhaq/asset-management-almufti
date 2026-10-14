import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { workflowsApi } from '@/api/workflows';
import * as organizationApi from '@/api/organization';
import { visibleNavigation } from '@/navigation';
import { renderScreen, signInWith } from '@/test/harness';
import { WorkflowConfigurationPage } from './WorkflowConfigurationPage';
import { WorkflowEditorPage } from './WorkflowEditorPage';

/**
 * Workflow configuration — Phase 36 (`CR-014`), `07-ui.md` §5.10, REQ-WF-001 –
 * REQ-WF-004, REQ-WF-006. Its own file, so the organization screen tests are
 * untouched.
 */

const READ = 'workflow-definition:read';
const ALL = [
  READ,
  'workflow-definition:create',
  'workflow-definition:update',
  'workflow-definition:publish',
];

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: rows.length, total: rows.length, totalPages: rows.length ? 1 : 0 },
});

const definition = (overrides = {}) => ({
  id: 'wf-1',
  institutionId: 'inst-1',
  category: 'COMMON',
  requesterPositionCode: 'COMMON_TEACHER',
  version: 1,
  status: 'DRAFT',
  publishedAt: null,
  retiredAt: null,
  steps: [],
  publishIssues: [],
  ...overrides,
});

const step = (sequence, stepType, actorPositionCode, extra = {}) => ({
  id: `step-${sequence}`,
  sequence,
  stepType,
  actorPositionCode,
  procurementMode: stepType === 'PROCURE' ? 'INTERNAL' : null,
  skipIfRequesterIsActor: false,
  ...extra,
});

const TEMPLATES = [
  {
    key: 'COMMON_COMMON_TEACHER',
    category: 'COMMON',
    requesterPositionCode: 'COMMON_TEACHER',
    steps: [
      { sequence: 1, stepType: 'DECIDE', actorPositionCode: 'WAKASEK_SARPRAS' },
      { sequence: 2, stepType: 'DECIDE', actorPositionCode: 'KEPALA_SEKOLAH' },
      {
        sequence: 3,
        stepType: 'PROCURE',
        actorPositionCode: null,
        procurementMode: 'INTERNAL',
        unresolvedQuestion: 'Q4',
      },
      { sequence: 4, stepType: 'REGISTER', actorPositionCode: null, unresolvedQuestion: 'Q4' },
    ],
  },
  {
    key: 'JURUSAN_KAJUR',
    category: 'JURUSAN',
    requesterPositionCode: 'KAJUR',
    steps: [
      { sequence: 1, stepType: 'DECIDE', actorPositionCode: 'KEPALA_SEKOLAH' },
      {
        sequence: 2,
        stepType: 'PROCURE',
        actorPositionCode: null,
        procurementMode: 'EXTERNAL',
        unresolvedQuestion: 'Q3',
      },
      { sequence: 3, stepType: 'REGISTER', actorPositionCode: null, unresolvedQuestion: 'Q3' },
    ],
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

// ---------------------------------------------------------------------------

describe('navigation', () => {
  const hrefs = (permissions) =>
    visibleNavigation(new Set(permissions)).flatMap((group) => group.items.map((i) => i.to));

  it('shows Workflow configuration under Organization with workflow-definition:read', () => {
    const groups = visibleNavigation(new Set([READ]));
    const organization = groups.find((group) => group.labelKey === 'nav.groups.organization');

    expect(organization.items.map((item) => item.to)).toEqual(['/organization/workflows']);
  });

  it('hides it without the code — as for a PIC-scoped user, whose ceiling never carries it', () => {
    expect(hrefs(['asset-unit:read', 'borrowing:read'])).not.toContain('/organization/workflows');
  });
});

// ---------------------------------------------------------------------------

describe('the configuration grid', () => {
  function mockLists({ active = [], drafts = [] } = {}) {
    return vi
      .spyOn(workflowsApi, 'list')
      .mockImplementation(async (params) => page(params.status === 'ACTIVE' ? active : drafts));
  }

  const ALL_CATEGORIES = ['COMMON', 'JURUSAN', 'KBM', 'EKSKUL'];
  /** The server's map (P2, §64.2): the two teacher contexts are limited. */
  const ELIGIBILITY = {
    categoriesByPosition: {
      COMMON_TEACHER: ['COMMON', 'KBM', 'EKSKUL'],
      JURUSAN_TEACHER: ['COMMON', 'JURUSAN'],
      TOOLMAN: ALL_CATEGORIES,
      KAJUR: ALL_CATEGORIES,
      WAKASEK_SARPRAS: ALL_CATEGORIES,
      WAKASEK_KURIKULUM: ALL_CATEGORIES,
      WAKASEK_KESISWAAN: ALL_CATEGORIES,
      KEPALA_SEKOLAH: ALL_CATEGORIES,
    },
  };

  beforeEach(() => {
    vi.spyOn(workflowsApi, 'templates').mockResolvedValue(TEMPLATES);
    vi.spyOn(workflowsApi, 'eligibility').mockResolvedValue(ELIGIBILITY);
  });

  it('offers no draft for a combination no request may have (P2)', async () => {
    signInWith(ALL, { institutionId: 'inst-1', isSystemWide: false });
    mockLists();

    renderScreen(<WorkflowConfigurationPage />);

    for (const [category, position] of [
      ['JURUSAN', 'COMMON_TEACHER'],
      ['KBM', 'JURUSAN_TEACHER'],
      ['EKSKUL', 'JURUSAN_TEACHER'],
    ]) {
      const cell = await screen.findByTestId(`cell-${category}-${position}`);
      expect(within(cell).getByText('Not requestable in this capacity')).toBeInTheDocument();
      expect(within(cell).queryByRole('button')).not.toBeInTheDocument();
    }
    // An eligible combination is unchanged.
    const kbm = screen.getByTestId('cell-KBM-COMMON_TEACHER');
    expect(within(kbm).getByText('Not configured')).toBeInTheDocument();
    expect(within(kbm).getByRole('button', { name: /Create a draft/ })).toBeInTheDocument();
  });

  it('shows every category for every requester context, with active, draft and "not configured"', async () => {
    signInWith(ALL, { institutionId: 'inst-1', isSystemWide: false });
    mockLists({
      active: [definition({ id: 'wf-a', status: 'ACTIVE', version: 2 })],
      drafts: [
        definition({ id: 'wf-d', version: 3 }),
        definition({ id: 'wf-k', category: 'KBM', version: 1 }),
      ],
    });

    renderScreen(<WorkflowConfigurationPage />);

    const common = await screen.findByTestId('cell-COMMON-COMMON_TEACHER');
    expect(within(common).getByRole('link', { name: 'Version 2 active' })).toHaveAttribute(
      'href',
      '/organization/workflows/wf-a'
    );
    expect(within(common).getByText('Draft v3')).toBeInTheDocument();

    const kbm = screen.getByTestId('cell-KBM-COMMON_TEACHER');
    expect(within(kbm).getByText('Not configured')).toBeInTheDocument();
    expect(within(kbm).getByText('Draft v1')).toBeInTheDocument();

    const ekskul = screen.getByTestId('cell-EKSKUL-KEPALA_SEKOLAH');
    expect(within(ekskul).getByText('Not configured')).toBeInTheDocument();
    expect(within(ekskul).getByRole('button', { name: /Create a draft/ })).toBeInTheDocument();

    // 4 categories × 8 contexts.
    expect(screen.getAllByTestId(/^cell-/)).toHaveLength(32);
  });

  it('asks an institution-scoped user nothing, and loads their own institution', async () => {
    signInWith(ALL, { institutionId: 'inst-1', isSystemWide: false });
    const list = mockLists();
    const institutions = vi.spyOn(organizationApi.institutionsApi, 'list');

    renderScreen(<WorkflowConfigurationPage />);

    await screen.findByTestId('cell-COMMON-COMMON_TEACHER');
    expect(screen.queryByLabelText('Institution')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 'inst-1' }));
    expect(institutions).not.toHaveBeenCalled();
  });

  it('lets a system-wide user choose the institution first (D4)', async () => {
    signInWith([...ALL, 'institution:read']);
    vi.spyOn(organizationApi.institutionsApi, 'list').mockResolvedValue(
      page([{ id: 'inst-2', name: 'SMK Dua', code: 'SMK2' }])
    );
    const list = mockLists();
    const user = userEvent.setup();

    renderScreen(<WorkflowConfigurationPage />);

    expect(await screen.findByText('No institution')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();

    const select = screen.getByLabelText('Institution');
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'SMK Dua' })).toBeTruthy()
    );
    await user.selectOptions(select, 'inst-2');

    await screen.findByTestId('cell-COMMON-COMMON_TEACHER');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 'inst-2' }));
  });

  it('keeps a system-wide user’s choice in the URL, and remembers it on return', async () => {
    signInWith([...ALL, 'institution:read']);
    vi.spyOn(organizationApi.institutionsApi, 'list').mockResolvedValue(
      page([{ id: 'inst-2', name: 'SMK Dua', code: 'SMK2' }])
    );
    const list = mockLists();
    const user = userEvent.setup();

    const first = renderScreen(<WorkflowConfigurationPage />, {
      route: '/organization/workflows?institution=inst-2',
      path: '/organization/workflows',
    });
    await screen.findByTestId('cell-COMMON-COMMON_TEACHER');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 'inst-2' }));

    // Choosing again stores it, so a return without the query still shows it.
    const select = screen.getByLabelText('Institution');
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'SMK Dua' })).toBeTruthy()
    );
    await user.selectOptions(select, 'inst-2');
    first.unmount();
    list.mockClear();

    renderScreen(<WorkflowConfigurationPage />, {
      route: '/organization/workflows',
      path: '/organization/workflows',
    });
    await screen.findByTestId('cell-COMMON-COMMON_TEACHER');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 'inst-2' }));
  });

  it('offers no create action to a read-only user', async () => {
    signInWith([READ], { institutionId: 'inst-1', isSystemWide: false });
    mockLists();

    renderScreen(<WorkflowConfigurationPage />);

    await screen.findByTestId('cell-COMMON-COMMON_TEACHER');
    expect(screen.queryByRole('button', { name: /Create a draft/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use template' })).not.toBeInTheDocument();
  });

  it('lists only the confirmed templates, naming undecided actors, and creates a DRAFT from one', async () => {
    signInWith(ALL, { institutionId: 'inst-1', isSystemWide: false });
    mockLists();
    const create = vi.spyOn(workflowsApi, 'create').mockResolvedValue(definition({ id: 'wf-new' }));
    vi.spyOn(workflowsApi, 'get').mockResolvedValue(definition({ id: 'wf-new' }));
    const user = userEvent.setup();

    renderScreen(<WorkflowConfigurationPage />, {
      extraRoutes: [{ path: '/organization/workflows/:id', element: <p>editor</p> }],
    });

    await screen.findByText(/actor not decided \(Q3\)/);
    expect(screen.getAllByText(/actor not decided \(Q4\)/)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Use template' })).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Use template' })[1]);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        category: 'JURUSAN',
        requesterPositionCode: 'KAJUR',
        institutionId: 'inst-1',
        templateKey: 'JURUSAN_KAJUR',
      })
    );
    expect(await screen.findByText('editor')).toBeInTheDocument();
  });

  it('creates an empty draft from a cell', async () => {
    signInWith(ALL, { institutionId: 'inst-1', isSystemWide: false });
    mockLists();
    const create = vi.spyOn(workflowsApi, 'create').mockResolvedValue(definition({ id: 'wf-x' }));
    const user = userEvent.setup();

    renderScreen(<WorkflowConfigurationPage />, {
      extraRoutes: [{ path: '/organization/workflows/:id', element: <p>editor</p> }],
    });

    const cell = await screen.findByTestId('cell-EKSKUL-KEPALA_SEKOLAH');
    await user.click(within(cell).getByRole('button', { name: /Create a draft/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        category: 'EKSKUL',
        requesterPositionCode: 'KEPALA_SEKOLAH',
        institutionId: 'inst-1',
      })
    );
  });
});

// ---------------------------------------------------------------------------

describe('the editor', () => {
  function renderEditor(data) {
    vi.spyOn(workflowsApi, 'get').mockResolvedValue(data);
    vi.spyOn(workflowsApi, 'list').mockResolvedValue(page([data]));
    return renderScreen(<WorkflowEditorPage />, {
      route: `/organization/workflows/${data.id}`,
      path: '/organization/workflows/:id',
      extraRoutes: [{ path: '/organization/workflows/wf-2', element: <p>new draft</p> }],
    });
  }

  beforeEach(() => signInWith(ALL, { institutionId: 'inst-1', isSystemWide: false }));

  it('offers exactly three constrained fields per step, and no free text', async () => {
    renderEditor(
      definition({
        steps: [
          step(1, 'DECIDE', 'WAKASEK_SARPRAS'),
          step(2, 'PROCURE', null),
          step(3, 'REGISTER', null),
        ],
      })
    );

    await screen.findByTestId('step-1');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    // The acquisition mode exists on the PROCURE step only.
    expect(screen.getAllByRole('combobox', { name: /^Acquisition — Step/ })).toHaveLength(1);
    expect(
      within(screen.getByTestId('step-2')).getByRole('combobox', { name: /Acquisition/ })
    ).toHaveValue('INTERNAL');
    expect(
      within(screen.getByTestId('step-3')).getByRole('combobox', { name: /^Position/ })
    ).toHaveValue('');
  });

  it('adds a step with self-skip off, and saves the ordered list', async () => {
    const saved = definition({
      steps: [step(1, 'DECIDE', 'KEPALA_SEKOLAH'), step(2, 'REGISTER', null)],
    });
    renderEditor(definition({ steps: [step(1, 'DECIDE', 'KEPALA_SEKOLAH')] }));
    const replace = vi.spyOn(workflowsApi, 'replaceSteps').mockResolvedValue(saved);
    const user = userEvent.setup();

    await screen.findByTestId('step-1');
    await user.click(screen.getByRole('button', { name: 'Add step' }));

    const added = screen.getByTestId('step-2');
    expect(within(added).getByRole('checkbox')).not.toBeChecked();
    await user.selectOptions(within(added).getByRole('combobox', { name: /^Type/ }), 'REGISTER');
    await user.click(screen.getByRole('button', { name: 'Save steps' }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('wf-1', [
        {
          sequence: 1,
          stepType: 'DECIDE',
          actorPositionCode: 'KEPALA_SEKOLAH',
          skipIfRequesterIsActor: false,
        },
        {
          sequence: 2,
          stepType: 'REGISTER',
          actorPositionCode: null,
          skipIfRequesterIsActor: false,
        },
      ])
    );
  });

  it('shows the mode only once a step becomes an acquisition step', async () => {
    renderEditor(definition({ steps: [step(1, 'DECIDE', 'KEPALA_SEKOLAH')] }));
    const user = userEvent.setup();

    const first = await screen.findByTestId('step-1');
    expect(within(first).queryByRole('combobox', { name: /Acquisition/ })).not.toBeInTheDocument();

    await user.selectOptions(within(first).getByRole('combobox', { name: /^Type/ }), 'PROCURE');

    const mode = within(first).getByRole('combobox', { name: /Acquisition/ });
    expect(within(mode).getByRole('option', { name: /Procurement completed/ })).toBeTruthy();
    expect(within(mode).getByRole('option', { name: /Acquisition completed/ })).toBeTruthy();
  });

  it('shows the validation result per step before publishing, and does not publish', async () => {
    renderEditor(
      definition({
        steps: [step(1, 'DECIDE', 'KAJUR'), step(2, 'REGISTER', null)],
        publishIssues: [
          { field: 'steps.0.actorPositionCode', issue: 'KAJUR is held for a department' },
          { field: 'steps.1.actorPositionCode', issue: 'an actor position must be chosen' },
        ],
      })
    );
    const publish = vi.spyOn(workflowsApi, 'publish');
    const user = userEvent.setup();

    expect(
      within(await screen.findByTestId('step-1')).getByText('KAJUR is held for a department')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('step-2')).getByText('an actor position must be chosen')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Not ready to publish')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes a valid draft after confirmation', async () => {
    const valid = definition({
      steps: [step(1, 'DECIDE', 'KEPALA_SEKOLAH'), step(2, 'REGISTER', 'WAKASEK_SARPRAS')],
    });
    renderEditor(valid);
    const publish = vi
      .spyOn(workflowsApi, 'publish')
      .mockResolvedValue({ ...valid, status: 'ACTIVE', publishIssues: undefined });
    const user = userEvent.setup();

    expect(await screen.findByText(/can be published/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Publish this workflow?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith('wf-1'));
  });

  it('does not publish unsaved changes', async () => {
    renderEditor(definition({ steps: [step(1, 'REGISTER', 'KEPALA_SEKOLAH')] }));
    const user = userEvent.setup();

    await screen.findByTestId('step-1');
    await user.click(screen.getByRole('button', { name: 'Add step' }));

    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();
  });

  it('shows an ACTIVE version read-only, with "Create new version"', async () => {
    renderEditor(
      definition({
        status: 'ACTIVE',
        publishedAt: '2026-09-24T00:00:00.000Z',
        publishIssues: undefined,
        steps: [step(1, 'DECIDE', 'KEPALA_SEKOLAH'), step(2, 'REGISTER', 'WAKASEK_SARPRAS')],
      })
    );
    const newVersion = vi
      .spyOn(workflowsApi, 'newVersion')
      .mockResolvedValue(definition({ id: 'wf-2', version: 2 }));
    const user = userEvent.setup();

    expect(await screen.findByText(/cannot be edited/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save steps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Kepala Sekolah' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create new version' }));

    await waitFor(() => expect(newVersion).toHaveBeenCalledWith('wf-1'));
    expect(await screen.findByText('new draft')).toBeInTheDocument();
  });

  it('shows a RETIRED version read-only too', async () => {
    renderEditor(
      definition({
        status: 'RETIRED',
        publishedAt: '2026-09-01T00:00:00.000Z',
        retiredAt: '2026-09-24T00:00:00.000Z',
        publishIssues: undefined,
        steps: [step(1, 'REGISTER', 'WAKASEK_SARPRAS')],
      })
    );

    expect(await screen.findByText(/has been retired/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('gates each action on its own code', async () => {
    signInWith([READ], { institutionId: 'inst-1', isSystemWide: false });
    renderEditor(definition({ steps: [step(1, 'REGISTER', 'WAKASEK_SARPRAS')] }));

    await screen.findByRole('cell', { name: 'Wakasek Sarpras' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save steps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });

  it('says a department-bound actor acts within the request’s department', async () => {
    renderEditor(
      definition({
        requesterPositionCode: 'JURUSAN_TEACHER',
        steps: [step(1, 'DECIDE', 'KAJUR'), step(2, 'REGISTER', 'WAKASEK_SARPRAS')],
      })
    );

    const first = await screen.findByTestId('step-1');
    expect(within(first).getByText(/request's department/)).toBeInTheDocument();
    expect(within(screen.getByTestId('step-2')).queryByText(/request's department/)).toBeNull();
  });
});
