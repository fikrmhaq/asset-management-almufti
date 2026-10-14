import { api } from './client';

/**
 * Requests — `06-api.md` §12.3 – §12.4 (`CR-014`): drafting (Phase 37),
 * submission and step actions (Phase 38), documents (Phase 39).
 *
 * No endpoint deletes a request at all. `guidance` is informational — nothing
 * it says prevents saving a draft.
 */
export const requestsApi = {
  list: (params) => api.list('/requests', params),
  /** P5 + P6 (§64.5, §64.6): `{actionNeeded, updated}` — two independent counts. */
  attention: () => api.get('/requests/attention'),
  /** P6: the caller has seen this request now. Nothing else is marked. */
  markViewed: (id) => api.post(`/requests/${encodeURIComponent(id)}/view`, {}),
  get: (id) => api.get(`/requests/${encodeURIComponent(id)}`),
  guidance: () => api.get('/requests/guidance'),
  create: (body) => api.post('/requests', body),
  update: (id, body) => api.patch(`/requests/${encodeURIComponent(id)}`, body),
  addItem: (id, body) => api.post(`/requests/${encodeURIComponent(id)}/items`, body),
  updateItem: (itemId, body) => api.patch(`/request-items/${encodeURIComponent(itemId)}`, body),
  removeItem: (itemId) => api.delete(`/request-items/${encodeURIComponent(itemId)}`),

  // --- Phase 38 -------------------------------------------------------------
  submit: (id) => api.post(`/requests/${encodeURIComponent(id)}/submit`, {}),
  /** Cancels, or discards the requester's own DRAFT (decision F3). `reason` is required. */
  cancel: (id, reason) => api.post(`/requests/${encodeURIComponent(id)}/cancel`, { reason }),
  /**
   * APPROVE, REJECT or REQUEST_REVISION (REQ-REQUEST-018) — the last with its
   * reason as `comment` and optional `itemNotes: [{requestItemId, note}]`.
   */
  decide: (stepId, decision, comment, itemNotes) =>
    api.post(`/request-steps/${encodeURIComponent(stepId)}/decide`, {
      decision,
      ...(comment ? { comment } : {}),
      ...(itemNotes?.length ? { itemNotes } : {}),
    }),
  /** The PROCURE actor's declaration — never fulfilment (`BR-031`). */
  complete: (stepId, note) =>
    api.post(`/request-steps/${encodeURIComponent(stepId)}/complete`, note ? { note } : {}),

  // --- Phase 39: documents (`06-api.md` §12.4) --------------------------------
  listDocuments: (id) => api.get(`/requests/${encodeURIComponent(id)}/documents`),
  /** `formData`: `file`, `documentType`, optional `title`. */
  uploadDocument: (id, formData) =>
    api.upload(`/requests/${encodeURIComponent(id)}/documents`, formData),
  /** The BYTES: `?download=true`, as for attachments — without it the API answers metadata. */
  downloadDocument: (documentId) =>
    api.download(`/request-documents/${encodeURIComponent(documentId)}?download=true`),
  removeDocument: (documentId) =>
    api.delete(`/request-documents/${encodeURIComponent(documentId)}`),

  // --- Phase 40: registration (`06-api.md` §12.5) -----------------------------
  // Registration links a unit to an item. It is never receipt (`BR-031`).
  /** `{assetId} | {name, classificationId}`, plus `unitCount`, `departmentId?`, … */
  registerUnits: (itemId, body) =>
    api.post(`/request-items/${encodeURIComponent(itemId)}/register`, body),
  listItemUnits: (itemId) => api.get(`/request-items/${encodeURIComponent(itemId)}/units`),
  linkUnit: (itemId, assetUnitId) =>
    api.post(`/request-items/${encodeURIComponent(itemId)}/units`, { assetUnitId }),
  unlinkUnit: (linkId) => api.delete(`/request-item-units/${encodeURIComponent(linkId)}`),

  // --- Phase 41: receipt and closing the remainder (`06-api.md` §12.6) --------
  /**
   * The requester's receipt with its confirmation — multipart (migration 057):
   * build the body with `receiptFormData`. All of it lands, or none does.
   */
  receive: (id, formData) => api.upload(`/requests/${encodeURIComponent(id)}/receive`, formData),
  /** Oversight only, never the receipt's recorder; the receipt row is kept. */
  reverseReceipt: (receiptId, reason) =>
    api.post(`/request-receipts/${encodeURIComponent(receiptId)}/reverse`, { reason }),
  closeRemainder: (id, reason) => api.post(`/requests/${encodeURIComponent(id)}/close`, { reason }),
  /**
   * §73: consumables handed over against consumable lines —
   * `{ items: [{ requestItemId, quantity }], note? }`. All lines or none.
   */
  issue: (id, body) => api.post(`/requests/${encodeURIComponent(id)}/issue`, body),
};

/** Builds the multipart body for one document. */
export function documentFormData({ file, documentType, title }) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('documentType', documentType);
  if (title?.trim()) formData.append('title', title.trim());
  return formData;
}

/**
 * Builds the multipart body for recording receipt (migration 057): the units,
 * the date, the placement (only when the request has an intended place), the
 * description and 1–5 photos.
 *
 * REQ-REQUEST-022: `unitPhotos` — `[{assetUnitId, file}]` — go under `unitPhotos`,
 * each naming its unit in `unitPhotoUnitIds`, in the same order. Units only:
 * the server finds the receipts. `photos` stay the photos of the whole receipt.
 */
export function receiptFormData({
  assetUnitIds,
  receivedOn,
  placement,
  description,
  photos,
  unitPhotos = [],
}) {
  const formData = new FormData();
  for (const id of assetUnitIds) formData.append('assetUnitIds', id);
  formData.append('receivedOn', receivedOn);
  if (placement) formData.append('placement', placement);
  formData.append('description', description.trim());
  for (const photo of photos) formData.append('photos', photo);
  for (const { assetUnitId } of unitPhotos) formData.append('unitPhotoUnitIds', assetUnitId);
  for (const { file } of unitPhotos) formData.append('unitPhotos', file);
  return formData;
}
