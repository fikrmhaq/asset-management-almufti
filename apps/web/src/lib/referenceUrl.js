/**
 * Request item reference URL — REQ-REQUEST-019.
 *
 * Mirrors the API's rules (`apps/api/src/domain/referenceUrl.js`) so the editor
 * can explain a refusal in the person's language before saving, and so a value
 * is rendered as a link only when it passes them. The server stays
 * authoritative; this never fetches anything.
 *
 * The RAW string is checked before `new URL()`, which would otherwise silently
 * strip tabs and newlines, turn `\` into `/` and repair `http:host`.
 */

export const REFERENCE_URL_MAX_LENGTH = 2048;

const RAW_MAX_LENGTH = 8192;
// eslint-disable-next-line no-control-regex
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f]/u;
const HTTP_PREFIX = /^https?:\/\//i;
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

const fail = (reason) => ({ ok: false, reason });

function rawAuthority(raw) {
  return raw.slice(raw.indexOf('//') + 2).split(/[/\\?#]/)[0];
}

/**
 * `{ ok: true, value, url }` — the normalized string (or `null` for none) and
 * its parsed URL — or `{ ok: false, reason }`, where `reason` is one of
 * type | whitespace | scheme | credentials | malformed | host | tooLong.
 */
export function normalizeReferenceUrl(input) {
  if (input === null || input === undefined) return { ok: true, value: null, url: null };
  if (typeof input !== 'string') return fail('type');

  const raw = input.trim();
  if (raw === '') return { ok: true, value: null, url: null };
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

  return { ok: true, value: url.href, url };
}

/**
 * What a stored value may be shown as: `{ href, host }` (the hostname, as
 * normalized — an internationalized domain in its `xn--` form) when it passes the
 * rules, otherwise `null` — the caller then shows it as plain text, never as a
 * link.
 */
export function safeReferenceLink(value) {
  const result = normalizeReferenceUrl(value);
  if (!result.ok || !result.url) return null;
  return { href: result.value, host: result.url.hostname };
}
