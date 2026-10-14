import { api } from './client';

/**
 * Consumables — `IMPLEMENTATION_PLAN.md` §73. Quantity-based stock, not Assets.
 *
 * The master (`consumable:read / create / update / deactivate`), stock
 * (`consumable:manage-stock`: receive, adjust) and its history. Issuing happens
 * against a request line: `requestsApi.issue`. `options` is what a requester
 * may name on a request line (`request:create`) — no stock figures.
 */
const path = (id) => `/consumables/${encodeURIComponent(id)}`;

export const consumablesApi = {
  list: (params) => api.list('/consumables', params),
  get: (id) => api.get(path(id)),
  create: (body) => api.post('/consumables', body),
  update: (id, body) => api.patch(path(id), body),
  deactivate: (id) => api.post(`${path(id)}/deactivate`),
  reactivate: (id) => api.post(`${path(id)}/reactivate`),
  movements: (id, params) => api.list(`${path(id)}/movements`, params),
  receive: (id, body) => api.post(`${path(id)}/receipts`, body),
  adjust: (id, body) => api.post(`${path(id)}/adjustments`, body),
  options: () => api.get('/consumables/options'),
};
