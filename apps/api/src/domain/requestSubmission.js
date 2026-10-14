'use strict';

/**
 * What stands between a DRAFT and its submission — REQ-REQUEST-007, `DEC-F`,
 * E9, F8 (`IMPLEMENTATION_PLAN.md` §64, P1).
 *
 * ONE SOURCE for both readers:
 *
 *   `POST /requests/:id/submit` (`requestWorkflow.submit`) refuses on the FIRST
 *   blocker, with exactly the error it has always raised — the rules, their
 *   order and their messages are unchanged by moving them here.
 *
 *   `GET /requests/:id` lists EVERY blocker (`submitBlockers`) so the form can
 *   say what is missing before anyone clicks Submit. The server re-checks at
 *   submission; the list is never a promise.
 *
 * Each blocker says who can clear it: `REQUESTER` (add an item, change the
 * category, …) or `ADMINISTRATOR` (no workflow is configured — nothing the
 * requester can do).
 *
 * Deliberately NOT here: documents (never required, `CR-014` §9), a destination
 * (optional), and anything a later step does. The caller has already checked
 * who may submit (the requester, a DRAFT, `request:submit`).
 *
 * ── Resubmission (REQ-REQUEST-018) ─────────────────────────────────────────
 *
 * A request returned for revision is resubmitted on its FROZEN step snapshot.
 * Every blocker still applies — the requester context, the items, the
 * department, the destination, the category's eligibility — except the
 * workflow lookup: the active definition is never consulted again, so there is
 * no `NO_WORKFLOW` and no definition, whatever has been published or retired
 * since (`DEC-K`).
 */

const { ValidationError, ConflictError } = require('../errors');
const { eligibleCategoriesFor, isEligibleCategory } = require('./requestGuidance');

/**
 * @typedef {{code: string, field: string, message: string, issue: string,
 *   fixedBy: 'REQUESTER'|'ADMINISTRATOR', kind: 'VALIDATION'|'CONFLICT'}} Blocker
 */

/** The error `submit` has always raised for a blocker. */
function errorFor(blocker) {
  const ErrorType = blocker.kind === 'CONFLICT' ? ConflictError : ValidationError;
  return new ErrorType(blocker.message, [{ field: blocker.field, issue: blocker.issue }]);
}

/** Whether submitting `request` resubmits it after a revision (REQ-REQUEST-018). */
const isResubmission = (request) => request.status === 'REVISION_REQUESTED';

/** The blocker as the detail response carries it. */
function serializeBlocker({ code, field, message, fixedBy }) {
  return { code, field, message, fixedBy };
}

/**
 * Every blocker, in the order `submit` checks them. Read-only.
 *
 * `lockDefinition` is set by `submit` only: a publish of the same key then
 * waits for the submission, or has finished (`DEC-K`).
 *
 * @returns {Promise<{blockers: Blocker[], definition: object|null}>}
 */
async function evaluate(request, { models, transaction, lockDefinition = false }) {
  const blockers = [];

  // E9: the capacity the draft was written in must still be held.
  const assignment = await models.PositionAssignment.findByPk(request.requesterAssignmentId, {
    include: [{ association: 'user', attributes: ['id', 'isActive'] }],
    transaction,
  });
  if (
    !assignment ||
    !assignment.isCurrent ||
    assignment.userId !== request.requesterUserId ||
    !assignment.user?.isActive
  ) {
    blockers.push({
      code: 'REQUESTER_CONTEXT_ENDED',
      field: 'requesterAssignmentId',
      message: 'The requester context is no longer current',
      issue:
        'that requester context is no longer current; create a new draft under a position you currently hold (E9)',
      fixedBy: 'REQUESTER',
      kind: 'VALIDATION',
    });
  }

  const itemCount = await models.RequestItem.count({
    where: { requestId: request.id },
    transaction,
  });
  if (itemCount === 0) {
    blockers.push({
      code: 'NO_ITEMS',
      field: 'items',
      message: 'A request needs at least one item',
      issue: 'add at least one item before submitting (REQ-REQUEST-006)',
      fixedBy: 'REQUESTER',
      kind: 'VALIDATION',
    });
  }

  if (request.departmentId) {
    const department = await models.Department.findByPk(request.departmentId, { transaction });
    if (!department?.isActive) {
      blockers.push({
        code: 'DEPARTMENT_INACTIVE',
        field: 'departmentId',
        message: 'The department has been deactivated',
        issue: 'must reference an active department',
        fixedBy: 'REQUESTER',
        kind: 'VALIDATION',
      });
    }
  }

  if (request.destinationLocationId) {
    const location = await models.Location.findByPk(request.destinationLocationId, { transaction });
    if (!location?.isActive) {
      blockers.push({
        code: 'DESTINATION_INACTIVE',
        field: 'destinationLocationId',
        message: 'The destination has been deactivated',
        issue: 'must reference an active location',
        fixedBy: 'REQUESTER',
        kind: 'VALIDATION',
      });
    }
  }

  // §73: a consumable line names an active consumable when it is (re)submitted.
  const inactiveConsumables = await models.RequestItem.count({
    where: { requestId: request.id },
    include: [
      { association: 'consumable', attributes: [], where: { isActive: false }, required: true },
    ],
    transaction,
  });
  if (inactiveConsumables > 0) {
    blockers.push({
      code: 'CONSUMABLE_INACTIVE',
      field: 'items',
      message: 'A line names an inactive consumable',
      issue: 'remove the line or choose an active consumable',
      fixedBy: 'REQUESTER',
      kind: 'VALIDATION',
    });
  }

  // Before the workflow lookup: an ineligible category is refused as such, not
  // as "no process configured" (a draft saved before the rule existed).
  const eligible = isEligibleCategory(request.requesterPositionCode, request.category);
  if (!eligible) {
    blockers.push({
      code: 'CATEGORY_NOT_ELIGIBLE',
      field: 'category',
      message: 'This category cannot be requested in this capacity',
      issue:
        `a request made as ${request.requesterPositionCode} may be one of ` +
        `${eligibleCategoriesFor(request.requesterPositionCode).join(', ')}; ` +
        `${request.category} is not among them`,
      fixedBy: 'REQUESTER',
      kind: 'VALIDATION',
    });
  }

  // REQ-REQUEST-018: a resubmission keeps its frozen snapshot; nothing to select.
  if (isResubmission(request)) return { blockers, definition: null };

  // `DEC-F`: exactly (institution, category, requester position), no fallback.
  // Not looked up for an ineligible category — none may be published for it.
  const definition = eligible
    ? await models.WorkflowDefinition.findOne({
        where: {
          institutionId: request.institutionId,
          category: request.category,
          requesterPositionCode: request.requesterPositionCode,
          status: 'ACTIVE',
        },
        ...(lockDefinition ? { lock: transaction.LOCK.SHARE } : {}),
        transaction,
      })
    : null;
  if (eligible && !definition) {
    blockers.push({
      code: 'NO_WORKFLOW',
      field: 'category',
      message: 'No process is configured for this request',
      issue: `no process is configured for this requester context and category (${request.category} from ${request.requesterPositionCode})`,
      fixedBy: 'ADMINISTRATOR',
      kind: 'CONFLICT',
    });
  }

  return { blockers, definition };
}

/** The detail's list: every blocker, serialized. */
async function submitBlockers(request, { models, transaction } = {}) {
  const { blockers } = await evaluate(request, { models, transaction });
  return blockers.map(serializeBlocker);
}

module.exports = { evaluate, submitBlockers, errorFor, serializeBlocker, isResubmission };
