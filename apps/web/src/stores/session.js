import { create } from 'zustand';

/**
 * Session state — `IMPLEMENTATION_PLAN.md` §16.1, §16.2; `07-ui.md` §6.
 *
 * The access token lives in memory and NOWHERE else. Not `localStorage`, not
 * `sessionStorage`: anything readable from JavaScript is readable by an XSS
 * payload, and the whole point of delivering the refresh token as an httpOnly
 * cookie (`05-infrastructure.md` §6.1) is that the long-lived credential is out
 * of reach. Persisting the short-lived one beside it would give that up for a
 * convenience the refresh flow already provides.
 *
 * A page reload therefore starts with no token and asks `POST /auth/refresh` for
 * a new one — the cookie is what survives, exactly as designed.
 *
 * `permissions` is a `Set` because `usePermission` is called on nearly every
 * button in the application; an array scan per render would be wasteful for no
 * reason.
 */

/**
 * `restoring` until the silent refresh on boot resolves.
 *
 * `unavailable` is deliberately NOT `anonymous`. A refresh can fail because the
 * session really is over (401) or because the server could not be reached at all
 * — a network drop, a 5xx, a rate limit. Collapsing the second case into
 * "signed out" throws away a session that is still perfectly valid, and sends
 * the user to a login screen that will accept the password they are about to
 * retype for no reason. The two are distinguished so the second can offer a
 * retry instead.
 */
export const SESSION_STATUS = Object.freeze({
  RESTORING: 'restoring',
  AUTHENTICATED: 'authenticated',
  ANONYMOUS: 'anonymous',
  UNAVAILABLE: 'unavailable',
});

const EMPTY_PERMISSIONS = new Set();

export const useSessionStore = create((set) => ({
  status: SESSION_STATUS.RESTORING,
  accessToken: null,
  user: null,
  permissions: EMPTY_PERMISSIONS,

  /** Called after login, and after every successful refresh. */
  setSession: ({ accessToken, user }) =>
    set({
      status: SESSION_STATUS.AUTHENTICATED,
      accessToken,
      user,
      permissions: new Set(user?.permissions ?? []),
    }),

  /** Refreshes the profile without touching the token — used by `GET /auth/me`. */
  setUser: (user) => set({ user, permissions: new Set(user?.permissions ?? []) }),

  /**
   * The session could not be established, and we do not know whether it exists.
   * Nothing is cleared beyond the token we never got — in particular this is not
   * a sign-out, and the refresh cookie is left alone.
   */
  setUnavailable: () =>
    set({
      status: SESSION_STATUS.UNAVAILABLE,
      accessToken: null,
      user: null,
      permissions: EMPTY_PERMISSIONS,
    }),

  /** Logout, or a refresh the server actively rejected. */
  clearSession: () =>
    set({
      status: SESSION_STATUS.ANONYMOUS,
      accessToken: null,
      user: null,
      permissions: EMPTY_PERMISSIONS,
    }),
}));

/** Reads the token outside React — the Axios interceptor needs it per request. */
export const getAccessToken = () => useSessionStore.getState().accessToken;

/**
 * Whether the session holds a permission code.
 *
 * Deliberately has NO system-wide shortcut. `isSystemWide` lifts organization
 * scope, it does not grant permissions (`BR-015`, REQ-AUTHZ-005), and the server
 * enforces exactly that. A UI that treated it as a master key would show buttons
 * the API then rejects.
 */
export function hasPermission(permissions, code) {
  return Boolean(code) && permissions.has(code);
}
