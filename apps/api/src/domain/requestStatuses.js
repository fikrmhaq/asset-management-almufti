'use strict';

/**
 * Request statuses — `CR-014` §5.3, `03-domain.md` §6.10.
 *
 * THE AUTHORITATIVE LIST. Migration 051 writes the same values into
 * `chk_requests_status`, and `tests/database/31-requests.test.js` fails if the
 * two disagree (`CR-014` `DEC-U`).
 *
 * Phase 37 creates and edits DRAFTs only. Every other status is reached by a
 * later phase's action (submission and decisions in 38, receipt in 41).
 *
 * `REVISION_REQUESTED` (migration 059, REQ-REQUEST-018): an approver returned
 * the SUBMITTED request to its requester; it is editable by them, resubmitted
 * through the same submit action, and not terminal.
 */

const REQUEST_STATUSES = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'REVISION_REQUESTED',
  'APPROVED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'CLOSED',
  'REJECTED',
  'CANCELLED',
]);

module.exports = { REQUEST_STATUSES };
