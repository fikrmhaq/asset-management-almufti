import { api } from './client';

/**
 * Room PIC reports — REQ-REQUEST-025, `06-api.md` (unit reports).
 *
 * The reporter's side (`asset-unit-report:create`): the units in their rooms,
 * the destinations a move may name, filing a report, their own reports. The
 * reviewer's side (`asset-unit-report:review`): the queue, confirm, reject.
 */
const path = (id) => `/asset-unit-reports/${encodeURIComponent(id)}`;

export const unitReportsApi = {
  myUnits: () => api.get('/asset-unit-reports/my-units'),
  destinations: () => api.get('/asset-unit-reports/destinations'),
  list: (params) => api.list('/asset-unit-reports', params),
  get: (id) => api.get(path(id)),
  create: (body) => api.post('/asset-unit-reports', body),
  confirm: (id, body = {}) => api.post(`${path(id)}/confirm`, body),
  reject: (id, note) => api.post(`${path(id)}/reject`, { note }),
};
