import { api } from './client';

/**
 * Workflow definitions — `06-api.md` §12.2, Phase 36 (`CR-014`).
 *
 * Configuration only: which position acts at each step of the process for one
 * request category from one requester context. Nothing here runs a workflow or
 * resolves a position to a person.
 *
 * There is no `update` of a definition itself and no `remove`: a DRAFT is edited
 * through its steps, a published version is never changed (a new version is
 * created instead), and no definition is deleted (Phase 36 decision D2).
 */
export const workflowsApi = {
  list: (params) => api.list('/workflow-definitions', params),
  get: (id) => api.get(`/workflow-definitions/${encodeURIComponent(id)}`),
  templates: () => api.get('/workflow-definitions/templates'),
  /** P2 (§64.2): `{categoriesByPosition}` — what each requester position may request at all. */
  eligibility: () => api.get('/workflow-definitions/eligibility'),
  /** `{category, requesterPositionCode, institutionId?, templateKey?}` — always a DRAFT. */
  create: (body) => api.post('/workflow-definitions', body),
  replaceSteps: (id, steps) =>
    api.put(`/workflow-definitions/${encodeURIComponent(id)}/steps`, { steps }),
  publish: (id) => api.post(`/workflow-definitions/${encodeURIComponent(id)}/publish`, {}),
  /** A new DRAFT copying a published version's steps. */
  newVersion: (id) => api.post(`/workflow-definitions/${encodeURIComponent(id)}/versions`, {}),
};
