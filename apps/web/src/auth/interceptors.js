import { apiClient, setAccessTokenProvider } from '@/api/client';
import { ERROR_CODES } from '@/api/errors';
import { refresh, SKIP_AUTH_REFRESH } from '@/api/auth';
import { getAccessToken, useSessionStore } from '@/stores/session';

/**
 * Transparent token refresh — `IMPLEMENTATION_PLAN.md` §16.1,
 * `05-infrastructure.md` §6.1/§6.2.
 *
 * Access tokens last 15 minutes, so a user working for an hour WILL hit an
 * expired one mid-action. Making them log in again at that moment would be a
 * bug, not security: the refresh cookie is still valid and the server is willing
 * to issue a new access token.
 *
 * So a `401` triggers one refresh and one retry of the original request. If the
 * refresh also fails — cookie gone, session revoked, account deactivated
 * (REQ-USER-004) — the session really is over and is cleared.
 *
 * The refresh is single-flight. A page that fires five queries at once produces
 * five simultaneous 401s, and five parallel refresh calls would race: the last
 * one wins and four requests retry with a token that has already been replaced.
 * Every caller awaits the same in-flight promise instead.
 *
 * This is the integration point Phase 9 left open (`api/client.js`).
 */

/** @type {Promise<string|null>|null} */
let inFlightRefresh = null;

async function refreshOnce() {
  inFlightRefresh ??= refresh()
    .then((session) => {
      useSessionStore.getState().setSession(session);
      return session.accessToken;
    })
    .catch((error) => {
      useSessionStore.getState().clearSession();
      throw error;
    })
    .finally(() => {
      inFlightRefresh = null;
    });

  return inFlightRefresh;
}

/** Whether this failure is one a refresh could plausibly fix. */
function shouldAttemptRefresh(error) {
  if (error?.code !== ERROR_CODES.UNAUTHORIZED) return false;

  const config = error.cause?.config;
  if (!config) return false;

  // `/auth/login` and `/auth/refresh` opt out: refreshing to recover a failed
  // login is nonsense, and refreshing to recover a failed refresh is a loop.
  if (config[SKIP_AUTH_REFRESH]) return false;

  // One attempt only. A second 401 after a fresh token means the token is not
  // the problem.
  return !config.__retriedAfterRefresh;
}

/**
 * Wires the client to the session store. Call once, at application start.
 *
 * @returns {() => void} an eject function, so tests can install cleanly
 */
export function installAuthInterceptors() {
  setAccessTokenProvider(getAccessToken);

  // Registered after Phase 9's normalizing interceptor, so `error` here is
  // already an `ApiError`.
  const id = apiClient.interceptors.response.use(undefined, async (error) => {
    if (!shouldAttemptRefresh(error)) return Promise.reject(error);

    const config = error.cause.config;
    config.__retriedAfterRefresh = true;

    try {
      const accessToken = await refreshOnce();
      // Replace the header explicitly: the request interceptor already ran for
      // this config, so it will not be re-applied on the retry.
      config.headers = { ...config.headers, Authorization: `Bearer ${accessToken}` };
      return await apiClient.request(config);
    } catch {
      // Reject with the ORIGINAL failure. The caller asked for an asset, not a
      // refresh, and the refresh error would be noise in their error state.
      return Promise.reject(error);
    }
  });

  return () => apiClient.interceptors.response.eject(id);
}

/** Test-only: forgets any in-flight refresh between cases. */
export function resetRefreshState() {
  inFlightRefresh = null;
}
