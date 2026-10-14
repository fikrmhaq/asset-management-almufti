import { describe, it, expect } from 'vitest';

import { REFERENCE_URL_MAX_LENGTH, normalizeReferenceUrl, safeReferenceLink } from './referenceUrl';

/**
 * REQ-REQUEST-019 — the client's copy of the API's rules. The same cases as
 * `apps/api/tests/reference-url.test.js`, so the two cannot quietly drift.
 */

const value = (input) => normalizeReferenceUrl(input);

describe('normalizeReferenceUrl', () => {
  it.each([null, undefined, '', '   '])('%j is none', (input) => {
    expect(value(input)).toMatchObject({ ok: true, value: null });
  });

  it.each([
    ['http://example.com/product/laptop', 'http://example.com/product/laptop'],
    ['  HTTPS://Example.COM  ', 'https://example.com/'],
    ['http://localhost:3000/x', 'http://localhost:3000/x'],
    ['http://192.168.1.10/p', 'http://192.168.1.10/p'],
    ['https://shop.example/p?id=7#spec', 'https://shop.example/p?id=7#spec'],
    ['https://bücher.example/kat', 'https://xn--bcher-kva.example/kat'],
    ['https://example.com\\@evil.example/', 'https://example.com/@evil.example/'],
  ])('accepts %s as %s', (input, expected) => {
    expect(value(input)).toMatchObject({ ok: true, value: expected });
  });

  it.each([
    ['javascript:alert(1)', 'scheme'],
    ['JaVaScRiPt:alert(1)', 'scheme'],
    ['data:text/html,x', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['ftp://files.example/a', 'scheme'],
    ['mailto:a@example.com', 'scheme'],
    ['//example.com/a', 'scheme'],
    ['http:example.com', 'scheme'],
    ['https://exa mple.com', 'whitespace'],
    ['https://example.com/\tx', 'whitespace'],
    ['https://exam\u0000ple.com', 'whitespace'],
    ['https://user:pw@example.com/', 'credentials'],
    ['https://@example.com/', 'credentials'],
    ['https://', 'malformed'],
    ['https://example.com:99999/', 'malformed'],
    ['http://./', 'host'],
    [42, 'type'],
  ])('refuses %j (%s)', (input, reason) => {
    expect(value(input)).toEqual({ ok: false, reason });
  });

  it('limits the normalized form to 2048 characters', () => {
    const base = 'https://example.com/';
    expect(value(base + 'a'.repeat(REFERENCE_URL_MAX_LENGTH - base.length)).ok).toBe(true);
    expect(value(base + 'a'.repeat(REFERENCE_URL_MAX_LENGTH - base.length + 1))).toEqual({
      ok: false,
      reason: 'tooLong',
    });
  });
});

describe('safeReferenceLink', () => {
  it('gives the normalized href and the hostname', () => {
    expect(safeReferenceLink('https://Toko.Example:8443/p?q=1')).toEqual({
      href: 'https://toko.example:8443/p?q=1',
      host: 'toko.example',
    });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'https://u:p@x.example/',
    'nonsense',
    '',
    null,
  ])('never offers %j as a link', (input) => {
    expect(safeReferenceLink(input)).toBeNull();
  });
});
