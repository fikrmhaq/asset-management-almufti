'use strict';

/**
 * Role and permission resolution — `IMPLEMENTATION_PLAN.md` §9.3.
 *
 * Builds the "principal": who the caller is, what they may do, and what
 * organizational scope their answers are bounded by.
 *
 * Resolution is a live database read on every authenticated request rather than
 * a claim baked into the token. That is deliberate: revoking a permission has to
 * take effect immediately, and a token carrying a permission set would keep
 * granting it until the token expired.
 */

const { getModels } = require('../db/models');
const { isPicAllowed } = require('./permissionCatalog');

/**
 * @typedef {object} Principal
 * @property {string} userId
 * @property {string} username
 * @property {string|null} institutionId
 * @property {string[]} roleIds
 * @property {{id: string, name: string, isSystemWide: boolean}[]} roles
 * @property {Set<string>} permissions EFFECTIVE permission codes — the granted
 *   set, intersected with `PIC_ALLOWED_PERMISSIONS` when `isPicScoped`
 * @property {boolean} isSystemWide any role lifts organization scope
 * @property {boolean} isPicScoped every role restricts to the caller's own
 *   departments (`CR-003` `DEC-092`), which also applies the ceiling
 * @property {Set<string>} picDepartmentIds departments currently held
 */

/**
 * Loads a user with roles and their granted permissions.
 *
 * @param {string} userId
 * @returns {Promise<Principal|null>} `null` when the user does not exist or is
 *   inactive — an inactive user must not authenticate (REQ-USER-004).
 */
async function resolvePrincipal(userId, { models = getModels() } = {}) {
  const user = await models.User.findByPk(userId, {
    include: [
      {
        association: 'roles',
        through: { attributes: [] },
        required: false,
        include: [{ association: 'permissions', through: { attributes: [] }, required: false }],
      },
    ],
  });

  if (!user || !user.isActive) return null;

  const roles = (user.roles ?? []).map((role) => ({
    id: role.id,
    name: role.name,
    isSystemWide: role.isSystemWide,
    isPicScoped: role.isPicScoped,
  }));

  const permissions = new Set();
  for (const role of user.roles ?? []) {
    for (const permission of role.permissions ?? []) permissions.add(permission.code);
  }

  /**
   * PIC-scoped only when NOTHING else grants more — Phase 22 (`CR-003` §5.2),
   * REQ-ROLE-011.
   *
   * `.every()`, deliberately the opposite of `isSystemWide`'s `.some()`. That
   * flag GRANTS, so one role holding it decides for the principal; this one
   * RESTRICTS, so the narrowing has to be unanimous. A user who also holds an
   * ordinary role keeps institution scope — otherwise attaching a PIC-scoped
   * role to an administrator would silently demote them, which is a surprising
   * way to lose access.
   *
   * `roles.length > 0` guards the vacuous truth: a user with no roles would
   * otherwise satisfy `.every()` and be treated as PIC-scoped, when in fact they
   * hold no permissions at all and every request already fails on that.
   */
  const isPicScoped = roles.length > 0 && roles.every((role) => role.isPicScoped);

  /**
   * The permission ceiling — `CR-004` §1.2, REQ-AUTHZ-008.
   *
   *     effectivePermissions = grantedPermissions ∩ PIC_ALLOWED_PERMISSIONS
   *
   * Applied HERE, at the one place the set is built, and not in
   * `requirePermission`. The middleware is not the only consumer:
   * `toPublicProfile` publishes this set to the web client, where it drives
   * navigation and every reference picker (`useOptions({ permission })`).
   * Filtering in the middleware would leave `/auth/me` advertising capabilities
   * the server then refuses, and would leave `hasPermission` disagreeing with
   * both. One filter, one definition, four consumers that cannot drift.
   *
   * AFTER `isPicScoped` is computed, necessarily — the flag is derived from the
   * roles, not from the permissions it goes on to narrow.
   *
   * Nothing is written. `role_permissions` keeps exactly what the administrator
   * granted, and `GET /roles/:id/permissions` keeps reporting it: a grant the
   * ceiling suppresses is inert, not erased. Stripping it would destroy the
   * record of what was intended and make clearing `isPicScoped` a lossy
   * operation.
   */
  const effectivePermissions = isPicScoped
    ? new Set([...permissions].filter((code) => isPicAllowed(code)))
    : permissions;

  return {
    userId: user.id,
    username: user.username,
    institutionId: user.institutionId ?? null,
    roleIds: roles.map((role) => role.id),
    roles,
    permissions: effectivePermissions,
    isSystemWide: roles.some((role) => role.isSystemWide),
    isPicScoped,
    /**
     * The departments this user is CURRENTLY the person in charge of.
     *
     * Loaded live, like everything else here. That is what makes revocation
     * immediate: a handover recorded a second ago is reflected on the very next
     * request, and no token carries a stale copy.
     *
     * Only `is_current = true` rows are read — a closed assignment grants
     * nothing, ever, which is the whole distinction between authorization and
     * audit (REQ-AUTHZ-006, `CR-003` §11 of the brief). Loaded for every
     * principal rather than only PIC-scoped ones so the profile can show a user
     * what they are responsible for regardless of their tier.
     */
    picDepartmentIds: new Set(
      (
        await models.DepartmentPicAssignment.findAll({
          where: { userId: user.id, isCurrent: true },
          attributes: ['departmentId'],
        })
      ).map((row) => row.departmentId)
    ),
  };
}

/**
 * Whether the principal holds a permission.
 *
 * There is no implicit "admin bypasses everything": a system-wide role lifts
 * organization scope (REQ-AUTHZ-005), it does not grant permissions the role was
 * never given. System Admin can do everything because it is *granted*
 * everything, which is auditable — an implicit bypass would not be.
 */
function hasPermission(principal, code) {
  return Boolean(principal?.permissions?.has(code));
}

/**
 * The organization scope for the caller's queries — `BR-007`, REQ-AUTHZ-004/005.
 *
 * A system-wide role lifts the scope entirely. Otherwise the caller sees only
 * their own institution's records. A user's `institutionId` — set or null —
 * grants nothing on its own (REQ-AUTHZ-005), so a user with no institution and
 * no system-wide role matches only records that have no institution either.
 *
 * @returns {{unrestricted: boolean, institutionId: string|null}}
 */
function organizationScope(principal) {
  if (principal?.isSystemWide) return { unrestricted: true, institutionId: null };

  /**
   * PIC-scoped — `CR-003` §5 / `CR-004` §1.1, REQ-ROLE-011, REQ-AUTHZ-007.
   *
   * `institutionId` IS STILL RETURNED. The institution remains the OUTER
   * containment boundary; the department set is an INNER narrowing on Asset
   * Units, and unit coverage narrows the operational records built from them.
   *
   * `CR-004` demoted this from load-bearing to belt-and-braces. Under `CR-003`
   * the institution was the only thing standing between a PIC and every other
   * resource, which is why §48.5 had to accept "do not grant the permission" as
   * a control. The permission ceiling now does that job structurally, so what
   * this value still buys is a second layer: even a code that IS on the
   * allow-list cannot reach across institutions.
   */
  if (principal?.isPicScoped) {
    return {
      unrestricted: false,
      institutionId: principal?.institutionId ?? null,
      picScoped: true,
      picDepartmentIds: principal.picDepartmentIds ?? new Set(),
    };
  }

  return { unrestricted: false, institutionId: principal?.institutionId ?? null };
}

/**
 * A `where` fragment applying the caller's organization scope.
 *
 * Phases 4–7 spread this into every scoped query. `05-infrastructure.md` §12.3
 * is explicit that there is no infrastructure substitute for this check.
 *
 * @param {Principal} principal
 * @param {string} [column] the institution foreign key on the queried model
 */
function scopeWhere(principal, column = 'institutionId') {
  const scope = organizationScope(principal);
  return scope.unrestricted ? {} : { [column]: scope.institutionId };
}

/** The shape returned by `GET /auth/me` (`06-api.md` §2). */
async function toPublicProfile(principal, { models = getModels() } = {}) {
  /**
   * The departments this user is currently in charge of — Phase 22 (`CR-003`
   * §5.7).
   *
   * Carried on the PROFILE rather than fetched from `GET /departments`, so a
   * PIC-scoped role needs no `department:read`. It has to offer a department
   * when creating a unit, and granting that permission to make a picker work
   * would expose every department in the institution to a role whose entire
   * purpose is to reach less. `/auth/me` is deliberately not permission-gated —
   * a user may always read their own profile — which is exactly the right place
   * for "what am I responsible for".
   *
   * Present for every tier, not only PIC-scoped ones: an administrator who
   * happens to hold a post should see it too.
   */
  const ids = [...(principal.picDepartmentIds ?? [])];

  const picDepartments =
    ids.length === 0
      ? []
      : (
          await models.Department.findAll({
            where: { id: ids },
            attributes: ['id', 'code', 'name'],
            order: [['name', 'ASC']],
          })
        ).map((row) => ({ id: row.id, code: row.code, name: row.name }));

  /**
   * The school positions this user currently holds — Phase 35 (`CR-014`
   * §12.1). Read HERE, for the profile only, and never by `resolvePrincipal`: a
   * position grants no permission and no record reach (`BR-028`), so it has no
   * place in the object every authorization decision is made from. Like
   * `picDepartments`, it needs no permission — a user may always see what they
   * hold. Queried directly rather than through `domain/positionAssignments`,
   * which itself depends on this module.
   */
  const positionAssignments = (
    await models.PositionAssignment.findAll({
      where: { userId: principal.userId, isCurrent: true },
      include: [{ association: 'department', attributes: ['id', 'code', 'name'] }],
      order: [['assignedAt', 'ASC']],
    })
  ).map((row) => ({
    id: row.id,
    positionCode: row.positionCode,
    institutionId: row.institutionId,
    department: row.department
      ? { id: row.department.id, code: row.department.code, name: row.department.name }
      : null,
  }));

  return {
    id: principal.userId,
    username: principal.username,
    institutionId: principal.institutionId,
    roles: principal.roles,
    permissions: [...principal.permissions].sort(),
    isSystemWide: principal.isSystemWide,
    isPicScoped: principal.isPicScoped ?? false,
    picDepartments,
    positionAssignments,
  };
}

module.exports = {
  resolvePrincipal,
  hasPermission,
  organizationScope,
  scopeWhere,
  toPublicProfile,
};
