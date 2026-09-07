import { api } from './client';

/**
 * Operations API — `06-api.md` §7.2, §7.3.
 *
 * Written out rather than generated from `createResourceApi`, because neither
 * resource has the standard shape:
 *
 *   - A Borrowing has no deactivate/reactivate. Its status is changed by four
 *     ACTION endpoints, each with its own permission, because each also moves
 *     the physical units the borrowing holds (`DEC-013`).
 *   - A Transaction has no update and no delete at all. REQ-TXN-007 requires
 *     historical records never to be silently modified, and the surest guarantee
 *     is that no such call exists to make.
 */

export const borrowingsApi = {
  list: (params) => api.list('/borrowings', params),
  get: (id) => api.get(`/borrowings/${id}`),
  create: (body) => api.post('/borrowings', body),
  /** DRAFT only — the server answers `CONFLICT` in any other status. */
  update: (id, body) => api.patch(`/borrowings/${id}`, body),

  /** Items — guarded by `borrowing-item:*`, and editable while DRAFT (`DEC-012`). */
  listItems: (id, params) => api.list(`/borrowings/${id}/items`, params),
  addItem: (id, assetUnitId) => api.post(`/borrowings/${id}/items`, { assetUnitId }),
  removeItem: (id, itemId) => api.delete(`/borrowings/${id}/items/${itemId}`),

  // --- State transitions ------------------------------------------------------
  // One call per edge of `03-domain.md` §7.2. There is deliberately no
  // "set status" call: OVERDUE is written by the Phase 8 sweep, never by a user.

  activate: (id) => api.post(`/borrowings/${id}/activate`),
  cancel: (id) => api.post(`/borrowings/${id}/cancel`),
  return: (id, body) => api.post(`/borrowings/${id}/return`, body),
  /** Answers `{ returned, borrowing }` — the second is a new DRAFT (`DEC-015`). */
  extend: (id, body) => api.post(`/borrowings/${id}/extend`, body),
};

export const transactionsApi = {
  list: (params) => api.list('/transactions', params),
  get: (id) => api.get(`/transactions/${id}`),
  /** Header AND items in one call: creation is the only moment composition is set. */
  create: (body) => api.post('/transactions', body),
  listItems: (id, params) => api.list(`/transactions/${id}/items`, params),
};
