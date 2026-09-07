import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { ApiError, ERROR_CODES } from '@/api/errors';
import { createQueryClient } from '@/lib/queryClient';
import { SESSION_STATUS, useSessionStore } from '@/stores/session';
import { changeLanguage, DEFAULT_LANGUAGE } from '@/i18n';
import * as authApi from '@/api/auth';
import { LoginPage } from './LoginPage';

/**
 * Login — `IMPLEMENTATION_PLAN.md` §16.1, REQ-AUTH-002/004.
 */

function renderLogin({ route = '/login' } = {}) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: route, state: undefined }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>dashboard</p>} />
          <Route path="/assets" element={<p>asset list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const SESSION = {
  accessToken: 'token-1',
  user: { id: 'u1', username: 'admin', roles: [], permissions: ['asset:read'] },
};

beforeEach(() => {
  useSessionStore.getState().clearSession();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await changeLanguage(DEFAULT_LANGUAGE);
});

describe('LoginPage', () => {
  it('requires both fields before sending anything', async () => {
    const loginSpy = vi.spyOn(authApi, 'login');
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(loginSpy).not.toHaveBeenCalled();
  });

  it('signs in and stores the session', async () => {
    const loginSpy = vi.spyOn(authApi, 'login').mockResolvedValue(SESSION);
    renderLogin();

    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(useSessionStore.getState().status).toBe(SESSION_STATUS.AUTHENTICATED)
    );
    // TanStack Query passes a context object as the second argument; only the
    // credentials matter here.
    expect(loginSpy.mock.calls[0][0]).toEqual({ username: 'admin', password: 'correct-horse' });
    expect(useSessionStore.getState().accessToken).toBe('token-1');
  });

  it('shows the API’s generic failure message verbatim (REQ-AUTH-004)', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid username or password',
        status: 401,
      })
    );
    renderLogin();

    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByText('Invalid username or password')).toBeInTheDocument()
    );
    // The message must not be embellished into something that reveals which
    // half was wrong, or that the account exists but is deactivated.
    expect(screen.queryByText(/user not found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deactivated/i)).not.toBeInTheDocument();
    expect(useSessionStore.getState().status).toBe(SESSION_STATUS.ANONYMOUS);
  });

  it('reports a rate limit rather than looking like a wrong password', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new ApiError({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Too many attempts. Try again later.',
        status: 429,
      })
    );
    renderLogin();

    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'again');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByText('Too many attempts. Try again later.')).toBeInTheDocument()
    );
  });

  it('redirects an already-signed-in visitor away from the login screen', () => {
    useSessionStore.getState().setSession(SESSION);
    renderLogin();

    expect(screen.getByText('dashboard')).toBeInTheDocument();
  });

  it('uses a password field, so the value is not shoulder-readable', () => {
    renderLogin();

    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/username/i)).toHaveAttribute('autocomplete', 'username');
  });

  it('shows the AL-MUFTI logo without constraining both of its axes', () => {
    renderLogin();

    const logo = screen.getByAltText('SMK AL-MUFTI');

    expect(logo).toHaveAttribute('src', '/brand/almufti-logo.png');
    // Both intrinsic dimensions are declared so the box is reserved, but only
    // the height is ever styled — `w-auto` is what makes distorting the mark
    // impossible rather than merely unlikely.
    expect(logo).toHaveAttribute('width', '1084');
    expect(logo).toHaveAttribute('height', '167');
    expect(logo.className).toContain('w-auto');
  });

  /**
   * The language control is on this screen because the top bar that normally
   * carries it does not exist before sign-in.
   */
  describe('language', () => {
    it('re-translates a validation message that is already on screen', async () => {
      renderLogin();

      await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
      await waitFor(() => expect(screen.getByText('Enter your username.')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: 'Bahasa Indonesia' }));

      // Rebuilding the schema is not enough on its own: a message that has
      // already been produced sits in the form state until something validates
      // again, and would otherwise be stranded in English under an Indonesian
      // label.
      await waitFor(() =>
        expect(screen.getByText('Masukkan nama pengguna Anda.')).toBeInTheDocument()
      );
      expect(screen.queryByText('Enter your username.')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/nama pengguna/i)).toBeInTheDocument();
    });

    it('keeps the server’s message when the language changes', async () => {
      vi.spyOn(authApi, 'login').mockRejectedValue(
        new ApiError({
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'Invalid username or password',
          status: 401,
        })
      );
      renderLogin();

      await userEvent.type(screen.getByLabelText(/username/i), 'admin');
      await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
      await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
      await waitFor(() =>
        expect(screen.getByText('Invalid username or password')).toBeInTheDocument()
      );

      await userEvent.click(screen.getByRole('button', { name: 'Bahasa Indonesia' }));

      // Server text is passed through as the API sent it (`07-ui.md` §1.3), so
      // there is nothing to re-translate — but re-validating the form must not
      // discard it either.
      expect(screen.getByText('Invalid username or password')).toBeInTheDocument();
    });
  });
});
