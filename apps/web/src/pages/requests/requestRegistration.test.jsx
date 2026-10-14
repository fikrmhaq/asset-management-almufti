import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import { assetsApi, assetUnitsApi, inventoryCodesApi } from '@/api/assetCore';
import { ApiError, ERROR_CODES } from '@/api/errors';
import { lookupApis } from '@/api/reference';
import { renderScreen, signInWith } from '@/test/harness';
import { fakePreview } from '@/test/inventoryCodePreview';
import { RequestDetailPage } from './RequestDetailPage';

/**
 * Registration — Phase 40 (`CR-014` §7.3), `07-ui.md` §5.10. Register and link
 * follow the REGISTER step's `canAct`; unlink follows each link's `canUnlink`.
 * Registration is not receipt: no received figure and no receipt control.
 */

const ME = { id: 'user-1', username: 'reg', firstName: 'Rina', lastName: 'Registrar' };

const NONE = {
  edit: false,
  submit: false,
  discard: false,
  cancel: false,
  changeDestination: false,
  uploadDocument: false,
};

const registerStep = (overrides = {}) => ({
  id: 'step-r',
  sequence: 3,
  stepType: 'REGISTER',
  actorPositionCode: 'WAKASEK_SARPRAS',
  procurementMode: null,
  skipIfRequesterIsActor: false,
  state: 'ACTIVE',
  skipReason: null,
  comment: null,
  activatedAt: '2026-09-25T00:00:00.000Z',
  completedAt: null,
  actedByUserId: null,
  actedBy: null,
  actedAs: null,
  resolvedActors: [{ userId: ME.id, name: 'Rina Registrar' }],
  vacant: false,
  canAct: true,
  ...overrides,
});

const item = (overrides = {}) => ({
  id: 'item-1',
  requestId: 'req-1',
  lineNo: 1,
  description: 'Kursi',
  specification: null,
  quantityRequested: 3,
  quantityCancelled: 0,
  quantityRequired: 3,
  quantityRegistered: 1,
  quantityNotYetRegistered: 2,
  measurementUnit: null,
  estimatedUnitPrice: null,
  classification: { id: '117010101001', name: 'Kursi kerja' },
  ...overrides,
});

const request = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  requestNumber: 'REQ/2026/0007',
  category: 'COMMON',
  title: 'Kursi',
  justification: null,
  status: 'APPROVED',
  requesterUserId: 'someone',
  requester: { id: 'someone', firstName: 'Guru', lastName: 'Umum' },
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
  closedAt: null,
  closeReason: null,
  items: [item()],
  steps: [registerStep()],
  actions: NONE,
  ...overrides,
});

const linkRow = (overrides = {}) => ({
  id: 'link-1',
  requestItemId: 'item-1',
  linkedAt: '2026-09-25T00:00:00.000Z',
  linkedBy: ME,
  assetUnit: {
    id: 'unit-1',
    inventoryCode: 'INV-0001',
    asset: { id: 'asset-1', name: 'Kursi kerja' },
    department: null,
    currentLocation: null,
    lifecycleState: 'REGISTERED',
    isActive: true,
  },
  canUnlink: true,
  ...overrides,
});

const ALL = [
  'request:read',
  'request-item:register',
  'request-item-unit:read',
  'request-item-unit:create',
  'request-item-unit:delete',
  'asset:create',
  'asset-unit:create',
  'asset-unit:read',
];

function renderDetail(data, links = [linkRow()]) {
  vi.spyOn(requestsApi, 'get').mockResolvedValue(data);
  vi.spyOn(requestsApi, 'listItemUnits').mockResolvedValue(links);
  renderScreen(<RequestDetailPage />, { route: `/requests/${data.id}`, path: '/requests/:id' });
}

beforeEach(() => {
  signInWith(ALL, { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the registration panel', () => {
  it('is absent without request-item-unit:read, and while REGISTER is still pending', async () => {
    signInWith(['request:read'], { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
    renderDetail(request());
    expect(await screen.findByText('REQ/2026/0007 — Kursi')).toBeInTheDocument();
    expect(screen.queryByText('Registration')).not.toBeInTheDocument();
  });

  it('is absent while REGISTER is pending', async () => {
    renderDetail(request({ status: 'SUBMITTED', steps: [registerStep({ state: 'PENDING' })] }));
    expect(await screen.findByText('REQ/2026/0007 — Kursi')).toBeInTheDocument();
    expect(screen.queryByText('Registration')).not.toBeInTheDocument();
  });

  it('shows progress and the linked units, with no receipt control unless offered', async () => {
    renderDetail(request());

    const row = await screen.findByTestId('registration-1');
    expect(within(row).getByText(/1 of 3 registered/)).toBeInTheDocument();
    expect(await within(row).findByText('INV-0001')).toBeInTheDocument();
    // Phase 41 shows the receipt figures; registration itself offers no
    // receipt control, and the server's flags decide the rest (D41-5).
    expect(screen.getByRole('columnheader', { name: 'Receipt recorded' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record receipt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /receipt/i })).not.toBeInTheDocument();
    // The items table carries the Registered column.
    expect(screen.getByRole('columnheader', { name: 'Registered' })).toBeInTheDocument();
  });

  it('shows an inactive linked unit with its state — and still counts it', async () => {
    renderDetail(request({ items: [item({ quantityRegistered: 1 })] }), [
      linkRow({ assetUnit: { ...linkRow().assetUnit, isActive: false } }),
    ]);

    const row = await screen.findByTestId('registration-1');
    expect(await within(row).findByText('Inactive')).toBeInTheDocument();
    expect(within(row).getByText(/1 of 3 registered/)).toBeInTheDocument();
  });

  it('offers register and link to the actor only', async () => {
    renderDetail(request({ steps: [registerStep({ canAct: false })] }));
    await screen.findByTestId('registration-1');
    expect(screen.queryByRole('button', { name: 'Register units' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link an existing unit' })).not.toBeInTheDocument();
  });

  it('offers nothing once the item is fully registered', async () => {
    renderDetail(
      request({ items: [item({ quantityRegistered: 3, quantityNotYetRegistered: 0 })] })
    );
    await screen.findByTestId('registration-1');
    expect(screen.queryByRole('button', { name: 'Register units' })).not.toBeInTheDocument();
  });

  it('hides the lookup without asset-unit:read', async () => {
    signInWith(
      ALL.filter((code) => code !== 'asset-unit:read'),
      { id: ME.id, institutionId: 'inst-1', isSystemWide: false }
    );
    renderDetail(request());
    expect(await screen.findByRole('button', { name: 'Register units' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link an existing unit' })).not.toBeInTheDocument();
  });

  it('unlinks after confirmation where the server allows it, and not elsewhere', async () => {
    renderDetail(request(), [
      linkRow(),
      linkRow({
        id: 'link-2',
        canUnlink: false,
        assetUnit: { ...linkRow().assetUnit, id: 'u2', inventoryCode: 'INV-0002' },
      }),
    ]);
    const unlink = vi.spyOn(requestsApi, 'unlinkUnit').mockResolvedValue(undefined);
    const user = userEvent.setup();

    const buttons = await screen.findAllByRole('button', { name: 'Unlink' });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Unlink' })
    );

    await waitFor(() => expect(unlink).toHaveBeenCalledWith('link-1'));
  });
});

describe('the register dialog', () => {
  it('registers a new asset with the item as the default, and no location field', async () => {
    renderDetail(request());
    const save = vi
      .spyOn(requestsApi, 'registerUnits')
      .mockResolvedValue({ units: [{ id: 'u' }, { id: 'v' }], request: request() });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Register units' }));
    const dialog = await screen.findByRole('dialog');
    // D1: no location field.
    expect(within(dialog).queryByLabelText(/location/i)).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(/does not record that the requester received/)
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('item-1', {
        name: 'Kursi',
        classificationId: '117010101001',
        unitCount: 2,
        departmentId: null,
      })
    );
  });

  /** P3 (§64.3): a department-bound REGISTER step registers for the request's department. */
  it('shows the request’s department fixed for a department-bound step, and never sends one', async () => {
    const tkj = { id: 'dept-tkj', code: 'TKJ', name: 'Teknik Komputer' };
    renderDetail(
      request({
        departmentId: tkj.id,
        department: tkj,
        unitRegistration: { numberComposition: { required: false }, departmentFixed: true },
      })
    );
    const save = vi
      .spyOn(requestsApi, 'registerUnits')
      .mockResolvedValue({ units: [{ id: 'u' }], request: request() });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Register units' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('register-department-fixed')).toHaveTextContent('TKJ');
    expect(within(dialog).queryByRole('combobox', { name: /Department/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).not.toHaveProperty('departmentId');
  });

  it('refuses more units than remain before sending', async () => {
    renderDetail(request());
    const save = vi.spyOn(requestsApi, 'registerUnits');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Register units' }));
    const dialog = await screen.findByRole('dialog');
    const count = within(dialog).getByLabelText(/Number of units/);
    await user.clear(count);
    await user.type(count, '5');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));

    expect(within(dialog).getByText('Between 1 and 2.')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('the link dialog', () => {
  const found = (overrides = {}) => ({
    id: 'unit-9',
    inventoryCode: 'INV-0009',
    asset: { id: 'asset-9', name: 'Meja' },
    lifecycleState: 'ACTIVE',
    isActive: true,
    requestItem: null,
    ...overrides,
  });

  it('finds a unit by inventory code and links it', async () => {
    renderDetail(request());
    vi.spyOn(assetUnitsApi, 'byCode').mockResolvedValue(found());
    const save = vi
      .spyOn(requestsApi, 'linkUnit')
      .mockResolvedValue({ link: linkRow(), request: request() });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Link an existing unit' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Inventory code'), 'INV-0009');
    await user.click(within(dialog).getByRole('button', { name: 'Find' }));
    expect(await within(dialog).findByTestId('found-unit')).toHaveTextContent('INV-0009');
    await user.click(within(dialog).getByRole('button', { name: 'Link' }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('item-1', 'unit-9'));
  });

  it.each([
    ['inactive', { isActive: false }, 'Inactive'],
    ['disposed', { lifecycleState: 'DISPOSED' }, 'This unit is Disposed.'],
    [
      'already linked',
      { requestItem: { requestId: 'r', requestNumber: 'REQ/2026/0002' } },
      'Already registered against REQ/2026/0002.',
    ],
  ])('says why a %s unit cannot be linked, and sends nothing', async (_label, change, text) => {
    renderDetail(request());
    vi.spyOn(assetUnitsApi, 'byCode').mockResolvedValue(found(change));
    const save = vi.spyOn(requestsApi, 'linkUnit');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Link an existing unit' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Inventory code'), 'X');
    await user.click(within(dialog).getByRole('button', { name: 'Find' }));
    expect(await within(dialog).findByText(text)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Link' }));

    expect(save).not.toHaveBeenCalled();
  });
});

/**
 * The four walkthrough fixes: the current state is always shown, translated;
 * a finished REGISTER reads "Completed by"; a registered unit opens its detail.
 */
describe('registered units — state, wording and navigation', () => {
  /** P3 (§64.3): a unit outside the caller's department, linked before the rule. */
  it('shows another department’s linked unit as plain, read-only text', async () => {
    renderDetail(request(), [
      linkRow({
        canUnlink: false,
        assetUnit: {
          ...linkRow().assetUnit,
          id: 'u-tkr',
          inventoryCode: 'TKR-1',
          accessible: false,
        },
      }),
    ]);

    const code = await screen.findByTestId('unit-outside-u-tkr');
    expect(code).toHaveTextContent('TKR-1');
    expect(screen.queryByRole('link', { name: 'TKR-1' })).not.toBeInTheDocument();
    expect(screen.getByText('(another department — read only)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unlink/ })).not.toBeInTheDocument();
  });

  it('always shows the current lifecycle state, translated — a normal unit included', async () => {
    renderDetail(request(), [
      linkRow(),
      linkRow({
        id: 'link-2',
        assetUnit: {
          ...linkRow().assetUnit,
          id: 'u2',
          inventoryCode: 'INV-0002',
          lifecycleState: 'ACTIVE',
        },
      }),
    ]);

    const row = await screen.findByTestId('registration-1');
    expect(await within(row).findByText('Registered')).toBeInTheDocument();
    expect(within(row).getByText('In use')).toBeInTheDocument();
    expect(within(row).queryByText('REGISTERED')).not.toBeInTheDocument();
    expect(within(row).queryByText('ACTIVE')).not.toBeInTheDocument();
  });

  it('translates DISPOSED, and still counts the unit', async () => {
    renderDetail(request({ items: [item({ quantityRegistered: 1 })] }), [
      linkRow({ assetUnit: { ...linkRow().assetUnit, lifecycleState: 'DISPOSED' } }),
    ]);

    const row = await screen.findByTestId('registration-1');
    expect(await within(row).findByText('Disposed')).toBeInTheDocument();
    expect(within(row).queryByText('DISPOSED')).not.toBeInTheDocument();
    expect(within(row).getByText(/1 of 3 registered/)).toBeInTheDocument();
  });

  it('links each registered unit to its existing detail page', async () => {
    renderDetail(request());

    const link = await screen.findByRole('link', { name: 'INV-0001' });
    expect(link).toHaveAttribute('href', '/assets/asset-1/units/unit-1');
  });

  it('words a finished REGISTER as completed, and PROCURE as declared', async () => {
    const acted = {
      state: 'DONE',
      actedByUserId: ME.id,
      actedBy: ME,
      actedAs: { id: 'pa-r', positionCode: 'WAKASEK_SARPRAS', department: null },
      completedAt: '2026-09-25T10:00:00.000Z',
      canAct: false,
      resolvedActors: [],
    };
    renderDetail(
      request({
        steps: [
          registerStep({
            ...acted,
            id: 'step-p',
            sequence: 2,
            stepType: 'PROCURE',
            procurementMode: 'INTERNAL',
          }),
          registerStep(acted),
        ],
      })
    );

    expect(await screen.findByText(/^Completed by Rina Registrar/)).toBeInTheDocument();
    expect(screen.getByText(/^Declared by Rina Registrar/)).toBeInTheDocument();
    expect(screen.getAllByText(/by Rina Registrar as/)).toHaveLength(2);
  });
});

/**
 * REQ-UNIT-012 (migration 056): the units' own funding source. Offered only
 * where the institution's code carries it; the server decides whether it is
 * required (a contractless asset), and a refusal lands on this field.
 */
describe('the funding source in the register dialog', () => {
  const FUNDED = {
    numberComposition: { required: false },
    fundingSource: { inCode: true },
  };
  const SOURCES = [
    { id: 1, name: 'Dana Bos', code: 'BOS_REG' },
    { id: 3, name: 'Komite', code: 'KMT' },
  ];

  beforeEach(() => {
    signInWith([...ALL, 'funding-source:read'], {
      id: ME.id,
      institutionId: 'inst-1',
      isSystemWide: false,
    });
    vi.spyOn(lookupApis['funding-sources'], 'list').mockResolvedValue({
      data: SOURCES,
      meta: { page: 1, pageSize: 100, total: 2 },
    });
  });

  it('is not offered where the code does not carry the funding source', async () => {
    renderDetail(request({ unitRegistration: { numberComposition: { required: false } } }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Register units' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/Funding source/)).not.toBeInTheDocument();
  });

  it('sends the chosen funding source with a contractless new asset', async () => {
    renderDetail(request({ unitRegistration: FUNDED }));
    const save = vi
      .spyOn(requestsApi, 'registerUnits')
      .mockResolvedValue({ units: [{ id: 'u' }], request: request() });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Register units' }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByLabelText(/Funding source/);
    await within(dialog).findByRole('option', { name: 'Komite' });
    await user.selectOptions(select, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ name: 'Kursi', fundingSourceId: 3 })
      )
    );
  });

  it('leaves it out when none is chosen — the contract may name one', async () => {
    renderDetail(request({ unitRegistration: FUNDED }));
    const save = vi
      .spyOn(requestsApi, 'registerUnits')
      .mockResolvedValue({ units: [{ id: 'u' }], request: request() });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Register units' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).not.toHaveProperty('fundingSourceId');
  });

  it('shows the server’s refusal beside the field, not only in a toast', async () => {
    renderDetail(request({ unitRegistration: FUNDED }));
    vi.spyOn(requestsApi, 'registerUnits').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'A funding source is required for this inventory code',
        status: 400,
        details: [
          {
            field: 'fundingSourceId',
            issue: 'choose the funding source the units were acquired with',
          },
        ],
      })
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Register units' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));

    expect(
      await within(dialog).findByText('choose the funding source the units were acquired with')
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('explains, and disables the field, without funding-source:read', async () => {
    signInWith(ALL, { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
    renderDetail(request({ unitRegistration: FUNDED }));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Register units' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Funding source/)).toBeDisabled();
    expect(within(dialog).getByText(/cannot list funding sources/)).toBeInTheDocument();
  });
});

/**
 * P4 (`IMPLEMENTATION_PLAN.md` §64.4): one Unit number field per unit, each
 * with the inventory code it becomes, previewed from the same inputs the
 * registration sends. Empty and repeated values are refused before sending;
 * everything else is the server's to decide, and registration decides again.
 */
describe('unit numbers in the register dialog (P4)', () => {
  const PER_UNIT = {
    numberComposition: { required: true, perUnit: true, maxLength: 16 },
    fundingSource: { inCode: false },
  };

  beforeEach(() => {
    vi.spyOn(inventoryCodesApi, 'preview').mockImplementation((body) =>
      Promise.resolve(fakePreview(body, { recent: ['1.5', '1.4'] }))
    );
  });

  const open = async (data) => {
    renderDetail(data);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Register units' }));
    return { user, dialog: await screen.findByRole('dialog') };
  };
  const fields = (dialog) => within(dialog).getAllByLabelText(/^Unit number/);

  it('gives each unit its own field, shows each code live, and sends one value per unit', async () => {
    const save = vi
      .spyOn(requestsApi, 'registerUnits')
      .mockResolvedValue({ units: [{ id: 'u' }, { id: 'v' }], request: request() });
    const { user, dialog } = await open(request({ unitRegistration: PER_UNIT }));

    expect(fields(dialog)).toHaveLength(2);
    await user.type(fields(dialog)[0], '1.9');
    await user.type(fields(dialog)[1], '1.10');

    await waitFor(() =>
      expect(inventoryCodesApi.preview).toHaveBeenLastCalledWith({
        classificationId: '117010101001',
        institutionId: 'inst-1',
        departmentId: null,
        unitNumbers: ['1.9', '1.10'],
      })
    );
    await waitFor(() =>
      expect(within(dialog).getByTestId('inventory-code-1')).toHaveTextContent(
        '1.10/LAP_TOP/BOS_REG/2026'
      )
    );
    expect(within(dialog).getByText('Recently used unit numbers')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Register' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ unitCount: 2, numberCompositions: ['1.9', '1.10'] })
      )
    );
  });

  it('follows the number of units', async () => {
    const { user, dialog } = await open(request({ unitRegistration: PER_UNIT }));
    const count = within(dialog).getByLabelText(/Number of units/);
    await user.clear(count);
    await user.type(count, '1');
    expect(fields(dialog)).toHaveLength(1);
  });

  it('will not send a repeated or missing unit number', async () => {
    const save = vi.spyOn(requestsApi, 'registerUnits');
    const { user, dialog } = await open(request({ unitRegistration: PER_UNIT }));

    await user.type(fields(dialog)[0], '1.6');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));
    expect(within(dialog).getByText('Give every unit its own unit number.')).toBeInTheDocument();
    expect(within(dialog).getByText('A unit number is required.')).toBeInTheDocument();

    await user.type(fields(dialog)[1], '1.6');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));
    expect(
      within(dialog).getAllByText('Already typed for another unit in this registration.')
    ).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
  });

  it('previews for an existing asset only once one is chosen', async () => {
    vi.spyOn(assetsApi, 'list').mockResolvedValue({
      data: [{ id: 'asset-7', name: 'ZZ Laptop', institutionId: 'inst-1' }],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
    signInWith([...ALL, 'asset:read'], { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
    const { user, dialog } = await open(request({ unitRegistration: PER_UNIT }));

    await user.click(within(dialog).getByLabelText('Existing asset'));
    expect(
      within(dialog).getAllByText('Choose the asset to see the inventory code.').length
    ).toBeGreaterThan(0);
    // Earlier calls were for the new-asset default; none names an asset yet.
    expect(inventoryCodesApi.preview.mock.calls.every(([body]) => !body.assetId)).toBe(true);
  });

  it('previews in the request’s department for a department-bound step (P3)', async () => {
    const tkj = { id: 'dept-tkj', code: 'TKJ', name: 'Teknik Komputer' };
    const { user, dialog } = await open(
      request({
        departmentId: tkj.id,
        department: tkj,
        unitRegistration: { ...PER_UNIT, departmentFixed: true },
      })
    );
    await user.type(fields(dialog)[0], '3.1');
    await waitFor(() =>
      expect(inventoryCodesApi.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ departmentId: 'dept-tkj' })
      )
    );
  });

  it('keeps the server’s final word beside the fields', async () => {
    vi.spyOn(requestsApi, 'registerUnits').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.CONFLICT,
        message: 'That inventory code has already been issued',
        status: 409,
        details: [{ field: 'numberComposition', issue: 'a unit already carries that code' }],
      })
    );
    const { user, dialog } = await open(request({ unitRegistration: PER_UNIT }));
    await user.type(fields(dialog)[0], '1.6');
    await user.type(fields(dialog)[1], '1.7');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));

    expect(await within(dialog).findByText('a unit already carries that code')).toBeInTheDocument();
  });

  it('asks for one value for the batch when a sequence separates the units', async () => {
    const save = vi
      .spyOn(requestsApi, 'registerUnits')
      .mockResolvedValue({ units: [{ id: 'u' }, { id: 'v' }], request: request() });
    const { user, dialog } = await open(
      request({
        unitRegistration: { numberComposition: { required: true, perUnit: false, maxLength: 16 } },
      })
    );
    expect(fields(dialog)).toHaveLength(1);
    expect(within(dialog).getByText(/One unit number for all 2 units/)).toBeInTheDocument();
    await user.type(fields(dialog)[0], 'LAB');
    await user.click(within(dialog).getByRole('button', { name: 'Register' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ numberComposition: 'LAB' })
      )
    );
  });
});
