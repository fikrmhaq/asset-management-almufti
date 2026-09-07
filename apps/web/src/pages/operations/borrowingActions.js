/**
 * Borrowing action visibility — `DEC-046`, `IMPLEMENTATION_PLAN.md` §20.4.
 *
 * A mirror of `TRANSITIONS` in the backend's `domain/borrowingLifecycle.js`,
 * which is itself the diagram in `03-domain.md` §7.2. It exists for ONE reason:
 * §20.4 requires that invalid actions are not displayed, and deciding that needs
 * the transition table.
 *
 * It validates nothing and blocks nothing. The server re-checks every transition
 * and answers `CONFLICT` when it disagrees, which is surfaced like any other
 * error — so the backend remains the authority (§32) and this table can only
 * ever hide a button, never permit an operation.
 *
 * `OVERDUE` appears as a target of no action: it is written by the Phase 8 sweep
 * (§14.3), never by a user. `RETURNED` and `CANCELLED` are terminal.
 */

/** Adjacency exactly as drawn in `03-domain.md` §7.2. */
export const TRANSITIONS = Object.freeze({
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['RETURNED', 'OVERDUE'],
  OVERDUE: ['RETURNED'],
  RETURNED: [],
  CANCELLED: [],
});

/** Statuses in which the record may still be edited — `06-api.md` §7.2. */
export const EDITABLE_STATUSES = Object.freeze(['DRAFT']);

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Whether the header and the item list may still be changed (`DEC-012`). */
export function isEditable(status) {
  return EDITABLE_STATUSES.includes(status);
}

/**
 * The actions offered for a status, each with the permission that authorizes it.
 *
 * `extend` shares `RETURNED` as its target with `return`, because it closes the
 * record the same way before opening a new DRAFT (`DEC-015`) — so it is offered
 * wherever a return is.
 */
export function availableActions(status) {
  const actions = [];

  if (canTransition(status, 'ACTIVE')) {
    actions.push({ key: 'activate', label: 'Activate', permission: 'borrowing:activate' });
  }
  if (canTransition(status, 'CANCELLED')) {
    actions.push({ key: 'cancel', label: 'Cancel', permission: 'borrowing:cancel' });
  }
  if (canTransition(status, 'RETURNED')) {
    actions.push({ key: 'return', label: 'Record return', permission: 'borrowing:return' });
    actions.push({ key: 'extend', label: 'Extend', permission: 'borrowing:extend' });
  }

  return actions;
}
