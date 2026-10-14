import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import { changeLanguage, DEFAULT_LANGUAGE } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { ReceiptDialog } from './RequestFulfilmentDialogs';
import { RequestReceiptConfirmations } from './RequestReceiptConfirmations';

/**
 * Receipt photos per received unit on screen — REQ-REQUEST-022. In Record
 * receipt, each selected unit may have its own photos, chosen beside it; the
 * rest are of the whole receipt; 1–5 in total. The confirmation shows them in
 * context: the whole receipt's, then each unit's own.
 */

const ME = { id: 'user-1', username: 'guru', firstName: 'Guru', lastName: 'Umum' };

const request = {
  id: 'req-1',
  institutionId: 'inst-1',
  status: 'APPROVED',
  requesterUserId: ME.id,
  destination: null,
  createdAt: '2026-09-20T01:00:00.000Z',
  items: [{ id: 'item-1', lineNo: 1, description: 'Laptop' }],
};

const link = (code) => ({
  id: `link-${code}`,
  assetUnit: {
    id: `unit-${code}`,
    inventoryCode: code,
    lifecycleState: 'REGISTERED',
    isActive: true,
  },
  receipt: null,
  receivable: true,
});

const png = (name) => new File(['png'], name, { type: 'image/png' });

function renderDialog() {
  vi.spyOn(requestsApi, 'listItemUnits').mockResolvedValue([link('INV-A'), link('INV-B')]);
  const receive = vi.spyOn(requestsApi, 'receive').mockResolvedValue(request);
  renderScreen(<ReceiptDialog request={request} open onOpenChange={() => {}} onDone={() => {}} />);
  return { receive };
}

/** What the dialog sent, as plain values. */
const sent = (receive) => {
  const formData = receive.mock.calls[0][1];
  return {
    assetUnitIds: formData.getAll('assetUnitIds'),
    photos: formData.getAll('photos').map((file) => file.name),
    unitPhotoUnitIds: formData.getAll('unitPhotoUnitIds'),
    unitPhotos: formData.getAll('unitPhotos').map((file) => file.name),
  };
};

async function fillAndSelect(user, dialog, codes) {
  for (const code of codes) {
    await user.click(await within(dialog).findByRole('checkbox', { name: code }));
  }
  await user.type(within(dialog).getByLabelText(/Description/), 'Sudah diterima');
}

beforeEach(() => {
  signInWith(
    ['request:read', 'request:receive', 'request-item-unit:read', 'request-document:read'],
    {
      id: ME.id,
      institutionId: 'inst-1',
      isSystemWide: false,
    }
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await changeLanguage(DEFAULT_LANGUAGE);
});

describe('Record receipt — photos of each unit', () => {
  it('offers a unit’s own photos only once the unit is selected', async () => {
    renderDialog();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');

    await within(dialog).findByRole('checkbox', { name: 'INV-A' });
    expect(within(dialog).queryByTestId('receipt-unit-photos-INV-A')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'INV-A' }));
    expect(within(dialog).getByTestId('receipt-unit-photos-INV-A')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Photos of this unit (INV-A)')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('receipt-unit-photos-INV-B')).not.toBeInTheDocument();
  });

  it('sends each unit’s photos naming that unit, and the whole receipt’s apart', async () => {
    const { receive } = renderDialog();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await fillAndSelect(user, dialog, ['INV-A', 'INV-B']);

    await user.upload(within(dialog).getByLabelText('Photos of this unit (INV-A)'), [
      png('a1.png'),
      png('a2.png'),
    ]);
    await user.upload(within(dialog).getByLabelText('Photos of this unit (INV-B)'), png('b1.png'));
    await user.upload(within(dialog).getByLabelText('Add photos'), png('umum.png'));
    expect(within(dialog).getByTestId('receipt-unit-photo-list-INV-A')).toHaveTextContent('a1.png');
    expect(within(dialog).getByTestId('receipt-unit-photo-list-INV-B')).not.toHaveTextContent(
      'a1.png'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));

    await waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect(sent(receive)).toEqual({
      assetUnitIds: ['unit-INV-A', 'unit-INV-B'],
      photos: ['umum.png'],
      unitPhotoUnitIds: ['unit-INV-A', 'unit-INV-A', 'unit-INV-B'],
      unitPhotos: ['a1.png', 'a2.png', 'b1.png'],
    });
  });

  it('counts unit photos toward the one-photo minimum', async () => {
    const { receive } = renderDialog();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await fillAndSelect(user, dialog, ['INV-A']);

    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(within(dialog).getByText('Add at least one photo.')).toBeInTheDocument();
    expect(receive).not.toHaveBeenCalled();

    await user.upload(within(dialog).getByLabelText('Photos of this unit (INV-A)'), png('a.png'));
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    await waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect(sent(receive)).toMatchObject({ photos: [], unitPhotos: ['a.png'] });
  });

  it('holds five photos in total across the receipt and its units', async () => {
    renderDialog();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await fillAndSelect(user, dialog, ['INV-A', 'INV-B']);

    await user.upload(within(dialog).getByLabelText('Add photos'), [png('g1.png'), png('g2.png')]);
    await user.upload(within(dialog).getByLabelText('Photos of this unit (INV-A)'), [
      png('a1.png'),
      png('a2.png'),
    ]);
    await user.upload(within(dialog).getByLabelText('Photos of this unit (INV-B)'), [
      png('b1.png'),
      png('b2.png'),
    ]);

    // Room for one only: b2 is refused, and every picker is full.
    expect(
      within(within(dialog).getByTestId('receipt-unit-photo-list-INV-B')).getAllByRole('listitem')
    ).toHaveLength(1);
    expect(within(dialog).getByText('At most 5 photos.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add photos' })).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Photos of this unit (INV-A)' })
    ).toBeDisabled();
  });

  it('drops a unit’s photos when the unit is deselected', async () => {
    const { receive } = renderDialog();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await fillAndSelect(user, dialog, ['INV-A', 'INV-B']);
    await user.upload(within(dialog).getByLabelText('Photos of this unit (INV-B)'), png('b1.png'));
    await user.upload(within(dialog).getByLabelText('Add photos'), png('umum.png'));

    await user.click(within(dialog).getByRole('checkbox', { name: 'INV-B' }));
    expect(within(dialog).queryByTestId('receipt-unit-photos-INV-B')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Record receipt' }));

    await waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect(sent(receive)).toEqual({
      assetUnitIds: ['unit-INV-A'],
      photos: ['umum.png'],
      unitPhotoUnitIds: [],
      unitPhotos: [],
    });
  });

  it('refuses a non-image beside its unit — in English and in Indonesian', async () => {
    renderDialog();
    const user = userEvent.setup({ applyAccept: false });
    let dialog = await screen.findByRole('dialog');
    await fillAndSelect(user, dialog, ['INV-A']);

    await user.upload(
      within(dialog).getByLabelText('Photos of this unit (INV-A)'),
      new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })
    );
    const unitArea = within(dialog).getByTestId('receipt-unit-photos-INV-A');
    expect(
      within(unitArea).getByText('scan.pdf: only JPG or PNG photos are accepted.')
    ).toBeInTheDocument();
    expect(within(unitArea).queryByTestId('receipt-unit-photo-list-INV-A')).not.toBeInTheDocument();

    await changeLanguage('id');
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Foto unit ini (INV-A)')).toBeInTheDocument();
    expect(within(dialog).getByText('Foto penerimaan secara keseluruhan')).toBeInTheDocument();
  });
});

describe('the confirmation — photos in context', () => {
  const confirmation = (overrides = {}) => ({
    id: 'conf-1',
    placement: null,
    description: 'Sudah diterima',
    destination: null,
    receivedOn: '2026-10-04',
    confirmedBy: ME,
    confirmedAt: '2026-10-04T02:00:00.000Z',
    state: 'ACTIVE',
    units: [
      { assetUnitId: 'unit-INV-A', inventoryCode: 'INV-A', receiptId: 'rc-a', reversed: false },
      { assetUnitId: 'unit-INV-B', inventoryCode: 'INV-B', receiptId: 'rc-b', reversed: false },
    ],
    photos: [
      {
        id: 'p-g',
        fileName: 'umum.png',
        fileType: 'image/png',
        fileSize: 3,
        receiptId: null,
        assetUnitId: null,
      },
      {
        id: 'p-a1',
        fileName: 'a1.png',
        fileType: 'image/png',
        fileSize: 3,
        receiptId: 'rc-a',
        assetUnitId: 'unit-INV-A',
      },
      {
        id: 'p-a2',
        fileName: 'a2.png',
        fileType: 'image/png',
        fileSize: 3,
        receiptId: 'rc-a',
        assetUnitId: 'unit-INV-A',
      },
      {
        id: 'p-b1',
        fileName: 'b1.png',
        fileType: 'image/png',
        fileSize: 3,
        receiptId: 'rc-b',
        assetUnitId: 'unit-INV-B',
      },
    ],
    ...overrides,
  });

  it('shows the whole receipt’s photos, then each unit’s own — none under the wrong unit', async () => {
    signInWith(['request:read'], { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
    renderScreen(
      <RequestReceiptConfirmations request={{ receiptConfirmations: [confirmation()] }} />
    );

    const whole = await screen.findByTestId('confirmation-whole-photos');
    expect(whole).toHaveTextContent('Photos of the whole receipt');
    expect(whole).toHaveTextContent('umum.png');
    expect(whole).not.toHaveTextContent('a1.png');
    const a = screen.getByTestId('confirmation-unit-photos-INV-A');
    expect(a).toHaveTextContent('Photos of unit INV-A');
    expect(a).toHaveTextContent('a1.png, a2.png');
    expect(a).not.toHaveTextContent('b1.png');
    const b = screen.getByTestId('confirmation-unit-photos-INV-B');
    expect(b).toHaveTextContent('b1.png');
    expect(b).not.toHaveTextContent('a1.png');
  });

  it('keeps a superseded confirmation’s photos under their reversed units', async () => {
    signInWith(['request:read'], { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
    renderScreen(
      <RequestReceiptConfirmations
        request={{
          receiptConfirmations: [
            confirmation({
              state: 'SUPERSEDED',
              units: [
                {
                  assetUnitId: 'unit-INV-A',
                  inventoryCode: 'INV-A',
                  receiptId: 'rc-a',
                  reversed: true,
                },
                {
                  assetUnitId: 'unit-INV-B',
                  inventoryCode: 'INV-B',
                  receiptId: 'rc-b',
                  reversed: true,
                },
              ],
            }),
          ],
        }}
      />
    );

    expect(await screen.findByText('Superseded')).toBeInTheDocument();
    expect(screen.getByTestId('confirmation-unit-photos-INV-A')).toHaveTextContent(
      'INV-A (receipt reversed)'
    );
    expect(screen.getByTestId('confirmation-unit-photos-INV-A')).toHaveTextContent('a1.png');
  });

  it('shows an existing general-only confirmation as before', async () => {
    signInWith(['request:read'], { id: ME.id, institutionId: 'inst-1', isSystemWide: false });
    renderScreen(
      <RequestReceiptConfirmations
        request={{
          receiptConfirmations: [
            confirmation({
              photos: [{ id: 'p-old', fileName: 'depan.png', fileType: 'image/png', fileSize: 3 }],
            }),
          ],
        }}
      />
    );

    expect(await screen.findByTestId('confirmation-whole-photos')).toHaveTextContent('depan.png');
    expect(screen.queryByTestId('confirmation-unit-photos-INV-A')).not.toBeInTheDocument();
  });
});
