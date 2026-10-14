import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import * as assetCoreApi from '@/api/assetCore';
import { ApiError, ERROR_CODES } from '@/api/errors';
import { changeLanguage, DEFAULT_LANGUAGE } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { AttachmentsPanel } from '@/components/asset/AttachmentsPanel';
import { AssetUnitDetailPage } from '@/pages/assets/AssetUnitDetailPage';
import { RequestRegistrationPanel } from './RequestRegistrationPanel';

/**
 * Registration photos on screen — REQ-REQUEST-020. Offered per registered unit
 * to a holder of attachment:create, whatever the REGISTER step's state; the unit
 * section always, the asset section only when the whole asset is the caller's
 * (`scope.wholeAssetChange`); JPG / PNG only; never worded as receipt.
 */

const { assetsApi, assetUnitsApi, locationsApi } = assetCoreApi;
const ME = { id: 'user-1', username: 'reg', firstName: 'Rina', lastName: 'Registrar' };
const REGISTRAR = [
  'request:read',
  'request-item:register',
  'request-item-unit:read',
  'asset:read',
  'asset-unit:read',
];
const ATTACH = ['attachment:create', 'attachment:read', 'attachment:delete'];

const registerStep = (overrides = {}) => ({
  id: 'step-r',
  sequence: 3,
  stepType: 'REGISTER',
  actorPositionCode: 'WAKASEK_SARPRAS',
  state: 'ACTIVE',
  canAct: true,
  resolvedActors: [],
  ...overrides,
});

const request = (overrides = {}) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  status: 'APPROVED',
  items: [
    {
      id: 'item-1',
      lineNo: 1,
      description: 'Kursi',
      quantityRequired: 2,
      quantityRegistered: 2,
      quantityNotYetRegistered: 0,
    },
  ],
  steps: [registerStep()],
  ...overrides,
});

const unit = (id, code, overrides = {}) => ({
  id,
  inventoryCode: code,
  asset: { id: 'asset-1', name: 'Kursi kerja' },
  department: null,
  currentLocation: null,
  lifecycleState: 'REGISTERED',
  isActive: true,
  ...overrides,
});

const linkRow = (assetUnit, overrides = {}) => ({
  id: `link-${assetUnit.id}`,
  requestItemId: 'item-1',
  linkedAt: '2026-10-04T00:00:00.000Z',
  linkedBy: ME,
  assetUnit,
  canUnlink: false,
  ...overrides,
});

const attachment = (id, overrides = {}) => ({
  id,
  assetId: 'asset-1',
  assetUnitId: null,
  fileName: `${id}.png`,
  fileType: 'image/png',
  fileSize: 2048,
  uploadedBy: ME.id,
  purpose: 'REGISTRATION_PHOTO',
  createdAt: '2026-10-04T01:00:00.000Z',
  ...overrides,
});

const ATTACHMENTS = [
  attachment('unit-photo', { assetUnitId: 'unit-1' }),
  attachment('sibling-photo', { assetUnitId: 'unit-2' }),
  attachment('asset-photo'),
  attachment('nota', { fileName: 'nota.pdf', fileType: 'application/pdf', purpose: null }),
];

const png = (name = 'foto.png') => new File(['png'], name, { type: 'image/png' });

function renderPanel({
  data = request(),
  links = [linkRow(unit('unit-1', 'INV-0001')), linkRow(unit('unit-2', 'INV-0002'))],
  wholeAssetChange = true,
} = {}) {
  vi.spyOn(requestsApi, 'listItemUnits').mockResolvedValue(links);
  vi.spyOn(assetsApi, 'listAttachments').mockResolvedValue(ATTACHMENTS);
  vi.spyOn(assetsApi, 'get').mockResolvedValue({
    id: 'asset-1',
    name: 'Kursi kerja',
    scope: { wholeAssetChange },
  });
  const upload = vi
    .spyOn(assetsApi, 'uploadAttachment')
    .mockResolvedValue(attachment('new-photo', { assetUnitId: 'unit-1' }));
  renderScreen(<RequestRegistrationPanel request={data} />);
  return { upload };
}

async function openFor(user, code = 'INV-0001') {
  const row = (await screen.findByRole('link', { name: code })).closest('li');
  await user.click(within(row).getByRole('button', { name: 'Registration photos' }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  signInWith([...REGISTRAR, ...ATTACH], {
    id: ME.id,
    institutionId: 'inst-1',
    isSystemWide: false,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await changeLanguage(DEFAULT_LANGUAGE);
});

describe('the action on registered units', () => {
  it('is offered per reachable unit — also once REGISTER is DONE', async () => {
    renderPanel({ data: request({ steps: [registerStep({ state: 'DONE', canAct: false })] }) });

    await screen.findByRole('link', { name: 'INV-0001' });
    expect(screen.getAllByRole('button', { name: 'Registration photos' })).toHaveLength(2);
  });

  it('is absent without attachment:create', async () => {
    signInWith(REGISTRAR, { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
    renderPanel();
    await screen.findByRole('link', { name: 'INV-0001' });
    expect(screen.queryByRole('button', { name: 'Registration photos' })).not.toBeInTheDocument();
  });

  it('is absent on a unit outside the caller’s department', async () => {
    renderPanel({
      links: [linkRow(unit('unit-9', 'INV-0009', { accessible: false }))],
    });
    await screen.findByTestId('unit-outside-unit-9');
    expect(screen.queryByRole('button', { name: 'Registration photos' })).not.toBeInTheDocument();
  });
});

describe('the dialog', () => {
  it('says what the photos are — and that they are not proof of receipt', async () => {
    renderPanel();
    const dialog = await openFor(userEvent.setup());

    expect(within(dialog).getByText('Registration photos — INV-0001')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Photos of what was registered, kept with the asset and its units. They are not proof of receipt.'
      )
    ).toBeInTheDocument();
  });

  it('lists this unit’s registration photos only, and the asset’s own in their section', async () => {
    renderPanel();
    const dialog = await openFor(userEvent.setup());

    const unitSection = await within(dialog).findByTestId('registration-photos-unit');
    await within(unitSection).findByText('unit-photo.png');
    expect(within(unitSection).queryByText('sibling-photo.png')).not.toBeInTheDocument();
    expect(within(unitSection).queryByText('asset-photo.png')).not.toBeInTheDocument();
    expect(within(unitSection).queryByText('nota.pdf')).not.toBeInTheDocument();

    const assetSection = await within(dialog).findByTestId('registration-photos-asset');
    expect(within(assetSection).getByText('asset-photo.png')).toBeInTheDocument();
    expect(within(assetSection).queryByText('unit-photo.png')).not.toBeInTheDocument();
    expect(
      within(assetSection).getByText('Photo of the asset (all its units)')
    ).toBeInTheDocument();
  });

  it('withholds the asset section when the asset is not wholly the caller’s (P3)', async () => {
    renderPanel({ wholeAssetChange: false });
    const dialog = await openFor(userEvent.setup());

    expect(await within(dialog).findByTestId('registration-photos-no-asset')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('registration-photos-asset')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('registration-photos-unit')).toBeInTheDocument();
  });

  it('uploads a unit photo for exactly that unit, and an asset photo for none', async () => {
    const { upload } = renderPanel();
    const user = userEvent.setup();
    const dialog = await openFor(user);

    await user.upload(
      within(dialog).getByLabelText('Choose a photo — Photo of this unit'),
      png('unit.png')
    );
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    let [assetId, form] = upload.mock.calls[0];
    expect(assetId).toBe('asset-1');
    expect(form.get('assetUnitId')).toBe('unit-1');
    expect(form.get('purpose')).toBe('REGISTRATION_PHOTO');
    expect(form.get('file').name).toBe('unit.png');

    await within(dialog).findByTestId('registration-photos-asset');
    await user.upload(
      within(dialog).getByLabelText('Choose a photo — Photo of the asset (all its units)'),
      png('asset.png')
    );
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    [assetId, form] = upload.mock.calls[1];
    expect(form.get('assetUnitId')).toBeNull();
    expect(form.get('purpose')).toBe('REGISTRATION_PHOTO');
  });

  it('refuses a non-image before sending it, in English', async () => {
    const { upload } = renderPanel();
    const user = userEvent.setup({ applyAccept: false });
    const dialog = await openFor(user);

    await user.upload(
      within(dialog).getByLabelText('Choose a photo — Photo of this unit'),
      new File(['%PDF'], 'nota.pdf', { type: 'application/pdf' })
    );

    expect(
      await within(dialog).findByText('Only JPG or PNG photos can be added.')
    ).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it('speaks Indonesian when the interface does', async () => {
    await changeLanguage('id');
    const { upload } = renderPanel();
    const user = userEvent.setup({ applyAccept: false });
    const row = (await screen.findByRole('link', { name: 'INV-0001' })).closest('li');
    await user.click(within(row).getByRole('button', { name: 'Foto registrasi' }));
    const dialog = await screen.findByRole('dialog');

    expect(
      within(dialog).getByText(
        'Foto barang yang didaftarkan, disimpan bersama aset dan unitnya. Foto ini bukan bukti penerimaan.'
      )
    ).toBeInTheDocument();
    await user.upload(
      within(dialog).getByLabelText('Pilih foto — Foto unit ini'),
      new File(['x'], 'foto.gif', { type: 'image/gif' })
    );
    expect(
      await within(dialog).findByText('Hanya foto JPG atau PNG yang dapat ditambahkan.')
    ).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal in the section it concerns', async () => {
    const { upload } = renderPanel();
    upload.mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Only a registered asset or unit takes a registration photo',
        status: 400,
        details: [
          {
            field: 'purpose',
            issue: 'a registration photo is of a unit registered against a request item',
          },
        ],
      })
    );
    const user = userEvent.setup();
    const dialog = await openFor(user);

    await user.upload(within(dialog).getByLabelText('Choose a photo — Photo of this unit'), png());

    const unitSection = within(dialog).getByTestId('registration-photos-unit');
    expect(
      await within(unitSection).findByText(
        'a registration photo is of a unit registered against a request item'
      )
    ).toBeInTheDocument();
  });
});

describe('the existing attachment views', () => {
  it('labels a registration photo among ordinary files, and narrows to one unit', async () => {
    vi.spyOn(assetsApi, 'listAttachments').mockResolvedValue(ATTACHMENTS);
    renderScreen(<AttachmentsPanel assetId="asset-1" assetUnitId="unit-1" />);

    expect(await screen.findByText('unit-photo.png')).toBeInTheDocument();
    expect(screen.queryByText('sibling-photo.png')).not.toBeInTheDocument();
    expect(screen.queryByText('asset-photo.png')).not.toBeInTheDocument();
    expect(screen.getByTestId('attachment-registration-photo-unit-photo')).toHaveTextContent(
      'Registration photo'
    );
  });

  it('marks nothing on an ordinary file', async () => {
    vi.spyOn(assetsApi, 'listAttachments').mockResolvedValue(ATTACHMENTS);
    renderScreen(<AttachmentsPanel assetId="asset-1" />);

    expect(await screen.findByText('nota.pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('attachment-registration-photo-nota')).not.toBeInTheDocument();
    expect(screen.getAllByText('Registration photo')).toHaveLength(3);
  });
});

describe('the unit detail page (D3)', () => {
  const UNIT = {
    id: 'unit-1',
    assetId: 'asset-1',
    description: 'Kursi A',
    lifecycleState: 'REGISTERED',
    currentCondition: null,
    currentLocationId: null,
    isActive: true,
  };

  const renderUnit = () => {
    vi.spyOn(assetUnitsApi, 'get').mockResolvedValue(UNIT);
    vi.spyOn(assetsApi, 'get').mockResolvedValue({ id: 'asset-1', name: 'Kursi kerja' });
    vi.spyOn(assetsApi, 'listAttachments').mockResolvedValue(ATTACHMENTS);
    vi.spyOn(locationsApi, 'context').mockResolvedValue({ path: [], floorPlan: null });
    vi.spyOn(assetUnitsApi, 'attributeValues').mockResolvedValue([]);
    renderScreen(<AssetUnitDetailPage />, {
      path: '/assets/:id/units/:unitId',
      route: '/assets/asset-1/units/unit-1',
    });
  };

  it('shows the unit’s own files in an Attachments tab', async () => {
    renderUnit();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Attachments' }));

    expect(await screen.findByText('unit-photo.png')).toBeInTheDocument();
    expect(screen.queryByText('sibling-photo.png')).not.toBeInTheDocument();
    expect(screen.queryByText('asset-photo.png')).not.toBeInTheDocument();
    expect(assetsApi.listAttachments).toHaveBeenCalledWith('asset-1');
  });

  it('offers no tab without attachment:read', async () => {
    signInWith(['asset:read', 'asset-unit:read'], {
      id: ME.id,
      institutionId: 'inst-1',
      isSystemWide: false,
    });
    renderUnit();

    await screen.findByRole('tab', { name: 'History' });
    expect(screen.queryByRole('tab', { name: 'Attachments' })).not.toBeInTheDocument();
  });
});
