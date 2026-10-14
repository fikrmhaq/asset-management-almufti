import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as organizationApi from '@/api/organization';
import { locationsApi } from '@/api/assetCore';
import { requestsApi } from '@/api/requests';
import { visibleNavigation } from '@/navigation';
import { renderScreen, signInWith } from '@/test/harness';
import { changeLanguage } from '@/i18n';
import { TeacherStorageRoomPanel } from '@/components/organization/TeacherStorageRoomPanel';
import { TeacherStorageRoomPage } from './TeacherStorageRoomPage';
import { RequestFormPage } from '@/pages/requests/RequestFormPage';

/**
 * The Teacher Storage Room — REQ-REQUEST-023: the institution setting, its own
 * page for an institution administrator, and the request form's default.
 */

const READ = 'teacher-storage-room:read';
const UPDATE = 'teacher-storage-room:update';

const ROOM = { id: 'loc-store', name: 'Ruang Penyimpanan Guru', isActive: true };

const storageContext = {
  assignmentId: 'pa-common',
  institutionId: 'inst-1',
  positionCode: 'COMMON_TEACHER',
  department: null,
  departmentRule: 'OPTIONAL',
  typicalCategories: ['COMMON'],
  categories: [
    {
      category: 'COMMON',
      typical: true,
      eligible: true,
      processConfigured: true,
      departmentRequired: false,
    },
  ],
  defaultDestinations: [{ id: ROOM.id, name: ROOM.name }],
  defaultDestinationSource: 'TEACHER_STORAGE_ROOM',
};

afterEach(() => {
  vi.restoreAllMocks();
  changeLanguage('en');
});

describe('the setting', () => {
  beforeEach(() => {
    vi.spyOn(locationsApi, 'context').mockResolvedValue({
      path: [{ id: ROOM.id, name: ROOM.name }],
    });
  });

  it('shows the room read-only to a reader, and that a change reaches new requests only', async () => {
    signInWith([READ]);
    vi.spyOn(organizationApi.institutionsApi, 'teacherStorageRoom').mockResolvedValue({
      location: ROOM,
    });

    renderScreen(<TeacherStorageRoomPanel institutionId="inst-1" />);

    expect(await screen.findByTestId('teacher-storage-room-current')).toHaveTextContent(ROOM.name);
    expect(screen.getByText(/affects only new requests/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('says when none is configured', async () => {
    signInWith([READ]);
    vi.spyOn(organizationApi.institutionsApi, 'teacherStorageRoom').mockResolvedValue({
      location: null,
    });

    renderScreen(<TeacherStorageRoomPanel institutionId="inst-1" />);

    expect(await screen.findByTestId('teacher-storage-room-current')).toHaveTextContent(
      'Not configured'
    );
  });

  it('warns that a deactivated room is offered to no one', async () => {
    signInWith([READ]);
    vi.spyOn(organizationApi.institutionsApi, 'teacherStorageRoom').mockResolvedValue({
      location: { ...ROOM, isActive: false },
    });

    renderScreen(<TeacherStorageRoomPanel institutionId="inst-1" />);

    expect(
      await screen.findByText(/has been deactivated, so it is offered to no one/)
    ).toBeInTheDocument();
  });

  it('needs location:read as well to choose a room', async () => {
    signInWith([READ, UPDATE]);
    vi.spyOn(organizationApi.institutionsApi, 'teacherStorageRoom').mockResolvedValue({
      location: ROOM,
    });

    renderScreen(<TeacherStorageRoomPanel institutionId="inst-1" />);

    expect(await screen.findByText(/also needs permission to view locations/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('clears the room and saves null', async () => {
    signInWith([READ, UPDATE, 'location:read']);
    vi.spyOn(organizationApi.institutionsApi, 'teacherStorageRoom').mockResolvedValue({
      location: ROOM,
    });
    const save = vi
      .spyOn(organizationApi.institutionsApi, 'setTeacherStorageRoom')
      .mockResolvedValue({ location: null });
    const user = userEvent.setup();

    renderScreen(<TeacherStorageRoomPanel institutionId="inst-1" />);

    const saveButton = await screen.findByRole('button', { name: 'Save changes' });
    expect(saveButton).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Clear location' }));
    await user.click(saveButton);

    await waitFor(() => expect(save).toHaveBeenCalledWith('inst-1', null));
  });

  it('speaks Indonesian', async () => {
    changeLanguage('id');
    signInWith([READ]);
    vi.spyOn(organizationApi.institutionsApi, 'teacherStorageRoom').mockResolvedValue({
      location: null,
    });

    renderScreen(<TeacherStorageRoomPanel institutionId="inst-1" />);

    expect(await screen.findByTestId('teacher-storage-room-current')).toHaveTextContent(
      'Belum diatur'
    );
    expect(screen.getByText('Ruang penyimpanan guru')).toBeInTheDocument();
  });
});

describe('the page and its navigation', () => {
  it('configures the caller’s own institution', async () => {
    signInWith([READ], { institutionId: 'inst-7', isSystemWide: false });
    const read = vi
      .spyOn(organizationApi.institutionsApi, 'teacherStorageRoom')
      .mockResolvedValue({ location: null });

    renderScreen(<TeacherStorageRoomPage />);

    await waitFor(() => expect(read).toHaveBeenCalledWith('inst-7'));
  });

  it('sends a system-wide user to the institution instead', async () => {
    signInWith([READ], { institutionId: null, isSystemWide: true });

    renderScreen(<TeacherStorageRoomPage />);

    expect(await screen.findByText('No institution to configure')).toBeInTheDocument();
  });

  it('appears in the navigation only with its permission', () => {
    const labels = (permissions) =>
      visibleNavigation(new Set(permissions))
        .flatMap((group) => group.items)
        .map((item) => item.labelKey);

    expect(labels([READ])).toContain('nav.items.teacherStorageRoom');
    expect(labels(['location:read'])).not.toContain('nav.items.teacherStorageRoom');
  });
});

describe('the request form', () => {
  const REQUESTER = ['request:read', 'request:create', 'request:update', 'request:submit'];

  function renderNew() {
    return renderScreen(<RequestFormPage />, {
      route: '/requests/new',
      path: '/requests/new',
      extraRoutes: [{ path: '/requests/:id/edit', element: <p>edit page</p> }],
    });
  }

  it('pre-fills the storage room for a teacher who is no PIC, and says so', async () => {
    signInWith(REQUESTER, { institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({ contexts: [storageContext] });

    renderNew();

    const select = await screen.findByRole('combobox', { name: /Intended destination/ });
    await waitFor(() => expect(select).toHaveValue(ROOM.id));
    expect(
      screen.getByText(/Proposed by default: your institution’s teacher storage room/)
    ).toBeInTheDocument();
  });

  it('says nothing of the storage room when the default is a PIC room', async () => {
    signInWith(REQUESTER, { institutionId: 'inst-1', isSystemWide: false });
    vi.spyOn(requestsApi, 'guidance').mockResolvedValue({
      contexts: [
        {
          ...storageContext,
          defaultDestinations: [{ id: 'loc-lab', name: 'Lab Komputer' }],
          defaultDestinationSource: 'LOCATION_PIC',
        },
      ],
    });

    renderNew();

    const select = await screen.findByRole('combobox', { name: /Intended destination/ });
    await waitFor(() => expect(select).toHaveValue('loc-lab'));
    expect(screen.queryByText(/teacher storage room/)).not.toBeInTheDocument();
  });
});
