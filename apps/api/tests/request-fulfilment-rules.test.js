import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isReceivableUnit,
  itemFigures,
  closedCancellation,
  statusFor,
  businessDate,
  receivedOnRefusal,
} = require('../src/domain/requestFulfilmentRules.js');

/**
 * Fulfilment arithmetic — Phase 41 (`IMPLEMENTATION_PLAN.md` §60.3). Pure; the
 * API side is `tests/database/35-request-fulfilment`.
 */

const item = (requested, cancelled = 0) => ({
  quantityRequested: requested,
  quantityCancelled: cancelled,
});

describe('receivable units (D41-1 b)', () => {
  it('receives only an active unit that is not DISPOSED or DEACTIVATED', () => {
    expect(isReceivableUnit({ isActive: true, lifecycleState: 'REGISTERED' })).toBe(true);
    expect(isReceivableUnit({ isActive: true, lifecycleState: 'BORROWED' })).toBe(true);
    expect(isReceivableUnit({ isActive: false, lifecycleState: 'ACTIVE' })).toBe(false);
    expect(isReceivableUnit({ isActive: true, lifecycleState: 'DISPOSED' })).toBe(false);
    expect(isReceivableUnit({ isActive: true, lifecycleState: 'DEACTIVATED' })).toBe(false);
  });
});

describe('item figures and the three shortfalls', () => {
  it('keeps the worked example apart: 10 requested, 6 registered, 4 received', () => {
    const f = itemFigures(item(10), { registered: 6, received: 4, pending: 2, blocked: 0 });
    expect(f).toMatchObject({
      required: 10,
      notYetRegistered: 4,
      receiptNotRecorded: 2,
      notYetReceived: 6,
      cancellableByClose: 4,
      cancellableUnregistered: 4,
      cancellableBlocked: 0,
    });
  });

  it('shows blocked units as receipt not recorded, and as what a close would cancel', () => {
    const f = itemFigures(item(5), { registered: 5, received: 4, pending: 0, blocked: 1 });
    expect(f).toMatchObject({
      receiptNotRecorded: 1,
      notYetReceived: 1,
      cancellableByClose: 1,
      cancellableUnregistered: 0,
      cancellableBlocked: 1,
    });
  });
});

describe('closing the remainder: cancelled′ = requested − received − pending', () => {
  it('cancels the blocked unit: 5 / 5 registered / 4 received / 1 blocked', () => {
    expect(closedCancellation(item(5), { received: 4, pending: 0 })).toBe(1);
  });

  it('keeps pending units: 10 / 6 registered / 4 received / 2 pending', () => {
    expect(closedCancellation(item(10), { received: 4, pending: 2 })).toBe(4);
  });

  it('cancels everything when nothing was registered', () => {
    expect(closedCancellation(item(3), {})).toBe(3);
  });

  it('never lowers an existing cancellation', () => {
    // Required already 4 after a close; nothing changed since.
    expect(closedCancellation(item(5, 1), { received: 4, pending: 0 })).toBe(1);
    expect(
      itemFigures(item(5, 1), { registered: 5, received: 4, blocked: 1 }).cancellableByClose
    ).toBe(0);
  });

  it('cancels a unit disposed after an earlier close', () => {
    // 10 requested, closed to 6 (4 received + 2 pending); one pending is now blocked.
    expect(closedCancellation(item(10, 4), { received: 4, pending: 1 })).toBe(5);
  });
});

describe('status follows received only', () => {
  const f = (required, received, registered = received) => ({ required, received, registered });

  it('stays APPROVED until something is received, and PARTIALLY_FULFILLED after', () => {
    expect(statusFor([f(3, 0, 3)], 0)).toBe('APPROVED');
    expect(statusFor([f(3, 1, 3)], 0)).toBe('PARTIALLY_FULFILLED');
    expect(statusFor([f(2, 2), f(2, 0, 2)], 0)).toBe('PARTIALLY_FULFILLED');
  });

  it('is FULFILLED with nothing cancelled, CLOSED after a cancellation', () => {
    expect(statusFor([f(2, 2), f(3, 3)], 0)).toBe('FULFILLED');
    expect(statusFor([f(4, 4, 5)], 1)).toBe('CLOSED');
  });

  it('is CLOSED even with nothing received, once something was registered', () => {
    expect(statusFor([f(0, 0, 1)], 1)).toBe('CLOSED');
  });

  it('is CANCELLED only when nothing was ever registered', () => {
    expect(statusFor([f(0, 0, 0)], 3)).toBe('CANCELLED');
  });
});

describe('received_on (Q2b)', () => {
  const now = new Date('2026-09-25T20:00:00Z'); // 26 Sep 03:00 in Jakarta

  it('uses the business date, not UTC', () => {
    expect(businessDate(now, 'Asia/Jakarta')).toBe('2026-09-26');
  });

  it('refuses a future date and a date before the request was created', () => {
    const at = { requestCreatedAt: '2026-09-20T01:00:00Z', now, timeZone: 'Asia/Jakarta' };
    expect(receivedOnRefusal('2026-09-26', at)).toBeNull();
    expect(receivedOnRefusal('2026-09-20', at)).toBeNull();
    expect(receivedOnRefusal('2026-09-27', at)).toMatch(/future/);
    expect(receivedOnRefusal('2026-09-19', at)).toMatch(/before the request was created/);
  });
});

describe('receipt confirmation rules (migration 057)', () => {
  const {
    RECEIPT_PLACEMENTS,
    placementRefusal,
    photoCountRefusal,
    confirmationState,
  } = require('../src/domain/requestFulfilmentRules.js');
  const { receiveUnits } = require('../src/modules/requests/schemas.js');

  it('asks placement exactly when there is an intended place', () => {
    expect(RECEIPT_PLACEMENTS).toEqual(['AT_INTENDED_PLACE', 'NOT_AT_INTENDED_PLACE']);
    expect(placementRefusal('AT_INTENDED_PLACE', { hasDestination: true })).toBeNull();
    expect(placementRefusal(undefined, { hasDestination: true })).toMatch(/required/);
    expect(placementRefusal(undefined, { hasDestination: false })).toBeNull();
    expect(placementRefusal('NOT_AT_INTENDED_PLACE', { hasDestination: false })).toMatch(
      /not asked/
    );
  });

  it('needs one to five photos', () => {
    expect(photoCountRefusal(0)).toMatch(/at least 1/);
    expect(photoCountRefusal(1)).toBeNull();
    expect(photoCountRefusal(5)).toBeNull();
    expect(photoCountRefusal(6)).toMatch(/at most 5/);
  });

  it('is superseded only when every receipt is reversed', () => {
    expect(confirmationState([{ reversedAt: null }, { reversedAt: new Date() }])).toBe('ACTIVE');
    expect(confirmationState([{ reversedAt: new Date() }, { reversedAt: new Date() }])).toBe(
      'SUPERSEDED'
    );
  });

  it('reads the multipart form: one id as a list, "true" as all, and no note', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const base = { receivedOn: '2026-09-28', description: 'Diterima' };

    expect(receiveUnits.parse({ ...base, assetUnitIds: id }).assetUnitIds).toEqual([id]);
    expect(receiveUnits.parse({ ...base, all: 'true' }).all).toBe(true);
    expect(receiveUnits.safeParse({ ...base, all: 'false' }).success).toBe(false);
    expect(receiveUnits.safeParse({ ...base, all: 'true', note: 'x' }).success).toBe(false);
    expect(receiveUnits.safeParse({ receivedOn: '2026-09-28', all: 'true' }).success).toBe(false);
    expect(
      receiveUnits.safeParse({ ...base, all: 'true', placement: 'DI_LAB' }).success
    ).toBe(false);
  });
});
