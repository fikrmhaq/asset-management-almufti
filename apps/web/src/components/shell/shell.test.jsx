import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { createQueryClient } from '@/lib/queryClient';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { useSessionStore } from '@/stores/session';
import { NAVIGATION, visibleNavigation } from '@/navigation';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { t } from '@/i18n';

/**
 * Application shell — `07-ui.md` §2, §3, §6; `IMPLEMENTATION_PLAN.md` §16.3.
 */

function signIn(permissions) {
  useSessionStore.getState().setSession({
    accessToken: 'token',
    user: {
      id: 'u1',
      username: 'ratna',
      roles: [{ id: 'r1', name: 'Asset Officer', isSystemWide: false }],
      permissions,
      isSystemWide: false,
    },
  });
}

/** Renders under a data router, which is what the breadcrumb needs. */
function renderShell(element, { route = '/', routes } = {}) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes ?? [{ path: '*', element, handle: { crumb: 'Home' } }], {
    initialEntries: [route],
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  useSessionStore.getState().clearSession();
});

describe('navigation model', () => {
  it('mirrors the module grouping of 07-ui.md §2', () => {
    // Keys, not words: the labels themselves live in the dictionaries now.
    expect(NAVIGATION.map((group) => group.labelKey)).toEqual([
      'nav.groups.dashboard',
      'nav.groups.assets',
      'nav.groups.procurement',
      'nav.groups.operations',
      'nav.groups.organization',
      // Phase 37 (`CR-014`): `07-ui.md` §2 places Requests after Organization.
      'nav.groups.requests',
      'nav.groups.reportsAudit',
    ]);

    // And every key resolves to real copy in both languages.
    for (const group of NAVIGATION) {
      expect(t(group.labelKey)).not.toBe(group.labelKey);
      for (const item of group.items) expect(t(item.labelKey)).not.toBe(item.labelKey);
    }
  });

  it('gives every entry a permission code', () => {
    const CODE = /^[a-z-]+:[a-z-]+$/;

    for (const group of NAVIGATION) {
      for (const item of group.items) {
        // One code, or a set of which one suffices (`CR-010`) — never neither,
        // which would be an unguarded entry.
        const codes = item.anyPermission ?? [item.permission];

        expect(codes.length, item.labelKey).toBeGreaterThan(0);
        for (const code of codes) expect(code, item.labelKey).toMatch(CODE);
      }
    }
  });

  it('drops a group once none of its items are visible', () => {
    const groups = visibleNavigation(new Set(['asset:read']));

    expect(groups).toHaveLength(1);
    expect(groups[0].labelKey).toBe('nav.groups.assets');
    expect(groups[0].items.map((item) => item.labelKey)).toEqual(['nav.items.assets']);
  });

  it('shows nothing to a session with no read permissions', () => {
    expect(visibleNavigation(new Set())).toEqual([]);
  });
});

describe('Sidebar', () => {
  it('hides modules the session cannot read, rather than disabling them (§6)', () => {
    signIn(['asset:read', 'location:read']);
    renderShell(<Sidebar />);

    expect(screen.getByRole('link', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Locations' })).toBeInTheDocument();

    // No Procurement, Operations or Organization at all — not greyed out.
    expect(screen.queryByRole('link', { name: 'Contracts' })).not.toBeInTheDocument();
    expect(screen.queryByText('Procurement')).not.toBeInTheDocument();
    expect(screen.queryByText('Organization')).not.toBeInTheDocument();
  });

  it('reveals a module as soon as its read permission is held', () => {
    signIn(['borrowing:read']);
    renderShell(<Sidebar />);

    expect(screen.getByRole('link', { name: 'Borrowings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vendors' })).not.toBeInTheDocument();
  });

  it('says so when nothing is available', () => {
    signIn([]);
    renderShell(<Sidebar />);

    expect(screen.getByText(/no modules are available/i)).toBeInTheDocument();
  });

  it('marks the active route', () => {
    signIn(['asset:read', 'location:read']);
    renderShell(<Sidebar />, { route: '/locations' });

    expect(screen.getByRole('link', { name: 'Locations' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Assets' })).not.toHaveAttribute('aria-current');
  });
});

describe('TopBar', () => {
  it('shows who is signed in and their roles', () => {
    signIn(['asset:read']);
    renderShell(<TopBar />);

    expect(screen.getByText('ratna')).toBeInTheDocument();
    expect(screen.getByText('Asset Officer')).toBeInTheDocument();
  });

  it('jumps global search into the asset list filter (REQ-SEARCH-001)', async () => {
    signIn(['asset:read']);
    const router = createMemoryRouter(
      [
        { path: '/', element: <TopBar /> },
        { path: '/assets', element: <p>asset list</p> },
      ],
      { initialEntries: ['/'] }
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>
    );

    await userEvent.type(screen.getByLabelText(/search assets/i), 'laptop');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByText('asset list')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=laptop');
  });

  it('hides search from a session that cannot read assets', () => {
    signIn(['borrowing:read']);
    renderShell(<TopBar />);

    expect(screen.queryByLabelText(/search assets/i)).not.toBeInTheDocument();
  });

  it('confirms before signing out (§4.4)', async () => {
    signIn(['asset:read']);
    renderShell(<TopBar />);

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Sign out?');
  });

  it('toggles the sidebar', async () => {
    signIn(['asset:read']);
    const onToggle = vi.fn();
    renderShell(<TopBar onToggleSidebar={onToggle} />);

    await userEvent.click(screen.getByRole('button', { name: /toggle navigation/i }));
    expect(onToggle).toHaveBeenCalled();
  });
});

describe('Breadcrumbs', () => {
  it('builds the trail from the matched route hierarchy', () => {
    signIn(['asset:read']);

    renderShell(null, {
      route: '/assets/abc',
      routes: [
        {
          path: '/',
          element: <TopBar />,
          handle: { crumb: 'Home' },
          children: [
            {
              path: 'assets',
              handle: { crumb: 'Assets' },
              children: [{ path: ':id', handle: { crumb: (params) => params.id }, element: null }],
            },
          ],
        },
      ],
    });

    const trail = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(trail).toHaveTextContent('Home');
    expect(trail).toHaveTextContent('Assets');
    expect(trail).toHaveTextContent('abc');

    // The current page is not a link to itself.
    expect(screen.getByText('abc')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Assets' })).toHaveAttribute('href', '/assets');
  });
});
