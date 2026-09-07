import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { apiClient } from '@/api/client';
import { ApiError, ERROR_CODES } from '@/api/errors';
import { createQueryClient } from '@/lib/queryClient';
import { SESSION_STATUS, hasPermission, useSessionStore } from '@/stores/session';
import { Can, RequireAuth, RequirePermission } from './guards';
import { SessionProvider } from './SessionProvider';
import { installAuthInterceptors, resetRefreshState } from './interceptors';
import { useLogout } from './useSession';
import * as authApi from '@/api/auth';

/**
 * Authentication and authorization — `IMPLEMENTATION_PLAN.md` §16.1, §16.2;
 * `07-ui.md` §6.
 */

const SESSION = {
  accessToken: 'token-1',
  user: {
    id: 'user-1',
    username: 'admin',
    institutionId: null,
    roles: [{ id: 'r1', name: 'System Admin', isSystemWide: true }],
    permissions: ['asset:read', 'asset:create'],
    isSystemWide: true,
  },
};

function signIn(session = SESSION) {
  useSessionStore.getState().setSession(session);
}

function renderWithRouter(ui, { route = '/' } = {}) {
  const queryClient = createQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/login" element={<p>login screen</p>} />
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** The rejection handler the auth interceptor just registered. */
const authRejectionHandler = () => apiClient.interceptors.response.handlers.at(-1).rejected;

beforeEach(() => {
  useSessionStore.getState().clearSession();
  resetRefreshState();
});

describe('session store', () => {
  it('starts as restoring, not anonymous', () => {
    // A fresh store must not look signed-out before the refresh attempt runs,
    // or a guard would bounce a valid session on page load.
    expect(useSessionStore.getInitialState().status).toBe(SESSION_STATUS.RESTORING);
  });

  it('holds the access token in memory only', () => {
    signIn();

    expect(useSessionStore.getState().accessToken).toBe('token-1');
    // Nothing about the session may be persisted where an XSS payload can read it.
    expect(window.localStorage.getItem('accessToken')).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain('token-1');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('token-1');
  });

  it('indexes permissions for lookup', () => {
    signIn();
    const { permissions } = useSessionStore.getState();

    expect(hasPermission(permissions, 'asset:read')).toBe(true);
    expect(hasPermission(permissions, 'asset:delete')).toBe(false);
  });

  it('does not treat a system-wide role as a master key (BR-015)', () => {
    signIn();
    const { permissions, user } = useSessionStore.getState();

    expect(user.isSystemWide).toBe(true);
    // isSystemWide lifts organization scope; it grants no permission.
    expect(hasPermission(permissions, 'borrowing:return')).toBe(false);
  });

  it('drops everything on clear', () => {
    signIn();
    useSessionStore.getState().clearSession();

    const state = useSessionStore.getState();
    expect(state.status).toBe(SESSION_STATUS.ANONYMOUS);
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.permissions.size).toBe(0);
  });
});

describe('session restoration (SessionProvider)', () => {
  const renderProvider = () =>
    render(
      <SessionProvider>
        <p>app content</p>
      </SessionProvider>
    );

  beforeEach(() => {
    // The shared `beforeEach` clears the store, which lands it on ANONYMOUS —
    // the very state two of these tests assert the provider MOVES to. Starting
    // from RESTORING is what makes those assertions capable of failing; without
    // it they pass no matter what the provider does, which is exactly how a
    // wrong property name shipped.
    useSessionStore.setState({ status: SESSION_STATUS.RESTORING });
  });

  it('restores a session from the refresh cookie', async () => {
    vi.spyOn(authApi, 'refresh').mockResolvedValue({
      accessToken: 'token-1',
      user: { id: 'u1', username: 'a', permissions: [] },
    });

    renderProvider();

    expect(await screen.findByText('app content')).toBeInTheDocument();
    expect(useSessionStore.getState().status).toBe(SESSION_STATUS.AUTHENTICATED);
  });

  it('signs out on 401, which is the one failure that means "not signed in"', async () => {
    vi.spyOn(authApi, 'refresh').mockRejectedValue(
      new ApiError({ code: ERROR_CODES.UNAUTHORIZED, message: 'no cookie', status: 401 })
    );

    renderProvider();

    // Reaching the login screen depends on this. A 401 that stalls on the
    // "could not reach the server" panel leaves no route to sign in at all.
    await waitFor(() =>
      expect(useSessionStore.getState().status).toBe(SESSION_STATUS.ANONYMOUS)
    );
    expect(useSessionStore.getState().status).not.toBe(SESSION_STATUS.UNAVAILABLE);
  });

  it.each([
    [ERROR_CODES.RATE_LIMITED, 429],
    [ERROR_CODES.INTERNAL_ERROR, 500],
    [ERROR_CODES.NETWORK_ERROR, null],
  ])('does NOT sign out on %s — the session may still be valid', async (code, status) => {
    vi.spyOn(authApi, 'refresh').mockRejectedValue(
      new ApiError({ code, message: 'nope', status })
    );

    renderProvider();

    // THE REGRESSION: every one of these used to clear the session, throwing
    // away a valid one and dropping the user on a login form. The 429 case is
    // exactly what a shared rate limit on /auth/refresh produced.
    await waitFor(() =>
      expect(useSessionStore.getState().status).toBe(SESSION_STATUS.UNAVAILABLE)
    );
    expect(useSessionStore.getState().status).not.toBe(SESSION_STATUS.ANONYMOUS);
  });

  it('offers a retry that picks the session back up', async () => {
    const refreshSpy = vi
      .spyOn(authApi, 'refresh')
      .mockRejectedValueOnce(
        new ApiError({ code: ERROR_CODES.RATE_LIMITED, message: 'slow down', status: 429 })
      )
      .mockResolvedValueOnce({
        accessToken: 'token-1',
        user: { id: 'u1', username: 'a', permissions: [] },
      });

    renderProvider();

    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('app content')).toBeInTheDocument();
    expect(refreshSpy).toHaveBeenCalledTimes(2);
  });
});

describe('route guards', () => {
  it('sends an anonymous visitor to the login screen', () => {
    useSessionStore.getState().clearSession();

    renderWithRouter(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>,
      { route: '/assets' }
    );

    expect(screen.getByText('login screen')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('lets a signed-in caller through', () => {
    signIn();

    renderWithRouter(
      <RequireAuth>
        <p>protected content</p>
      </RequireAuth>
    );

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('shows FORBIDDEN rather than redirecting, and names the permission (§6)', () => {
    signIn();

    renderWithRouter(
      <RequirePermission code="borrowing:read">
        <p>borrowings</p>
      </RequirePermission>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this');
    expect(screen.getByRole('alert')).toHaveTextContent('borrowing:read');
    expect(screen.queryByText('borrowings')).not.toBeInTheDocument();
    // Not a redirect: the user stays where they are and is told why.
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });

  it('renders the page when the permission is held', () => {
    signIn();

    renderWithRouter(
      <RequirePermission code="asset:read">
        <p>assets</p>
      </RequirePermission>
    );

    expect(screen.getByText('assets')).toBeInTheDocument();
  });
});

describe('action guard', () => {
  it('hides an action rather than disabling it (§6)', () => {
    signIn();

    renderWithRouter(
      <>
        <Can code="asset:create">
          <button type="button">New asset</button>
        </Can>
        <Can code="asset:deactivate">
          <button type="button">Deactivate</button>
        </Can>
      </>
    );

    expect(screen.getByRole('button', { name: 'New asset' })).toBeInTheDocument();
    // Absent, not present-and-disabled.
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('can render a fallback in place of the hidden action', () => {
    signIn();

    renderWithRouter(
      <Can code="asset:deactivate" fallback={<span>read only</span>}>
        <button type="button">Deactivate</button>
      </Can>
    );

    expect(screen.getByText('read only')).toBeInTheDocument();
  });
});

describe('token refresh', () => {
  let eject;

  beforeEach(() => {
    eject = installAuthInterceptors();
  });

  afterEach(() => {
    eject();
    vi.restoreAllMocks();
  });

  const unauthorized = () =>
    new ApiError({
      code: ERROR_CODES.UNAUTHORIZED,
      message: 'The access token has expired',
      status: 401,
      cause: { config: { url: '/assets', headers: {} } },
    });

  it('refreshes once and retries the original request', async () => {
    signIn();
    const refreshSpy = vi
      .spyOn(authApi, 'refresh')
      .mockResolvedValue({ accessToken: 'token-2', user: SESSION.user });
    const requestSpy = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: { data: [] } });

    await authRejectionHandler()(unauthorized());

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledTimes(1);
    // The retry carries the NEW token, not the stale one.
    expect(requestSpy.mock.calls[0][0].headers.Authorization).toBe('Bearer token-2');
    expect(useSessionStore.getState().accessToken).toBe('token-2');
  });

  it('refreshes only once for several simultaneous 401s', async () => {
    signIn();
    const refreshSpy = vi
      .spyOn(authApi, 'refresh')
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ accessToken: 'token-2', user: SESSION.user }), 10)
          )
      );
    vi.spyOn(apiClient, 'request').mockResolvedValue({ data: { data: [] } });

    const handler = authRejectionHandler();
    await Promise.all([handler(unauthorized()), handler(unauthorized()), handler(unauthorized())]);

    // Single-flight: three failures, one refresh.
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the session and rejects with the original error when refresh fails', async () => {
    signIn();
    vi.spyOn(authApi, 'refresh').mockRejectedValue(new Error('no cookie'));
    const original = unauthorized();

    await expect(authRejectionHandler()(original)).rejects.toBe(original);
    await waitFor(() => expect(useSessionStore.getState().status).toBe(SESSION_STATUS.ANONYMOUS));
  });

  it('never refreshes in response to a failed login or refresh', async () => {
    const refreshSpy = vi.spyOn(authApi, 'refresh');
    const error = new ApiError({
      code: ERROR_CODES.UNAUTHORIZED,
      message: 'Invalid username or password',
      status: 401,
      cause: { config: { url: '/auth/login', headers: {}, [authApi.SKIP_AUTH_REFRESH]: true } },
    });

    await expect(authRejectionHandler()(error)).rejects.toBe(error);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('does not retry a second time after a refreshed token still fails', async () => {
    signIn();
    const refreshSpy = vi.spyOn(authApi, 'refresh');
    const error = unauthorized();
    error.cause.config.__retriedAfterRefresh = true;

    await expect(authRejectionHandler()(error)).rejects.toBe(error);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('leaves non-401 failures untouched', async () => {
    const conflict = new ApiError({
      code: ERROR_CODES.CONFLICT,
      message: 'Already active',
      status: 409,
      cause: { config: { url: '/assets', headers: {} } },
    });
    const refreshSpy = vi.spyOn(authApi, 'refresh');

    await expect(authRejectionHandler()(conflict)).rejects.toBe(conflict);
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});

describe('logout', () => {
  it('clears the session even when the server call fails', async () => {
    signIn();
    vi.spyOn(authApi, 'logout').mockRejectedValue(new Error('already gone'));

    const queryClient = createQueryClient();

    function LogoutButton() {
      const logout = useLogout();
      return (
        <button type="button" onClick={() => logout.mutate()}>
          Sign out
        </button>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <LogoutButton />
      </QueryClientProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    // Refusing to sign out locally because the server said no would strand the
    // user in a broken session.
    await waitFor(() => expect(useSessionStore.getState().status).toBe(SESSION_STATUS.ANONYMOUS));
  });
});
