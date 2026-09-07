import { api } from './client';
import { createResourceApi } from './resources';

/**
 * Procurement API — `06-api.md` §6, plus §7.1's Vendors, which are procurement
 * work here (`DEC-008`, `DEC-034`).
 *
 * Every endpoint below already existed and was tested in Phase 6 (§12). This
 * file only builds the URLs.
 */

/** §6.1 — a global list, not organization-scoped (`DEC-007`). */
export const suppliersApi = createResourceApi('/suppliers');

/** §7.1 — global like Supplier; its ASSETS are scoped, because assets carry an institution. */
export const vendorsApi = {
  ...createResourceApi('/vendors'),
  /** REQ-VENDOR-004. Guarded by `asset:read`, not `vendor:read`. */
  assets: (id, params) => api.list(`/vendors/${id}/assets`, params),
};

/** §6.2 — organization-scoped through `contracts.institution_id` (`BR-007`). */
export const contractsApi = {
  ...createResourceApi('/contracts'),
  /** Line items — guarded by `contract-item:*`, since the item is what is acted on. */
  listItems: (id, params) => api.list(`/contracts/${id}/items`, params),
  createItem: (id, body) => api.post(`/contracts/${id}/items`, body),
};

/**
 * §6.3 — a contract item has no institution of its own; its scope is its
 * parent contract's. `remove` is a real hard delete: the table has no
 * `is_active` column, and the server answers `CONFLICT` once units reference it.
 */
export const contractItemsApi = {
  get: (id) => api.get(`/contract-items/${id}`),
  update: (id, body) => api.patch(`/contract-items/${id}`, body),
  remove: (id) => api.delete(`/contract-items/${id}`),
  /** Units procured through this line — REQ-PROC-006. Needs `asset-unit:read`. */
  assetUnits: (id, params) => api.list(`/contract-items/${id}/asset-units`, params),
  /**
   * The procurement-to-asset flow — REQ-PROC-009.
   *
   * Creates an Asset AND its units in one call, so it requires BOTH
   * `asset:create` and `asset-unit:create` (`DEC-010`). `contractId` and
   * `contractItemId` are absent by design: the server derives both, so the
   * caller cannot detach what it creates from the procurement it came from.
   */
  createAsset: (id, body) => api.post(`/contract-items/${id}/assets`, body),
};
