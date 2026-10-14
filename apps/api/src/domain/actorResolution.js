'use strict';

/**
 * Workflow actor resolution — Phase 38 (`CR-014` §6.2), REQ-WF-005, `BR-028`,
 * `BR-030`.
 *
 * READ-ONLY. A step names a position code; this module answers, live, who
 * currently holds that position in the request's scope:
 *
 *   department-bound (KAJUR, TOOLMAN, JURUSAN_TEACHER)  — the request's department
 *   every other position                                — the request's institution
 *
 * Only CURRENT assignments of ACTIVE users count. Resolution happens at the
 * moment of every action and display, so a handover takes effect immediately:
 * the new holder may act, the old one may not.
 *
 * No holder means the step is VACANT. A vacant step waits; nothing here ever
 * skips it, reassigns it or offers an override (`BR-030`).
 *
 * A position is never a permission (`BR-028`): being resolved here makes a user
 * the step's actor, which is necessary but not sufficient — acting also needs
 * the step type's permission, checked separately.
 */

const { getModels } = require('../db/models');
const { requiresDepartment } = require('./schoolPositions');

const DEPARTMENT_BOUND_SQL = `('JURUSAN_TEACHER', 'TOOLMAN', 'KAJUR')`;

/** The `where` selecting current holders of `positionCode` in the request's scope. */
function holderWhere(positionCode, request) {
  const scope = requiresDepartment(positionCode)
    ? { departmentId: request.departmentId ?? null }
    : { institutionId: request.institutionId };
  return { positionCode, isCurrent: true, ...scope };
}

/**
 * The current, active holders able to act on `step` of `request`.
 *
 * @returns {Promise<Array<{assignmentId: string, userId: string, user: object}>>}
 */
async function resolveHolders(step, request, { models = getModels(), transaction } = {}) {
  // A department-bound step on a request with no department cannot resolve.
  // Publication (REQ-WF-004) and the JURUSAN rule make this unreachable; it is
  // guarded so that a gap shows as vacancy, never as "anyone".
  if (requiresDepartment(step.actorPositionCode) && !request.departmentId) return [];

  const rows = await models.PositionAssignment.findAll({
    where: holderWhere(step.actorPositionCode, request),
    include: [
      {
        association: 'user',
        attributes: ['id', 'username', 'firstName', 'lastName', 'isActive'],
        where: { isActive: true },
        required: true,
      },
    ],
    order: [['assignedAt', 'ASC']],
    transaction,
  });

  return rows.map((row) => ({ assignmentId: row.id, userId: row.userId, user: row.user }));
}

/**
 * The caller's own current assignment that makes them the actor of `step`, or
 * `null`. The caller is authenticated, hence active.
 */
async function actorAssignmentFor(
  userId,
  step,
  request,
  { models = getModels(), transaction } = {}
) {
  if (requiresDepartment(step.actorPositionCode) && !request.departmentId) return null;

  return models.PositionAssignment.findOne({
    where: { ...holderWhere(step.actorPositionCode, request), userId },
    order: [['assignedAt', 'ASC']],
    transaction,
  });
}

/**
 * SQL: an ACTIVE step of the request (aliased `requestRef`) whose position the
 * user currently holds in the request's scope. Optionally restricted to step
 * types. Used for visibility clause 2 and "awaiting my action" (F6, F9).
 *
 * @param {string} requestRef SQL for the request row alias, e.g. `"Request"`
 * @param {string} userLiteral an escaped user id
 * @param {string[]} [types] step types; omitted = any
 */
function activeActorSql(requestRef, userLiteral, types, sequelize) {
  const typeFilter = types
    ? `AND s.step_type IN (${types.map((type) => sequelize.escape(type)).join(', ')})`
    : '';
  return holderOfStepSql(requestRef, userLiteral, `s.state = 'ACTIVE' ${typeFilter}`);
}

/**
 * SQL: a step `s` of the request, matching `stepCondition`, whose position the
 * user currently holds in the request's scope — the live holder join shared by
 * every "is this user the step's holder" question.
 */
function holderOfStepSql(requestRef, userLiteral, stepCondition) {
  return `EXISTS (
    SELECT 1
      FROM public.request_steps s
      JOIN public.position_assignments pa
        ON pa.position_code = s.actor_position_code
       AND pa.is_current
       AND pa.user_id = ${userLiteral}
       AND (
             (s.actor_position_code IN ${DEPARTMENT_BOUND_SQL}
              AND pa.department_id = ${requestRef}."department_id")
          OR (s.actor_position_code NOT IN ${DEPARTMENT_BOUND_SQL}
              AND pa.institution_id = ${requestRef}."institution_id")
           )
     WHERE s.request_id = ${requestRef}."id"
       AND ${stepCondition})`;
}

/**
 * SQL: the user currently holds a DECIDE position of the request's NEWEST
 * cycle, and that cycle is a resubmission (> 1) — REQ-REQUEST-018, decision
 * D10. The narrow exception that lets every approver of a restarted chain see
 * the request and its "resubmitted" update, including one who never acted on
 * it. Live, like every holder question: it lapses the moment the user stops
 * holding the position. Never a general position-based visibility.
 */
function resubmittedDecideHolderSql(requestRef, userLiteral) {
  return holderOfStepSql(
    requestRef,
    userLiteral,
    `s.step_type = 'DECIDE' AND s.cycle > 1
       AND s.cycle = (SELECT max(c.cycle) FROM public.request_steps c
                       WHERE c.request_id = ${requestRef}."id")`
  );
}

/**
 * SQL: the user is recorded as having acted on one of the request's steps —
 * visibility clause 3, "a former actor" (decision F9). Holding the position
 * without acting grants nothing. Spans every approval cycle on purpose
 * (REQ-REQUEST-018): having acted in an earlier cycle is still having acted.
 */
function actedSql(requestRef, userLiteral) {
  return `EXISTS (
    SELECT 1 FROM public.request_steps s
     WHERE s.request_id = ${requestRef}."id" AND s.acted_by_user_id = ${userLiteral})`;
}

module.exports = {
  resolveHolders,
  actorAssignmentFor,
  activeActorSql,
  resubmittedDecideHolderSql,
  actedSql,
  holderWhere,
};
