import { api, apiClient } from './client';

/**
 * Reporting and audit API — `06-api.md` §9, §10.
 *
 * READ-ONLY, both of them. There is no create, update or delete here because the
 * server exposes none: reports are aggregates, and an audit record is immutable
 * (REQ-AUDIT-003).
 *
 * Two envelopes (`DEC-053`), which is why the calls are not uniform:
 *
 *   `api.list` — the three ROW reports answer `{ data, meta }` and paginate.
 *   `api.get`  — the five GROUPED reports answer `{ data: { groups, totals } }`
 *                and do not, because a breakdown over five conditions is a
 *                complete answer rather than a page of one.
 */

export const reportsApi = {
  // Row reports — paginated lists.
  inventory: (params) => api.list('/reports/inventory', params),
  borrowings: (params) => api.list('/reports/borrowings', params),
  procurementTraceability: (params) => api.list('/reports/procurement-traceability', params),

  // Grouped reports — `{ groups, totals }`.
  status: (params) => api.get('/reports/status', { params }),
  byClassification: (params) => api.get('/reports/by-classification', { params }),
  byOrganization: (params) => api.get('/reports/by-organization', { params }),
  byLocation: (params) => api.get('/reports/by-location', { params }),
  byCondition: (params) => api.get('/reports/by-condition', { params }),
  inventoryUnits: (params) => api.list('/reports/inventory-units', params),

  /**
   * `CR-012` — the three aggregates behind the dashboard.
   *
   * Grouped like the five above, so `api.get`. They require `asset-unit:read`
   * rather than `report:read` (`06-api.md` §9), which is what makes them
   * reachable by a Department PIC — the reason the dashboard can show a
   * department its own progress at all.
   *
   * `month` is optional everywhere: omitted, the server answers for the current
   * business month in `Asia/Jakarta`, which is what the dashboard wants and
   * saves every caller computing it.
   */
  byLocationCondition: (params) => api.get('/reports/by-location-condition', { params }),
  assessmentCoverage: (params) => api.get('/reports/assessment-coverage', { params }),
  assessmentActivity: (params) => api.get('/reports/assessment-activity', { params }),

  /**
   * The spreadsheet export — `CR-009` `DEC-D`.
   *
   * The only call in this client that does NOT unwrap a `{ data }` envelope:
   * the response is a file, so it is requested as a blob and handed back with
   * the filename the server chose. The server names it because the server knows
   * the scope the export was taken at.
   */
  inventoryUnitsExport: async (params) => {
    const response = await apiClient.get('/reports/inventory-units/export', {
      params,
      responseType: 'blob',
    });

    return {
      blob: response.data,
      filename: filenameFrom(response.headers['content-disposition']),
    };
  },
};

/** The server's own filename, falling back to a dated default. */
function filenameFrom(disposition) {
  const match = /filename="([^"]+)"/.exec(disposition ?? '');
  return match?.[1] ?? `inventaris-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

/** §10 — the trail Phase 8 records. No write path exists, here or on the server. */
export const auditLogsApi = {
  list: (params) => api.list('/audit-logs', params),
  get: (id) => api.get(`/audit-logs/${id}`),
};
