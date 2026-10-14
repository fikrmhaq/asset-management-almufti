'use strict';

/**
 * Request item reference URL — REQ-REQUEST-019 (`IMPLEMENTATION_PLAN.md` §66).
 *
 * One optional external link per Request Item: a product page the requester
 * points at. Informational only — the system never fetches, previews or checks
 * it, so there is no network access here and no host allow-list. localhost,
 * private addresses, ports, query strings, fragments and internationalized
 * domains are all accepted when the URL parser accepts them.
 *
 * Order matters. The RAW string is checked first — WHATWG parsing silently
 * strips tabs and newlines, turns `\` into `/` and repairs `http:host`, so a
 * check after `new URL()` would accept what the person never typed:
 *
 *   1. trim; blank → none (NULL)
 *   2. no whitespace or control character anywhere inside
 *   3. literally `http://` or `https://` — refuses javascript:, data:, file:,
 *      ftp:, mailto:, protocol-relative `//host` and `http:host`
 *   4. no `user@` / `user:password@` in the authority
 *   5. `new URL()` — refuses malformed addresses
 *   6. the protocol again, then credentials and a meaningful host on the result
 *   7. the NORMALIZED form (`href`) is what is stored, at most 2,048 characters
 *
 * The web client mirrors these rules (`apps/web/src/lib/referenceUrl.js`) so
 * that a stored value it cannot vouch for is never rendered as a link.
 */

const REFERENCE_URL_MAX_LENGTH = 2048;

/** Bounds the parser's work; the stored limit applies to the normalized form. */
const RAW_MAX_LENGTH = 8192;

// eslint-disable-next-line no-control-regex
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f]/u;
const HTTP_PREFIX = /^https?:\/\//i;
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/** English messages, as the API reports every other field issue. */
const REFERENCE_URL_MESSAGES = Object.freeze({
  type: 'must be a web address',
  whitespace: 'must not contain spaces or control characters',
  scheme: 'must start with http:// or https://',
  credentials: 'must not contain a user name or password',
  malformed: 'must be a valid web address',
  host: 'must name a website',
  tooLong: `must be at most ${REFERENCE_URL_MAX_LENGTH} characters`,
});

const fail = (reason) => ({ ok: false, reason });

/** The authority as typed: after `//`, up to the first `/`, `\`, `?` or `#`. */
function rawAuthority(raw) {
  return raw.slice(raw.indexOf('//') + 2).split(/[/\\?#]/)[0];
}

/**
 * `{ ok: true, value }` — the normalized URL, or `null` for none — or
 * `{ ok: false, reason }` with a key of `REFERENCE_URL_MESSAGES`.
 */
function normalizeReferenceUrl(input) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'string') return fail('type');

  const raw = input.trim();
  if (raw === '') return { ok: true, value: null };
  if (raw.length > RAW_MAX_LENGTH) return fail('tooLong');
  if (WHITESPACE_OR_CONTROL.test(raw)) return fail('whitespace');
  if (!HTTP_PREFIX.test(raw)) return fail('scheme');
  if (rawAuthority(raw).includes('@')) return fail('credentials');

  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail('malformed');
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) return fail('scheme');
  if (url.username !== '' || url.password !== '') return fail('credentials');
  if (url.hostname.replace(/\./g, '') === '') return fail('host');
  if (url.href.length > REFERENCE_URL_MAX_LENGTH) return fail('tooLong');

  return { ok: true, value: url.href };
}

module.exports = {
  REFERENCE_URL_MAX_LENGTH,
  REFERENCE_URL_MESSAGES,
  normalizeReferenceUrl,
};
