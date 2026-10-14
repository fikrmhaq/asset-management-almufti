import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '@/api/errors';
import { unitReportsApi } from '@/api/unitReports';
import { visibleNavigation } from '@/navigation';
import { changeLanguage, DEFAULT_LANGUAGE } from '@/i18n';
import { renderScreen, signInWith } from '@/test/harness';
import { MyRoomsPage } from './MyRoomsPage';
import { UnitReportsPage } from './UnitReportsPage';

/**
 * Room PIC reports on screen — REQ-REQUEST-025. The reporter files a report per
 * kind from the units in their rooms and sees what became of it; the reviewer
 * confirms (a stale report only after acknowledging) or rejects with a note.
 */

const PERSON = { id: 'user-2', username: 'guru', firstName: 'Guru', lastName: 'TKJ' };
const ROOM = { id: 'loc-room', name: 'Kelas 1' };
const UNIT = {
  id: 'unit-1',
  inventoryCode: 'INV-1',
  assetName: 'Laptop',
  currentLocation: ROOM,
  currentCondition: 'GOOD',
  lifecycleState: 'ACTIVE',
};

const report = (overrides = {}) => ({
  id: 'rep-1',
  kind: 'CONDITION',
  narrative: 'Layar retak',
  reportedCondition: 'DAMAGED',
  destination: null,
  reportedState: { location: ROOM, condition: 'GOOD' },
  unit: UNIT,
  reporter: PERSON,
  reportedAt: '2026-10-05T03:00:00.000Z',
  status: 'PENDING',
  stale: false,
  reviewer: null,
  reviewedAt: null,
  reviewNote: null,
  staleAcknowledged: false,
  historyId: null,
  // The reviewer's view: the open history row the report shows (M1).
  currentHistoryId: 'h-1',
  ...overrides,
});

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
});

afterEach(async () => {
  vi.restoreAllMocks();
  await changeLanguage(DEFAULT_LANGUAGE);
});

describe('My rooms — the reporter', () => {
  beforeEach(() => {
    signInWith(['asset-unit-report:create'], { institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(unitReportsApi, 'myUnits').mockResolvedValue([UNIT]);
    vi.spyOn(unitReportsApi, 'list').mockResolvedValue(
      page([report({ status: 'REJECTED', reviewNote: 'Tidak sesuai' })])
    );
    vi.spyOn(unitReportsApi, 'destinations').mockResolvedValue([
      ROOM,
      { id: 'loc-lab', name: 'Lab TKJ' },
    ]);
  });

  it('lists the units in their rooms, and their own reports with what became of them', async () => {
    renderScreen(<MyRoomsPage />);

    // Once among the units, once on the report about it.
    expect(await screen.findAllByText('INV-1')).toHaveLength(2);
    expect(screen.getByText('Kelas 1')).toBeInTheDocument();
    expect(unitReportsApi.list).toHaveBeenCalledWith(expect.objectContaining({ mine: 'true' }));
    expect(await screen.findByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Tidak sesuai')).toBeInTheDocument();
    expect(screen.getByText('Condition: Damaged — Layar retak')).toBeInTheDocument();
  });

  it('sends a condition report', async () => {
    const create = vi.spyOn(unitReportsApi, 'create').mockResolvedValue(report());
    const user = userEvent.setup();
    renderScreen(<MyRoomsPage />);

    await user.click(await screen.findByRole('button', { name: 'Report' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Condition you see/), 'DAMAGED');
    await user.type(within(dialog).getByLabelText(/What you see/), 'Layar retak');
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        assetUnitId: 'unit-1',
        kind: 'CONDITION',
        narrative: 'Layar retak',
        reportedCondition: 'DAMAGED',
      })
    );
  });

  it('sends a move to another room — never the one it is in', async () => {
    const create = vi.spyOn(unitReportsApi, 'create').mockResolvedValue(report());
    const user = userEvent.setup();
    renderScreen(<MyRoomsPage />);

    await user.click(await screen.findByRole('button', { name: 'Report' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText('It has moved'));
    const where = await within(dialog).findByLabelText(/Where it is now/);
    await waitFor(() =>
      expect(
        within(where)
          .getAllByRole('option')
          .map((o) => o.textContent)
      ).toEqual(['Choose…', 'Lab TKJ'])
    );
    await user.selectOptions(where, 'loc-lab');
    await user.type(within(dialog).getByLabelText(/What you see/), 'Dipindah');
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        assetUnitId: 'unit-1',
        kind: 'MOVEMENT',
        narrative: 'Dipindah',
        destinationLocationId: 'loc-lab',
      })
    );
  });

  it('asks for what the kind needs before sending', async () => {
    const create = vi.spyOn(unitReportsApi, 'create');
    const user = userEvent.setup();
    renderScreen(<MyRoomsPage />);

    await user.click(await screen.findByRole('button', { name: 'Report' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));

    expect(within(dialog).getAllByText('Required.')).toHaveLength(2);
    expect(create).not.toHaveBeenCalled();
  });

  it('speaks Indonesian', async () => {
    await changeLanguage('id');
    renderScreen(<MyRoomsPage />);

    expect(await screen.findByText('Unit di ruangan saya')).toBeInTheDocument();
    expect(await screen.findByText('Ditolak')).toBeInTheDocument();
  });
});

describe('Unit reports — the reviewer', () => {
  beforeEach(() => {
    signInWith(['asset-unit-report:review'], { institutionId: 'inst-1', isSystemWide: false });
  });

  const openReview = async (row) => {
    vi.spyOn(unitReportsApi, 'list').mockResolvedValue(page([row]));
    // The dialog reviews the report as freshly loaded.
    if (!vi.isMockFunction(unitReportsApi.get)) {
      vi.spyOn(unitReportsApi, 'get').mockResolvedValue(row);
    }
    const user = userEvent.setup();
    renderScreen(<UnitReportsPage />, { route: '/?status=PENDING' });
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    return { user, dialog: screen.getByRole('dialog') };
  };

  it('queues what is waiting, and shows the report against the unit now', async () => {
    const { dialog } = await openReview(
      report({ stale: true, unit: { ...UNIT, currentCondition: 'FAIR' } })
    );

    expect(unitReportsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING' })
    );
    expect(screen.getAllByText('Changed since').length).toBeGreaterThan(0);
    const body = within(dialog).getByTestId('review-report');
    expect(body).toHaveTextContent('Reported by Guru TKJ');
    expect(body).toHaveTextContent('When reported: Kelas 1, Good');
    expect(body).toHaveTextContent('Now: Kelas 1, Fair');
  });

  it('confirms a current report as it is', async () => {
    const confirm = vi.spyOn(unitReportsApi, 'confirm').mockResolvedValue(report());
    const { user, dialog } = await openReview(report());
    expect(within(dialog).queryByTestId('review-stale')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('rep-1', { seenHistoryId: 'h-1' }));
  });

  it('confirms a stale report only with the acknowledgement it carries', async () => {
    const confirm = vi.spyOn(unitReportsApi, 'confirm').mockResolvedValue(report());
    const { user, dialog } = await openReview(report({ stale: true }));

    const stale = within(dialog).getByTestId('review-stale');
    await user.click(within(stale).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith('rep-1', {
        seenHistoryId: 'h-1',
        acknowledgeStale: true,
      })
    );
  });

  it('reloads the newer state when the unit changed after it was seen, and asks again', async () => {
    const changed = report({
      stale: true,
      currentHistoryId: 'h-2',
      unit: { ...UNIT, currentCondition: 'POOR' },
    });
    vi.spyOn(unitReportsApi, 'get')
      .mockResolvedValueOnce(report({ stale: true }))
      .mockResolvedValue(changed);
    const confirm = vi
      .spyOn(unitReportsApi, 'confirm')
      .mockRejectedValueOnce(
        new ApiError({
          code: 'CONFLICT',
          status: 409,
          message: 'The unit has changed since you looked at this report',
          details: [{ field: 'seenHistoryId', issue: 'now at Kelas 1 (POOR)' }],
        })
      )
      .mockResolvedValue(changed);
    const { user, dialog } = await openReview(report({ stale: true }));

    await user.click(within(within(dialog).getByTestId('review-stale')).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    // Refused: the dialog now shows what is there, unacknowledged.
    await waitFor(() =>
      expect(within(dialog).getByTestId('review-report')).toHaveTextContent('Now: Kelas 1, Poor')
    );
    expect(confirm).toHaveBeenNthCalledWith(1, 'rep-1', {
      seenHistoryId: 'h-1',
      acknowledgeStale: true,
    });
    const box = within(within(dialog).getByTestId('review-stale')).getByRole('checkbox');
    expect(box).not.toBeChecked();

    await user.click(box);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(confirm).toHaveBeenNthCalledWith(2, 'rep-1', {
        seenHistoryId: 'h-2',
        acknowledgeStale: true,
      })
    );
  });

  it('rejects only with a note', async () => {
    const reject = vi.spyOn(unitReportsApi, 'reject').mockResolvedValue(report());
    const { user, dialog } = await openReview(report());

    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(within(dialog).getByText('A note is required to reject.')).toBeInTheDocument();
    expect(reject).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Note/), 'Tidak sesuai');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('rep-1', 'Tidak sesuai'));
  });
});

describe('navigation', () => {
  const items = (permissions) =>
    visibleNavigation(new Set(permissions))
      .flatMap((group) => group.items)
      .map((item) => item.to);

  it('shows each side only with its own permission', () => {
    expect(items(['asset-unit-report:create'])).toContain('/unit-reports/my-rooms');
    expect(items(['asset-unit-report:create'])).not.toContain('/unit-reports?status=PENDING');
    expect(items(['asset-unit-report:review'])).toContain('/unit-reports?status=PENDING');
    expect(items(['asset-unit:read'])).not.toContain('/unit-reports/my-rooms');
  });
});
