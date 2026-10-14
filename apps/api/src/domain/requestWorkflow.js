'use strict';

/**
 * Request workflow execution — Phase 38 (`CR-014` §6.1 – §6.4, §10.2),
 * REQ-WF-005 – REQ-WF-007, REQ-REQUEST-007 – REQ-REQUEST-009, REQ-REQUEST-013.
 *
 * ── The model (decisions G1 – G4) ─────────────────────────────────────────
 *
 *   DECIDE steps run strictly in sequence; at most one is ACTIVE.
 *   When the last DECIDE is APPROVED or SKIPPED, IN THE SAME TRANSACTION (G4):
 *       the request becomes APPROVED, and PROCURE and REGISTER become ACTIVE.
 *   PROCURE and REGISTER are independent (G2): completing PROCURE touches
 *       nothing else; nothing in this phase completes REGISTER (Phase 40 does,
 *       when every item is registered). After APPROVED the request status never
 *       follows step states — it follows recorded receipt (Phase 41). Procurement
 *       completion is therefore never fulfilment (`BR-031`).
 *
 * ── Actors (`DEC-J`, REQ-WF-005) ──────────────────────────────────────────
 *
 * Acting needs the step type's PERMISSION (checked by the route) AND being a
 * current holder of the step's position in the request's scope (checked here,
 * live, under the request's row lock). `request:oversee` never substitutes for
 * the second: a caller who is not the actor receives `403` "not the actor of
 * this step". A vacant step waits — nothing here skips or reassigns it
 * (`BR-030`).
 *
 * ── Self-skip (decisions F1, F2) ──────────────────────────────────────────
 *
 * DECIDE steps only, and only when `skip_if_requester_is_actor` is set: at the
 * moment the step becomes ACTIVE — once — if the requester then holds the step's
 * position in scope, it is recorded SKIPPED with reason SELF. It is never
 * re-evaluated afterwards, and a vacant step is never skipped. With the flag off
 * (every template), a requester who holds the position acts like any holder.
 *
 * ── Concurrency ───────────────────────────────────────────────────────────
 *
 * Every state change takes a row lock on the request first, then re-reads the
 * step. Two actors can therefore never act on one request at once, and
 * `uq_request_steps_one_active_decision` is the backstop for G1.
 */

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { ValidationError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');
const { hasPermission } = require('../auth/principal');
const { actorAssignmentFor } = require('./actorResolution');
const { currentSteps } = require('./requestCycles');
const {
  FINISHED_STATES,
  TERMINAL_REQUEST_STATUSES,
  EDITABLE_REQUEST_STATUSES,
} = require('./requestStepStates');
const requests = require('./requests');
const submission = require('./requestSubmission');

// --- Shared -------------------------------------------------------------------

async function lockRequest(id, principal, { models, transaction }) {
  return requests.getVisible(id, principal, { models, transaction, lock: transaction.LOCK.UPDATE });
}

/** The CURRENT cycle's steps, locked (REQ-REQUEST-018: earlier cycles are history). */
async function stepsOf(requestId, { models, transaction }) {
  return currentSteps(requestId, { models, transaction, lock: transaction.LOCK.UPDATE });
}

/**
 * Advances a request to its next waiting point — the activation loop.
 *
 *   - the first unfinished DECIDE becomes ACTIVE (self-skip evaluated once);
 *   - an ACTIVE DECIDE means the request is waiting: stop;
 *   - when no DECIDE is left unfinished, the request becomes APPROVED and every
 *     PENDING PROCURE / REGISTER becomes ACTIVE — all in this transaction (G4).
 *
 * @param {object} request locked row
 * @param {object[]} steps the request's steps, ordered, locked
 */
async function advance(request, steps, { models, transaction, now = new Date() }) {
  for (const step of steps.filter((s) => s.stepType === 'DECIDE')) {
    if (step.state === 'APPROVED' || step.state === 'SKIPPED') continue;
    if (step.state === 'ACTIVE') return;

    // PENDING: it opens now. Self-skip is decided here and only here (F2).
    const selfSkip =
      step.skipIfRequesterIsActor &&
      (await actorAssignmentFor(request.requesterUserId, step, request, { models, transaction }));

    if (selfSkip) {
      await step.update(
        { state: 'SKIPPED', skipReason: 'SELF', activatedAt: now, completedAt: now },
        { transaction }
      );
      continue;
    }

    await step.update({ state: 'ACTIVE', activatedAt: now }, { transaction });
    return;
  }

  // Every decision is finished: approve and open the fulfilment steps together.
  await request.update({ status: 'APPROVED', approvedAt: now }, { transaction });
  // §73: a request of consumable lines only has nothing to register — its
  // REGISTER step is CLOSED, never DONE, exactly as when a close leaves nothing
  // to register (D41-3). Items are frozen from approval on, so this holds.
  const assetLines = await models.RequestItem.count({
    where: { requestId: request.id, consumableId: null },
    transaction,
  });
  for (const step of steps.filter((s) => s.stepType !== 'DECIDE' && s.state === 'PENDING')) {
    if (step.stepType === 'REGISTER' && assetLines === 0) {
      await step.update({ state: 'CLOSED', completedAt: now }, { transaction });
      continue;
    }
    // No self-skip for PROCURE or REGISTER (F1).
    await step.update({ state: 'ACTIVE', activatedAt: now }, { transaction });
  }
}

/** F10: every step not finished becomes CLOSED — never DONE (`BR-031`). */
async function closeOpenSteps(steps, { transaction, now = new Date() }) {
  for (const step of steps) {
    if (FINISHED_STATES.includes(step.state)) continue;
    await step.update({ state: 'CLOSED', completedAt: now }, { transaction });
  }
}

// --- Submission ---------------------------------------------------------------

/**
 * `POST /requests/:id/submit` — REQ-REQUEST-007, `DEC-F`, `DEC-K`.
 *
 * Re-validates (E9, F8), selects the single ACTIVE definition for exactly
 * (institution, category, requester position) — with no fallback of any kind —
 * copies its steps, and advances. All in one transaction; a refusal writes
 * nothing and leaves the request a DRAFT.
 *
 * A request returned for revision is RESUBMITTED by the same call
 * (REQ-REQUEST-018, D2) — see `resubmit`.
 */
async function submit(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  assertSubmittable(principal, await requests.getVisible(id, principal, { models }));

  await withTransaction(
    async (transaction) => {
      const request = await lockRequest(id, principal, { models, transaction });
      assertSubmittable(principal, request);

      if (submission.isResubmission(request)) {
        await resubmit(request, principal, { models, transaction });
        return;
      }

      // E9, F8, eligibility and `DEC-F` — the same checks the detail lists as
      // `submitBlockers`, refused here on the first, as they always were. The
      // definition is read under SHARE: a publish of the same key waits for
      // this transaction, or has finished.
      const { blockers, definition } = await submission.evaluate(request, {
        models,
        transaction,
        lockDefinition: true,
      });
      if (blockers.length > 0) throw submission.errorFor(blockers[0]);

      const definitionSteps = await models.WorkflowDefinitionStep.findAll({
        where: { definitionId: definition.id },
        order: [['sequence', 'ASC']],
        transaction,
      });

      // The snapshot (`BR-029`). One create per step, so each is audited.
      const steps = [];
      for (const source of definitionSteps) {
        steps.push(
          await models.RequestStep.create(
            {
              requestId: request.id,
              sequence: source.sequence,
              stepType: source.stepType,
              actorPositionCode: source.actorPositionCode,
              procurementMode: source.procurementMode ?? null,
              skipIfRequesterIsActor: source.skipIfRequesterIsActor,
              state: 'PENDING',
            },
            { transaction }
          )
        );
      }

      const now = new Date();
      await request.update(
        {
          status: 'SUBMITTED',
          workflowDefinitionId: definition.id,
          submittedAt: now,
          updatedBy: principal.userId,
        },
        { transaction }
      );

      await advance(request, steps, { models, transaction, now });
    },
    { sequelize }
  );

  return requests.detail(id, principal, { models });
}

/**
 * Resubmission after revision — REQ-REQUEST-018, in `submit`'s transaction,
 * under the request's row lock.
 *
 * The approval chain restarts from its first decision on the SAME FROZEN
 * snapshot: the newest cycle's own rows are copied into the next cycle — never
 * the workflow definition, which is not read at all, so a version published or
 * retired since changes nothing (`DEC-K`). Every new row starts PENDING; no
 * earlier decision carries forward, and the earlier cycle stays exactly as it
 * was decided. `advance` then opens the first decision only, as at submission.
 *
 * The same blockers as a submission apply, apart from the workflow lookup.
 * `workflow_definition_id` and `submitted_at` (the first submission, D7) are not
 * touched; when this cycle began is its rows' `created_at`.
 */
async function resubmit(request, principal, { models, transaction }) {
  const { blockers } = await submission.evaluate(request, { models, transaction });
  if (blockers.length > 0) throw submission.errorFor(blockers[0]);

  const previous = await stepsOf(request.id, { models, transaction });
  const cycle = previous[0].cycle + 1;
  const now = new Date();

  // One create per step, so each is audited.
  const steps = [];
  for (const source of previous) {
    steps.push(
      await models.RequestStep.create(
        {
          requestId: request.id,
          cycle,
          sequence: source.sequence,
          stepType: source.stepType,
          actorPositionCode: source.actorPositionCode,
          procurementMode: source.procurementMode ?? null,
          skipIfRequesterIsActor: source.skipIfRequesterIsActor,
          state: 'PENDING',
          createdAt: now,
        },
        { transaction }
      )
    );
  }

  await request.update({ status: 'SUBMITTED', updatedBy: principal.userId }, { transaction });
  await advance(request, steps, { models, transaction, now });
}

function assertSubmittable(principal, request) {
  if (request.requesterUserId !== principal.userId) {
    throw new ForbiddenError('Only the requester can submit this request', [
      { issue: 'a request is submitted by the person who made it' },
    ]);
  }
  if (!EDITABLE_REQUEST_STATUSES.includes(request.status)) {
    throw new ConflictError('Only a draft or a request returned for revision can be submitted', [
      { field: 'status', issue: `this request is ${request.status}` },
    ]);
  }
}

// --- Acting on a step ---------------------------------------------------------

/**
 * Loads a step, its request (visible to the caller, row-locked) and all its
 * steps; checks the step is ACTIVE and of `type`; checks the caller is its
 * resolved actor. Returns what the action needs.
 */
async function lockStepForAction(stepId, type, principal, { models, transaction }) {
  const found = await models.RequestStep.findByPk(stepId, { transaction });
  if (!found) throw new NotFoundError('Request step not found');

  let request;
  try {
    request = await lockRequest(found.requestId, principal, { models, transaction });
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError('Request step not found');
    throw error;
  }

  const steps = await stepsOf(request.id, { models, transaction });
  const step = steps.find((s) => s.id === stepId);
  // A step of an earlier cycle (REQ-REQUEST-018) is history: never open again.
  if (!step) {
    throw new ConflictError('This step is not open', [
      {
        field: 'state',
        issue: `step ${found.sequence} is ${found.state} in an earlier approval cycle`,
      },
    ]);
  }

  if (step.stepType !== type) {
    throw new ConflictError(`This is not a ${type} step`, [
      { field: 'stepType', issue: `step ${step.sequence} is ${step.stepType}` },
    ]);
  }
  if (step.state !== 'ACTIVE') {
    throw new ConflictError('This step is not open', [
      { field: 'state', issue: `step ${step.sequence} is ${step.state}` },
    ]);
  }

  const assignment = await actorAssignmentFor(principal.userId, step, request, {
    models,
    transaction,
  });
  if (!assignment) {
    throw new ForbiddenError('You are not the actor of this step', [
      {
        issue: `not the actor of this step: it belongs to the current holder of ${step.actorPositionCode} for this request (CR-014 DEC-J)`,
      },
    ]);
  }

  return { request, steps, step, assignment };
}

/**
 * `POST /request-steps/:id/decide` — REQ-REQUEST-008. APPROVE advances the
 * request (and, on the last decision, opens the fulfilment steps atomically,
 * G4). REJECT needs a comment and ends the request (F10).
 *
 * REQUEST_REVISION (REQ-REQUEST-018) needs a reason (the comment) and may carry
 * one note per item: the step becomes RETURNED, the rest of its cycle CLOSED,
 * and the request REVISION_REQUESTED — editable by its requester, who
 * resubmits it. Only an ACTIVE decision of a SUBMITTED request can be returned:
 * never once it is APPROVED, so never after acquisition or registration began.
 */
async function decide(stepId, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  const comment = body.comment?.trim() || null;
  if (body.decision === 'REJECT' && !comment) {
    throw new ValidationError('A rejection needs a comment', [
      { field: 'comment', issue: 'is required to reject' },
    ]);
  }
  if (body.decision === 'REQUEST_REVISION' && !comment) {
    throw new ValidationError('A revision request needs a reason', [
      {
        field: 'comment',
        issue: 'is required to request a revision: say what must change and why',
      },
    ]);
  }
  const itemNotes = body.itemNotes ?? [];
  if (itemNotes.length > 0 && body.decision !== 'REQUEST_REVISION') {
    throw new ValidationError('Item notes belong to a revision request', [
      { field: 'itemNotes', issue: 'may be given only with the decision REQUEST_REVISION' },
    ]);
  }
  const noted = itemNotes.map((entry) => entry.requestItemId);
  if (new Set(noted).size !== noted.length) {
    throw new ValidationError('An item is noted more than once', [
      { field: 'itemNotes', issue: 'each request item may have one note' },
    ]);
  }

  const requestId = await withTransaction(
    async (transaction) => {
      const { request, steps, step, assignment } = await lockStepForAction(
        stepId,
        'DECIDE',
        principal,
        { models, transaction }
      );
      const now = new Date();
      const acted = {
        actedByUserId: principal.userId,
        actedAsAssignmentId: assignment.id,
        comment,
        completedAt: now,
      };

      if (body.decision === 'REJECT') {
        await step.update({ state: 'REJECTED', ...acted }, { transaction });
        await request.update(
          { status: 'REJECTED', closedAt: now, updatedBy: principal.userId },
          { transaction }
        );
        await closeOpenSteps(steps, { transaction, now });
      } else if (body.decision === 'REQUEST_REVISION') {
        await returnForRevision(request, steps, step, acted, itemNotes, principal, {
          models,
          transaction,
          now,
        });
      } else {
        await step.update({ state: 'APPROVED', ...acted }, { transaction });
        await advance(request, steps, { models, transaction, now });
      }
      return request.id;
    },
    { sequelize }
  );

  return requests.detail(requestId, principal, { models });
}

/**
 * REQUEST_REVISION, in `decide`'s transaction under the request's row lock.
 *
 * The hard boundary: the request is SUBMITTED. An ACTIVE decision implies it
 * (G4 — PROCURE and REGISTER open only once every decision is made), and it is
 * asserted, together with "nothing registered", so no path can ever return a
 * request whose acquisition or registration has begun.
 *
 * Each item note snapshots the item's line and description, so it stays
 * readable if the requester edits, renumbers or deletes that item.
 */
async function returnForRevision(
  request,
  steps,
  step,
  acted,
  itemNotes,
  principal,
  { models, transaction, now }
) {
  if (request.status !== 'SUBMITTED') {
    throw new ConflictError('Only a request in approval can be returned for revision', [
      { field: 'status', issue: `this request is ${request.status}` },
    ]);
  }
  if (await requests.hasRegistration(request.id, { models, transaction })) {
    throw new ConflictError('Units have already been registered against this request', [
      { field: 'status', issue: 'a request with registered units cannot be returned for revision' },
    ]);
  }

  const items = itemNotes.length
    ? await models.RequestItem.findAll({
        where: { id: itemNotes.map((entry) => entry.requestItemId), requestId: request.id },
        transaction,
      })
    : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const unknown = itemNotes.filter((entry) => !byId.has(entry.requestItemId));
  if (unknown.length > 0) {
    throw new ValidationError('A noted item is not part of this request', [
      ...unknown.map((entry) => ({
        field: 'itemNotes',
        issue: `${entry.requestItemId}: not an item of this request`,
      })),
    ]);
  }

  await step.update({ state: 'RETURNED', ...acted }, { transaction });
  for (const entry of itemNotes) {
    const item = byId.get(entry.requestItemId);
    await models.RequestStepItemNote.create(
      {
        requestStepId: step.id,
        requestItemId: item.id,
        lineNo: item.lineNo,
        itemDescription: item.description,
        note: entry.note.trim(),
      },
      { transaction }
    );
  }
  // The rest of this cycle never runs: CLOSED, never DONE (F10).
  await closeOpenSteps(steps, { transaction, now });
  await request.update(
    { status: 'REVISION_REQUESTED', updatedBy: principal.userId },
    { transaction }
  );
}

/**
 * `POST /request-steps/:id/complete` — REQ-REQUEST-009, `BR-031`. The PROCURE
 * actor declares acquisition finished ("Procurement completed" / "Acquisition
 * completed"). This sets THAT step DONE and nothing else: REGISTER stays open,
 * the request stays APPROVED, and nothing is registered or received.
 */
async function complete(stepId, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);

  const requestId = await withTransaction(
    async (transaction) => {
      const { request, step, assignment } = await lockStepForAction(stepId, 'PROCURE', principal, {
        models,
        transaction,
      });
      await step.update(
        {
          state: 'DONE',
          actedByUserId: principal.userId,
          actedAsAssignmentId: assignment.id,
          comment: body.note?.trim() || null,
          completedAt: new Date(),
        },
        { transaction }
      );
      return request.id;
    },
    { sequelize }
  );

  return requests.detail(requestId, principal, { models });
}

// --- Cancel / discard ---------------------------------------------------------

/**
 * `POST /requests/:id/cancel {reason}` — REQ-REQUEST-013, `CR-014` §5.5, §10.2.
 *
 *   own DRAFT          discard (F3): CANCELLED, no workflow, no steps
 *   own SUBMITTED      the requester may cancel — likewise REVISION_REQUESTED,
 *                      for the requester or with oversight (REQ-REQUEST-018, D3)
 *   own APPROVED       NOT by the requester alone (F4) — oversight required
 *   anyone's SUBMITTED / APPROVED, with `request:oversee`, before any unit is
 *                      registered. Once any unit is linked (Phase 40, scenario
 *                      6d) cancel answers `409` for everyone; closing the
 *                      remainder is Phase 41 (D9).
 *
 * The reason is required (F5). Unfinished steps become CLOSED (F10).
 */
async function cancel(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  const reason = body.reason?.trim();
  if (!reason) {
    throw new ValidationError('A reason is required', [
      { field: 'reason', issue: 'is required to cancel or discard' },
    ]);
  }
  assertCancellable(principal, await requests.getVisible(id, principal, { models }));
  await assertNothingRegistered(id, { models });

  await withTransaction(
    async (transaction) => {
      const request = await lockRequest(id, principal, { models, transaction });
      assertCancellable(principal, request);
      await assertNothingRegistered(request.id, { models, transaction });

      const now = new Date();
      await request.update(
        { status: 'CANCELLED', closedAt: now, closeReason: reason, updatedBy: principal.userId },
        { transaction }
      );
      await closeOpenSteps(await stepsOf(request.id, { models, transaction }), {
        transaction,
        now,
      });
    },
    { sequelize }
  );

  return requests.detail(id, principal, { models });
}

function assertCancellable(principal, request) {
  const own = request.requesterUserId === principal.userId;
  const overseer = hasPermission(principal, 'request:oversee');

  if (TERMINAL_REQUEST_STATUSES.includes(request.status)) {
    throw new ConflictError('This request has already ended', [
      { field: 'status', issue: `this request is ${request.status}` },
    ]);
  }

  if (request.status === 'DRAFT') {
    // Only the requester sees a DRAFT (E1), so `own` always holds here.
    if (own) return;
  } else if (['SUBMITTED', 'REVISION_REQUESTED'].includes(request.status)) {
    // A request returned for revision cancels as a SUBMITTED one (D3).
    if (own || overseer) return;
  } else if (request.status === 'APPROVED') {
    // Any registered unit is refused separately (`assertNothingRegistered`).
    if (overseer) return;
    throw new ForbiddenError('After approval only oversight can cancel', [
      {
        issue: own
          ? 'a requester cannot cancel their own approved request; ask someone with oversight (F4)'
          : 'cancelling another user’s request needs request:oversee',
      },
    ]);
  } else {
    throw new ConflictError('This request can no longer be cancelled', [
      { field: 'status', issue: `this request is ${request.status}` },
    ]);
  }

  throw new ForbiddenError('You cannot cancel this request', [
    { issue: 'cancelling another user’s request needs request:oversee' },
  ]);
}

/** Scenario 6d (Phase 40, D9): a request with any linked unit cannot be cancelled. */
async function assertNothingRegistered(requestId, { models, transaction }) {
  // §73: stock issued against a line is handed over too — close the remainder.
  if (await requests.hasIssue(requestId, { models, transaction })) {
    throw new ConflictError('Consumables have already been issued against this request', [
      {
        field: 'status',
        issue: 'a request with issued consumables cannot be cancelled; close the remainder instead',
      },
    ]);
  }
  if (!(await requests.hasRegistration(requestId, { models, transaction }))) return;
  throw new ConflictError('Units have already been registered against this request', [
    {
      field: 'status',
      issue:
        'a request with registered units cannot be cancelled; closing the remainder arrives with Phase 41',
    },
  ]);
}

module.exports = { submit, decide, complete, cancel, advance, closeOpenSteps };
