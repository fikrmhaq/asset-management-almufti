'use strict';

/**
 * User use cases — `IMPLEMENTATION_PLAN.md` §10.3, REQ-USER-001–004,
 * REQ-ROLE-002.
 */

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { NotFoundError, ConflictError, ValidationError, ForbiddenError } = require('../../errors');
const { hashPassword } = require('../../auth/password');
const { revokeAllUserSessions } = require('../../auth/sessionStore');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, containsAny, equals } = require('../../query/filtering');
const {
  scopeFilter,
  assertCanAccess,
  assertCanAssignInstitution,
  defaultInstitutionFor,
} = require('../../domain/scope');
const { organizationScope } = require('../../auth/principal');

const SORTABLE = ['username', 'lastName', 'createdAt', 'updatedAt'];

const FILTERS = {
  status: activeStatus(),
  institutionId: (value) => equals('institutionId', value),
  q: (value) => containsAny(['username', 'firstName', 'lastName'], value),
};

/** Never includes `passwordHash` — the model's default scope excludes it too. */
function serialize(user) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    contactInfo: user.contactInfo ?? null,
    institutionId: user.institutionId ?? null,
    isActive: user.isActive,
    roles: user.roles?.map((role) => ({
      id: role.id,
      name: role.name,
      isSystemWide: role.isSystemWide,
    })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['username', 'ASC']],
  });

  // Reads are filtered to the caller's institution (BR-007, REQ-AUTHZ-004); a
  // system-wide role lifts it. Users carry `institution_id`, so the same query
  // layer that scopes assets scopes them.
  options.where = { ...options.where, ...scopeFilter(principal) };

  // Roles come with the list, not only with the detail. Without this every row
  // reported "None" for its roles however many were actually assigned, because
  // `serialize` reads `user.roles` and nothing had loaded it.
  //
  // `distinct: true` is REQUIRED, not defensive: this is a belongsToMany, so the
  // join multiplies rows, and `findAndCountAll` would otherwise count a user
  // once per role they hold and report a total larger than the number of users.
  const { rows, pagination } = await paginate(models.User, options, {
    include: [{ association: 'roles', through: { attributes: [] } }],
    distinct: true,
  });

  return { rows: rows.map(serialize), pagination };
}

async function getById(id, principal, { models = getModels(), withRoles = false } = {}) {
  const user = await models.User.findByPk(id, {
    include: withRoles ? [{ association: 'roles', through: { attributes: [] } }] : undefined,
  });
  // Out-of-scope is indistinguishable from absent — both answer 404 (§1.4).
  return assertCanAccess(principal, user, { label: 'User' });
}

const detail = async (id, principal, options = {}) =>
  serialize(await getById(id, principal, { ...options, withRoles: true }));

/** Rejects a role id that does not exist, rather than letting the FK do it. */
/**
 * THE ASSIGNMENT CEILING — `BR-022`, REQ-ROLE-010.
 *
 * This is the whole security boundary for delegated user management, not
 * hardening around its edge. `create` below takes a `password` chosen by the
 * caller and there is no password-reset endpoint, so an administrator who
 * creates an account can sign in as it. Assigning a role is therefore
 * indistinguishable from granting oneself its permissions: any role a scoped
 * administrator can assign, they can become.
 *
 * A system-wide caller may assign anything. A scoped caller may assign only
 * roles a system-wide administrator has marked assignable — which is why that
 * flag defaults to false and why the UI warns at the toggle.
 *
 * Applied at BOTH entry points (`create`'s `roleIds` and `addRole`), because
 * they are the same grant reached by two routes.
 *
 * For an INSTITUTION caller, unassignment is deliberately not ceilinged:
 * removing a role can only reduce access, and an administrator who inherits a
 * user carrying a role they could not grant must still be able to take it away.
 * `CR-004` §8.1 added `removeRole` as a third call site anyway, because the PIC
 * rule below is absolute — a PIC assigns and removes nothing — and because
 * removal is not purely de-escalating for them: stripping a role off a
 * two-role user changes which tier that user lands in.
 *
 * @param {object[]} roles already loaded by `assertRolesExist`, so the ceiling
 *   costs no extra query
 */
function assertRolesAssignable(roles, principal, { field = 'roleIds' } = {}) {
  /**
   * A PIC-scoped caller may assign NO role, to anyone — `CR-004` §8.1.
   *
   * This is the sharpest escalation the codebase had. A PIC-scoped principal is
   * not `unrestricted`, so it fell through to the check below — which permits
   * any `isInstitutionAssignable` role, and ordinary institution roles are
   * exactly the ones flagged assignable (`CR-003` B3 allows `isPicScoped` and
   * `isInstitutionAssignable` to coexist). Attaching one to their own account
   * makes `DEC-092`'s `.every()` fail on the very next request, and the caller
   * is institution-scoped. One call, full tier escape.
   *
   * Blocked at the ASSIGNMENT, deliberately, not left for `.every()` to notice
   * afterwards: the write must never land. And blocked for every target, not
   * just self — `addRole` takes any user id the caller can reach, so a PIC could
   * otherwise promote a colleague and act through them.
   *
   * `user-role:*` is also outside `PIC_ALLOWED_PERMISSIONS`, so the ceiling
   * already answers `403` at the route. This is the second layer, and it is the
   * one that still holds if a future route forgets `requirePermission` or a
   * service is reached from a job.
   */
  if (organizationScope(principal).picScoped) {
    throw new ForbiddenError(
      'A PIC-scoped role may not assign or remove roles: doing so could change ' +
        'your own access tier (CR-004)'
    );
  }

  if (organizationScope(principal).unrestricted) return;

  const refused = roles.filter((role) => !role.isInstitutionAssignable);
  if (refused.length === 0) return;

  throw new ValidationError('You cannot assign one or more of those roles', [
    {
      field,
      issue:
        `${refused.map((role) => `"${role.name}"`).join(', ')} ` +
        `${refused.length === 1 ? 'is' : 'are'} not available for institutions to assign; ` +
        'ask a system administrator (REQ-ROLE-010)',
    },
  ]);
}

async function assertRolesExist(roleIds, models) {
  if (!roleIds?.length) return [];

  const roles = await models.Role.findAll({ where: { id: roleIds } });
  const found = new Set(roles.map((role) => role.id));
  const missing = roleIds.filter((roleId) => !found.has(roleId));

  if (missing.length > 0) {
    throw new ValidationError('One or more roles do not exist', [
      { field: 'roleIds', issue: `unknown role(s): ${missing.join(', ')}` },
    ]);
  }

  return roles;
}

async function assertInstitutionExists(institutionId, models) {
  if (!institutionId) return;

  const institution = await models.Institution.findByPk(institutionId);
  if (!institution) {
    throw new ValidationError('The institution does not exist', [
      { field: 'institutionId', issue: 'must reference an existing institution' },
    ]);
  }
}

/**
 * A user cannot leave an institution while still responsible for something in
 * it — Phase 21 (`CR-003` I7), `BR-007`.
 *
 * Moving them would leave a PIC assignment pointing at a department or location
 * in the institution they left, which is exactly the cross-institution state
 * `assertPicAssignable` refuses to create directly.
 *
 * REFUSED rather than silently ended. A location that changes institution has
 * plainly stopped being that institution's responsibility, so ending its
 * assignment states a fact. A person changing institution is an administrative
 * act by someone who may not know what that person is currently in charge of —
 * so the error names it, and the handover happens deliberately.
 *
 * @throws {ConflictError}
 */
async function assertNoActivePicAssignments(user, nextInstitutionId, models) {
  if ((user.institutionId ?? null) === (nextInstitutionId ?? null)) return;

  const [departments, locations] = await Promise.all([
    models.DepartmentPicAssignment.count({ where: { userId: user.id, isCurrent: true } }),
    models.LocationPicAssignment.count({ where: { userId: user.id, isCurrent: true } }),
  ]);

  if (departments === 0 && locations === 0) return;

  const held = [
    departments > 0 ? `${departments} department(s)` : null,
    locations > 0 ? `${locations} location(s)` : null,
  ]
    .filter(Boolean)
    .join(' and ');

  throw new ConflictError(
    `This user cannot change institution while they are the person in charge of ${held}`,
    [
      {
        field: 'institutionId',
        issue: 'hand over their current PIC assignments first (CR-003)',
      },
    ]
  );
}

async function create(body, principal, { models = getModels(), sequelize = getSequelize() } = {}) {
  const { password, roleIds = [], ...attributes } = body;

  // A scoped caller creating a user without naming an institution gets their
  // own; naming another institution is rejected (BR-007), the same rule assets
  // enforce on create.
  const institutionId = defaultInstitutionFor(principal, body.institutionId);
  assertCanAssignInstitution(principal, institutionId);

  const existing = await models.User.findOne({ where: { username: attributes.username } });
  if (existing) {
    throw new ConflictError(`Username "${attributes.username}" is already taken`, [
      { field: 'username', issue: 'must be unique' },
    ]);
  }

  await assertInstitutionExists(institutionId, models);
  assertRolesAssignable(await assertRolesExist(roleIds, models), principal);

  const passwordHash = await hashPassword(password);

  // User and role assignments in one transaction, so a failure cannot leave an
  // account with a partial role set (REQ-NFR-REL-002).
  const created = await withTransaction(
    async (transaction) => {
      const user = await models.User.create(
        { ...attributes, institutionId, passwordHash, isActive: true },
        { transaction }
      );

      if (roleIds.length > 0) {
        await models.UserRole.bulkCreate(
          roleIds.map((roleId) => ({ userId: user.id, roleId })),
          { transaction }
        );
      }

      return user;
    },
    { sequelize }
  );

  return detail(created.id, principal, { models });
}

async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const user = await getById(id, principal, { models });

  if (body.institutionId !== undefined) {
    // Cannot move a user into an institution outside the caller's scope, nor
    // reach a record already outside it (getById handled the latter).
    assertCanAssignInstitution(principal, body.institutionId);
    await assertInstitutionExists(body.institutionId, models);
    await assertNoActivePicAssignments(user, body.institutionId, models);
  }

  await user.update(body);

  return detail(id, principal, { models });
}

/**
 * Deactivation revokes every session the user holds (REQ-USER-004,
 * `05-infrastructure.md` §6.2). Without that, a deactivated account keeps
 * working until its refresh token expires — up to seven days.
 */
async function setActive(id, isActive, principal, options = {}) {
  const models = options.models ?? getModels();
  const user = await getById(id, principal, { models });

  if (user.isActive === isActive) {
    throw new ConflictError(`User is already ${isActive ? 'active' : 'inactive'}`);
  }

  await user.update({ isActive });

  if (!isActive) await revokeAllUserSessions(user.id);

  return detail(id, principal, { models });
}

async function listRoles(id, principal, options = {}) {
  const user = await getById(id, principal, { ...options, withRoles: true });

  return user.roles.map((role) => ({
    id: role.id,
    name: role.name,
    isSystemWide: role.isSystemWide,
  }));
}

async function addRole(id, roleId, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  assertRolesAssignable(await assertRolesExist([roleId], models), principal, { field: 'roleId' });

  const [, created] = await models.UserRole.findOrCreate({
    where: { userId: id, roleId },
    defaults: { userId: id, roleId },
  });

  if (!created) throw new ConflictError('The user already has this role');

  return listRoles(id, principal, { models });
}

async function removeRole(id, roleId, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  /**
   * `CR-004` §8.1. Removal had no assignability check at all; this adds the PIC
   * half of it, with no role list to check because a PIC may remove none.
   *
   * The institution-tier asymmetry that remains — an institution administrator
   * can remove a role they could not have granted — is de-escalating and
   * pre-existing from `CR-002`. Recorded as `SEC-002`, deliberately not widened
   * into here.
   */
  assertRolesAssignable([], principal, { field: 'roleId' });

  const removed = await models.UserRole.destroy({ where: { userId: id, roleId } });
  if (removed === 0) throw new NotFoundError('The user does not have this role');

  return listRoles(id, principal, { models });
}

module.exports = {
  list,
  detail,
  create,
  update,
  deactivate: (id, principal, options) => setActive(id, false, principal, options),
  reactivate: (id, principal, options) => setActive(id, true, principal, options),
  listRoles,
  addRole,
  removeRole,
  serialize,
  SORTABLE,
};
