import { api, apiClient } from './client';

/**
 * Authentication endpoints — `06-api.md` §2.
 *
 * `login` and `refresh` deliberately use the raw client rather than the shared
 * `api` helpers for one reason: both must bypass the refresh-and-retry
 * interceptor (`auth/interceptors.js`), which would otherwise try to recover a
 * failed login by refreshing, and try to recover a failed refresh by refreshing
 * again.
 */

/** Marks a request the refresh interceptor must leave alone. */
export const SKIP_AUTH_REFRESH = 'skipAuthRefresh';

const withoutRefresh = { [SKIP_AUTH_REFRESH]: true };

/** `{ username, password }` → `{ accessToken, user }`, and sets the refresh cookie. */
export async function login(credentials) {
  const response = await apiClient.post('/auth/login', credentials, withoutRefresh);
  return response.data?.data;
}

/**
 * Exchanges the httpOnly refresh cookie for a new access token — REQ-AUTH-005.
 *
 * Rejects when there is no cookie, the session was revoked, or the account was
 * deactivated mid-session (`05-infrastructure.md` §6.2) — all of which mean the
 * same thing to the caller: this session is over.
 */
export async function refresh() {
  const response = await apiClient.post('/auth/refresh', undefined, withoutRefresh);
  return response.data?.data;
}

/** Revokes the session server-side — REQ-AUTH-003. */
export function logout() {
  return api.post('/auth/logout');
}

/** The current profile, roles and effective permission set — REQ-AUTH-001. */
export function me() {
  return api.get('/auth/me');
}
