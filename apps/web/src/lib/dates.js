import { format, isValid, parseISO } from 'date-fns';

import { dateLocale } from '@/i18n';

/**
 * Date conversion — `IMPLEMENTATION_PLAN.md` §15.
 *
 * Every date this application exchanges with the API is a SQL `DATE`
 * (`contract_date`, `borrow_date`, `transaction_date`), carried as a
 * `YYYY-MM-DD` string. Serializing a JS `Date` instead would attach a time and a
 * zone the column cannot hold, and would shift the day for anyone east or west
 * of UTC — the same reasoning the API applies by declaring those columns
 * `DATEONLY`.
 *
 * `Date` objects therefore exist only inside the calendar widget. These two
 * functions are the boundary.
 */

/** `YYYY-MM-DD` → `Date`. Parsed at local noon, so no zone can shift the day. */
export function toDate(value) {
  if (!value) return undefined;
  const parsed = parseISO(`${value}T12:00:00`);
  return isValid(parsed) ? parsed : undefined;
}

/** `Date` → `YYYY-MM-DD`, or `null` for anything unparseable. */
export function toIsoDate(date) {
  return date && isValid(date) ? format(date, 'yyyy-MM-dd') : null;
}

/**
 * A stored `YYYY-MM-DD` rendered for display, in the active language.
 *
 * The PATTERN is fixed and the LOCALE is not: `d MMM yyyy` keeps the day-first
 * order Indonesian and British English both use, while the locale supplies the
 * month name (`Mar` / `Mar`, `May` / `Mei`). Changing the pattern per language
 * would change which number is the day, which is exactly the ambiguity a written
 * month name exists to avoid.
 */
export function formatDate(value, pattern = 'd MMM yyyy') {
  const parsed = toDate(value);
  return parsed ? format(parsed, pattern, { locale: dateLocale() }) : '';
}

/**
 * A full ISO TIMESTAMP rendered for display, in the active language.
 *
 * Separate from `formatDate` because the two take different kinds of value and
 * must treat zones oppositely. A SQL `DATE` is a calendar day with no instant
 * attached, so `toDate` pins it to local noon and no zone can shift it. A
 * timestamp — `created_at`, an audit entry's `timestamp`, a history row — IS an
 * instant, and pinning it would move it. Passing one to the other silently
 * produces an invalid date, so they stay two functions.
 */
export function formatDateTime(value, pattern = 'd MMM yyyy, HH:mm') {
  if (!value) return '';
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, pattern, { locale: dateLocale() }) : '';
}
