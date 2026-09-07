'use strict';

/**
 * Free text made safe for an identifier — Phase 26 (`CR-007`), `BR-027`.
 *
 * An inventory code may carry a classification label: text written for people,
 * in a catalog of 14,739 externally-sourced names, going into a permanent string
 * that travels in a URL path and gets printed on a sticker.
 *
 * TWO OUTCOMES, NEVER THREE. Text is either transformed deterministically into
 * the identifier alphabet, or refused. It is never truncated to fit, and
 * characters are never silently dropped:
 *
 *   Truncating is lossy on a label that outlives the record, and collapses
 *   classifications sharing a prefix onto one string.
 *
 *   Dropping produces a plausible-looking permanent identifier that quietly
 *   omits information — the worst of the three, because nothing looks wrong.
 *
 * ALLOWLIST, NOT DENYLIST (`BR-027`). Only the punctuation named below becomes a
 * separator; anything else refuses. A denylist fails open the first time an
 * unforeseen character appears, and against real reference data that is a
 * certainty rather than a risk — the live catalog contains `#`, `?`, `[` and `>`
 * in five leaf names, two of them plainly data-entry slips (`Inde[endent`,
 * `Jaring?harnes`). Those must not become codes.
 *
 * LENGTH IS NOT DECIDED HERE. How much room a value has depends on the format it
 * is going into, not on the text, so the caller applies the budget. This module
 * answers only "can this be represented at all, and as what".
 */

/** The identifier alphabet — the same class `institutions.code` is held to. */
const URL_SAFE = /^[A-Za-z0-9._-]+$/;

/**
 * Punctuation that becomes a separator, chosen from what the real catalog
 * contains: `()` in 1045 names, `..` in 907, `/` in 637, `,` in 112, `&` in 67,
 * `+` in 62, `:` in 40. Whitespace joins them — a space between words is a
 * separator by any reading.
 *
 * `-`, `.` and `_` are deliberately absent: they are already in the alphabet and
 * survive as themselves.
 */
const SEPARATORS = /[\s/,&+:();]+/g;

/** Runs of the separator character, after substitution. */
const REPEATED = /_+/g;
const EDGES = /^_+|_+$/g;

/**
 * @typedef {object} NormalizedText
 * @property {string|null} value the identifier-safe form, or `null` if refused
 * @property {'empty'|'unrepresentable'|null} reason why it was refused
 * @property {string} [offending] the characters that could not be represented
 */

/**
 * Transforms free text into the identifier alphabet.
 *
 * @param {unknown} text
 * @returns {NormalizedText}
 */
function normalize(text) {
  if (typeof text !== 'string') return { value: null, reason: 'empty' };

  const trimmed = text.trim();
  if (trimmed.length === 0) return { value: null, reason: 'empty' };

  const value = trimmed
    .toUpperCase()
    .replace(SEPARATORS, '_')
    .replace(REPEATED, '_')
    .replace(EDGES, '');

  // Reachable from text that is nothing but separators — `"( , )"`.
  if (value.length === 0) return { value: null, reason: 'empty' };

  if (!URL_SAFE.test(value)) {
    // Named individually so the error can say WHICH character is the problem;
    // "contains unsupported characters" leaves the reader hunting.
    const offending = [...new Set(value.replace(/[A-Za-z0-9._-]/g, ''))].join('');
    return { value: null, reason: 'unrepresentable', offending };
  }

  return { value, reason: null };
}

/**
 * Whether a value a PERSON typed may be used as-is.
 *
 * Validated, never transformed (`BR-027`). A number composition is written by
 * someone who means exactly what they wrote: rewriting `001/02` into `001_02`
 * would silently issue a permanent code they did not ask for, so an unusable
 * character is an error to report back.
 *
 * @param {unknown} value
 */
const isSafe = (value) => typeof value === 'string' && URL_SAFE.test(value);

module.exports = { URL_SAFE, SEPARATORS, normalize, isSafe };
