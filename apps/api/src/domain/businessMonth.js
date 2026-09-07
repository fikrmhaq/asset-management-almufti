'use strict';

/**
 * The business calendar month — Phase 31 (`CR-012` `DEC-L`, `DEC-M`),
 * REQ-COND-006, `05-infrastructure.md` §7.5.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Nothing in this application had a timezone before now. Every month boundary
 * was built with `Date.UTC` (`modules/reports/service.js monthWindow`), and
 * every day boundary with a literal `Z` (`modules/auditLogs/service.js`).
 *
 * At UTC+7 that displaces a month by seven hours: an assessment recorded at
 * 06:00 WIB on 1 August is `2026-07-31T23:00Z` and files into July. For a
 * feature whose entire output is a monthly figure, that is a defect rather than
 * a rounding difference.
 *
 * ── The one rule that matters ──────────────────────────────────────────────
 *
 * `monthBounds` returns UTC INSTANTS, to be compared directly against the raw
 * `TIMESTAMPTZ` column:
 *
 *     created_at >= start AND created_at < end        -- half-open
 *
 * NEVER `WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date …`. Wrapping the
 * column in a function is non-sargable — it discards any index on it — and it
 * quietly changes the boundary semantics at the same time. The conversion
 * happens once, here, on two scalars.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 *
 * One application-wide zone (`DEC-M`). Nothing in the schema carries a
 * timezone, and adding one to `institutions` would touch that table, its API,
 * its form and every consumer of a month — a larger change than this feature
 * justifies. Per-institution is recorded as future work, not built.
 *
 * `CR-011`'s `monthWindow` is deliberately NOT migrated to this module. That
 * would change the `PERAWATAN` sheet's month boundaries, which is a visible
 * change to a printed deliverable and needs its own approval — `CR-012`
 * Appendix A.
 */

const { getConfig } = require('../config');

/** The zone every month in this module is expressed in, unless overridden. */
const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Jakarta';

/** `YYYY-MM`, the wire format for a month parameter. */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function businessTimeZone() {
  // Read lazily rather than at module load: the config throws on an invalid
  // environment, and importing this module must not be what surfaces that.
  return getConfig().businessTimeZone ?? DEFAULT_BUSINESS_TIMEZONE;
}

/**
 * The offset of `timeZone` from UTC at `instant`, in minutes.
 *
 * `Intl.DateTimeFormat` is the only offset source in Node that knows the zone's
 * historical and seasonal rules; Node 20 ships full ICU, and the API has no
 * date library to add one for. The formatted parts are read back as if they
 * were UTC, and the difference from the real instant is the offset.
 */
function offsetMinutesAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const at = {};
  for (const part of parts) at[part.type] = part.value;

  const asIfUtc = Date.UTC(
    Number(at.year),
    Number(at.month) - 1,
    Number(at.day),
    Number(at.hour),
    Number(at.minute),
    Number(at.second)
  );

  return (asIfUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

/**
 * The UTC instant at which a local wall-clock time occurs in `timeZone`.
 *
 * Two passes, and the second is not redundant. The offset depends on the
 * instant, and the instant is what is being solved for — so the first pass uses
 * the offset that applies at the naive guess, and the second re-reads it at the
 * corrected instant. That converges everywhere except inside a DST transition,
 * which is why the guard below exists.
 *
 * Jakarta has observed no daylight saving since 1964, so in this deployment the
 * second pass always agrees with the first. It is written generally anyway: a
 * fixed-offset shortcut would be an assumption nothing states and nothing
 * checks, and `businessTimeZone` is configurable.
 */
function utcInstantOfLocalTime({ year, month, day = 1 }, timeZone) {
  const naive = Date.UTC(year, month, day, 0, 0, 0);

  const firstPass = new Date(naive - offsetMinutesAt(new Date(naive), timeZone) * 60000);
  const secondPass = new Date(naive - offsetMinutesAt(firstPass, timeZone) * 60000);

  return secondPass;
}

/**
 * Parses a `YYYY-MM` month parameter.
 *
 * `month` is ZERO-BASED in the returned object, matching `Date` and
 * `monthWindow`'s existing convention, while the string is one-based like every
 * calendar. Getting that backwards is the obvious bug here, so the two never
 * share a name: the string is `value`, the number is `month`.
 *
 * @param {string} value
 * @returns {{year: number, month: number}|null} `null` when malformed — the
 *   caller decides whether that is a validation error or a default
 */
function parseMonth(value) {
  const match = MONTH_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;

  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

/** `{year, month}` formatted back as `YYYY-MM`. */
function formatMonth({ year, month }) {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * The business month `instant` falls in.
 *
 * @param {Date} [instant]
 * @param {string} [timeZone]
 * @returns {{year: number, month: number}}
 */
function currentBusinessMonth(instant = new Date(), timeZone = businessTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instant);

  const at = {};
  for (const part of parts) at[part.type] = part.value;

  return { year: Number(at.year), month: Number(at.month) - 1 };
}

/**
 * The half-open UTC interval covering one business month.
 *
 * `end` is the first instant of the NEXT month, not the last of this one, so a
 * comparison is `>= start AND < end` and no caller has to know month lengths or
 * worry about the millisecond between them. This matches the shape
 * `monthWindow` already uses for the maintenance sheet.
 *
 * @param {number} year
 * @param {number} month zero-based
 * @param {string} [timeZone]
 * @returns {{year: number, month: number, start: Date, end: Date, timeZone: string}}
 */
function monthBounds(year, month, timeZone = businessTimeZone()) {
  const start = utcInstantOfLocalTime({ year, month }, timeZone);
  // Month + 1 with no normalisation of its own: Date.UTC already rolls
  // December into the next January, which is exactly the wanted behaviour.
  const end = utcInstantOfLocalTime({ year, month: month + 1 }, timeZone);

  return { year, month, start, end, timeZone };
}

/**
 * `monthBounds` for a `YYYY-MM` parameter, defaulting to the current month.
 *
 * The single entry point a report should use: it accepts the parameter exactly
 * as it arrives, applies the default in one place, and reports a malformed
 * value distinguishably from an absent one.
 *
 * @param {string|undefined|null} value
 * @param {{now?: Date, timeZone?: string}} [options]
 * @returns {{bounds: object, invalid: boolean}} `invalid` is true only when a
 *   value was supplied and could not be parsed — an absent value is not an error
 */
function resolveMonth(value, { now = new Date(), timeZone = businessTimeZone() } = {}) {
  if (value === undefined || value === null || value === '') {
    const current = currentBusinessMonth(now, timeZone);
    return { bounds: monthBounds(current.year, current.month, timeZone), invalid: false };
  }

  const parsed = parseMonth(value);
  if (!parsed) {
    const current = currentBusinessMonth(now, timeZone);
    return { bounds: monthBounds(current.year, current.month, timeZone), invalid: true };
  }

  return { bounds: monthBounds(parsed.year, parsed.month, timeZone), invalid: false };
}

module.exports = {
  DEFAULT_BUSINESS_TIMEZONE,
  MONTH_PATTERN,
  businessTimeZone,
  offsetMinutesAt,
  parseMonth,
  formatMonth,
  currentBusinessMonth,
  monthBounds,
  resolveMonth,
};
