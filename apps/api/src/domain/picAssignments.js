'use strict';

/**
 * Person-in-charge assignment — Phase 21 (`CR-003` §9), REQ-ORG-006, REQ-LOC-014.
 *
 * Departments and Locations answer the same two questions — "who is responsible
 * for this?" and "who was responsible when that happened?" — so they share one
 * implementation rather than two that could drift. The only difference between
 * them is which table and column a row hangs off, which is what `SUBJECTS`
 * describes.
 *
 * ── Why an assignment table and not a column ───────────────────────────────
 *
 * A single mutable `pic_user_id` answers the first question and destroys the
 * answer to the second. The history matters precisely when something went
 * wrong — an item is missing, a room was left unlocked — and that is exactly
 * when the column has already been overwritten by whoever holds the post now.
 *
 * ── The write ──────────────────────────────────────────────────────────────
 *
 * `applyStateChange` in `modules/assetUnits/service.js` is the shape this
 * follows, because it solves the same problem for a unit's location:
 *
 *   1. lock the parent row
 *   2. close the live assignment  (is_current = false, ended_at, ended_by)
 *   3. open the new one           (is_current = true,  assigned_by)
 *   4. sync the denormalized `current_pic_user_id`
 *
 * All four in one transaction. A partial application would leave the parent
 * disagreeing with its own history, which is the single thing this design
 * exists to prevent.
 *
 * The lock in step 1 serialises concurrent handovers of the same record;
 * `uq_*_pic_current` is the backstop if one still slips through, turning a race
 * into a constraint violation rather than two people both being "the" PIC.
 *
 * ── Authorization ──────────────────────────────────────────────────────────
 *
 * NOTHING HERE GRANTS ACCESS. Phase 22 will read the *current* department
 * assignment to narrow what a PIC-scoped role may touch; closed rows are never
 * consulted by that lookup, which is what makes "historical PIC does not grant
 * ongoing access" true by construction rather than by remembering.
 */

const { Op } = require('sequelize');

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { ValidationError, ConflictError, ForbiddenError } = require('../errors');
const { organizationScope } = require('../auth/principal');

/**
 * What differs between a Department PIC and a Location PIC.
 *
 * @type {Record<string, {model: string, parentModel: string, foreignKey: string, label: string}>}
 */
const SUBJECTS = Object.freeze({
  department: {
    model: 'DepartmentPicAssignment',
    parentModel: 'Department',
    foreignKey: 'departmentId',
    label: 'Department',
  },
  location: {
    model: 'LocationPicAssignment',
    parentModel: 'Location',
    foreignKey: 'locationId',
    label: 'Location',
  },
});

function subjectOf(kind) {
  const subject = SUBJECTS[kind];
  if (!subject) throw new Error(`Unknown PIC subject "${kind}"`);
  return subject;
}

/** `{ id, username, firstName, lastName }` — never the password hash. */
function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

function serializeAssignment(row) {
  return {
    id: row.id,
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

/**
 * A PIC-scoped caller may not decide who is in charge of anything — `CR-004`
 * §8.2, escalations 1 and 2.
 *
 * Without this, `department-pic:create` would let a PIC appoint themselves to
 * every department in their institution — the one permission that DEFINES their
 * reach — and `department-pic:delete` would let them unseat a colleague. Both
 * codes are outside `PIC_ALLOWED_PERMISSIONS`, so the ceiling already answers
 * `403` at the route; this is the layer that survives a route being added
 * without its guard.
 *
 * Placed here rather than in `departments/service.js` so it covers Location PIC
 * in the same stroke. Location PIC grants no record access in any phase
 * (`CR-004` §14 of the brief), but a PIC-scoped user has no business editing it
 * either.
 *
 * `ForbiddenError`: the parent record is legitimately visible to their
 * institution and it is the ACT that is refused, not the record's existence.
 *
 * @throws {ForbiddenError}
 */
function assertNotPicScoped(principal, verb) {
  if (!organizationScope(principal).picScoped) return;

  throw new ForbiddenError(
    `A PIC-scoped role may not ${verb} a person in charge: deciding who is ` +
      'responsible is an institution-scoped act (CR-004)'
  );
}

/**
 * A PIC must be an active user of the record's own institution — `CR-003` §12
 * of the brief, `BR-007`.
 *
 * The institution check is judged against the RECORD, not the caller: a
 * system-wide caller may legitimately reach both institutions, and must still
 * not put Institution B's user in charge of Institution A's workshop.
 *
 * A record with no institution cannot have a PIC at all. That is the unassigned
 * department case (`institution_id IS NULL`) — there is no institution whose
 * staff could hold the post, so the request is refused rather than accepting a
 * user from an arbitrary one.
 *
 * @throws {ValidationError}
 */
async function assertPicAssignable(userId, parent, { models = getModels(), label }) {
  const user = await models.User.findByPk(userId);

  if (!user) {
    throw new ValidationError('The user does not exist', [
      { field: 'userId', issue: 'must reference an existing user' },
    ]);
  }

  if (!user.isActive) {
    throw new ValidationError('That user is deactivated', [
      { field: 'userId', issue: 'must reference an active user' },
    ]);
  }

  if (!parent.institutionId) {
    throw new ValidationError(`This ${label.toLowerCase()} has no institution`, [
      {
        field: 'userId',
        issue: `a ${label.toLowerCase()} with no institution has no staff to put in charge of it`,
      },
    ]);
  }

  if (user.institutionId !== parent.institutionId) {
    throw new ValidationError('That user belongs to a different institution', [
      {
        field: 'userId',
        issue: `must belong to the same institution as the ${label.toLowerCase()} (BR-007)`,
      },
    ]);
  }

  return user;
}

/** The live assignment row, or `null`. */
async function currentAssignment(kind, parentId, { models = getModels(), transaction } = {}) {
  const subject = subjectOf(kind);

  return models[subject.model].findOne({
    where: { [subject.foreignKey]: parentId, isCurrent: true },
    transaction,
  });
}

/**
 * Closes the live assignment, if any, inside a transaction the caller owns.
 *
 * Separated so the institution-change paths in `modules/locations/service.js`
 * and `modules/users/service.js` can end an assignment that is about to become
 * cross-institution, using the same write as an ordinary handover rather than a
 * second definition of what "ended" means.
 *
 * @returns {Promise<boolean>} whether a row was closed
 */
async function closeCurrent(kind, parentId, principal, { models = getModels(), transaction }) {
  const subject = subjectOf(kind);
  const live = await currentAssignment(kind, parentId, { models, transaction });

  if (!live) return false;

  await live.update(
    { isCurrent: false, endedAt: new Date(), endedBy: principal?.userId ?? null },
    { transaction }
  );

  await models[subject.parentModel].update(
    { currentPicUserId: null },
    { where: { id: parentId }, transaction }
  );

  return true;
}

/**
 * Locks the parent row for the duration of the transaction.
 *
 * Two callers handing over the same department at once would otherwise both
 * read "no live row" (or both read the same one) and both insert. The unique
 * partial index would catch it, but as a constraint violation rather than a
 * queue — this makes the second caller wait and then do the right thing.
 */
async function lockParent(kind, parentId, { models, transaction }) {
  const subject = subjectOf(kind);

  await models[subject.parentModel].findByPk(parentId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
}

/**
 * Sets the current PIC — REQ-ORG-006, REQ-LOC-014.
 *
 * Idempotent in the useful sense: re-assigning the user who already holds the
 * post is a `CONFLICT` rather than a silent no-op or a spurious history entry
 * that says responsibility changed hands when it did not.
 *
 * @param {'department'|'location'} kind
 * @param {object} parent the already-loaded and already-scope-checked record
 */
async function assign(kind, parent, userId, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const subject = subjectOf(kind);

  assertNotPicScoped(principal, 'assign');
  await assertPicAssignable(userId, parent, { models, label: subject.label });

  await withTransaction(
    async (transaction) => {
      await lockParent(kind, parent.id, { models, transaction });

      const live = await currentAssignment(kind, parent.id, { models, transaction });

      if (live && live.userId === userId) {
        throw new ConflictError(
          `That user is already the person in charge of this ${subject.label.toLowerCase()}`
        );
      }

      if (live) {
        await live.update(
          { isCurrent: false, endedAt: new Date(), endedBy: principal.userId },
          { transaction }
        );
      }

      await models[subject.model].create(
        {
          [subject.foreignKey]: parent.id,
          userId,
          isCurrent: true,
          assignedBy: principal.userId,
        },
        { transaction }
      );

      await models[subject.parentModel].update(
        { currentPicUserId: userId },
        { where: { id: parent.id }, transaction }
      );
    },
    { sequelize, transaction: options.transaction }
  );
}

/** Ends the current assignment without opening a new one. */
async function clear(kind, parent, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const subject = subjectOf(kind);

  assertNotPicScoped(principal, 'remove');

  await withTransaction(
    async (transaction) => {
      await lockParent(kind, parent.id, { models, transaction });

      const closed = await closeCurrent(kind, parent.id, principal, { models, transaction });

      if (!closed) {
        throw new ConflictError(
          `This ${subject.label.toLowerCase()} has no person in charge to remove`
        );
      }
    },
    { sequelize, transaction: options.transaction }
  );
}

/**
 * The full assignment history, newest first — the answer to "who was in charge
 * when this happened?".
 *
 * A complete collection rather than a page (`06-api.md` §1.5): it is a short
 * succession list read as a whole, and page two of a responsibility trail is
 * not a smaller trail.
 */
async function history(kind, parentId, { models = getModels() } = {}) {
  const subject = subjectOf(kind);

  const rows = await models[subject.model].findAll({
    where: { [subject.foreignKey]: parentId },
    include: [
      { association: 'user', attributes: ['id', 'username', 'firstName', 'lastName'] },
      { association: 'assigner', attributes: ['id', 'username', 'firstName', 'lastName'] },
      { association: 'ender', attributes: ['id', 'username', 'firstName', 'lastName'] },
    ],
    order: [
      ['isCurrent', 'DESC'],
      ['assignedAt', 'DESC'],
    ],
  });

  return rows.map(serializeAssignment);
}

/**
 * Who held the post at a given instant — the audit question, kept deliberately
 * separate from the authorization lookup.
 *
 * Authorization reads `is_current = true` and nothing else (Phase 22). This
 * reads a period. Two different questions, two different queries, so a change to
 * one cannot quietly answer the other.
 */
async function picAt(kind, parentId, when, { models = getModels() } = {}) {
  const subject = subjectOf(kind);

  const row = await models[subject.model].findOne({
    where: {
      [subject.foreignKey]: parentId,
      assignedAt: { [Op.lte]: when },
      [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gt]: when } }],
    },
    include: [{ association: 'user', attributes: ['id', 'username', 'firstName', 'lastName'] }],
    order: [['assignedAt', 'DESC']],
  });

  return row ? serializeAssignment(row) : null;
}

module.exports = {
  SUBJECTS,
  assign,
  clear,
  closeCurrent,
  currentAssignment,
  history,
  picAt,
  assertPicAssignable,
  serializeUser,
  serializeAssignment,
};
