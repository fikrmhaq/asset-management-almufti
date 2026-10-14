'use strict';

/**
 * Request step states — `CR-014` §6.1, `03-domain.md` §6.11.
 *
 * THE AUTHORITATIVE LIST; migration 052's `chk_request_steps_state` is held to
 * it by `tests/database/32-request-workflow.test.js`.
 *
 *   PENDING   copied at submission, not yet reached
 *   ACTIVE    open: its actor may act
 *   APPROVED  a DECIDE step approved by its actor
 *   REJECTED  a DECIDE step rejected (with a comment) — ends the request
 *   RETURNED  a DECIDE step whose actor requested revision (with a reason) —
 *             the request goes back to its requester (migration 059,
 *             REQ-REQUEST-018); its cycle ends
 *   DONE    a PROCURE step declared complete by its actor; a REGISTER step
 *             once every item has links = required (Phase 40) — never reopened
 *   SKIPPED   an explicit self-skip (reason SELF), DECIDE only (decision F1)
 *   CLOSED    left unfinished when the request ended — never DONE (`BR-031`)
 */

const STEP_STATES = Object.freeze([
  'PENDING',
  'ACTIVE',
  'APPROVED',
  'REJECTED',
  'RETURNED',
  'DONE',
  'SKIPPED',
  'CLOSED',
]);

/** States a step never leaves. */
const FINISHED_STATES = Object.freeze([
  'APPROVED',
  'REJECTED',
  'RETURNED',
  'DONE',
  'SKIPPED',
  'CLOSED',
]);

/**
 * Request statuses the requester edits in: their DRAFT, and a request returned
 * to them for revision (REQ-REQUEST-018).
 */
const EDITABLE_REQUEST_STATUSES = Object.freeze(['DRAFT', 'REVISION_REQUESTED']);

/** Request statuses that end it: nothing changes afterwards. */
const TERMINAL_REQUEST_STATUSES = Object.freeze(['REJECTED', 'CANCELLED', 'CLOSED', 'FULFILLED']);

/** The permission each actionable step type requires (decision F6). */
const STEP_ACTION_PERMISSION = Object.freeze({
  DECIDE: 'request-step:decide',
  PROCURE: 'request-step:complete',
  // Phase 40: registering units against the request's items.
  REGISTER: 'request-item:register',
});

module.exports = {
  STEP_STATES,
  FINISHED_STATES,
  EDITABLE_REQUEST_STATUSES,
  TERMINAL_REQUEST_STATUSES,
  STEP_ACTION_PERMISSION,
};
