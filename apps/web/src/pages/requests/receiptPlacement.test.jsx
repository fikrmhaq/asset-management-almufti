import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { requestsApi } from '@/api/requests';
import { changeLanguage, DEFAULT_LANGUAGE } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { ReceiptDialog } from './RequestFulfilmentDialogs';
import { RequestReceiptConfirmations } from './RequestReceiptConfirmations';

/**
 * Receipt places the unit at its intended location — REQ-REQUEST-024. Record
 * receipt says, per selected unit, what receiving will do to its location; the
 * confirmation says where each unit is now, or that it still needs placement.
 */

const ME = { id: 'user-1', username: 'guru', firstName: 'Guru', lastName: 'Umum' };
const ROOM = { id: 'loc-room', name: 'Ruang Guru', isActive: true };

const request = (destination = ROOM) => ({
  id: 'req-1',
  institutionId: 'inst-1',
  status: 'APPROVED',
  requesterUserId: ME.id,
  destination,
  createdAt: '2026-09-20T01:00:00.000Z',
  items: [{ id: 'item-1', lineNo: 1, description: 'Laptop' }],
});

const link = (code, currentLocation = null) => ({
  id: `link-${code}`,
  assetUnit: {
    id: `unit-${code}`,
    inventoryCode: code,
    lifecycleState: 'REGISTERED',
    isActive: true,
    currentLocation,
  },
  receipt: null,
  receivable: true,
});

function renderDialog(destination) {
  vi.spyOn(requestsApi, 'listItemUnits').mockResolvedValue([
    link('INV-A'),
    link('INV-B', { id: 'loc-lab', name: 'Lab TKJ' }),
  ]);
  renderScreen(
    <ReceiptDialog request={request(destination)} open onOpenChange={() => {}} onDone={() => {}} />
  );
}

async function selectBoth(user) {
  const dialog = await screen.findByRole('dialog');
  for (const code of ['INV-A', 'INV-B']) {
    await user.click(await within(dialog).findByRole('checkbox', { name: code }));
  }
  return dialog;
}

beforeEach(() => {
  signInWith(['request:read', 'request:receive', 'request-item-unit:read'], {
    id: ME.id,
    institutionId: 'inst-1',
    isSystemWide: false,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await changeLanguage(DEFAULT_LANGUAGE);
});

describe('Record receipt — what happens to each unit’s location', () => {
  it('says nothing until a placement is chosen', async () => {
    renderDialog();
    const dialog = await selectBoth(userEvent.setup());

    expect(within(dialog).queryByTestId('receipt-unit-placement-INV-A')).not.toBeInTheDocument();
    // A unit with a location stays where it is whatever is chosen.
    expect(within(dialog).getByTestId('receipt-unit-placement-INV-B')).toHaveTextContent(
      'Stays at Lab TKJ'
    );
  });

  it('places an unplaced unit at the intended place, and keeps a placed one where it is', async () => {
    renderDialog();
    const user = userEvent.setup();
    const dialog = await selectBoth(user);
    await user.click(within(dialog).getByLabelText('At the intended place'));

    expect(within(dialog).getByTestId('receipt-unit-placement-INV-A')).toHaveTextContent(
      'Will be placed at Ruang Guru'
    );
    expect(within(dialog).getByTestId('receipt-unit-placement-INV-B')).toHaveTextContent(
      'Stays at Lab TKJ'
    );
  });

  it('says a unit will need placement when it is not at the intended place', async () => {
    renderDialog();
    const user = userEvent.setup();
    const dialog = await selectBoth(user);
    await user.click(within(dialog).getByLabelText('Not at the intended place'));

    expect(within(dialog).getByTestId('receipt-unit-placement-INV-A')).toHaveTextContent(
      'Will not be placed — it will need placement'
    );
  });

  it('warns that a deactivated intended place places nothing', async () => {
    renderDialog({ ...ROOM, isActive: false });
    const user = userEvent.setup();
    const dialog = await selectBoth(user);
    await user.click(within(dialog).getByLabelText('At the intended place'));

    expect(within(dialog).getByTestId('receipt-destination-inactive')).toHaveTextContent(
      'Ruang Guru has been deactivated'
    );
    expect(within(dialog).getByTestId('receipt-unit-placement-INV-A')).toHaveTextContent(
      'Will not be placed'
    );
  });

  it('says a unit will need placement when the request has no intended place', async () => {
    renderDialog(null);
    const dialog = await selectBoth(userEvent.setup());

    expect(within(dialog).getByTestId('receipt-unit-placement-INV-A')).toHaveTextContent(
      'Will not be placed — it will need placement'
    );
  });

  it('speaks Indonesian', async () => {
    await changeLanguage('id');
    renderDialog();
    const user = userEvent.setup();
    const dialog = await selectBoth(user);
    await user.click(within(dialog).getByLabelText('Di tempat tujuan'));

    expect(within(dialog).getByTestId('receipt-unit-placement-INV-A')).toHaveTextContent(
      'Akan ditempatkan di Ruang Guru'
    );
  });
});

describe('the confirmation — where each unit is now', () => {
  const confirmation = {
    id: 'conf-1',
    placement: 'AT_INTENDED_PLACE',
    description: 'Sudah diterima',
    destination: { id: ROOM.id, name: ROOM.name },
    receivedOn: '2026-10-05',
    confirmedBy: ME,
    confirmedAt: '2026-10-05T02:00:00.000Z',
    state: 'ACTIVE',
    units: [
      {
        assetUnitId: 'unit-INV-A',
        inventoryCode: 'INV-A',
        receiptId: 'rc-a',
        reversed: false,
        currentLocation: { id: ROOM.id, name: ROOM.name },
        needsPlacement: false,
      },
      {
        assetUnitId: 'unit-INV-B',
        inventoryCode: 'INV-B',
        receiptId: 'rc-b',
        reversed: false,
        currentLocation: null,
        needsPlacement: true,
      },
      {
        assetUnitId: 'unit-INV-C',
        inventoryCode: 'INV-C',
        receiptId: 'rc-c',
        reversed: true,
        currentLocation: null,
        needsPlacement: false,
      },
    ],
    photos: [],
  };

  it('marks each unit placed at its location, or needing placement; nothing on a reversed one', () => {
    renderScreen(
      <RequestReceiptConfirmations request={{ receiptConfirmations: [confirmation] }} />
    );

    expect(screen.getByTestId('confirmation-unit-INV-A')).toHaveTextContent('placed at Ruang Guru');
    expect(screen.getByTestId('confirmation-unit-INV-B')).toHaveTextContent('needs placement');
    expect(screen.getByTestId('confirmation-unit-INV-C')).not.toHaveTextContent(/placed|placement/);
  });

  it('speaks Indonesian', async () => {
    await changeLanguage('id');
    renderScreen(
      <RequestReceiptConfirmations request={{ receiptConfirmations: [confirmation] }} />
    );

    expect(screen.getByTestId('confirmation-unit-INV-A')).toHaveTextContent(
      'ditempatkan di Ruang Guru'
    );
    expect(screen.getByTestId('confirmation-unit-INV-B')).toHaveTextContent('perlu ditempatkan');
  });
});
