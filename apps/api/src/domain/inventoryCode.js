'use strict';

/**
 * Asset unit inventory codes — Phase 18 (`CR-001`), REQ-UNIT-007/008, `BR-020`.
 * Generalised to configurable formats by Phase 25 (`CR-006`).
 *
 * The printable identity of a unit. Its SHAPE belongs to the institution and is
 * resolved by `inventoryCodeFormat.js`; this module owns the number that goes on
 * the end of it, and nothing else. An institution that has configured no format
 * gets `{institution code}-{registration year}-{sequence}` — `ALM-1-2026-00042`.
 *
 * Three properties the rest of the system depends on:
 *
 *   ALLOCATED, NOT CHOSEN.  Callers never supply one (REQ-UNIT-007). Allocation
 *   runs under an advisory lock so two concurrent registrations into the same
 *   pool cannot mint the same code. The partial unique index is the backstop,
 *   not the mechanism.
 *
 *   STORED, NOT DERIVED.  Once written it is never recomputed (`BR-020`,
 *   REQ-UNIT-008). Recomputing would bind every printed label to the
 *   institution's CURRENT code and CURRENT format, so a rename — or a
 *   redesign — would silently invalidate labels already stuck to physical items.
 *
 *   UNIQUE BY CONSTRUCTION.  See `allocateCodes`.
 *
 * A unit whose asset has no institution has no code. `asset_units` carries no
 * `institution_id` of its own and `assets.institution_id` is nullable, so there
 * is no institution, therefore no format, and nothing to build one from; the
 * column stays NULL rather than taking a placeholder that would then be frozen
 * onto a label. That is distinct from a configured token having no value, which
 * refuses the registration outright (`inventoryCodeFormat.buildPrefix`).
 */

/** The minimum sequence width. Five digits is 99,999 registrations per pool. */
const SEQUENCE_WIDTH = 5;

/**
 * The characters an institution code — and every other VALUE carried into a
 * code — may use: the RFC 3986 unreserved set, minus the tilde. Mirrors
 * `chk_institutions_code_url_safe`.
 *
 * `CR-008` did NOT widen this. The slash it admits is a separator an
 * administrator types into a format, validated the moment it is stored; these
 * are values on records maintained by many people over years, which flow into
 * filters, sort keys and screens an inventory code never reaches. Widening the
 * separators was the decision asked for; widening every code in the system was
 * not.
 */
const URL_SAFE_CODE = /^[A-Za-z0-9._-]+$/;

/**
 * A whole inventory code. Deliberately loose about where the boundaries fall —
 * the institution segment may itself contain hyphens (`ALM-1`), and under a
 * configurable format the boundaries are wherever the institution put them. The
 * code is looked up whole, never parsed back into its parts.
 *
 * Admits `/` as of `CR-008`, so a code may read `027/1234/BID.1/2026`. That is
 * why the code is no longer carried in a URL PATH segment: `/u?c=…` and
 * `/asset-units/by-code?code=…` carry it in a query value, where a slash
 * survives percent-encoding on every server and proxy (REQ-UNIT-011). The older
 * path routes remain for the labels already printed onto them.
 */
const INVENTORY_CODE = /^[A-Za-z0-9._/-]+$/;

/**
 * Phase 25 (`CR-006`) widened this from 40. The width is the token registry's
 * worst case, not a guess, and `validateFormat` refuses a format that could
 * exceed it — see `inventoryCodeFormat.js`. Mirrors `VARCHAR(64)`, and also
 * caps the `by-code` route parameter, so every code that can be minted can be
 * scanned.
 */
const MAX_LENGTH = 64;

/** @param {string} code */
const isUrlSafeInstitutionCode = (code) => URL_SAFE_CODE.test(String(code ?? ''));

/** @param {string} code */
const isWellFormed = (code) =>
  typeof code === 'string' && code.length > 0 && code.length <= MAX_LENGTH && INVENTORY_CODE.test(code);

/**
 * Puts the number on the end of the prefix. Pure — the allocation query decides
 * `sequence`, and `inventoryCodeFormat.buildPrefix` decides `prefix`.
 *
 * Widens rather than truncating past the padding: a truncated sequence would
 * collide with a code already issued, and the padding is a minimum rather than
 * a ceiling.
 *
 * @param {string} prefix
 * @param {number} sequence
 */
function formatCode(prefix, sequence) {
  return `${prefix}${String(sequence).padStart(SEQUENCE_WIDTH, '0')}`;
}

/**
 * Serializes allocation within one pool.
 *
 * A transaction-scoped advisory lock: it releases on commit or rollback with no
 * unlock call to forget, and it blocks only the pool being written to, so
 * registrations that cannot collide never wait on each other.
 *
 * KEYED ON THE PREFIX, not on the institution and year. Under a configurable
 * format the prefix IS the pool — two institutions whose formats render the
 * same leading text share one, and one institution's classifications may split
 * into several. A key naming the institution would serialize registrations that
 * cannot collide while leaving ones that can unprotected.
 */
async function lockForAllocation(sequelize, prefix, transaction) {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext($1))', {
    bind: [`inventory-code:${prefix}`],
    transaction,
    type: sequelize.QueryTypes.SELECT,
  });
}

/**
 * Allocates the next `count` codes for one prefix.
 *
 * Returns an array so the procurement path, which registers `unitCount` units in
 * one call, takes one lock and one scan rather than N of each. Every unit in
 * such a batch shares an asset, department, institution and year, so they share
 * a prefix by construction.
 *
 * The next sequence is read from the existing codes rather than from a counter
 * table: there is no second source of truth to drift, and deleted units leave
 * gaps, which is correct — reusing a gap would issue a code a printed label may
 * still carry.
 *
 * THIS IS ALSO WHAT MAKES A FORMAT CHANGE SAFE (`BR-020`). Every generated code
 * is this prefix followed by digits, so any code already stored that could
 * collide with a future one necessarily matches the pattern below and is seen by
 * the scan, which allocates strictly above it. An institution that configures a
 * format reproducing an earlier shape therefore continues past the codes issued
 * under it rather than restarting into them. The `LIKE` pre-filter only ever
 * over-matches — `_` is a wildcard and does occur in institution codes, `%`
 * cannot occur at all — so it can never hide a row from the scan.
 *
 * @param {{prefix: string, count?: number}} params
 * @returns {Promise<string[]>}
 */
async function allocateCodes({ prefix, count = 1 }, { sequelize, transaction }) {
  await lockForAllocation(sequelize, prefix, transaction);

  // `substring(...)::bigint` rather than a plain max on the text: '00010' sorts
  // below '00009' as text only by luck of padding, and the padding is exactly
  // what a sequence outgrowing five digits breaks. `bigint` rather than `int`
  // because a long digit run in a matching row would overflow the narrower cast
  // and fail the allocation rather than being ignored.
  const [row] = await sequelize.query(
    `
    SELECT COALESCE(MAX(substring(inventory_code FROM $2)::bigint), 0) AS highest
      FROM public.asset_units
     WHERE inventory_code LIKE $1 || '%'
    `,
    {
      bind: [prefix, `^${escapeRegex(prefix)}(\\d+)$`],
      transaction,
      type: sequelize.QueryTypes.SELECT,
    }
  );

  const highest = Number(row?.highest ?? 0);

  return Array.from({ length: count }, (_, index) => formatCode(prefix, highest + index + 1));
}

/** Escapes a literal for use inside a POSIX regular expression. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The year a code is stamped with — the year of registration, which is always
 * available, unlike an acquisition date the schema does not record.
 */
const registrationYear = (at = new Date()) => (at ?? new Date()).getFullYear();

module.exports = {
  SEQUENCE_WIDTH,
  MAX_LENGTH,
  URL_SAFE_CODE,
  INVENTORY_CODE,
  allocateCodes,
  formatCode,
  isWellFormed,
  isUrlSafeInstitutionCode,
  registrationYear,
  lockForAllocation,
};
