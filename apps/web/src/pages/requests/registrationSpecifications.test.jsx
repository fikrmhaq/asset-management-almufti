import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import { assetsApi, assetUnitsApi } from '@/api/assetCore';
import { ApiError, ERROR_CODES } from '@/api/errors';
import { changeLanguage, DEFAULT_LANGUAGE } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { AttributeValuesTab } from '@/pages/assets/AssetDetailPage';
import { RequestRegistrationPanel } from './RequestRegistrationPanel';

/**
 * Specifications during registration on screen — REQ-REQUEST-021. The existing
 * attribute values of the registered unit and its asset, each section at its
 * definitions' scope; recorded values read-only, blanks fillable; required
 * marked; the unit of measure shown; the whole set saved with the recorded
 * values carried unchanged.
 */

const ME = { id: 'user-1', username: 'reg', firstName: 'Rina', lastName: 'Registrar' };
const REGISTRAR = ['request:read', 'request-item-unit:read', 'asset:read', 'asset-unit:read'];
const SPECS = ['asset-attribute-value:read', 'asset-attribute-value:update'];

const request = {
  id: 'req-1',
  institutionId: 'inst-1',
  status: 'APPROVED',
  items: [
    {
      id: 'item-1',
      lineNo: 1,
      description: 'Laptop',
      quantityRequired: 2,
      quantityRegistered: 2,
      quantityNotYetRegistered: 0,
    },
  ],
  steps: [{ id: 'step-r', stepType: 'REGISTER', state: 'DONE', canAct: false }],
};

const unit = (id, code, overrides = {}) => ({
  id,
  inventoryCode: code,
  asset: { id: 'asset-1', name: 'Laptop Lab' },
  department: null,
  currentLocation: null,
  lifecycleState: 'REGISTERED',
  isActive: true,
  ...overrides,
});

const linkRow = (assetUnit) => ({
  id: `link-${assetUnit.id}`,
  requestItemId: 'item-1',
  linkedAt: '2026-10-04T00:00:00.000Z',
  linkedBy: ME,
  assetUnit,
  canUnlink: false,
});

const definition = (id, name, overrides = {}) => ({
  attributeDefinitionId: id,
  name,
  attributeType: 'TEXT',
  scope: 'ASSET_UNIT',
  isRequired: false,
  measurementUnitId: null,
  measurementUnitName: null,
  value: null,
  ...overrides,
});

const ASSET_DEFINITIONS = [
  definition('d-ram', 'RAM', {
    attributeType: 'NUMBER',
    scope: 'ASSET',
    measurementUnitId: 'mu-gb',
    measurementUnitName: 'GB',
  }),
];
const UNIT_DEFINITIONS = [
  definition('d-serial', 'Serial Number', { value: 'SN-OLD' }),
  definition('d-mac', 'MAC Address', { isRequired: true }),
  definition('d-vga', 'VGA'),
];

function renderPanel({
  wholeAssetChange = true,
  links = [linkRow(unit('unit-1', 'INV-0001'))],
} = {}) {
  vi.spyOn(requestsApi, 'listItemUnits').mockResolvedValue(links);
  vi.spyOn(assetsApi, 'get').mockResolvedValue({
    id: 'asset-1',
    name: 'Laptop Lab',
    scope: { wholeAssetChange },
  });
  vi.spyOn(assetsApi, 'attributeValues').mockResolvedValue(ASSET_DEFINITIONS);
  vi.spyOn(assetUnitsApi, 'attributeValues').mockResolvedValue(UNIT_DEFINITIONS);
  const saveAsset = vi.spyOn(assetsApi, 'replaceAttributeValues').mockResolvedValue([]);
  const saveUnit = vi.spyOn(assetUnitsApi, 'replaceAttributeValues').mockResolvedValue([]);
  renderScreen(<RequestRegistrationPanel request={request} />);
  return { saveAsset, saveUnit };
}

async function open(user, name = 'Specifications') {
  const row = (await screen.findByRole('link', { name: 'INV-0001' })).closest('li');
  await user.click(within(row).getByRole('button', { name }));
  return screen.findByRole('dialog');
}

const labelOf = (scope, name) => within(scope).getByText(name).closest('label');

beforeEach(() => {
  signInWith([...REGISTRAR, ...SPECS], { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await changeLanguage(DEFAULT_LANGUAGE);
});

describe('the action on registered units', () => {
  it('is offered on a reachable unit — also once REGISTER is DONE', async () => {
    renderPanel();
    const row = (await screen.findByRole('link', { name: 'INV-0001' })).closest('li');
    expect(within(row).getByRole('button', { name: 'Specifications' })).toBeInTheDocument();
  });

  it('is absent without asset-attribute-value:read', async () => {
    signInWith(REGISTRAR, { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
    renderPanel();
    await screen.findByRole('link', { name: 'INV-0001' });
    expect(screen.queryByRole('button', { name: 'Specifications' })).not.toBeInTheDocument();
  });

  it('is absent on a unit outside the caller’s department', async () => {
    renderPanel({ links: [linkRow(unit('unit-9', 'INV-0009', { accessible: false }))] });
    await screen.findByTestId('unit-outside-unit-9');
    expect(screen.queryByRole('button', { name: 'Specifications' })).not.toBeInTheDocument();
  });
});

describe('the dialog', () => {
  it('shows the asset’s and the unit’s definitions in their own sections', async () => {
    renderPanel();
    const dialog = await open(userEvent.setup());

    const assetSection = await within(dialog).findByTestId('registration-specifications-asset');
    expect(within(assetSection).getByText('Asset specifications')).toBeInTheDocument();
    expect(await within(assetSection).findByText('RAM')).toBeInTheDocument();
    expect(within(assetSection).queryByText('Serial Number')).not.toBeInTheDocument();

    const unitSection = within(dialog).getByTestId('registration-specifications-unit');
    expect(within(unitSection).getByText("This unit's specifications")).toBeInTheDocument();
    for (const name of ['Serial Number', 'MAC Address', 'VGA']) {
      expect(await within(unitSection).findByText(name)).toBeInTheDocument();
    }
    expect(within(unitSection).queryByText('RAM')).not.toBeInTheDocument();
  });

  it('shows the measurement unit beside a number, and marks a required field', async () => {
    renderPanel();
    const dialog = await open(userEvent.setup());

    const assetSection = await within(dialog).findByTestId('registration-specifications-asset');
    expect(await within(assetSection).findByText('GB')).toBeInTheDocument();
    const unitSection = within(dialog).getByTestId('registration-specifications-unit');
    await within(unitSection).findByText('MAC Address');
    expect(labelOf(unitSection, 'MAC Address')).toHaveTextContent('MAC Address*');
    expect(labelOf(unitSection, 'VGA')).toHaveTextContent(/^VGA$/);
  });

  it('withholds the asset section when the asset is not wholly the caller’s (P3)', async () => {
    renderPanel({ wholeAssetChange: false });
    const dialog = await open(userEvent.setup());

    expect(
      await within(dialog).findByTestId('registration-specifications-no-asset')
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByTestId('registration-specifications-asset')
    ).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('registration-specifications-unit')).toBeInTheDocument();
  });

  it('shows a recorded value read-only, with the way to the unit page; blanks stay editable', async () => {
    renderPanel();
    const dialog = await open(userEvent.setup());
    const unitSection = within(dialog).getByTestId('registration-specifications-unit');

    const serial = await within(unitSection).findByLabelText('Serial Number');
    expect(serial).toHaveValue('SN-OLD');
    expect(serial).toBeDisabled();
    expect(
      within(unitSection).getByText('Already recorded — change it on the asset or unit page.')
    ).toBeInTheDocument();
    expect(within(unitSection).getByLabelText(/MAC Address/)).toBeEnabled();
    expect(within(unitSection).getByLabelText('VGA')).toBeEnabled();
    expect(within(unitSection).getByRole('link', { name: 'Open unit' })).toHaveAttribute(
      'href',
      '/assets/asset-1/units/unit-1'
    );
    const assetSection = within(dialog).getByTestId('registration-specifications-asset');
    expect(within(assetSection).getByRole('link', { name: 'Open asset' })).toHaveAttribute(
      'href',
      '/assets/asset-1'
    );
  });

  it('saves the whole set — the recorded value carried unchanged, the blanks filled', async () => {
    const { saveUnit, saveAsset } = renderPanel();
    const user = userEvent.setup();
    const dialog = await open(user);
    const unitSection = within(dialog).getByTestId('registration-specifications-unit');

    await user.type(await within(unitSection).findByLabelText(/MAC Address/), 'AA:BB');
    await user.type(within(unitSection).getByLabelText('VGA'), 'GTX');
    await user.click(within(unitSection).getByRole('button', { name: 'Save specifications' }));

    await waitFor(() =>
      expect(saveUnit).toHaveBeenCalledWith('unit-1', {
        'd-serial': 'SN-OLD',
        'd-mac': 'AA:BB',
        'd-vga': 'GTX',
      })
    );
    expect(saveAsset).not.toHaveBeenCalled();

    const assetSection = within(dialog).getByTestId('registration-specifications-asset');
    await user.type(within(assetSection).getByLabelText('RAM'), '16');
    await user.click(within(assetSection).getByRole('button', { name: 'Save specifications' }));
    await waitFor(() => expect(saveAsset).toHaveBeenCalledWith('asset-1', { 'd-ram': '16' }));
  });

  it('shows the server’s refusal under the field it names', async () => {
    const { saveUnit } = renderPanel();
    saveUnit.mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'One or more attribute values are invalid',
        status: 400,
        details: [
          { field: 'values.d-mac', issue: 'is required for this classification (REQ-ATTR-005)' },
        ],
      })
    );
    const user = userEvent.setup();
    const dialog = await open(user);
    const unitSection = within(dialog).getByTestId('registration-specifications-unit');

    await user.type(await within(unitSection).findByLabelText('VGA'), 'GTX');
    await user.click(within(unitSection).getByRole('button', { name: 'Save specifications' }));

    expect(
      await within(unitSection).findByText('is required for this classification (REQ-ATTR-005)')
    ).toBeInTheDocument();
    expect(within(unitSection).getByLabelText(/MAC Address/)).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });

  it('offers no save without asset-attribute-value:update', async () => {
    signInWith([...REGISTRAR, 'asset-attribute-value:read'], {
      id: ME.id,
      institutionId: 'inst-1',
      isSystemWide: false,
    });
    renderPanel();
    const dialog = await open(userEvent.setup());
    const unitSection = within(dialog).getByTestId('registration-specifications-unit');

    expect(await within(unitSection).findByLabelText('VGA')).toBeDisabled();
    expect(
      within(dialog).queryByRole('button', { name: 'Save specifications' })
    ).not.toBeInTheDocument();
  });

  it('speaks Indonesian when the interface does', async () => {
    await changeLanguage('id');
    renderPanel();
    const dialog = await open(userEvent.setup(), 'Spesifikasi');

    expect(within(dialog).getByText('Spesifikasi — INV-0001')).toBeInTheDocument();
    expect(await within(dialog).findByText('Spesifikasi aset')).toBeInTheDocument();
    expect(within(dialog).getByText('Spesifikasi unit ini')).toBeInTheDocument();
    expect(
      await within(dialog).findByText('Sudah tercatat — ubah di halaman aset atau unit.')
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: 'Simpan spesifikasi' }).length).toBe(2);
  });
});

describe('the existing detail-page tab', () => {
  it('still edits the whole set, now with the required marker and the unit shown', async () => {
    const save = vi.fn().mockResolvedValue([]);
    renderScreen(
      <AttributeValuesTab
        ownerId="unit-1"
        canEdit
        load={{ key: ['unit-1', 'attribute-values'], fn: async () => UNIT_DEFINITIONS }}
        save={{ fn: save }}
      />
    );
    const user = userEvent.setup();

    const mac = await screen.findByLabelText(/MAC Address/);
    expect(labelOf(document.body, 'MAC Address')).toHaveTextContent('MAC Address*');
    // Nothing is locked on the detail page: a recorded value stays editable there.
    expect(screen.getByLabelText('Serial Number')).toBeEnabled();
    await user.clear(screen.getByLabelText('Serial Number'));
    await user.type(screen.getByLabelText('Serial Number'), 'SN-NEW');
    await user.type(mac, 'AA');
    await user.click(screen.getByRole('button', { name: 'Save attributes' }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ 'd-serial': 'SN-NEW', 'd-mac': 'AA', 'd-vga': null })
    );
  });

  it('shows the unit of measure beside a number', async () => {
    renderScreen(
      <AttributeValuesTab
        ownerId="asset-1"
        canEdit
        load={{ key: ['asset-1', 'attribute-values'], fn: async () => ASSET_DEFINITIONS }}
        save={{ fn: vi.fn() }}
      />
    );
    expect(await screen.findByText('GB')).toBeInTheDocument();
  });
});
