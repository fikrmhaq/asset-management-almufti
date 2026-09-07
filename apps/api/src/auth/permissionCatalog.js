'use strict';

/**
 * The permission catalog — `06-api.md` §1.3, REQ-ROLE-006, BR-013.
 *
 * Codes are DERIVED, never hand-written. Each protected resource declares the
 * actions the API actually guards, and `{resource}:{action}` is computed from
 * that. `ref.permissions` is seeded from this module, so the catalog and the
 * operations the server enforces cannot drift apart.
 *
 * §1.3's action vocabulary:
 *   create, read, update  — standard CRUD
 *   deactivate            — also covers reactivate (§1.7)
 *   delete                — hard-delete resources only
 *   <custom verb>         — matching the path segment of an action endpoint,
 *                           e.g. borrowing:return, asset-unit:record-history
 *
 * The resource is the domain entity being acted on, not the URL's parent
 * segment: `GET /assets/:id/attachments` is `attachment:read`, not `asset:read`.
 *
 * Resources are grouped by the module sections `07-ui.md` §5.1 uses for the
 * role-permission checklist, so the UI can group 100+ codes without a second
 * mapping.
 *
 * Endpoints under `/auth` are deliberately absent. They are authenticated but
 * not permission-gated: a user must always be able to read their own profile
 * and end their own session, whatever permissions they hold.
 */

const { CRUD, SOFT_DELETE } = {
  CRUD: ['create', 'read', 'update'],
  SOFT_DELETE: ['deactivate'],
};

/**
 * @typedef {{resource: string, actions: string[], group: string, description: string}} ResourceSpec
 */

/** @type {ResourceSpec[]} */
const RESOURCES = [
  // --- Organization (06-api.md §3) ------------------------------------------
  {
    resource: 'institution',
    actions: [...CRUD, ...SOFT_DELETE],
    group: 'Organization',
    description: 'Institutions',
  },
  {
    /**
     * An institution's inventory code format — Phase 25 (`CR-006`),
     * REQ-ORG-007.
     *
     * ITS OWN RESOURCE, AND DELIBERATELY NOT SYSTEM-WIDE-ONLY. `institution` is
     * in `SYSTEM_WIDE_RESOURCES` because creating and deactivating institutions
     * is not meaningful scoped to one (`BR-015`). Designing THIS institution's
     * inventory codes is exactly that kind of act, so it is split out — the same
     * reasoning that already gives `user-role`, `role-permission` and
     * `department-pic` codes of their own.
     *
     * The consequence is the point: an institution administrator, who cannot
     * hold `institution:update` at all, can configure their own code format
     * without gaining the ability to rename or deactivate the institution.
     * Cross-institution access is refused by the ordinary scope check in the
     * service, not by anything special here.
     */
    resource: 'inventory-code-format',
    actions: ['read', 'update'],
    group: 'Organization',
    description: "An institution's inventory code format",
  },
  {
    resource: 'department',
    actions: [...CRUD, ...SOFT_DELETE],
    group: 'Organization',
    description: 'Departments',
  },
  {
    resource: 'user',
    actions: [...CRUD, ...SOFT_DELETE],
    group: 'Organization',
    description: 'Users',
  },
  {
    // `DELETE /roles/:id` is a hard delete (§3.4), hence `delete` rather than
    // `deactivate` — ref.roles has no is_active column.
    resource: 'role',
    actions: [...CRUD, 'delete'],
    group: 'Organization',
    description: 'Roles',
  },
  {
    // The User <-> Role assignment (03-domain.md §4.5) — the entity acted on by
    // GET/POST /users/:id/roles and DELETE /users/:id/roles/:roleId.
    resource: 'user-role',
    actions: ['read', 'create', 'delete'],
    group: 'Organization',
    description: 'Role assignments on a user',
  },
  {
    /**
     * The Department <-> User responsibility assignment — Phase 21 (`CR-003`),
     * acted on by GET/PUT/DELETE `/departments/:id/pic`.
     *
     * Its own resource, following `user-role`: the entity being acted on is the
     * assignment, not the department. That separation is the point — holding
     * `department:update` (rename a department) is a different authority from
     * deciding who is responsible for it, and in Phase 22 the second one will
     * determine what its holder may touch.
     */
    resource: 'department-pic',
    actions: ['read', 'create', 'delete'],
    group: 'Organization',
    description: 'Person in charge of a department',
  },
  {
    // GET/PUT /roles/:id/permissions — PUT replaces the whole granted set, so
    // `update`, not `create` (§3.4, REQ-ROLE-007).
    resource: 'role-permission',
    actions: ['read', 'update'],
    group: 'Organization',
    description: 'Permissions granted to a role',
  },
  {
    // Read-only catalog (§3.5, REQ-ROLE-006, BR-013).
    resource: 'permission',
    actions: ['read'],
    group: 'Organization',
    description: 'The permission catalog',
  },

  // --- Reference and classification (06-api.md §4) --------------------------
  {
    // Read plus writes on application-defined nodes only (REQ-CLASS-003 as
    // amended by `CR-001`; `BR-016`). Government and legacy rows stay read-only
    // however these are granted — the service refuses them, not the permission.
    resource: 'classification',
    actions: [...CRUD, 'delete', 'promote'],
    group: 'Reference',
    description: 'Asset classifications',
  },
  { resource: 'category', actions: ['read'], group: 'Reference', description: 'Categories' },
  {
    resource: 'attribute-definition',
    actions: [...CRUD, ...SOFT_DELETE],
    group: 'Reference',
    description: 'Configurable attribute definitions',
  },
  {
    // The simple lookups have no status column, so they hard-delete (§4.4).
    resource: 'measurement-unit',
    actions: [...CRUD, 'delete'],
    group: 'Reference',
    description: 'Measurement units',
  },
  {
    resource: 'contract-type',
    actions: [...CRUD, 'delete'],
    group: 'Reference',
    description: 'Contract types',
  },
  {
    resource: 'funding-source',
    actions: [...CRUD, 'delete'],
    group: 'Reference',
    description: 'Funding sources',
  },
  {
    resource: 'transaction-type',
    actions: [...CRUD, 'delete'],
    group: 'Reference',
    description: 'Transaction types',
  },
  {
    resource: 'account-code',
    actions: [...CRUD, 'delete'],
    group: 'Reference',
    description: 'Account codes',
  },
  {
    // `GET /reference/conditions` (§4.6). ConditionEnum is a fixed enum rather
    // than a table, so the resource is read-only and has no CRUD.
    resource: 'condition',
    actions: ['read'],
    group: 'Reference',
    description: 'Asset condition values',
  },

  // --- Asset core (06-api.md §5) --------------------------------------------
  {
    resource: 'asset',
    actions: [...CRUD, ...SOFT_DELETE],
    group: 'Asset Core',
    description: 'Assets',
  },
  {
    // `record-history` is the custom verb for POST /asset-units/:id/history,
    // the single endpoint that writes a longitudinal snapshot (§5.2).
    resource: 'asset-unit',
    actions: ['create', 'read', 'update', 'deactivate', 'record-history'],
    group: 'Asset Core',
    description: 'Asset units',
  },
  {
    resource: 'asset-attribute-value',
    actions: ['read', 'update'],
    group: 'Asset Core',
    description: 'Attribute values on assets and asset units',
  },
  {
    resource: 'location',
    actions: [...CRUD, ...SOFT_DELETE],
    group: 'Asset Core',
    description: 'Locations',
  },
  {
    // GET/PUT/DELETE `/locations/:id/pic` — Phase 21 (`CR-003`). Purely
    // responsibility data: unlike `department-pic`, this grants no record access
    // in any phase (§5.4).
    resource: 'location-pic',
    actions: ['read', 'create', 'delete'],
    group: 'Asset Core',
    description: 'Person in charge of a location',
  },
  {
    resource: 'floor-plan',
    actions: ['read', 'update', 'delete'],
    group: 'Asset Core',
    description: 'Location floor plans',
  },
  {
    resource: 'floor-plan-area',
    actions: ['create', 'read', 'update', 'delete'],
    group: 'Asset Core',
    description: 'Areas drawn on a floor plan',
  },
  {
    resource: 'attachment',
    actions: ['create', 'read', 'delete'],
    group: 'Asset Core',
    description: 'File attachments',
  },

  // --- Procurement (06-api.md §6) -------------------------------------------
  {
    resource: 'supplier',
    actions: [...CRUD, ...SOFT_DELETE],
    group: 'Procurement',
    description: 'Suppliers',
  },
  {
    resource: 'contract',
    actions: [...CRUD, ...SOFT_DELETE],
    group: 'Procurement',
    description: 'Procurement contracts',
  },
  {
    resource: 'contract-item',
    actions: ['create', 'read', 'update', 'delete'],
    group: 'Procurement',
    description: 'Contract line items',
  },

  // --- Operations (06-api.md §7) --------------------------------------------
  {
    resource: 'vendor',
    actions: [...CRUD, ...SOFT_DELETE],
    group: 'Operations',
    description: 'Vendors',
  },
  {
    // Each state transition is its own action endpoint (§7.2), so each gets its
    // own permission: authorising "may create a borrowing" is not the same as
    // "may return one".
    resource: 'borrowing',
    actions: ['create', 'read', 'update', 'activate', 'cancel', 'return', 'extend'],
    group: 'Operations',
    description: 'Borrowings',
  },
  {
    resource: 'borrowing-item',
    actions: ['create', 'read', 'delete'],
    group: 'Operations',
    description: 'Units included in a borrowing',
  },
  {
    // No update: transactions are historical records (REQ-TXN-007, §7.3).
    resource: 'transaction',
    actions: ['create', 'read'],
    group: 'Operations',
    description: 'Transactions',
  },

  // --- Reporting and audit (06-api.md §9, §10) ------------------------------
  { resource: 'report', actions: ['read'], group: 'Reports', description: 'Reports' },
  {
    // Read-only forever (REQ-AUDIT-003).
    resource: 'audit-log',
    actions: ['read'],
    group: 'Audit',
    description: 'Audit log',
  },
];

/**
 * Resources whose permissions only make sense system-wide (BR-015): Institution,
 * Role and Permission/RolePermission management are not meaningful scoped to a
 * single institution, so a role granted any of these MUST be `isSystemWide`.
 */
const SYSTEM_WIDE_RESOURCES = new Set(['institution', 'role', 'role-permission', 'permission']);

/**
 * Codes exempted from their resource's system-wide rule — `CR-002`, BR-015 as
 * amended.
 *
 * The rule was originally per-resource, which swept `role:read` and
 * `role-permission:read` up with the writes. An institution administrator has to
 * see the roles available to them, and what each one grants, before handing one
 * out (REQ-ROLE-010) — otherwise they assign blind. Reading a role's name and
 * grants discloses nothing an administrator of any institution should not know.
 *
 * Every operation that CHANGES a role stays system-wide-only. Only reads are
 * listed here, and that is the invariant to preserve if this set ever grows.
 */
const SCOPED_EXEMPT_CODES = new Set(['role:read', 'role-permission:read']);

/**
 * The permission ceiling for PIC-scoped roles — `CR-004` §2, REQ-AUTHZ-008.
 *
 * A PIC-scoped principal's effective permissions are INTERSECTED with this set
 * (`principal.js resolvePrincipal`). A code outside it is inert: granting it to
 * a PIC-scoped role changes nothing, and the role's stored grants are left
 * exactly as the administrator wrote them.
 *
 * This exists because the boundary must not depend on an administrator
 * remembering what not to grant. `CR-003` §48.5 accepted that dependency for
 * Reports, Assets and the operational lists; `CR-004` retires it.
 *
 * Three kinds of code are in here, and nothing else:
 *
 *   1. Operations on the caller's OWN Asset Units, already narrowed by
 *      `unitScopeFilter` / `assertCanAccessUnit`.
 *   2. Operations on Borrowings and Transactions, narrowed by unit coverage
 *      (`unitCoverageFilter` / `assertCanAccessByUnits`).
 *   3. The minimum supporting READS those two need — global reference data, and
 *      the location tree a history entry has to name.
 *
 * Deliberately ABSENT, each for a reason recorded in `CR-004` §2.3:
 *
 *   `asset-unit:create`  a PIC manages existing units; registering one is an
 *                        Asset-administration act (`CR-004` OQ-1)
 *   `asset:read`         would browse every asset in the institution
 *   `department:read`    `picDepartments` already rides on `/auth/me` (`DEC-095`)
 *   `user:read`          returns contact details and every user's roles
 *   `user-role:*`        the sharpest escalation vector there is (§8.1)
 *   `department-pic:*`   self-appointment to any department
 *   `report:read`        institution-wide aggregates over unreachable assets.
 *                        Still excluded, and `CR-010` did NOT add it. What that
 *                        change did instead was move the ONE report whose rows
 *                        are Asset Units — `/reports/inventory-units` and its
 *                        export — onto `asset-unit:read`, which is already on
 *                        this list and which `unitScopeFilter` narrows row by
 *                        row. The reason above is exactly right for the eight
 *                        aggregate reports and was never true of that one.
 *   `audit-log:read`     not institution-scoped for ANY tier — see `SEC-001`
 *
 * Adding a code here widens a security boundary. The test that grants each
 * forbidden code in turn and expects `403` (`22-pic-ceiling.test.js`) is what
 * makes an accidental addition visible.
 */
const PIC_ALLOWED_PERMISSIONS = new Set([
  // Asset Units the caller is responsible for — no `create`.
  'asset-unit:read',
  'asset-unit:update',
  'asset-unit:deactivate',
  'asset-unit:record-history',

  // Values and files ON those units. Both families also guard an ASSET-level
  // endpoint, which the services refuse for a PIC (`CR-004` §6.4, §6.5) — the
  // code alone cannot separate the two targets.
  'asset-attribute-value:read',
  'asset-attribute-value:update',
  'attachment:create',
  'attachment:read',
  'attachment:delete',

  // Operational records, narrowed by unit coverage.
  'borrowing:create',
  'borrowing:read',
  'borrowing:update',
  'borrowing:activate',
  'borrowing:cancel',
  'borrowing:return',
  'borrowing:extend',
  'borrowing-item:read',
  'borrowing-item:create',
  'borrowing-item:delete',
  'transaction:create',
  'transaction:read',

  // Supporting reads. `location:read` is required because recording a history
  // entry must name a location and the unit detail resolves its path; the one
  // sub-path returning units is already narrowed. Location WRITES are absent.
  'location:read',
  'floor-plan:read',
  'floor-plan-area:read',

  // Global reference data. No institution records, needed to render the unit
  // and history forms and to create a transaction.
  'classification:read',
  'category:read',
  'attribute-definition:read',
  'measurement-unit:read',
  'transaction-type:read',
  'condition:read',
]);

/** Whether a PIC-scoped principal may hold `code` at all (`CR-004` §2). */
function isPicAllowed(code) {
  return PIC_ALLOWED_PERMISSIONS.has(code);
}

/** Human-readable phrasing per action, for the catalog's `description` column. */
const ACTION_PHRASE = {
  create: 'Create',
  read: 'View',
  update: 'Update',
  deactivate: 'Deactivate and reactivate',
  delete: 'Delete',
  activate: 'Activate',
  cancel: 'Cancel',
  return: 'Record the return of',
  extend: 'Extend',
  'record-history': 'Record a history entry for',
};

/** `{resource}:{action}` — the one place the code format is defined. */
function permissionCode(resource, action) {
  return `${resource}:${action}`;
}

/**
 * The complete catalog, derived from the resource declarations above.
 *
 * @returns {{code: string, description: string, resource: string, action: string,
 *            group: string, systemWideOnly: boolean}[]}
 */
function buildCatalog() {
  return RESOURCES.flatMap(({ resource, actions, group, description }) =>
    actions.map((action) => ({
      code: permissionCode(resource, action),
      description: `${ACTION_PHRASE[action] ?? action}: ${description}`,
      resource,
      action,
      group,
      systemWideOnly:
        SYSTEM_WIDE_RESOURCES.has(resource) &&
        !SCOPED_EXEMPT_CODES.has(permissionCode(resource, action)),
      // `CR-004`: whether a PIC-scoped role granted this code would actually
      // receive it. Published so the role editor can mark the ones the ceiling
      // suppresses, rather than letting an administrator grant them silently.
      picAllowed: isPicAllowed(permissionCode(resource, action)),
    }))
  );
}

let catalog;

function getCatalog() {
  if (!catalog) catalog = Object.freeze(buildCatalog());
  return catalog;
}

/** Every code in the catalog. */
function allPermissionCodes() {
  return getCatalog().map((entry) => entry.code);
}

/** Codes that require `isSystemWide` on the granting role (BR-015). */
function systemWideOnlyCodes() {
  return getCatalog()
    .filter((entry) => entry.systemWideOnly)
    .map((entry) => entry.code);
}

/**
 * Whether a code exists in the catalog.
 *
 * Phases 4–7 use this to assert that every permission a route declares is one
 * the catalog actually contains — the check that keeps the two in step.
 */
function isKnownPermission(code) {
  return getCatalog().some((entry) => entry.code === code);
}

module.exports = {
  RESOURCES,
  SYSTEM_WIDE_RESOURCES,
  SCOPED_EXEMPT_CODES,
  PIC_ALLOWED_PERMISSIONS,
  isPicAllowed,
  permissionCode,
  buildCatalog,
  getCatalog,
  allPermissionCodes,
  systemWideOnlyCodes,
  isKnownPermission,
};
