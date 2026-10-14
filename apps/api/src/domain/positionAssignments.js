'use strict';

/**
 * School position assignments — Phase 35 (`CR-014` §4), REQ-POS-002, REQ-POS-003.
 *
 * Follows `domain/picAssignments.js`: a temporal row per period, a lock taken
 * before the write, the partial unique indexes of migration 049 as the backstop,
 * and closed rows never modified.
 *
 * ONE DELIBERATE DIFFERENCE from PIC: assigning a post that is already held does
 * NOT hand it over. A PIC assignment replaces the holder in one step; here the
 * current holder must be ended first (`06-api.md` §12.1). Whoever holds a
 * position decides whose turn a workflow step is (Phase 38 onward), so
 * replacing someone must be a deliberate, separate act, never a side effect.
 *
 * ── Authorization ──────────────────────────────────────────────────────────
 *
 * NOTHING HERE GRANTS ACCESS (`BR-028`). `resolvePrincipal` never reads this
 * table. Two refusals live here rather than only at the route:
 *
 *   - `BR-033` — nobody creates or ends their own assignment. A position plus a
 *     role able to decide steps determines who approves, so self-appointment is
 *     an escalation, refused where it is attempted.
 *   - A PIC-scoped caller may not assign positions at all. The codes are outside
 *     the `CR-004` ceiling, so the route already answers `403`; this is the layer
 *     that survives a route being added without its guard.
 *
 * Errors keep the existing envelope (`CR-014` Phase 35 decision D1): `409
 * CONFLICT` / `403 FORBIDDEN`, with the specific reason in `details[].issue`.
 */

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { ValidationError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');
const { organizationScope } = require('../auth/principal');
const { assertCanAccess } = require('./scope');
const { serializeUser } = require('./picAssignments');
const {
  isKnownPosition,
  requiresDepartment,
  isSingleHolder,
  positionOf,
} = require('./schoolPositions');

const PERSON = ['id', 'username', 'firstName', 'lastName'];

const INCLUDE = [
  { association: 'user', attributes: PERSON },
  { association: 'assigner', attributes: PERSON },
  { association: 'ender', attributes: PERSON },
  { association: 'department', attributes: ['id', 'code', 'name'] },
];

function serialize(row) {
  return {
    id: row.id,
    institutionId: row.institutionId,
    positionCode: row.positionCode,
    departmentId: row.departmentId ?? null,
    department: row.department
      ? { id: row.department.id, code: row.department.code, name: row.department.name }
      : null,
    userId: row.userId,
    user: serializeUser(row.user),
    isCurrent: row.isCurrent,
    assignedAt: row.assignedAt,
    endedAt: row.endedAt ?? null,
    assignedBy: row.assignedBy ?? null,
    assigner: serializeUser(row.assigner),
    endedBy: row.endedBy ?? null,
    ender: serializeUser(row.ender),
  };
}

const ORDER = [
  ['isCurrent', 'DESC'],
  ['assignedAt', 'DESC'],
];

/** `CR-004` ceiling, second layer. @throws {ForbiddenError} */
function assertNotPicScoped(principal) {
  if (!organizationScope(principal).picScoped) return;
  throw new ForbiddenError('A PIC-scoped role may not manage school positions', [
    { issue: 'assigning school positions is an institution-scoped act (CR-004, CR-014)' },
  ]);
}

/** `BR-033`. @throws {ForbiddenError} */
function assertNotSelf(principal, userId, verb) {
  if (principal?.userId !== userId) return;
  throw new ForbiddenError(`You may not ${verb} your own school position`, [
    {
      field: 'userId',
      issue: `a user cannot ${verb} their own school-position assignment (BR-033)`,
    },
  ]);
}

/**
 * The holder must be an active user of an institution; the department, when the
 * position is held for one, an active department of that same institution.
 */
async function assertAssignable(user, positionCode, departmentId, models) {
  if (!isKnownPosition(positionCode)) {
    throw new ValidationError('Unknown school position', [
      { field: 'positionCode', issue: 'must be one of the school positions' },
    ]);
  }

  if (!user.isActive) {
    throw new ValidationError('That user is deactivated', [
      { field: 'userId', issue: 'must reference an active user' },
    ]);
  }

  if (!user.institutionId) {
    throw new ValidationError('That user has no institution', [
      { field: 'userId', issue: 'a school position is held within an institution' },
    ]);
  }

  if (!requiresDepartment(positionCode)) {
    if (departmentId) {
      throw new ValidationError('This position is not held for a department', [
        { field: 'departmentId', issue: `must be omitted for ${positionCode}` },
      ]);
    }
    return null;
  }

  if (!departmentId) {
    throw new ValidationError('This position is held for a department', [
      { field: 'departmentId', issue: `is required for ${positionCode}` },
    ]);
  }

  const department = await models.Department.findByPk(departmentId);

  if (!department) {
    throw new ValidationError('The department does not exist', [
      { field: 'departmentId', issue: 'must reference an existing department' },
    ]);
  }

  if (!department.isActive) {
    throw new ValidationError('That department has been deactivated', [
      { field: 'departmentId', issue: 'must not reference a deactivated department' },
    ]);
  }

  if (department.institutionId !== user.institutionId) {
    throw new ValidationError('That department belongs to a different institution', [
      {
        field: 'departmentId',
        issue: 'must belong to the same institution as the user (BR-007)',
      },
    ]);
  }

  return department;
}

/**
 * The live assignments that would collide with the new one, checked inside the
 * transaction so the answer is a reason rather than a bare constraint error.
 */
async function assertNoCollision(user, positionCode, departmentId, { models, transaction }) {
  const live = (where) =>
    models.PositionAssignment.findOne({ where: { ...where, isCurrent: true }, transaction });

  if (await live({ userId: user.id, positionCode, departmentId: departmentId ?? null })) {
    throw new ConflictError('That user already holds this position', [
      { field: 'positionCode', issue: 'the user already has this assignment' },
    ]);
  }

  if (isSingleHolder(positionCode)) {
    const scope =
      positionOf(positionCode).holders === 'ONE_PER_DEPARTMENT'
        ? { departmentId, positionCode }
        : { institutionId: user.institutionId, positionCode };

    if (await live(scope)) {
      throw new ConflictError('This position is already held', [
        {
          field: 'positionCode',
          issue: "position occupied: end the current holder's assignment first",
        },
      ]);
    }
  }

  if (positionCode === 'TOOLMAN' && (await live({ userId: user.id, positionCode }))) {
    throw new ConflictError('That user is already the Toolman of another department', [
      { field: 'departmentId', issue: 'a person is the Toolman of one department at a time' },
    ]);
  }
}

/**
 * Serialises concurrent assignments. A new row has no parent to lock, so the
 * lock is taken on the user it will belong to, and additionally on the
 * department for department-bound posts. The partial unique indexes remain the
 * backstop for anything that still races.
 */
async function lockFor(userId, departmentId, { models, transaction }) {
  await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
  if (departmentId) {
    await models.Department.findByPk(departmentId, { transaction, lock: transaction.LOCK.UPDATE });
  }
}

/**
 * Serialises assignments to the same institution-wide post, which the user and
 * department locks do not cover. Transaction-scoped, released on commit.
 */
async function lockInstitutionPost(institutionId, positionCode, { sequelize, transaction }) {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext($1))', {
    bind: [`position:${institutionId}:${positionCode}`],
    transaction,
    type: sequelize.QueryTypes.SELECT,
  });
}

async function assign(user, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const { positionCode } = body;
  const departmentId = body.departmentId ?? null;

  assertNotPicScoped(principal);
  assertNotSelf(principal, user.id, 'assign');
  await assertAssignable(user, positionCode, departmentId, models);

  const id = await withTransaction(
    async (transaction) => {
      await lockFor(user.id, departmentId, { models, transaction });
      if (positionOf(positionCode).holders === 'ONE_PER_INSTITUTION') {
        await lockInstitutionPost(user.institutionId, positionCode, { sequelize, transaction });
      }
      await assertNoCollision(user, positionCode, departmentId, { models, transaction });

      const row = await models.PositionAssignment.create(
        {
          institutionId: user.institutionId,
          userId: user.id,
          positionCode,
          departmentId,
          isCurrent: true,
          assignedBy: principal.userId,
        },
        { transaction }
      );
      return row.id;
    },
    { sequelize }
  );

  return serialize(await models.PositionAssignment.findByPk(id, { include: INCLUDE }));
}

/** Loads an assignment within the caller's scope; `404` outside it. */
async function getById(id, principal, { models = getModels() } = {}) {
  const row = await models.PositionAssignment.findByPk(id);
  if (!row) throw new NotFoundError('Position assignment not found');
  return assertCanAccess(principal, row, { label: 'Position assignment' });
}

async function end(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);
  const found = await getById(id, principal, { models });
  assertNotSelf(principal, found.userId, 'end');

  await withTransaction(
    async (transaction) => {
      const row = await models.PositionAssignment.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!row.isCurrent) {
        throw new ConflictError('This assignment has already ended', [
          { issue: 'an ended assignment is history and is never modified' },
        ]);
      }
      await row.update(
        { isCurrent: false, endedAt: new Date(), endedBy: principal.userId },
        { transaction }
      );
    },
    { sequelize }
  );

  return serialize(await models.PositionAssignment.findByPk(id, { include: INCLUDE }));
}

/** Every assignment, current first then newest; `current` limits to live rows. */
async function listFor(where, { current = false, models = getModels() } = {}) {
  const rows = await models.PositionAssignment.findAll({
    where: current ? { ...where, isCurrent: true } : where,
    include: INCLUDE,
    order: ORDER,
  });
  return rows.map(serialize);
}

module.exports = {
  assign,
  end,
  getById,
  listFor,
  serialize,
};
