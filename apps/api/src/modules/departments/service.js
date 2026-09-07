'use strict';

/**
 * Department use cases — `IMPLEMENTATION_PLAN.md` §10.2, REQ-ORG-003/004.
 *
 * Institution-scoped since Phase 20 (`CR-003`). Until then this module was the
 * one organizational resource with no scope enforcement at all — it did not even
 * accept a `principal` — because `public.departments` had no `institution_id` to
 * enforce against. Its previous header recorded that contradiction rather than
 * inventing columns to resolve it; migration 040 supplies the column, and this
 * module now uses the same five `domain/scope.js` helpers every other scoped
 * resource does.
 *
 * `institutionId` is nullable, and NULL means UNASSIGNED, not global. Such a row
 * is reachable only by a system-wide caller — `scopeFilter` matches a scoped
 * caller's own institution and nothing else — and it can never be attached to an
 * asset unit (`domain/departmentRules.js`). It exists so a legacy department can
 * wait to be assigned without being fabricated into an institution.
 */

const { getModels } = require('../../db/models');
const { NotFoundError, ConflictError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, containsAny, equals } = require('../../query/filtering');
const {
  scopeFilter,
  assertCanAccess,
  assertCanAssignInstitution,
  defaultInstitutionFor,
} = require('../../domain/scope');
const pic = require('../../domain/picAssignments');
const { serializeUser } = pic;

const SORTABLE = ['code', 'name', 'createdAt', 'updatedAt'];

const FILTERS = {
  status: activeStatus(),
  institutionId: (value) => equals('institutionId', value),
  q: (value) => containsAny(['code', 'name'], value),
};

function serialize(department) {
  return {
    id: department.id,
    institutionId: department.institutionId ?? null,
    code: department.code,
    name: department.name,
    // The live person in charge — Phase 21 (`CR-003`). `currentPicUserId` is
    // the authority on whether one exists; `currentPic` is the resolved
    // convenience, present only when the association was loaded. Same
    // convention as `parentLocationId` versus `parentLocation`.
    currentPicUserId: department.currentPicUserId ?? null,
    currentPic: department.currentPic ? serializeUser(department.currentPic) : undefined,
    isActive: department.isActive,
    createdAt: department.createdAt,
    updatedAt: department.updatedAt,
    // Present only when the caller asked for detail, as elsewhere.
    institution: department.institution
      ? {
          id: department.institution.id,
          name: department.institution.name,
          code: department.institution.code,
        }
      : undefined,
  };
}

async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['name', 'ASC']],
  });

  // Scope is applied on top of the caller's filters, never instead of them.
  options.where = { ...options.where, ...scopeFilter(principal) };

  const { rows, pagination } = await paginate(models.Department, options);

  return { rows: rows.map(serialize), pagination };
}

/**
 * A department outside the caller's scope answers 404, never 403 — `06-api.md`
 * §1.4. Confirming that a department exists but belongs to another institution
 * would disclose the shape of that institution's organization.
 */
async function getById(id, principal, { models = getModels(), withInstitution = false } = {}) {
  const department = await models.Department.findByPk(id, {
    include: withInstitution
      ? [
          { association: 'institution', attributes: ['id', 'name', 'code'] },
          {
            association: 'currentPic',
            attributes: ['id', 'username', 'firstName', 'lastName'],
          },
        ]
      : [],
  });

  if (!department) throw new NotFoundError('Department not found');

  return assertCanAccess(principal, department, { label: 'Department' });
}

const detail = async (id, principal, options) =>
  serialize(await getById(id, principal, { ...options, withInstitution: true }));

// --- Person in charge — Phase 21 (`CR-003`), REQ-ORG-006 ---------------------

/**
 * The rules live in `domain/picAssignments.js`, shared with Locations. Reaching
 * the department is checked here first, so an out-of-scope id answers 404 before
 * any body is looked at — existence must not leak through a validation message.
 */
async function setPic(id, userId, principal, options = {}) {
  const models = options.models ?? getModels();
  const department = await getById(id, principal, { models });

  await pic.assign('department', department, userId, principal, { ...options, models });

  return detail(id, principal, { models });
}

async function clearPic(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const department = await getById(id, principal, { models });

  await pic.clear('department', department, principal, { ...options, models });

  return detail(id, principal, { models });
}

async function picHistory(id, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  return pic.history('department', id, { models });
}

/**
 * `code` is unique WITHIN an institution, not globally — `CR-003` §2.1. Two
 * institutions each running a `TKJ` is the case this phase exists to allow, so
 * the clash check is scoped to the institution the row will belong to.
 */
async function assertCodeAvailable(code, institutionId, models, { excludeId } = {}) {
  const clash = await models.Department.findOne({ where: { code, institutionId } });

  if (clash && clash.id !== excludeId) {
    throw new ConflictError(
      institutionId
        ? `A department with code "${code}" already exists in that institution`
        : `An unassigned department with code "${code}" already exists`,
      [{ field: 'code', issue: 'must be unique within the institution' }]
    );
  }
}

async function create(body, principal, { models = getModels() } = {}) {
  // A scoped caller creating a department without naming an institution gets
  // their own; naming another is rejected (`BR-007`) — the same rule assets,
  // contracts, locations and users all enforce on create.
  const institutionId = defaultInstitutionFor(principal, body.institutionId);
  assertCanAssignInstitution(principal, institutionId);

  await assertCodeAvailable(body.code, institutionId, models);

  const department = await models.Department.create({ ...body, institutionId });

  return detail(department.id, principal, { models });
}

/**
 * `institutionId` is deliberately absent from the update schema (`CR-003`
 * OPEN-6). Moving a department between institutions would invalidate every asset
 * unit assigned to it in one statement, and there is no correct remapping — the
 * two institutions' departments are different rows that happen to share a code.
 * A department created in the wrong institution is deactivated and recreated.
 */
async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const department = await getById(id, principal, { models });

  if (body.code && body.code !== department.code) {
    await assertCodeAvailable(body.code, department.institutionId, models, { excludeId: id });
  }

  await department.update(body);

  return detail(id, principal, { models });
}

async function setActive(id, isActive, principal, options = {}) {
  const models = options.models ?? getModels();
  const department = await getById(id, principal, { models });

  if (department.isActive === isActive) {
    throw new ConflictError(`Department is already ${isActive ? 'active' : 'inactive'}`);
  }

  await department.update({ isActive });

  return detail(id, principal, { models });
}

module.exports = {
  list,
  detail,
  getById,
  create,
  update,
  setPic,
  clearPic,
  picHistory,
  deactivate: (id, principal, options) => setActive(id, false, principal, options),
  reactivate: (id, principal, options) => setActive(id, true, principal, options),
  serialize,
  SORTABLE,
};
