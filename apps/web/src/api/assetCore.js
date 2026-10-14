import { api } from './client';
import { createResourceApi } from './resources';

/**
 * Asset core API — `06-api.md` §5.
 *
 * The sub-collections are written out rather than generated: each has its own
 * permission and its own shape, and a reader of this file should be able to see
 * which endpoint a screen actually calls.
 */

export const assetsApi = {
  ...createResourceApi('/assets'),
  /** P3 (§64.3): the caller's own Asset reach — department-scoped or not, and which. */
  scope: () => api.get('/assets/scope'),
  /** §5.1 — an asset's physical units. */
  listUnits: (id, params) => api.list(`/assets/${id}/units`, params),
  /** Every unit's label in one call — REQ-UNIT-010, a complete collection. */
  unitLabels: (id) => api.list(`/assets/${id}/units/labels`),
  createUnit: (id, body) => api.post(`/assets/${id}/units`, body),
  /** Attribute values: `PUT` replaces the whole set (§5.1, REQ-ATTR-006/008). */
  attributeValues: (id) => api.get(`/assets/${id}/attribute-values`),
  replaceAttributeValues: (id, values) => api.put(`/assets/${id}/attribute-values`, { values }),
  listAttachments: (id) => api.get(`/assets/${id}/attachments`),
  uploadAttachment: (id, formData) => api.upload(`/assets/${id}/attachments`, formData),
};

/**
 * The inventory-code preview — P4 (`IMPLEMENTATION_PLAN.md` §64.4). Read-only on
 * the server: it writes and reserves nothing, and registration still decides.
 */
export const inventoryCodesApi = {
  preview: (body) => api.post('/inventory-codes/preview', body),
};

export const assetUnitsApi = {
  /**
   * The Asset Unit collection — §5.2, `CR-005`.
   *
   * Gated by `asset-unit:read`, NOT `asset:read`, which is what makes it usable
   * by a Department PIC: they manage units without administering the assets
   * those units belong to. The server scopes the result to the caller's
   * institution and, for a PIC, to their current departments — the params below
   * only narrow further.
   */
  list: (params) => api.list('/asset-units', params),
  get: (id) => api.get(`/asset-units/${id}`),
  update: (id, body) => api.patch(`/asset-units/${id}`, body),
  setActive: (id, active) => api.post(`/asset-units/${id}/${active ? 'reactivate' : 'deactivate'}`),
  attributeValues: (id) => api.get(`/asset-units/${id}/attribute-values`),
  replaceAttributeValues: (id, values) =>
    api.put(`/asset-units/${id}/attribute-values`, { values }),
  /**
   * Longitudinal history — §5.2.
   *
   * ONE endpoint, not three: condition, location and lifecycle state are one row
   * (`03-domain.md` §4.12), so moving a unit and changing its condition are the
   * same write. Omitted fields carry forward.
   */
  history: (id, params) => api.list(`/asset-units/${id}/history`, params),
  recordHistory: (id, body) => api.post(`/asset-units/${id}/history`, body),
  /** Location assignment history — `DEC-006`. */
  locations: (id) => api.get(`/asset-units/${id}/locations`),
  borrowings: (id, params) => api.list(`/asset-units/${id}/borrowings`, params),
  transactions: (id, params) => api.list(`/asset-units/${id}/transactions`, params),
  /**
   * Label endpoints — §5.2, REQ-UNIT-009/010/011.
   *
   * `label` is deliberately not the unit detail: it returns only what may be
   * printed (`BR-021`), so a screen cannot accidentally put a location on a
   * sticker that will outlive it.
   */
  label: (id) => api.get(`/asset-units/${id}/label`),
  /**
   * Labels for SELECTED units, in the order given (§73) — each the same label
   * `label` returns. Any unit out of reach fails the whole batch.
   */
  labels: (ids) => api.get('/asset-units/labels', { params: { ids: ids.join(',') } }),
  /**
   * Lookup by printed code — REQ-UNIT-011, `CR-008`.
   *
   * A QUERY value, not a path segment: a code may contain a slash, and `%2F`
   * inside a path is decoded-then-split by proxies that never touch a query
   * string. The server keeps the older path route for labels printed before the
   * change; nothing minted from here needs it.
   */
  byCode: (inventoryCode) => api.get('/asset-units/by-code', { params: { code: inventoryCode } }),
};

export const locationsApi = {
  ...createResourceApi('/locations'),
  /**
   * Direct children — a collection, so `api.list` and `{ data, meta }`.
   *
   * It was `api.get` while the endpoint answered in the item envelope, which
   * made this the one collection in the client that resolved to a bare array.
   * The location picker read it as a list and got nothing, so no location below
   * the top level could be chosen.
   */
  children: (id) => api.list(`/locations/${id}/children`),
  /** Includes units at descendant locations unless `scope: 'direct'` — `DEC-004`. */
  units: (id, params) => api.list(`/locations/${id}/units`, params),

  /**
   * Person in charge — Phase 21 (`CR-003`), REQ-LOC-009.
   *
   * Responsibility and history only: unlike a department's PIC, this grants the
   * holder no access to anything (§5.4).
   */
  picAssignments: (id) => api.get(`/locations/${id}/pic-assignments`),
  setPic: (id, userId) => api.put(`/locations/${id}/pic`, { userId }),
  clearPic: (id) => api.delete(`/locations/${id}/pic`),

  /**
   * Where a location sits, and which floor plan shows it.
   *
   * `{ path: [root … self], floorPlan: { locationId, floorPlanId, areaId } | null }`.
   *
   * The server owns the resolution rule so the unit page and the location page
   * cannot disagree about which ancestor's plan is the relevant one. `path` is
   * however long the hierarchy is — never assume a number of levels.
   */
  context: (id) => api.get(`/locations/${id}/context`),

  /**
   * Floor plan — §5.3, and `DEC-005` for why metadata and image are separate:
   * one endpoint would have to wrap binary data in JSON or abandon the response
   * envelope.
   */
  floorPlan: (id) => api.get(`/locations/${id}/floor-plan`),
  floorPlanImageUrl: (id) => `/locations/${id}/floor-plan/image`,
  downloadFloorPlan: (id) => api.download(`/locations/${id}/floor-plan/image`),
  uploadFloorPlan: (id, formData) => api.put(`/locations/${id}/floor-plan`, formData),
  deleteFloorPlan: (id) => api.delete(`/locations/${id}/floor-plan`),

  listAreas: (id) => api.get(`/locations/${id}/floor-plan/areas`),
  createArea: (id, body) => api.post(`/locations/${id}/floor-plan/areas`, body),
  updateArea: (id, areaId, body) => api.patch(`/locations/${id}/floor-plan/areas/${areaId}`, body),
  deleteArea: (id, areaId) => api.delete(`/locations/${id}/floor-plan/areas/${areaId}`),
};

/** §5.4 — metadata, the bytes, and removal. */
export const attachmentsApi = {
  get: (id) => api.get(`/attachments/${id}`),
  /**
   * The BYTES — and `?download=true` is load-bearing, not decoration.
   *
   * One endpoint serves both shapes (§5.4): metadata by default, the file only
   * when asked. Without the parameter the response is the JSON envelope, which
   * `api.download` faithfully wraps in a Blob because it was told to expect
   * binary — so every download saved a few hundred bytes of JSON under the
   * attachment's real name, and nothing could open it.
   *
   * Floor plans never had this defect because their bytes live at their own
   * endpoint (`/floor-plan/image`), with no flag to forget.
   */
  download: (id) => api.download(`/attachments/${id}?download=true`),
  remove: (id) => api.delete(`/attachments/${id}`),
};
