import axios from 'axios';

import { normalizeError } from './errors';

/**
 * The HTTP client — `IMPLEMENTATION_PLAN.md` §15.2, `06-api.md` §1.
 *
 * One instance for the whole application. Two things happen here and nowhere
 * else:
 *
 *   1. the response envelope is unwrapped, so a caller receives `data` (and
 *      `meta` for lists) rather than reaching through `response.data.data`;
 *   2. every failure becomes an `ApiError` (`api/errors.js`), so no screen ever
 *      inspects an Axios error shape.
 *
 * `withCredentials` is on because the refresh token is an httpOnly cookie
 * (`05-infrastructure.md` §6.1) — the browser will not send it otherwise.
 *
 * Authentication is deliberately a HOOK here, not an implementation. Phase 10
 * owns login, token storage and refresh-on-401 (`IMPLEMENTATION_PLAN.md` §16.1);
 * this phase provides the seam so that arrives without rewriting the client.
 */

const BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

/** @type {() => string|null} */
let accessTokenProvider = () => null;
/** @type {(error: import('./errors').ApiError) => void} */
let authFailureHandler = () => {};

/**
 * Registers where the access token comes from — Phase 10's integration point.
 *
 * A getter rather than a value: the token is replaced on every refresh, and a
 * client holding a copy would keep sending the stale one.
 */
export function setAccessTokenProvider(provider) {
  accessTokenProvider = typeof provider === 'function' ? provider : () => null;
}

/** Registers what happens on a 401. Phase 10 uses this to refresh or sign out. */
export function setAuthFailureHandler(handler) {
  authFailureHandler = typeof handler === 'function' ? handler : () => {};
}

export const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { Accept: 'application/json' },
  timeout: 30000,
});

apiClient.interceptors.request.use((config) => {
  const token = accessTokenProvider();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalized = normalizeError(error);
    if (normalized.isAuthFailure) authFailureHandler(normalized);
    return Promise.reject(normalized);
  }
);

/**
 * `{ data }` → the resource. Used by every detail and mutation call.
 *
 * @returns {Promise<unknown>}
 */
async function unwrap(promise) {
  const response = await promise;
  return response.data?.data;
}

/**
 * `{ data, meta }` → both, since a list page needs the pagination block
 * (`06-api.md` §1.5).
 *
 * @returns {Promise<{data: unknown[], meta: {page: number, pageSize: number,
 *   total: number, totalPages: number}}>}
 */
async function unwrapList(promise) {
  const response = await promise;
  return {
    data: response.data?.data ?? [],
    meta: response.data?.meta ?? { page: 1, pageSize: 0, total: 0, totalPages: 0 },
  };
}

/** Thin verbs over the instance. Resource modules build on these, not on axios. */
export const api = {
  get: (url, config) => unwrap(apiClient.get(url, config)),
  list: (url, params, config) => unwrapList(apiClient.get(url, { ...config, params })),
  post: (url, body, config) => unwrap(apiClient.post(url, body, config)),
  patch: (url, body, config) => unwrap(apiClient.patch(url, body, config)),
  put: (url, body, config) => unwrap(apiClient.put(url, body, config)),
  delete: (url, config) => unwrap(apiClient.delete(url, config)),
  /** Multipart upload — `06-api.md` §1.8. The browser sets the boundary itself. */
  upload: (url, formData, config = {}) =>
    unwrap(apiClient.post(url, formData, { ...config, headers: { ...config.headers } })),
  /** Binary responses: floor plan images, attachment downloads. */
  download: async (url, config = {}) => {
    const response = await apiClient.get(url, { ...config, responseType: 'blob' });
    return response.data;
  },
};

export { BASE_URL };
