import { api } from './client';
import { createResourceApi } from './resources';

/**
 * Organization API — `06-api.md` §3.
 *
 * Each resource keeps its own module-level constant so a call site names the
 * resource it means, and the endpoints that are NOT plain CRUD are written out
 * rather than hidden behind the shared factory.
 */

/**
 * Institutions — `06-api.md` §3.1.
 *
 * The inventory code format is its own pair of endpoints and its own
 * permissions (`inventory-code-format:*`), not `institution:update`: the CRUD
 * above is system-wide-only (`BR-015`), while configuring your own
 * institution's codes is exactly the kind of act that is meaningful scoped to
 * one. `PUT` with `{ format: null }` clears it back to the application default.
 */
export const institutionsApi = {
  ...createResourceApi('/institutions'),
  inventoryCodeFormat: (id) =>
    api.get(`/institutions/${encodeURIComponent(id)}/inventory-code-format`),
  setInventoryCodeFormat: (id, format) =>
    api.put(`/institutions/${encodeURIComponent(id)}/inventory-code-format`, { format }),
};

/** `:id` is the natural key (`VARCHAR(8)`), not a UUID — §3.2. */
/**
 * Departments — `06-api.md` §3.2.
 *
 * The PIC calls are their own permissions (`department-pic:*`), not
 * `department:update`: who is responsible for a department is a different
 * authority from who may rename it.
 */
export const departmentsApi = {
  ...createResourceApi('/departments'),
  picAssignments: (id) => api.get(`/departments/${encodeURIComponent(id)}/pic-assignments`),
  setPic: (id, userId) => api.put(`/departments/${encodeURIComponent(id)}/pic`, { userId }),
  clearPic: (id) => api.delete(`/departments/${encodeURIComponent(id)}/pic`),
};

export const usersApi = {
  ...createResourceApi('/users'),
  /** Role assignment — §3.3, REQ-ROLE-002. */
  listRoles: (id) => api.get(`/users/${id}/roles`),
  assignRole: (id, roleId) => api.post(`/users/${id}/roles`, { roleId }),
  removeRole: (id, roleId) => api.delete(`/users/${id}/roles/${roleId}`),
};

export const rolesApi = {
  ...createResourceApi('/roles'),
  /** `GET` returns the granted codes; `PUT` replaces the whole set — §3.4. */
  listPermissions: (id) => api.get(`/roles/${id}/permissions`),
  replacePermissions: (id, permissionCodes) =>
    api.put(`/roles/${id}/permissions`, { permissionCodes }),
};

/**
 * The fixed permission catalog — §3.5, REQ-ROLE-006, `BR-013`.
 *
 * Read-only by design: there is no create, update or delete, here or on the
 * server. Each entry carries `group` and `systemWideOnly`, which is what lets
 * the role checklist group 100+ codes and warn about `BR-015` without a second
 * mapping of its own.
 */
export const permissionsApi = {
  list: () => api.get('/permissions'),
};
