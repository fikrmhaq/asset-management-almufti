import { api } from './client';

/**
 * Resource clients — `IMPLEMENTATION_PLAN.md` §17.
 *
 * Seven organization and reference resources expose the same endpoint shape
 * (`06-api.md` §1.7): list, detail, create, update, and either
 * deactivate/reactivate or a hard delete. This builds that shape once.
 *
 * Deliberately thin. It generates URLs and nothing else — no validation, no
 * permissions, no response reshaping — so each resource's own module stays the
 * place its specifics are written, and reading one tells you what it does
 * without reading this file first.
 */
export function createResourceApi(basePath) {
  return {
    basePath,
    list: (params) => api.list(basePath, params),
    get: (id) => api.get(`${basePath}/${encodeURIComponent(id)}`),
    create: (body) => api.post(basePath, body),
    update: (id, body) => api.patch(`${basePath}/${encodeURIComponent(id)}`, body),
    remove: (id) => api.delete(`${basePath}/${encodeURIComponent(id)}`),
    /** `06-api.md` §1.7 — status is a guarded transition, not a field edit. */
    setActive: (id, active) =>
      api.post(`${basePath}/${encodeURIComponent(id)}/${active ? 'reactivate' : 'deactivate'}`),
  };
}
