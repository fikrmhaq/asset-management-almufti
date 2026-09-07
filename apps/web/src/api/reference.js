import { api } from './client';
import { createResourceApi } from './resources';

/**
 * Reference and classification API — `06-api.md` §4.
 */

/**
 * Classifications — §4.1. READ-ONLY: no create, update or delete exists here or
 * on the server (REQ-CLASS-003, REQ-REF-003).
 *
 * `list()` with no `parentId` returns the root-level nodes, which is where the
 * picker's drill-down starts (`07-ui.md` §4.5).
 */
/**
 * Classifications — §4.1.
 *
 * Mostly read-only reference data, with one seam: application-defined leaves
 * (`origin = 3`) may be added, renamed and deleted (Phase 17, `CR-001`). The
 * server decides which nodes those are and says so in `isAppDefined`, so nothing
 * here needs to know the rule.
 *
 * The reads take `institutionId` and `owner` (`06-api.md` §4.1): the first
 * chooses whose private nodes are in view, the second narrows within it.
 */
export const classificationsApi = {
  list: (params) => api.list('/classifications', params),
  get: (id) => api.get(`/classifications/${id}`),
  children: (id, params) => api.list(`/classifications/${id}/children`, params),
  /** Leaf-only search, for the picker's type-ahead — REQ-CLASS-009/010. */
  searchLeaves: (q, params) => api.list('/classifications/leaf', { q, ...params }),
  attributeDefinitions: (id) => api.get(`/classifications/${id}/attribute-definitions`),
  /** The id is allocated by the server (REQ-CLASS-013) and never sent. */
  create: (body) => api.post('/classifications', body),
  rename: (id, body) => api.patch(`/classifications/${id}`, body),
  remove: (id) => api.delete(`/classifications/${id}`),
  promote: (id) => api.post(`/classifications/${id}/promote`),
};

/** Categories — §4.2. Read-only (REQ-CLASS-002), so list and detail only. */
export const categoriesApi = {
  list: (params) => api.list('/categories', params),
  get: (id) => api.get(`/categories/${id}`),
};

export const attributeDefinitionsApi = createResourceApi('/attribute-definitions');

/**
 * The five editable simple lookups — §4.4, §4.5.
 *
 * They share one shape (identifier + name, plain CRUD, no status column), which
 * is why `07-ui.md` §5.2 makes them one tabbed page rather than five screens.
 * `account-codes` is keyed by `code`, a `CHAR(12)` natural key, not an id.
 */
export const lookupApis = {
  'measurement-units': createResourceApi('/measurement-units'),
  'contract-types': createResourceApi('/contract-types'),
  'funding-sources': createResourceApi('/funding-sources'),
  'transaction-types': createResourceApi('/transaction-types'),
  'account-codes': createResourceApi('/account-codes'),
};
