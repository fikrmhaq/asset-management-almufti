import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, ERROR_CODES } from '@/api/errors';
import * as reportingApi from '@/api/reporting';
import * as organizationApi from '@/api/organization';
import { renderScreen, signInWith } from '@/test/harness';
import { AuditPage } from './AuditPage';

/**
 * Audit log — `07-ui.md` §5.8, `IMPLEMENTATION_PLAN.md` §21.4.
 */

const ALL = ['audit-log:read', 'user:read'];

const page = (rows, meta = {}) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1, ...meta },
});

const UPDATE_ENTRY = {
  id: 'log-1',
  actorId: 'user-1',
  action: 'UPDATE',
  entityType: 'Asset',
  entityId: 'asset-1',
  timestamp: '2026-08-12T10:00:00.000Z',
  oldValues: { name: 'Old name', description: 'unchanged text' },
  newValues: { name: 'New name', description: 'unchanged text' },
  ipAddress: '127.0.0.1',
  metadata: { requestId: 'req-9' },
};

const SYSTEM_ENTRY = {
  ...UPDATE_ENTRY,
  id: 'log-2',
  actorId: null,
  action: 'STATUS_CHANGE',
  entityType: 'Borrowing',
  entityId: 'brw-1',
  oldValues: { status: 'ACTIVE' },
  newValues: { status: 'OVERDUE' },
};

const ORPHAN_ENTRY = { ...UPDATE_ENTRY, id: 'log-3', actorId: 'deleted-user-id' };

beforeEach(() => {
  signInWith(ALL);

  vi.spyOn(reportingApi.auditLogsApi, 'list').mockResolvedValue(page([UPDATE_ENTRY]));
  vi.spyOn(reportingApi.auditLogsApi, 'get').mockResolvedValue(UPDATE_ENTRY);
  vi.spyOn(organizationApi.usersApi, 'list').mockResolvedValue(
    page([{ id: 'user-1', username: 'ratna', firstName: 'Ratna', lastName: 'Sari' }])
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuditPage', () => {
  it('lists entries with the action and entity', async () => {
    renderScreen(<AuditPage />);

    // `entityType` and the entity id are the server's own record name and key,
    // shown verbatim because the free-text filters match on them. The ACTION is
    // a stored column value (`UPDATE`), so the reader gets a label instead.
    expect(await screen.findByText('Asset')).toBeInTheDocument();
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('asset-1')).toBeInTheDocument();
  });

  it('resolves the actor to a name (DEC-055)', async () => {
    renderScreen(<AuditPage />);

    expect(await screen.findByText('Ratna Sari')).toBeInTheDocument();
  });

  it('shows a NULL actor as System', async () => {
    reportingApi.auditLogsApi.list.mockResolvedValue(page([SYSTEM_ENTRY]));
    renderScreen(<AuditPage />);

    expect(await screen.findByText('System')).toBeInTheDocument();
  });

  it('falls back to the raw id when the actor cannot be resolved', async () => {
    reportingApi.auditLogsApi.list.mockResolvedValue(page([ORPHAN_ENTRY]));
    renderScreen(<AuditPage />);

    // A deleted or out-of-page user must not silently become nobody.
    expect(await screen.findByText('deleted-user-id')).toBeInTheDocument();
  });

  it('filters entity type as free text (DEC-054)', async () => {
    const { router } = renderScreen(<AuditPage />);
    await screen.findByText('Asset');

    const field = screen.getByLabelText('Entity type');
    expect(field.tagName).toBe('INPUT'); // not a select of the internal allowlist

    await userEvent.type(field, 'Borrowing');
    await waitFor(() => expect(router.state.location.search).toContain('entityType=Borrowing'));
  });

  it('forwards every documented filter to the endpoint', async () => {
    renderScreen(<AuditPage />, {
      path: '/audit',
      route: '/audit?entityType=Asset&entityId=asset-1&action=UPDATE&dateFrom=2026-08-01',
    });

    await waitFor(() =>
      expect(reportingApi.auditLogsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Asset',
          entityId: 'asset-1',
          action: 'UPDATE',
          dateFrom: '2026-08-01',
        })
      )
    );
  });

  it('hides the actor filter without user:read', async () => {
    signInWith(['audit-log:read']);
    renderScreen(<AuditPage />);
    await screen.findByText('Asset');

    expect(screen.queryByLabelText('Actor')).not.toBeInTheDocument();
    expect(organizationApi.usersApi.list).not.toHaveBeenCalled();
  });

  it('states that it is not organization-scoped (DEC-050)', async () => {
    renderScreen(<AuditPage />);
    await screen.findByText('Asset');

    expect(screen.getByText(/covers every institution/i)).toBeInTheDocument();
  });

  it('exposes no way to change anything (REQ-AUDIT-003)', async () => {
    renderScreen(<AuditPage />);
    await screen.findByText('Asset');

    for (const name of [/edit/i, /delete/i, /new/i, /save/i, /deactivate/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });
});

describe('AuditPage — detail (REQ-AUDIT-002)', () => {
  const open = async () => {
    renderScreen(<AuditPage />);
    await screen.findByText('Asset');
    await userEvent.click(screen.getByRole('button', { name: /2026/ }));
    return screen.findByRole('dialog');
  };

  it('compares old and new values, marking what changed', async () => {
    const dialog = await open();

    expect(reportingApi.auditLogsApi.get).toHaveBeenCalledWith('log-1');

    const table = within(dialog).getByRole('table');
    expect(within(table).getByText('Before')).toBeInTheDocument();
    expect(within(table).getByText('After')).toBeInTheDocument();

    // `name` differs, `description` does not — only the first is marked.
    expect(within(table).getAllByText('changed')).toHaveLength(1);
  });

  it('shows the request id the audit writer recorded', async () => {
    const dialog = await open();

    expect(within(dialog).getByText('req-9')).toBeInTheDocument();
    expect(within(dialog).getByText('127.0.0.1')).toBeInTheDocument();
  });

  it('renders a CREATE entry that has no previous values', async () => {
    const created = {
      ...UPDATE_ENTRY,
      action: 'CREATE',
      oldValues: null,
      newValues: { name: 'Fresh' },
    };
    reportingApi.auditLogsApi.list.mockResolvedValue(page([created]));
    reportingApi.auditLogsApi.get.mockResolvedValue(created);

    const dialog = await open();

    expect(within(dialog).getByText('Fresh')).toBeInTheDocument();
    // The union of both sides is shown, so a one-sided entry still renders.
    expect(within(dialog).getAllByText('changed')).toHaveLength(1);
  });

  it('has no edit affordance in the dialog either', async () => {
    const dialog = await open();

    // Dismissal only — the footer button and the dialog's own X.
    expect(within(dialog).getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
    expect(
      within(dialog).queryByRole('button', { name: /save|edit|delete/i })
    ).not.toBeInTheDocument();
  });

  it('surfaces a failure to load one entry', async () => {
    reportingApi.auditLogsApi.get.mockRejectedValue(
      new ApiError({ code: ERROR_CODES.NOT_FOUND, message: 'Gone', status: 404 })
    );

    const dialog = await open();

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  });
});
