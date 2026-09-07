import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  DEFAULT_BUSINESS_TIMEZONE,
  offsetMinutesAt,
  parseMonth,
  formatMonth,
  currentBusinessMonth,
  monthBounds,
  resolveMonth,
} = require('../src/domain/businessMonth.js');

/**
 * The business month — `CR-012` `DEC-L`, REQ-COND-006, TC-COND-006.
 *
 * The zone is passed explicitly throughout rather than read from the
 * environment: these are assertions about the arithmetic, and a suite that
 * depended on the deployment's configured zone would pass or fail for the wrong
 * reason.
 *
 * `Asia/Jakarta` is UTC+7 with no daylight saving, so its month starts at
 * 17:00Z on the last day of the preceding month. Those literals below are the
 * whole point of the module and are written out rather than computed.
 */

const JKT = 'Asia/Jakarta';

describe('businessMonth (CR-012 DEC-L)', () => {
  it('defaults to Asia/Jakarta', () => {
    expect(DEFAULT_BUSINESS_TIMEZONE).toBe('Asia/Jakarta');
  });

  describe('parseMonth', () => {
    it('parses YYYY-MM into a zero-based month', () => {
      expect(parseMonth('2026-08')).toEqual({ year: 2026, month: 7 });
      expect(parseMonth('2026-01')).toEqual({ year: 2026, month: 0 });
      expect(parseMonth('2026-12')).toEqual({ year: 2026, month: 11 });
    });

    it('tolerates surrounding whitespace', () => {
      expect(parseMonth('  2026-08 ')).toEqual({ year: 2026, month: 7 });
    });

    it.each(['2026-13', '2026-00', '2026-8', '26-08', '2026', '2026-08-01', '', null, undefined])(
      'rejects %p',
      (value) => {
        expect(parseMonth(value)).toBeNull();
      }
    );

    it('round-trips through formatMonth', () => {
      for (const value of ['2026-01', '2026-08', '2026-12']) {
        expect(formatMonth(parseMonth(value))).toBe(value);
      }
    });
  });

  describe('monthBounds', () => {
    it('starts a Jakarta month at 17:00Z on the last day of the previous one', () => {
      const { start, end } = monthBounds(2026, 7, JKT);

      expect(start.toISOString()).toBe('2026-07-31T17:00:00.000Z');
      expect(end.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    });

    it('rolls December into the next January', () => {
      const { start, end } = monthBounds(2026, 11, JKT);

      expect(start.toISOString()).toBe('2026-11-30T17:00:00.000Z');
      expect(end.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    });

    it('handles February in a leap year', () => {
      const { start, end } = monthBounds(2028, 1, JKT);

      expect(start.toISOString()).toBe('2028-01-31T17:00:00.000Z');
      expect(end.toISOString()).toBe('2028-02-29T17:00:00.000Z');
    });

    it('one month ends exactly where the next begins', () => {
      expect(monthBounds(2026, 7, JKT).end.getTime()).toBe(
        monthBounds(2026, 8, JKT).start.getTime()
      );
    });

    it('produces UTC midnight boundaries when the zone is UTC', () => {
      const { start, end } = monthBounds(2026, 7, 'UTC');

      expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });
  });

  /**
   * The defect this module exists to fix.
   *
   * Under the UTC boundaries `monthWindow` uses, both instants below fall in
   * July — including the one a recorder in Jakarta experienced as the morning of
   * 1 August. A monthly compliance figure built that way is wrong for the first
   * seven hours of every month.
   */
  describe('the boundary case CR-012 exists for', () => {
    const august = monthBounds(2026, 7, JKT);
    const july = monthBounds(2026, 6, JKT);

    const inRange = ({ start, end }, iso) => {
      const at = new Date(iso);
      return at >= start && at < end;
    };

    it('files 00:30 WIB on 1 August into August', () => {
      // 2026-07-31T17:30:00Z
      expect(inRange(august, '2026-07-31T17:30:00Z')).toBe(true);
      expect(inRange(july, '2026-07-31T17:30:00Z')).toBe(false);
    });

    it('files 06:00 WIB on 1 August into August', () => {
      expect(inRange(august, '2026-07-31T23:00:00Z')).toBe(true);
    });

    it('files 23:30 WIB on 31 July into July', () => {
      // 2026-07-31T16:30:00Z
      expect(inRange(july, '2026-07-31T16:30:00Z')).toBe(true);
      expect(inRange(august, '2026-07-31T16:30:00Z')).toBe(false);
    });

    it('excludes the first instant of the next month', () => {
      expect(inRange(august, august.end.toISOString())).toBe(false);
    });

    it('includes the first instant of its own month', () => {
      expect(inRange(august, august.start.toISOString())).toBe(true);
    });
  });

  /**
   * Jakarta observes no daylight saving, so nothing above would catch a
   * fixed-offset shortcut. A zone that does is the only thing that separates
   * "reads the zone's rules" from "adds seven hours".
   *
   * Europe/London: UTC+0 in January, UTC+1 (BST) from late March.
   */
  describe('zones with daylight saving', () => {
    it('reads the offset that applies to the month being bounded', () => {
      expect(monthBounds(2026, 0, 'Europe/London').start.toISOString()).toBe(
        '2026-01-01T00:00:00.000Z'
      );
      expect(monthBounds(2026, 6, 'Europe/London').start.toISOString()).toBe(
        '2026-06-30T23:00:00.000Z'
      );
    });

    it('bounds the month a transition falls inside', () => {
      // BST begins 29 March 2026. March starts in GMT, April in BST.
      const march = monthBounds(2026, 2, 'Europe/London');

      expect(march.start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      expect(march.end.toISOString()).toBe('2026-03-31T23:00:00.000Z');
    });

    it('reports a different offset either side of a transition', () => {
      expect(offsetMinutesAt(new Date('2026-01-15T12:00:00Z'), 'Europe/London')).toBe(0);
      expect(offsetMinutesAt(new Date('2026-07-15T12:00:00Z'), 'Europe/London')).toBe(60);
    });

    it('reports a constant offset for Jakarta', () => {
      expect(offsetMinutesAt(new Date('2026-01-15T12:00:00Z'), JKT)).toBe(420);
      expect(offsetMinutesAt(new Date('2026-07-15T12:00:00Z'), JKT)).toBe(420);
    });
  });

  describe('currentBusinessMonth', () => {
    it('reports the local month, not the UTC one', () => {
      // 23:30Z on 31 July is already 06:30 on 1 August in Jakarta.
      expect(currentBusinessMonth(new Date('2026-07-31T23:30:00Z'), JKT)).toEqual({
        year: 2026,
        month: 7,
      });
      expect(currentBusinessMonth(new Date('2026-07-31T23:30:00Z'), 'UTC')).toEqual({
        year: 2026,
        month: 6,
      });
    });

    it('rolls the year over', () => {
      expect(currentBusinessMonth(new Date('2026-12-31T20:00:00Z'), JKT)).toEqual({
        year: 2027,
        month: 0,
      });
    });
  });

  describe('resolveMonth', () => {
    const now = new Date('2026-08-15T04:00:00Z');

    it('defaults to the current business month when no value is given', () => {
      for (const absent of [undefined, null, '']) {
        const { bounds, invalid } = resolveMonth(absent, { now, timeZone: JKT });

        expect(invalid).toBe(false);
        expect(formatMonth(bounds)).toBe('2026-08');
      }
    });

    it('uses the month supplied', () => {
      const { bounds, invalid } = resolveMonth('2026-03', { now, timeZone: JKT });

      expect(invalid).toBe(false);
      expect(formatMonth(bounds)).toBe('2026-03');
      expect(bounds.start.toISOString()).toBe('2026-02-28T17:00:00.000Z');
    });

    /**
     * A malformed value is distinguishable from an absent one, which is what
     * lets a route answer VALIDATION_ERROR for the first and apply a default for
     * the second — rather than silently reporting the wrong month.
     */
    it('flags a malformed value while still returning usable bounds', () => {
      const { bounds, invalid } = resolveMonth('2026-13', { now, timeZone: JKT });

      expect(invalid).toBe(true);
      expect(formatMonth(bounds)).toBe('2026-08');
    });
  });
});
