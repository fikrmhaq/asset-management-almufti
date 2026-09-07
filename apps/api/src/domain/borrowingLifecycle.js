'use strict';

/**
 * Borrowing status state machine — `03-domain.md` §7.2, REQ-BORROW-007.
 *
 * Distinct from the asset-unit lifecycle (`lifecycle.js`): this governs the
 * borrowing EVENT, while that one governs the physical item. Activating a
 * borrowing drives both — the event becomes ACTIVE and each borrowed unit moves
 * to BORROWED — which is why they are kept as two machines rather than one.
 *
 * `RETURNED` and `CANCELLED` are terminal: the diagram takes both to `[*]`.
 * A completed borrowing is never reopened, because its dates must survive
 * unchanged (REQ-BORROW-015, DR-011); continued use is a NEW borrowing
 * (REQ-BORROW-014).
 */

const { ConflictError } = require('../errors');

/** Adjacency exactly as drawn in `03-domain.md` §7.2. */
const TRANSITIONS = Object.freeze({
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['RETURNED', 'OVERDUE'],
  OVERDUE: ['RETURNED'],
  RETURNED: [],
  CANCELLED: [],
});

/** Statuses in which a borrowing is holding its units — `BR-003`, `DR-005`. */
const HOLDING_STATUSES = Object.freeze(['ACTIVE', 'OVERDUE']);

/** Statuses that may still be edited — `06-api.md` §7.2. */
const EDITABLE_STATUSES = Object.freeze(['DRAFT']);

function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * @throws {ConflictError} `06-api.md` §1.4 maps an invalid state transition to
 *   `CONFLICT`: the request is well formed, it is the record's current status
 *   that makes the action impossible.
 */
function assertTransition(from, to) {
  if (canTransition(from, to)) return;

  const allowed = TRANSITIONS[from] ?? [];

  throw new ConflictError(`A borrowing in ${from} cannot move to ${to}`, [
    {
      field: 'status',
      issue: allowed.length
        ? `from ${from} the allowed next states are: ${allowed.join(', ')}`
        : `${from} is a terminal state`,
    },
  ]);
}

/** @throws {ConflictError} when the borrowing is past the point of editing. */
function assertEditable(status) {
  if (EDITABLE_STATUSES.includes(status)) return;

  throw new ConflictError(`A borrowing in ${status} can no longer be edited`, [
    { field: 'status', issue: `only ${EDITABLE_STATUSES.join(', ')} borrowings are editable` },
  ]);
}

module.exports = {
  TRANSITIONS,
  HOLDING_STATUSES,
  EDITABLE_STATUSES,
  canTransition,
  assertTransition,
  assertEditable,
};
