import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as organizationApi from '@/api/organization';
import { renderScreen, signInWith } from '@/test/harness';
import { PositionAssignmentsPanel } from './PositionAssignmentsPanel';

/**
 * School positions panel — Phase 35 (`CR-014`), `07-ui.md` §5.10.
 *
 * Kept in its own file (Phase 35 decision D7) so it never touches the
 * organization screen tests.
 */

const ALL = [
  'school-position:read',
  'position-assignment:read',
  'position-assignment:create',
  'position-assignment:end',
];

const POSITIONS = [
  { code: 'COMMON_TEACHER', department: 'NONE', holders: 'MANY', requestContext: true },
  { code: 'JURUSAN_TEACHER', department: 'REQUIRED', holders: 'MANY', requestContext: true },
  { code: 'TOOLMAN', department: 'REQUIRED', holders: 'ONE_PER_DEPARTMENT', requestContext: false },
  { code: 'KAJUR', department: 'REQUIRED', holders: 'ONE_PER_DEPARTMENT', requestContext: false },
  {
    code: 'KEPALA_SEKOLAH',
    department: 'NONE',
    holders: 'ONE_PER_INSTITUTION',
    requestContext: false,
  },
];

const TKJ = { id: 'dept-tkj', code: 'TKJ', name: 'Teknik Komputer' };
const ADMIN = { id: 'admin-1', username: 'admin', firstName: 'Admin', lastName: 'Sekolah' };
const BUDI = { id: 'user-budi', username: 'budi', firstName: 'Budi', lastName: 'Santoso' };

const assignment = (overrides) => ({
  id: 'pa-1',
  institutionId: 'inst-1',
  positionCode: 'COMMON_TEACHER',
  departmentId: null,
  department: null,
  userId: BUDI.id,
  user: BUDI,
  isCurrent: true,
  assignedAt: '2026-09-01T00:00:00.000Z',
  endedAt: null,
  assignedBy: ADMIN.id,
  assigner: ADMIN,
  endedBy: null,
  ender: null,
  ...overrides,
});

const page = (rows) => ({
  data: rows,
  meta: { page: 1, pageSize: rows.length, total: rows.length, totalPages: 1 },
});

function renderPanel(props) {
  return renderScreen(<PositionAssignmentsPanel {...props} />);
}

beforeEach(() => {
  signInWith(ALL, { id: ADMIN.id });
  vi.spyOn(organizationApi.positionsApi, 'list').mockResolvedValue(POSITIONS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the user panel', () => {
  it('groups the two teacher contexts under one Teacher heading, apart from other posts', async () => {
    vi.spyOn(organizationApi.positionsApi, 'forUser').mockResolvedValue([
      assignment({ id: 'pa-1', positionCode: 'COMMON_TEACHER' }),
      assignment({
        id: 'pa-2',
        positionCode: 'JURUSAN_TEACHER',
        departmentId: TKJ.id,
        department: TKJ,
      }),
      assignment({ id: 'pa-3', positionCode: 'KAJUR', departmentId: TKJ.id, department: TKJ }),
    ]);

    renderPanel({ mode: 'user', userId: BUDI.id, institutionId: 'inst-1' });

    expect(await screen.findByText('Teacher — common subjects')).toBeInTheDocument();
    expect(screen.getByText('Teacher — Jurusan Teknik Komputer')).toBeInTheDocument();
    expect(screen.getByText('Teacher')).toBeInTheDocument();
    expect(screen.getByText(/request contexts/i)).toBeInTheDocument();
    expect(screen.getByText('Kajur — Teknik Komputer')).toBeInTheDocument();
    expect(screen.getByText('Positions')).toBeInTheDocument();
  });

  it('shows ended assignments as history, without an End action', async () => {
    vi.spyOn(organizationApi.positionsApi, 'forUser').mockResolvedValue([
      assignment({ isCurrent: false, endedAt: '2026-09-10T00:00:00.000Z' }),
    ]);

    renderPanel({ mode: 'user', userId: BUDI.id, institutionId: 'inst-1' });

    expect(await screen.findByText('Teacher — common subjects')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End' })).not.toBeInTheDocument();
  });

  it('asks for a department only when the chosen position needs one', async () => {
    vi.spyOn(organizationApi.positionsApi, 'forUser').mockResolvedValue([]);
    vi.spyOn(organizationApi.departmentsApi, 'list').mockResolvedValue(page([TKJ]));
    const assign = vi.spyOn(organizationApi.positionsApi, 'assign').mockResolvedValue({});
    const user = userEvent.setup();

    renderPanel({ mode: 'user', userId: BUDI.id, institutionId: 'inst-1' });

    await user.click(await screen.findByRole('button', { name: 'Assign position' }));
    const dialog = await screen.findByRole('dialog');

    await user.selectOptions(within(dialog).getByLabelText(/Position/), 'KEPALA_SEKOLAH');
    expect(within(dialog).queryByLabelText(/Department/)).not.toBeInTheDocument();

    await user.selectOptions(within(dialog).getByLabelText(/Position/), 'KAJUR');
    const department = await within(dialog).findByLabelText(/Department/);
    await waitFor(() =>
      expect(within(department).getByRole('option', { name: /Teknik Komputer/ })).toBeTruthy()
    );
    await user.selectOptions(department, TKJ.id);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(BUDI.id, {
        positionCode: 'KAJUR',
        departmentId: TKJ.id,
      })
    );
  });

  it('labels the teacher options as request contexts', async () => {
    vi.spyOn(organizationApi.positionsApi, 'forUser').mockResolvedValue([]);
    const user = userEvent.setup();

    renderPanel({ mode: 'user', userId: BUDI.id, institutionId: 'inst-1' });

    await user.click(await screen.findByRole('button', { name: 'Assign position' }));
    const dialog = await screen.findByRole('dialog');

    await waitFor(() =>
      expect(
        within(dialog).getByRole('option', {
          name: 'Teacher — common subjects (request context)',
        })
      ).toBeInTheDocument()
    );
    expect(
      within(dialog).getByRole('option', { name: 'Teacher — Jurusan (request context)' })
    ).toBeInTheDocument();
  });

  it('ends a current assignment after confirmation', async () => {
    vi.spyOn(organizationApi.positionsApi, 'forUser').mockResolvedValue([assignment()]);
    const end = vi.spyOn(organizationApi.positionsApi, 'end').mockResolvedValue({});
    const user = userEvent.setup();

    renderPanel({ mode: 'user', userId: BUDI.id, institutionId: 'inst-1' });

    await user.click(await screen.findByRole('button', { name: 'End' }));
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    await user.click(within(dialog).getByRole('button', { name: 'End' }));

    await waitFor(() => expect(end).toHaveBeenCalledWith('pa-1'));
  });

  /** `BR-033`: nobody assigns or ends their own position. */
  it('offers neither assign nor end on the own record of the viewer', async () => {
    vi.spyOn(organizationApi.positionsApi, 'forUser').mockResolvedValue([
      assignment({ userId: ADMIN.id, user: ADMIN, positionCode: 'KEPALA_SEKOLAH' }),
    ]);

    renderPanel({ mode: 'user', userId: ADMIN.id, institutionId: 'inst-1' });

    expect(await screen.findByText('Kepala Sekolah')).toBeInTheDocument();
    expect(screen.getByText(/cannot assign or end your own/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign position' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End' })).not.toBeInTheDocument();
  });

  it('hides the actions without the create and end permissions', async () => {
    signInWith(['position-assignment:read'], { id: ADMIN.id });
    vi.spyOn(organizationApi.positionsApi, 'forUser').mockResolvedValue([assignment()]);

    renderPanel({ mode: 'user', userId: BUDI.id, institutionId: 'inst-1' });

    expect(await screen.findByText('Teacher — common subjects')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign position' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End' })).not.toBeInTheDocument();
  });

  it('renders nothing without position-assignment:read', () => {
    signInWith([], { id: ADMIN.id });
    const forUser = vi.spyOn(organizationApi.positionsApi, 'forUser');

    renderPanel({ mode: 'user', userId: BUDI.id, institutionId: 'inst-1' });

    expect(screen.queryByText('School positions')).not.toBeInTheDocument();
    expect(forUser).not.toHaveBeenCalled();
  });
});

describe('the department panel', () => {
  it('lists holders with their position, separately titled from the person in charge', async () => {
    vi.spyOn(organizationApi.positionsApi, 'forDepartment').mockResolvedValue([
      assignment({ positionCode: 'KAJUR', departmentId: TKJ.id, department: TKJ }),
    ]);

    renderPanel({ mode: 'department', departmentId: TKJ.id, institutionId: 'inst-1' });

    expect(await screen.findByText('Budi Santoso · Kajur — Teknik Komputer')).toBeInTheDocument();
    expect(screen.getByText('School positions in this department')).toBeInTheDocument();
    expect(screen.queryByText('Person in charge')).not.toBeInTheDocument();
  });

  it('offers only department-bound positions, and never the viewer as a candidate', async () => {
    vi.spyOn(organizationApi.positionsApi, 'forDepartment').mockResolvedValue([]);
    vi.spyOn(organizationApi.usersApi, 'list').mockResolvedValue(
      page([ADMIN, BUDI].map((person) => ({ ...person, isActive: true })))
    );
    const assign = vi.spyOn(organizationApi.positionsApi, 'assign').mockResolvedValue({});
    const user = userEvent.setup();

    renderPanel({ mode: 'department', departmentId: TKJ.id, institutionId: 'inst-1' });

    await user.click(await screen.findByRole('button', { name: 'Assign position' }));
    const dialog = await screen.findByRole('dialog');

    await waitFor(() =>
      expect(within(dialog).getByRole('option', { name: 'Kajur' })).toBeInTheDocument()
    );
    expect(within(dialog).queryByRole('option', { name: 'Kepala Sekolah' })).toBeNull();
    expect(
      within(dialog).queryByRole('option', {
        name: 'Teacher — common subjects (request context)',
      })
    ).toBeNull();

    await user.selectOptions(within(dialog).getByLabelText(/Position/), 'TOOLMAN');
    const person = within(dialog).getByLabelText(/Person/);
    await waitFor(() =>
      expect(within(person).getByRole('option', { name: /Budi Santoso/ })).toBeTruthy()
    );
    expect(within(person).queryByRole('option', { name: /Admin Sekolah/ })).toBeNull();

    await user.selectOptions(person, BUDI.id);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(BUDI.id, {
        positionCode: 'TOOLMAN',
        departmentId: TKJ.id,
      })
    );
  });
});
