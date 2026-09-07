'use strict';

/**
 * Asset unit lifecycle state machine — `03-domain.md` §7.1, DR-010.
 *
 * REQ-LIFE-002 requires transitions to be restricted to valid paths, and
 * REQ-VAL-005 requires an invalid one to be rejected rather than absorbed.
 *
 * `DISPOSED` and `DEACTIVATED` are terminal: the diagram takes both to `[*]`
 * with no outbound edge. A unit that reached end of life does not come back —
 * bringing it back would rewrite history that REQ-LIFE-006 requires preserved.
 */

const { ConflictError } = require('../errors');

/** Adjacency exactly as drawn in `03-domain.md` §7.1. */
const TRANSITIONS = Object.freeze({
  REGISTERED: ['ACTIVE'],
  ACTIVE: ['IN_STORAGE', 'BORROWED', 'UNDER_MAINTENANCE', 'DISPOSED', 'DEACTIVATED'],
  IN_STORAGE: ['ACTIVE', 'DISPOSED', 'DEACTIVATED'],
  BORROWED: ['ACTIVE'],
  UNDER_MAINTENANCE: ['ACTIVE', 'DISPOSED'],
  DISPOSED: [],
  DEACTIVATED: [],
});

const TERMINAL_STATES = Object.freeze(
  Object.entries(TRANSITIONS)
    .filter(([, next]) => next.length === 0)
    .map(([state]) => state)
);

function isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

/** Whether a transition is allowed. Staying put is always allowed. */
function canTransition(from, to) {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * @throws {ConflictError} `06-api.md` §5.2 requires an invalid transition to be
 *   rejected with `CONFLICT`, not `VALIDATION_ERROR`: the value is a legal
 *   lifecycle state, it is the current state that makes it unreachable.
 */
function assertTransition(from, to) {
  if (canTransition(from, to)) return;

  const allowed = TRANSITIONS[from] ?? [];

  throw new ConflictError(
    isTerminal(from)
      ? `An asset unit in ${from} has reached end of life and cannot change state`
      : `An asset unit cannot move from ${from} to ${to}`,
    [
      {
        field: 'lifecycleState',
        issue: allowed.length
          ? `from ${from} the allowed next states are: ${allowed.join(', ')}`
          : `${from} is a terminal state`,
      },
    ]
  );
}

module.exports = { TRANSITIONS, TERMINAL_STATES, isTerminal, canTransition, assertTransition };
