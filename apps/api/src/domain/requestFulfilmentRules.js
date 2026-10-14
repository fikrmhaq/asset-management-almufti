'use strict';

/**
 * Fulfilment arithmetic — Phase 41 (`IMPLEMENTATION_PLAN.md` §60.3), pure.
 *
 * Registration, receipt and fulfilment are three facts:
 *
 *   registered  links of an item (Phase 40, D4 — historical)
 *   received    links with an ACTIVE receipt
 *   pending     links without one whose unit can still be received
 *   blocked     links without one whose unit cannot (inactive, DISPOSED,
 *               DEACTIVATED — D41-1 b)
 *
 * registered = received + pending + blocked, always.
 *
 * Closing the remainder sets cancelled′ = requested − received − pending, so
 * that afterwards required = received + pending: it cancels what was never
 * registered AND what is blocked, and keeps what can still be received. A
 * Request can therefore always finish.
 *
 * The status follows received only — never registration, procurement,
 * location or lifecycle (`BR-031`).
 */

const { businessTimeZone } = require('./businessMonth');

/** Lifecycle states in which a registered unit can no longer be received. */
const UNRECEIVABLE_STATES = Object.freeze(['DISPOSED', 'DEACTIVATED']);

/** Statuses in which receipt, reversal and closing are allowed. */
const OPEN_FULFILMENT_STATUSES = Object.freeze(['APPROVED', 'PARTIALLY_FULFILLED']);

/** Whether a unit, as it is now, can be received (D41-1 b). */
function isReceivableUnit(unit) {
  return Boolean(unit?.isActive) && !UNRECEIVABLE_STATES.includes(unit?.lifecycleState);
}

/**
 * Every figure of one item.
 *
 * @param {{quantityRequested: number, quantityCancelled: number}} item
 * @param {{registered?: number, received?: number, pending?: number, blocked?: number}} [counts]
 */
function itemFigures(item, counts = {}) {
  const registered = counts.registered ?? 0;
  const received = counts.received ?? 0;
  const pending = counts.pending ?? 0;
  const blocked = counts.blocked ?? 0;
  const required = item.quantityRequested - item.quantityCancelled;
  const cancelledAfterClose = closedCancellation(item, { received, pending });
  const cancellable = cancelledAfterClose - item.quantityCancelled;
  const cancellableUnregistered = Math.min(Math.max(required - registered, 0), cancellable);

  return {
    required,
    registered,
    received,
    pending,
    blocked,
    notYetRegistered: Math.max(required - registered, 0),
    receiptNotRecorded: pending + blocked,
    notYetReceived: Math.max(required - received, 0),
    // What closing the remainder would cancel now, split by why.
    cancellableByClose: cancellable,
    cancellableUnregistered,
    cancellableBlocked: cancellable - cancellableUnregistered,
  };
}

/**
 * The item's cancelled quantity after a close. Never lower than today's: a
 * close only ever cancels more.
 */
function closedCancellation(item, { received = 0, pending = 0 } = {}) {
  const target = item.quantityRequested - received - pending;
  return Math.min(Math.max(target, item.quantityCancelled), item.quantityRequested);
}

/**
 * The Request status the figures call for (§60.3).
 *
 * @param {Array<{required: number, received: number, registered: number}>} figures
 * @param {number} totalCancelled
 */
function statusFor(figures, totalCancelled) {
  const totalReceived = figures.reduce((sum, f) => sum + f.received, 0);
  const anyRegistered = figures.some((f) => f.registered > 0);
  const complete = figures.every((f) => f.received >= f.required);

  if (!complete) return totalReceived > 0 ? 'PARTIALLY_FULFILLED' : 'APPROVED';
  if (totalCancelled === 0) return 'FULFILLED';
  return anyRegistered ? 'CLOSED' : 'CANCELLED';
}

/** Today's business date (Asia/Jakarta by default), as `YYYY-MM-DD`. */
function businessDate(instant = new Date(), timeZone = businessTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const at = {};
  for (const part of parts) at[part.type] = part.value;
  return `${at.year}-${at.month}-${at.day}`;
}

/**
 * Why `receivedOn` is not acceptable, or `null` (Q2b): not in the future, and
 * not before the Request was created — both business dates.
 */
function receivedOnRefusal(receivedOn, { requestCreatedAt, now = new Date(), timeZone } = {}) {
  const today = businessDate(now, timeZone);
  if (receivedOn > today) return `must not be in the future (today is ${today})`;
  const created = businessDate(new Date(requestCreatedAt), timeZone);
  if (receivedOn < created) return `must not be before the request was created (${created})`;
  return null;
}

// --- Receipt confirmation (migration 057) ------------------------------------

/**
 * Where the received units are, relative to the Request's intended place — the
 * requester's statement, not a verified fact. Asked only when the Request has
 * an intended place (`chk_rrc_destination`).
 */
const RECEIPT_PLACEMENTS = Object.freeze(['AT_INTENDED_PLACE', 'NOT_AT_INTENDED_PLACE']);

/** Photos with every confirmation: at least one, at most five. */
const CONFIRMATION_PHOTO_LIMITS = Object.freeze({ min: 1, max: 5 });

/**
 * `null` when acceptable, or the issue. With an intended place, placement is
 * required; without one it is not asked, and giving one is refused rather than
 * stored as a claim about nothing.
 */
function placementRefusal(placement, { hasDestination }) {
  if (hasDestination) {
    return placement ? null : 'is required: the request has an intended place';
  }
  return placement ? 'is not asked: the request has no intended place' : null;
}

/** `null` when acceptable, or the issue. */
function photoCountRefusal(count) {
  const { min, max } = CONFIRMATION_PHOTO_LIMITS;
  if (count < min) return `at least ${min} photo is required`;
  if (count > max) return `at most ${max} photos`;
  return null;
}

/**
 * ACTIVE while any of its receipts stands; SUPERSEDED once every one is
 * reversed. Derived, never stored.
 */
function confirmationState(receipts) {
  return receipts.some((receipt) => !receipt.reversedAt) ? 'ACTIVE' : 'SUPERSEDED';
}

module.exports = {
  RECEIPT_PLACEMENTS,
  CONFIRMATION_PHOTO_LIMITS,
  placementRefusal,
  photoCountRefusal,
  confirmationState,
  UNRECEIVABLE_STATES,
  OPEN_FULFILMENT_STATUSES,
  isReceivableUnit,
  itemFigures,
  closedCancellation,
  statusFor,
  businessDate,
  receivedOnRefusal,
};
