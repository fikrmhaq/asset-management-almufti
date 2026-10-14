import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, ERROR_CODES } from '@/api/errors';
import * as organizationApi from '@/api/organization';
import { renderScreen, signInWith } from '@/test/harness';
import { InstitutionsPage } from './InstitutionsPage';
import { InstitutionDetailPage } from './InstitutionDetailPage';
import { DepartmentsPage } from './DepartmentsPage';
import { DepartmentDetailPage } from './DepartmentDetailPage';
import { UsersPage } from './UsersPage';
import { RoleDetailPage } from './RoleDetailPage';

/**
 * Organization screens — `07-ui.md` §5.1, `IMPLEMENTATION_PLAN.md` §17.1–§17.4.
 */

const ALL = [
  'institution:read',
  'institution:create',
  'institution:update',
  'institution:deactivate',
  'department:read',
  'department:create',
  'department:update',
  'department:deactivate',
  'department-pic:read',
  'department-pic:create',
  'department-pic:delete',
  'user:read',
  'user:create',
  'user:update',
  'user:deactivate',
  'user-role:create',
  'user-role:delete',
  'role:read',
  'role:create',
  'role:update',
  'role:delete',
  'role-permission:read',
  'role-permission:update',
  'permission:read',
];

const page = (rows, meta = {}) => ({
  data: rows,
  meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1, ...meta },
});

const INSTITUTION = {
  id: 'inst-1',
  name: 'Dinas Pendidikan',
  code: 'DISDIK',
  address: 'Jl. Merdeka 1',
  isActive: true,
};

beforeEach(() => {
  signInWith(ALL);
  vi.spyOn(organizationApi.institutionsApi, 'list').mockResolvedValue(page([INSTITUTION]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InstitutionsPage', () => {
  it('lists institutions with their status', async () => {
    renderScreen(<InstitutionsPage />);

    expect(await screen.findByText('Dinas Pendidikan')).toBeInTheDocument();
    expect(screen.getByText('DISDIK')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('writes filters into the URL so the view survives a refresh (§4.1)', async () => {
    const { router } = renderScreen(<InstitutionsPage />);
    await screen.findByText('Dinas Pendidikan');

    await userEvent.type(screen.getByLabelText('Search'), 'disdik');

    await waitFor(() => expect(router.state.location.search).toContain('q=disdik'));
  });

  it('hides the create action without the permission (§6)', async () => {
    signInWith(['institution:read']);
    renderScreen(<InstitutionsPage />);
    await screen.findByText('Dinas Pendidikan');

    expect(screen.queryByRole('button', { name: /new institution/i })).not.toBeInTheDocument();
  });

  it('shows the create action with it', async () => {
    renderScreen(<InstitutionsPage />);
    await screen.findByText('Dinas Pendidikan');

    expect(screen.getByRole('button', { name: /new institution/i })).toBeInTheDocument();
  });

  it('maps a server VALIDATION_ERROR onto the offending field', async () => {
    vi.spyOn(organizationApi.institutionsApi, 'create').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'invalid',
        status: 400,
        details: [{ field: 'code', issue: 'must be unique' }],
      })
    );

    renderScreen(<InstitutionsPage />);
    await screen.findByText('Dinas Pendidikan');
    await userEvent.click(screen.getByRole('button', { name: /new institution/i }));

    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'Baru');
    await userEvent.type(within(dialog).getByLabelText(/code/i), 'DUP');
    await userEvent.type(within(dialog).getByLabelText(/address/i), 'Jl. Baru');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('must be unique')).toBeInTheDocument();
    // Still open — the caller closes only on success.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('validates before sending anything', async () => {
    const createSpy = vi.spyOn(organizationApi.institutionsApi, 'create');
    renderScreen(<InstitutionsPage />);
    await screen.findByText('Dinas Pendidikan');

    await userEvent.click(screen.getByRole('button', { name: /new institution/i }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create' })
    );

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('surfaces a list failure as an error state', async () => {
    organizationApi.institutionsApi.list.mockRejectedValue(
      new ApiError({ code: ERROR_CODES.FORBIDDEN, message: 'Nope', status: 403 })
    );

    renderScreen(<InstitutionsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this');
  });
});

describe('InstitutionDetailPage', () => {
  beforeEach(() => {
    vi.spyOn(organizationApi.institutionsApi, 'get').mockResolvedValue(INSTITUTION);
  });

  it('confirms before deactivating and only then calls the API (§4.4)', async () => {
    const setActive = vi
      .spyOn(organizationApi.institutionsApi, 'setActive')
      .mockResolvedValue({ ...INSTITUTION, isActive: false });

    renderScreen(<InstitutionDetailPage />, { path: '/:id', route: '/inst-1' });
    await screen.findByRole('heading', { name: 'Dinas Pendidikan' });

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Deactivate this institution?');
    expect(setActive).not.toHaveBeenCalled();

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate' })
    );
    await waitFor(() => expect(setActive).toHaveBeenCalledWith('inst-1', false));
  });

  it('keeps Save disabled until something changes', async () => {
    renderScreen(<InstitutionDetailPage />, { path: '/:id', route: '/inst-1' });
    await screen.findByRole('heading', { name: 'Dinas Pendidikan' });

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^name/i), ' Kota');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
  });

  it('hides both edit and status actions from a read-only caller', async () => {
    signInWith(['institution:read']);
    renderScreen(<InstitutionDetailPage />, { path: '/:id', route: '/inst-1' });
    await screen.findByRole('heading', { name: 'Dinas Pendidikan' });

    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toBeDisabled();
  });
});

describe('DepartmentsPage', () => {
  beforeEach(() => {
    vi.spyOn(organizationApi.departmentsApi, 'list').mockResolvedValue(
      page([
        {
          id: 'dept-uuid-1',
          institutionId: INSTITUTION.id,
          code: 'DEP-01',
          name: 'Umum',
          isActive: true,
        },
      ])
    );
  });

  it('lists departments with their code, and no hierarchy (DEC-001)', async () => {
    renderScreen(<DepartmentsPage />);

    expect(await screen.findByText('Umum')).toBeInTheDocument();
    // The code is shown; the surrogate id never is.
    expect(screen.getByText('DEP-01')).toBeInTheDocument();
    expect(screen.queryByText('dept-uuid-1')).not.toBeInTheDocument();
    // Still no parent column and no tree affordance — Phase 20 gave departments
    // an institution, not a hierarchy.
    expect(screen.queryByRole('columnheader', { name: /parent/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/parent department/i)).not.toBeInTheDocument();
  });

  /** Phase 20 (`CR-003`): `code` replaced `id` in the create body. */
  it('sends a code rather than a natural key on create', async () => {
    const create = vi.spyOn(organizationApi.departmentsApi, 'create').mockResolvedValue({});
    renderScreen(<DepartmentsPage />);
    await screen.findByText('Umum');

    await userEvent.click(screen.getByRole('button', { name: /new department/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/code/i), 'DEP-02');
    await userEvent.type(within(dialog).getByLabelText(/name/i), 'Keuangan');
    // The default harness session is system-wide, so an institution must be
    // chosen — see the suite below for why.
    await userEvent.selectOptions(within(dialog).getByLabelText(/institution/i), INSTITUTION.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        code: 'DEP-02',
        name: 'Keuangan',
        institutionId: INSTITUTION.id,
      })
    );
  });

  /**
   * The institution on a new department — `CR-003` §4.3, REQ-ORG-003.
   *
   * `POST /departments` always accepted `institutionId`, and the form never
   * offered it. For an institution-scoped administrator that was invisible: the
   * server fills in their own. For a SYSTEM-WIDE caller there is nothing to fill
   * in, so every department they created was UNASSIGNED — unable to hold an
   * asset unit, and unrepairable, because `institutionId` is not updatable
   * (`CR-003` OPEN-6). The dead end was silent, which is what made it a bug
   * rather than a limitation.
   */
  describe('choosing the institution', () => {
    it('refuses to submit when a system-wide caller has not chosen one', async () => {
      const create = vi.spyOn(organizationApi.departmentsApi, 'create').mockResolvedValue({});
      renderScreen(<DepartmentsPage />);
      await screen.findByText('Umum');

      await userEvent.click(screen.getByRole('button', { name: /new department/i }));
      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/code/i), 'DEP-03');
      await userEvent.type(within(dialog).getByLabelText(/name/i), 'Umum 2');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

      // Nothing is sent, and the reason names the field rather than failing at
      // the server with a department already created.
      await waitFor(() =>
        expect(within(dialog).getByText(/not scoped to one institution/i)).toBeInTheDocument()
      );
      expect(create).not.toHaveBeenCalled();
    });

    /**
     * An institution-scoped administrator has exactly one, and the server
     * applies it. Sending it from the client would be the same value by a
     * longer route; omitting it is what `defaultInstitutionFor` expects.
     */
    it('omits it for an institution-scoped caller, who is not asked', async () => {
      signInWith(ALL, { institutionId: INSTITUTION.id, isSystemWide: false });

      const create = vi.spyOn(organizationApi.departmentsApi, 'create').mockResolvedValue({});
      renderScreen(<DepartmentsPage />);
      await screen.findByText('Umum');

      await userEvent.click(screen.getByRole('button', { name: /new department/i }));
      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/code/i), 'DEP-04');
      await userEvent.type(within(dialog).getByLabelText(/name/i), 'Keuangan');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() =>
        expect(create).toHaveBeenCalledWith({
          code: 'DEP-04',
          name: 'Keuangan',
          institutionId: undefined,
        })
      );
    });

    /**
     * `CR-003` is explicit that a role which should reach less must not be
     * handed the institution list to make a control work.
     */
    it('does not show the field to a caller without institution:read', async () => {
      signInWith(['department:read', 'department:create'], { institutionId: INSTITUTION.id });

      renderScreen(<DepartmentsPage />);
      await screen.findByText('Umum');

      await userEvent.click(screen.getByRole('button', { name: /new department/i }));

      expect(
        within(screen.getByRole('dialog')).queryByLabelText(/institution/i)
      ).not.toBeInTheDocument();
    });
  });
});

describe('UsersPage', () => {
  beforeEach(() => {
    vi.spyOn(organizationApi.usersApi, 'list').mockResolvedValue(
      page([
        {
          id: 'u1',
          username: 'ratna',
          firstName: 'Ratna',
          lastName: 'Sari',
          isActive: true,
          roles: [{ id: 'r1', name: 'Asset Officer' }],
        },
      ])
    );
  });

  it('lists users with their roles', async () => {
    renderScreen(<UsersPage />);

    expect(await screen.findByText('ratna')).toBeInTheDocument();
    expect(screen.getByText('Ratna Sari')).toBeInTheDocument();
    expect(screen.getByText('Asset Officer')).toBeInTheDocument();
  });

  it('requires a password of at least 12 characters on create', async () => {
    const create = vi.spyOn(organizationApi.usersApi, 'create');
    renderScreen(<UsersPage />);
    await screen.findByText('ratna');

    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/username/i), 'baru');
    await userEvent.type(within(dialog).getByLabelText(/password/i), 'short');
    await userEvent.type(within(dialog).getByLabelText(/first name/i), 'Baru');
    await userEvent.type(within(dialog).getByLabelText(/last name/i), 'User');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  /**
   * The institution select is hidden when the caller cannot read institutions,
   * and its `''` default used to fail a UUID check on that hidden field — the
   * dialog then refused to submit and displayed nothing, so the Create button
   * looked dead to every scoped administrator.
   */
  it('creates a user when the institution select is hidden (no institution:read)', async () => {
    signInWith(['user:read', 'user:create'], { institutionId: 'inst-1', isSystemWide: false });
    organizationApi.institutionsApi.list.mockRejectedValue(
      new ApiError({ code: ERROR_CODES.FORBIDDEN, message: 'Forbidden', status: 403 })
    );
    const create = vi.spyOn(organizationApi.usersApi, 'create').mockResolvedValue({ id: 'u2' });

    renderScreen(<UsersPage />);
    await screen.findByText('ratna');

    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(/institution/i)).not.toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/username/i), 'baru');
    await userEvent.type(within(dialog).getByLabelText(/password/i), 'correct-horse-battery');
    await userEvent.type(within(dialog).getByLabelText(/first name/i), 'Baru');
    await userEvent.type(within(dialog).getByLabelText(/last name/i), 'User');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    // No `institutionId` at all — the API defaults it to the caller's (BR-007).
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        username: 'baru',
        password: 'correct-horse-battery',
        firstName: 'Baru',
        lastName: 'User',
        contactInfo: undefined,
        institutionId: undefined,
      })
    );
  });

  it('creates a user with "no institution" selected by a system administrator', async () => {
    const create = vi.spyOn(organizationApi.usersApi, 'create').mockResolvedValue({ id: 'u2' });

    renderScreen(<UsersPage />);
    await screen.findByText('ratna');

    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/username/i), 'baru');
    await userEvent.type(within(dialog).getByLabelText(/password/i), 'correct-horse-battery');
    await userEvent.type(within(dialog).getByLabelText(/first name/i), 'Baru');
    await userEvent.type(within(dialog).getByLabelText(/last name/i), 'User');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ institutionId: undefined }))
    );
  });

  it('offers no password field anywhere outside creation (GAP-004)', async () => {
    renderScreen(<UsersPage />);
    await screen.findByText('ratna');

    // The list itself must not expose a password reset affordance.
    expect(screen.queryByRole('button', { name: /reset password/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change password/i })).not.toBeInTheDocument();
  });
});

describe('RoleDetailPage — institution-assignable (REQ-ROLE-009, BR-022)', () => {
  const base = {
    id: 'r1',
    name: 'Asset Officer',
    isSystemWide: false,
    isInstitutionAssignable: false,
    permissions: [],
  };

  beforeEach(() => {
    vi.spyOn(organizationApi.permissionsApi, 'list').mockResolvedValue([]);
    vi.spyOn(organizationApi.rolesApi, 'listPermissions').mockResolvedValue([]);
  });

  it('warns what the flag actually grants, at the control', async () => {
    vi.spyOn(organizationApi.rolesApi, 'get').mockResolvedValue({
      ...base,
      isInstitutionAssignable: true,
    });

    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });

    // A setting this consequential states its consequence where the decision is
    // made, not in a help page.
    expect(await screen.findByText(/any role they can assign, they can take/i)).toBeInTheDocument();
  });

  it('does not warn when the flag is off', async () => {
    vi.spyOn(organizationApi.rolesApi, 'get').mockResolvedValue(base);

    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });

    expect(screen.queryByText(/any role they can assign/i)).not.toBeInTheDocument();
  });

  it('disables the toggle for a system-wide role, and says why', async () => {
    vi.spyOn(organizationApi.rolesApi, 'get').mockResolvedValue({ ...base, isSystemWide: true });

    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });

    const toggle = screen.getByRole('checkbox', { name: /assignable by institutions/i });
    expect(toggle).toBeDisabled();
    // Disabled with the reason shown, rather than silently doing nothing.
    expect(screen.getByText(/unavailable while this role is system-wide/i)).toBeInTheDocument();
  });

  it('clears the flag when system-wide is ticked, so the refused state cannot be composed', async () => {
    vi.spyOn(organizationApi.rolesApi, 'get').mockResolvedValue({
      ...base,
      isInstitutionAssignable: true,
    });

    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });

    // The accessible name folds in the field description, so match on the hint,
    // which is unique to this control.
    await userEvent.click(screen.getByRole('checkbox', { name: /lifts the institution scope/i }));

    const toggle = screen.getByRole('checkbox', { name: /assignable by institutions/i });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
  });
});

describe('RoleDetailPage — permissions', () => {
  const ROLE = { id: 'r1', name: 'Asset Officer', isSystemWide: false, permissions: [] };

  const CATALOG = [
    {
      code: 'asset:read',
      description: 'View: Assets',
      group: 'Asset Core',
      systemWideOnly: false,
      picAllowed: false,
    },
    {
      code: 'asset:create',
      description: 'Create: Assets',
      group: 'Asset Core',
      systemWideOnly: false,
      picAllowed: false,
    },
    {
      code: 'asset-unit:read',
      description: 'View: Asset units',
      group: 'Asset Core',
      systemWideOnly: false,
      picAllowed: true,
    },
    {
      code: 'institution:create',
      description: 'Create: Institutions',
      group: 'Organization',
      systemWideOnly: true,
      picAllowed: false,
    },
    {
      code: 'contract:read',
      description: 'View: Contracts',
      group: 'Procurement',
      systemWideOnly: false,
      picAllowed: false,
    },
  ];

  beforeEach(() => {
    vi.spyOn(organizationApi.rolesApi, 'get').mockResolvedValue(ROLE);
    vi.spyOn(organizationApi.permissionsApi, 'list').mockResolvedValue(CATALOG);
    vi.spyOn(organizationApi.rolesApi, 'listPermissions').mockResolvedValue([]);
  });

  it('groups the catalog by module rather than listing 100+ flat codes (§5.1)', async () => {
    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));

    // Groups appear in the documented order.
    const groups = await screen.findAllByRole('group');
    expect(
      groups.map(
        (group) => within(group).getByText(/^(Organization|Asset Core|Procurement)$/).textContent
      )
    ).toEqual(['Organization', 'Asset Core', 'Procurement']);
  });

  it('disables system-wide-only codes while the role is scoped (BR-015)', async () => {
    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));

    const blocked = await screen.findByRole('checkbox', { name: /institution:create/i });
    expect(blocked).toBeDisabled();
    expect(screen.getByText(/requires a system-wide role/i)).toBeInTheDocument();

    // An ordinary code is unaffected.
    expect(screen.getByRole('checkbox', { name: /asset:read/i })).toBeEnabled();
  });

  it('enables them once the role is system-wide', async () => {
    organizationApi.rolesApi.get.mockResolvedValue({ ...ROLE, isSystemWide: true });

    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));

    expect(await screen.findByRole('checkbox', { name: /institution:create/i })).toBeEnabled();
  });

  /**
   * `CR-004` §2 — the ceiling is otherwise invisible. An administrator would
   * tick `report:read` on a PIC-scoped role, watch it save, and never learn the
   * server ignores it.
   */
  it('marks codes the PIC ceiling suppresses, without disabling them', async () => {
    organizationApi.rolesApi.get.mockResolvedValue({ ...ROLE, isPicScoped: true });

    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));

    expect(await screen.findAllByText(/not effective for a pic-scoped role/i)).toHaveLength(3);

    // Still tickable: the grant is STORED and becomes effective if the flag is
    // later cleared, so refusing it here would lose the administrator's intent.
    // That is the opposite of the systemWideOnly rule, which the server refuses.
    expect(screen.getByRole('checkbox', { name: /asset:read/i })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /institution:create/i })).toBeDisabled();

    // An allowed code carries no warning at all.
    const allowed = screen.getByRole('checkbox', { name: /asset-unit:read/i });
    expect(allowed).toBeEnabled();
  });

  it('marks nothing when the role is not PIC-scoped', async () => {
    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));

    await screen.findByRole('checkbox', { name: /asset:read/i });
    expect(screen.queryByText(/not effective for a pic-scoped role/i)).not.toBeInTheDocument();
  });

  it('replaces the whole granted set on save (REQ-ROLE-007)', async () => {
    const replace = vi.spyOn(organizationApi.rolesApi, 'replacePermissions').mockResolvedValue({});

    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));

    await userEvent.click(await screen.findByRole('checkbox', { name: /asset:read/i }));
    await userEvent.click(screen.getByRole('button', { name: /save permissions/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('r1', ['asset:read']));
  });

  it('reports a BR-015 CONFLICT from the server', async () => {
    vi.spyOn(organizationApi.rolesApi, 'replacePermissions').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.CONFLICT,
        message: 'A role granting institution management must be system-wide',
        status: 409,
      })
    );

    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));

    await userEvent.click(await screen.findByRole('checkbox', { name: /asset:read/i }));
    await userEvent.click(screen.getByRole('button', { name: /save permissions/i }));

    expect(
      await screen.findByText('A role granting institution management must be system-wide')
    ).toBeInTheDocument();
  });

  it('hides saving from a caller without role-permission:update', async () => {
    signInWith(['role:read', 'role-permission:read', 'permission:read']);

    renderScreen(<RoleDetailPage />, { path: '/:id', route: '/r1' });
    await screen.findByRole('heading', { name: 'Asset Officer' });
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));

    await screen.findByRole('checkbox', { name: /asset:read/i });
    expect(screen.queryByRole('button', { name: /save permissions/i })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /asset:read/i })).toBeDisabled();
  });
});

/**
 * Person in charge — Phase 21 (`CR-003`), REQ-ORG-006.
 *
 * The panel is shared with Locations, so this covers both. The history is
 * asserted directly: a screen showing only the current holder would be the
 * mutable-column design the assignment table exists to replace.
 */
describe('DepartmentDetailPage — person in charge', () => {
  const DEPARTMENT = {
    id: 'dept-1',
    institutionId: INSTITUTION.id,
    institution: INSTITUTION,
    code: 'TKJ',
    name: 'Teknik Komputer dan Jaringan',
    currentPicUserId: 'u-budi',
    currentPic: { id: 'u-budi', username: 'budi', firstName: 'Budi', lastName: 'Santoso' },
    isActive: true,
  };

  const ASSIGNMENTS = [
    {
      id: 'a2',
      userId: 'u-budi',
      user: { id: 'u-budi', username: 'budi', firstName: 'Budi', lastName: 'Santoso' },
      isCurrent: true,
      assignedAt: '2026-07-01T00:00:00.000Z',
      endedAt: null,
      assigner: { id: 'u-admin', username: 'admin', firstName: 'Sys', lastName: 'Admin' },
    },
    {
      id: 'a1',
      userId: 'u-sari',
      user: { id: 'u-sari', username: 'sari', firstName: 'Sari', lastName: 'Dewi' },
      isCurrent: false,
      assignedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-07-01T00:00:00.000Z',
      assigner: null,
    },
  ];

  beforeEach(() => {
    vi.spyOn(organizationApi.departmentsApi, 'get').mockResolvedValue(DEPARTMENT);
    vi.spyOn(organizationApi.departmentsApi, 'picAssignments').mockResolvedValue(ASSIGNMENTS);
    vi.spyOn(organizationApi.usersApi, 'list').mockResolvedValue(
      page([
        { id: 'u-sari', username: 'sari', firstName: 'Sari', lastName: 'Dewi', isActive: true },
      ])
    );
  });

  it('names the current holder and keeps the previous one visible', async () => {
    renderScreen(<DepartmentDetailPage />, { path: '/:id', route: '/dept-1' });

    expect(await screen.findByText(/Budi Santoso/)).toBeInTheDocument();
    // The whole reason for an assignment table: January's holder is still
    // answerable in July. Awaited separately — the current holder renders from
    // the department itself, the history from its own request.
    expect(await screen.findByText('Sari Dewi')).toBeInTheDocument();
  });

  it('offers only this institution users when handing over', async () => {
    renderScreen(<DepartmentDetailPage />, { path: '/:id', route: '/dept-1' });
    await screen.findByText(/Budi Santoso/);

    await userEvent.click(screen.getByRole('button', { name: /hand over/i }));

    // The server refuses a user from elsewhere, so a wider list would be a trap.
    await waitFor(() =>
      expect(organizationApi.usersApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ institutionId: INSTITUTION.id })
      )
    );
  });

  it('hands the post over to the chosen person', async () => {
    const setPic = vi.spyOn(organizationApi.departmentsApi, 'setPic').mockResolvedValue({});
    renderScreen(<DepartmentDetailPage />, { path: '/:id', route: '/dept-1' });
    await screen.findByText(/Budi Santoso/);

    await userEvent.click(screen.getByRole('button', { name: /hand over/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/person/i), 'u-sari');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    await waitFor(() => expect(setPic).toHaveBeenCalledWith('dept-1', 'u-sari'));
  });

  it('says so plainly when nobody holds the post', async () => {
    organizationApi.departmentsApi.get.mockResolvedValue({
      ...DEPARTMENT,
      currentPicUserId: null,
      currentPic: null,
    });
    organizationApi.departmentsApi.picAssignments.mockResolvedValue([]);

    renderScreen(<DepartmentDetailPage />, { path: '/:id', route: '/dept-1' });

    expect(await screen.findByText(/nobody assigned/i)).toBeInTheDocument();
    // Nothing to hand over from, so the control says "assign".
    expect(screen.getByRole('button', { name: /^assign$/i })).toBeInTheDocument();
  });

  it('hides the panel entirely without department-pic:read', async () => {
    signInWith(ALL.filter((code) => !code.startsWith('department-pic')));

    renderScreen(<DepartmentDetailPage />, { path: '/:id', route: '/dept-1' });
    await screen.findByRole('heading', { name: DEPARTMENT.name });

    // Scoped to the panel's own control rather than its title text, which a
    // portal left mounted by an earlier test could also match.
    expect(screen.queryByRole('button', { name: /hand over/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /person in charge/i })).not.toBeInTheDocument();
  });
});
