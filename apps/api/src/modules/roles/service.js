'use strict';

/**
 * Role use cases — `IMPLEMENTATION_PLAN.md` §10.4, REQ-ROLE-001/003/007/008.
 *
 * This module owns the enforcement of BR-015: a role granted any permission that
 * MODIFIES Institutions, Roles or Role-Permission grants MUST be system-wide,
 * because those operations are not meaningful scoped to a single institution. The
 * rule spans `role_permissions` → `permissions` → `roles`, which is why the data
 * model leaves it to the application layer.
 *
 * Phase 19 (`CR-002`) added `isInstitutionAssignable` (REQ-ROLE-009). Roles are
 * still authored here and only by a system-wide caller; that flag governs which
 * of them a scoped administrator may hand out (`BR-022`, enforced in the users
 * module, which is where assignment happens).
 */

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { contains } = require('../../query/filtering');
const { isKnownPermission, systemWideOnlyCodes } = require('../../auth/permissionCatalog');
const { organizationScope } = require('../../auth/principal');

const SORTABLE = ['name', 'createdAt', 'updatedAt'];

const FILTERS = { q: (value) => contains('name', value) };

function serialize(role) {
  return {
    id: role.id,
    name: role.name,
    isSystemWide: role.isSystemWide,
    isInstitutionAssignable: role.isInstitutionAssignable,
    // Phase 22 (`CR-003`), REQ-ROLE-011 — the third scope tier.
    isPicScoped: role.isPicScoped,
    permissions: role.permissions?.map((permission) => permission.code).sort(),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

/**
 * BR-015. Throws when the combination of granted codes and `isSystemWide` is
 * not permitted.
 *
 * @param {string[]} codes the full granted set the role would end up with
 * @param {boolean} isSystemWide the role's flag after the change
 */
function assertSystemWideRule(codes, isSystemWide) {
  if (isSystemWide) return;

  const restricted = new Set(systemWideOnlyCodes());
  const offending = codes.filter((code) => restricted.has(code));

  if (offending.length > 0) {
    throw new ConflictError(
      'A role granted Institution, Role or Permission management must be system-wide',
      offending.map((code) => ({
        field: 'permissionCodes',
        issue: `"${code}" requires isSystemWide to be true (BR-015)`,
      }))
    );
  }
}

/**
 * REQ-ROLE-010 — a scoped caller sees only the roles they may actually assign.
 *
 * Narrowing here rather than in the client is what keeps the picker honest: the
 * user form has no filter of its own, so it cannot drift from this rule. It also
 * means an institution administrator never enumerates the existence of
 * `System Admin`, which is of no use to them.
 */
async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['name', 'ASC']],
  });

  if (!organizationScope(principal).unrestricted) {
    options.where = { ...options.where, isInstitutionAssignable: true };
  }

  const { rows, pagination } = await paginate(models.Role, options);

  return { rows: rows.map(serialize), pagination };
}

async function getById(id, { models = getModels(), withPermissions = false } = {}) {
  const role = await models.Role.findByPk(id, {
    include: withPermissions
      ? [{ association: 'permissions', through: { attributes: [] } }]
      : undefined,
  });
  if (!role) throw new NotFoundError('Role not found');
  return role;
}

const detail = async (id, options = {}) =>
  serialize(await getById(id, { ...options, withPermissions: true }));

/**
 * Only a system-wide caller may mark a role assignable — REQ-ROLE-009.
 *
 * `ValidationError` on the field rather than `ForbiddenError` on the request: the
 * caller may legitimately hold `role:create`; it is this one field they cannot
 * set, and the message should say which.
 */
function assertCanSetAssignable(body, principal) {
  if (body.isInstitutionAssignable === undefined) return;
  if (organizationScope(principal).unrestricted) return;

  throw new ValidationError('You cannot decide which roles institutions may assign', [
    {
      field: 'isInstitutionAssignable',
      issue: 'requires a system-wide role (REQ-ROLE-009)',
    },
  ]);
}

/**
 * The two flags are mutually exclusive — `BR-022`.
 *
 * `chk_roles_system_wide_not_assignable` refuses the combination in the database
 * too. This exists so the caller gets a field-level message naming both flags
 * rather than a constraint violation, not because the database check is
 * redundant: that one is the guarantee, this one is the explanation.
 */
function assertFlagsCompatible({ isSystemWide, isInstitutionAssignable, isPicScoped }) {
  if (isSystemWide && isInstitutionAssignable) {
    throw new ValidationError('A system-wide role cannot be assignable by institutions', [
      {
        field: 'isInstitutionAssignable',
        issue:
          'a system-wide role escapes institution scope, so handing it to an institution ' +
          'administrator would defeat that boundary (BR-022)',
      },
    ]);
  }

  /**
   * Phase 22 (`CR-003`), `BR-023`.
   *
   * "Reaches every institution" and "reaches only my own departments" is not a
   * combination with a meaning — a role claiming both would leave
   * `organizationScope` to pick one, and whichever it picked would be a guess.
   * `chk_roles_system_wide_not_pic_scoped` refuses it in the database too; this
   * exists to name both fields rather than surface a constraint violation.
   *
   * `isPicScoped` + `isInstitutionAssignable` is deliberately NOT refused (B3):
   * that flag governs who may hand a role out, not what its holder reaches, and
   * a PIC-scoped role grants strictly less than any ordinary one — so CR-002's
   * ceiling is not raised by allowing an institution administrator to delegate
   * it.
   */
  if (isSystemWide && isPicScoped) {
    throw new ValidationError('A system-wide role cannot also be PIC-scoped', [
      {
        field: 'isPicScoped',
        issue:
          'a system-wide role reaches every institution, which is the opposite of ' +
          'reaching only the departments you are responsible for (BR-023)',
      },
    ]);
  }
}

async function create(body, principal, { models = getModels() } = {}) {
  assertCanSetAssignable(body, principal);
  assertFlagsCompatible({
    isSystemWide: body.isSystemWide ?? false,
    isInstitutionAssignable: body.isInstitutionAssignable ?? false,
    isPicScoped: body.isPicScoped ?? false,
  });

  const existing = await models.Role.findOne({ where: { name: body.name } });
  if (existing) {
    throw new ConflictError(`A role named "${body.name}" already exists`, [
      { field: 'name', issue: 'must be unique' },
    ]);
  }

  return detail((await models.Role.create(body)).id, { models });
}

async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const role = await getById(id, { models, withPermissions: true });

  assertCanSetAssignable(body, principal);

  // Against the state the role will be in after this update, not the state it is
  // in now — turning one flag on while turning the other off in a single call
  // must be judged on the result.
  assertFlagsCompatible({
    isSystemWide: body.isSystemWide ?? role.isSystemWide,
    isInstitutionAssignable: body.isInstitutionAssignable ?? role.isInstitutionAssignable,
    isPicScoped: body.isPicScoped ?? role.isPicScoped,
  });

  if (body.name && body.name !== role.name) {
    const clash = await models.Role.findOne({ where: { name: body.name } });
    if (clash) {
      throw new ConflictError(`A role named "${body.name}" already exists`, [
        { field: 'name', issue: 'must be unique' },
      ]);
    }
  }

  // Clearing `isSystemWide` on a role that holds management permissions would
  // leave it in a state BR-015 forbids, so it is checked here too — not only
  // when permissions change.
  if (body.isSystemWide === false) {
    assertSystemWideRule(
      role.permissions.map((permission) => permission.code),
      false
    );
  }

  await role.update(body);

  return detail(id, { models });
}

/**
 * Hard delete — `ref.roles` has no `is_active` column, so §3.4 specifies
 * DELETE. Blocked while the role is still assigned, so nobody silently loses
 * access (REQ-VAL-004).
 */
async function remove(id, options = {}) {
  const models = options.models ?? getModels();
  const role = await getById(id, { models });

  const assigned = await models.UserRole.count({ where: { roleId: id } });
  if (assigned > 0) {
    throw new ConflictError(
      `The role is assigned to ${assigned} user(s). Remove those assignments first.`
    );
  }

  await role.destroy();
}

async function listPermissions(id, options = {}) {
  const role = await getById(id, { ...options, withPermissions: true });
  return role.permissions.map((permission) => permission.code).sort();
}

/**
 * Replaces the role's entire granted set — `06-api.md` §3.4, REQ-ROLE-007.
 *
 * PUT, not PATCH: the frontend presents a checklist (`07-ui.md` §5.1), and
 * sending the whole set makes an unchecked box unambiguous. Replacement runs in
 * one transaction so a role is never left partially granted.
 */
async function replacePermissions(id, codes, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const role = await getById(id, { models });

  const unknown = codes.filter((code) => !isKnownPermission(code));
  if (unknown.length > 0) {
    throw new ValidationError('One or more permission codes are not in the catalog', [
      { field: 'permissionCodes', issue: `unknown code(s): ${unknown.join(', ')}` },
    ]);
  }

  assertSystemWideRule(codes, role.isSystemWide);

  const unique = [...new Set(codes)];

  await withTransaction(
    async (transaction) => {
      await models.RolePermission.destroy({ where: { roleId: id }, transaction });

      if (unique.length > 0) {
        await models.RolePermission.bulkCreate(
          unique.map((permissionCode) => ({ roleId: id, permissionCode })),
          { transaction }
        );
      }
    },
    { sequelize }
  );

  return listPermissions(id, { models });
}

module.exports = {
  list,
  detail,
  create,
  update,
  remove,
  listPermissions,
  replacePermissions,
  assertSystemWideRule,
  serialize,
  SORTABLE,
};
