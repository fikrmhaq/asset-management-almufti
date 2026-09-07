/**
 * Query key conventions — `IMPLEMENTATION_PLAN.md` §15.3.
 *
 * Keys are built here and nowhere else. Hand-written arrays scattered across
 * screens are how a cache stops invalidating correctly: one file writes
 * `['assets', id]` and another `['asset', id]`, and neither notices until a
 * mutation silently fails to refresh a list.
 *
 * The shape is hierarchical, so a prefix invalidates everything beneath it:
 *
 *   ['assets']                     every asset query
 *   ['assets', 'list', {...}]      one filtered page
 *   ['assets', 'detail', id]       one record
 *   ['assets', 'detail', id, 'units']   a sub-collection of that record
 *
 * `queryClient.invalidateQueries({ queryKey: keys.assets.all })` therefore
 * refreshes lists and details together, which is what a create or delete needs.
 */

/**
 * Builds the standard key set for one resource.
 *
 * @param {string} resource plural resource name, matching the API path
 */
export function resourceKeys(resource) {
  const all = [resource];

  return {
    all,
    lists: () => [...all, 'list'],
    /** Filters are part of the key: a different page or filter is a different query. */
    list: (params = {}) => [...all, 'list', params],
    details: () => [...all, 'detail'],
    detail: (id) => [...all, 'detail', id],
    /** A named sub-collection of one record, e.g. an asset's units. */
    sub: (id, name, params = {}) => [...all, 'detail', id, name, params],
  };
}

/**
 * The resources the API exposes — `06-api.md` §3–§10.
 *
 * Declared up front so a screen imports a key rather than inventing one. The
 * screens themselves belong to Phases 10–15; this is the shared vocabulary they
 * are built against.
 */
export const queryKeys = Object.freeze({
  // Authentication (§2)
  currentUser: ['auth', 'me'],

  // Organization (§3)
  institutions: resourceKeys('institutions'),
  departments: resourceKeys('departments'),
  users: resourceKeys('users'),
  roles: resourceKeys('roles'),
  permissions: resourceKeys('permissions'),

  // Reference and classification (§4)
  classifications: resourceKeys('classifications'),
  categories: resourceKeys('categories'),
  attributeDefinitions: resourceKeys('attribute-definitions'),
  measurementUnits: resourceKeys('measurement-units'),
  contractTypes: resourceKeys('contract-types'),
  fundingSources: resourceKeys('funding-sources'),
  transactionTypes: resourceKeys('transaction-types'),
  accountCodes: resourceKeys('account-codes'),
  conditions: resourceKeys('conditions'),

  // Asset core (§5)
  assets: resourceKeys('assets'),
  assetUnits: resourceKeys('asset-units'),
  locations: resourceKeys('locations'),
  attachments: resourceKeys('attachments'),

  // Procurement (§6)
  suppliers: resourceKeys('suppliers'),
  contracts: resourceKeys('contracts'),
  contractItems: resourceKeys('contract-items'),

  // Operations (§7)
  vendors: resourceKeys('vendors'),
  borrowings: resourceKeys('borrowings'),
  transactions: resourceKeys('transactions'),

  // Reporting and audit (§9, §10) — Phase 15
  reports: resourceKeys('reports'),
  auditLogs: resourceKeys('audit-logs'),
});
