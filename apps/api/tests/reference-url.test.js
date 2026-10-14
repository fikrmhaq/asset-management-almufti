import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  REFERENCE_URL_MAX_LENGTH,
  REFERENCE_URL_MESSAGES,
  normalizeReferenceUrl,
} = require('../src/domain/referenceUrl.js');
const { createItem, updateItem } = require('../src/modules/requests/schemas.js');

/**
 * Request item reference URL — REQ-REQUEST-019. The helper alone, then the two
 * write schemas that use it (`POST /requests/:id/items`, `PATCH
 * /request-items/:id`), which share `itemFields`.
 */

const accepted = (input) => {
  const result = normalizeReferenceUrl(input);
  expect(result.ok).toBe(true);
  return result.value;
};
const reason = (input) => {
  const result = normalizeReferenceUrl(input);
  expect(result.ok).toBe(false);
  return result.reason;
};

describe('none (REQ-REQUEST-019)', () => {
  it.each([[null], [undefined], [''], ['   '], ['\t\n ']])('%j → null', (input) => {
    expect(accepted(input)).toBeNull();
  });
});

describe('accepted and normalized', () => {
  it.each([
    ['http://example.com/product/laptop', 'http://example.com/product/laptop'],
    ['https://example.com/product/laptop', 'https://example.com/product/laptop'],
    ['https://example.com', 'https://example.com/'],
    ['  https://example.com/p  ', 'https://example.com/p'],
    ['HTTPS://Example.COM/Path', 'https://example.com/Path'],
    ['https://example.com:443/a/../b', 'https://example.com/b'],
    ['http://localhost:3000/x', 'http://localhost:3000/x'],
    ['http://192.168.1.10/p', 'http://192.168.1.10/p'],
    ['http://10.0.0.1:8080/', 'http://10.0.0.1:8080/'],
    ['http://[::1]:8080/', 'http://[::1]:8080/'],
    [
      'https://shop.example/p?id=7&color=hitam#spec',
      'https://shop.example/p?id=7&color=hitam#spec',
    ],
    ['https://bücher.example/kat', 'https://xn--bcher-kva.example/kat'],
    [
      'https://toko.example/barang/Proyektor%20Epson',
      'https://toko.example/barang/Proyektor%20Epson',
    ],
    ['https://a.example/@handle', 'https://a.example/@handle'],
    // A backslash ends the authority, as in a browser: the host is example.com.
    ['https://example.com\\@evil.example/', 'https://example.com/@evil.example/'],
  ])('%s → %s', (input, expected) => {
    expect(accepted(input)).toBe(expected);
  });
});

describe('unsupported schemes', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://files.example.com/a',
    'mailto:someone@example.com',
    'vbscript:msgbox(1)',
    '//example.com/protocol-relative',
    'http:example.com',
    'http:/example.com',
    'https:\\\\example.com',
    'example.com',
    'www.example.com/p',
  ])('%s', (input) => {
    expect(reason(input)).toBe('scheme');
  });
});

describe('whitespace and control characters inside', () => {
  it.each([
    'https://exa mple.com',
    'https://example.com/a b',
    'https://example.com/\tx',
    'https://example.com/\nx',
    'https://exam\u0000ple.com',
    'https://example.com/\u007f',
    'https://example.com/\u0085',
    'https://example.com/a\u00a0b',
    'java\nscript:alert(1)',
  ])('%j', (input) => {
    expect(reason(input)).toBe('whitespace');
  });
});

describe('embedded credentials', () => {
  it.each([
    'https://user:secret@example.com/',
    'https://user@example.com/',
    'https://@example.com/',
    'https://example.com@evil.example/',
  ])('%s', (input) => {
    expect(reason(input)).toBe('credentials');
  });
});

describe('malformed, or without a meaningful host', () => {
  it.each(['http://', 'https://', 'https://[::1', 'https://example.com:99999/', 'http://xn--/'])(
    '%s is malformed',
    (input) => {
      expect(reason(input)).toBe('malformed');
    }
  );

  it.each(['http://./', 'http://../', 'https://.../p'])('%s has no host', (input) => {
    expect(reason(input)).toBe('host');
  });

  it('refuses a value that is not text', () => {
    expect(reason(42)).toBe('type');
    expect(reason({ href: 'https://example.com' })).toBe('type');
  });
});

describe('length — of the normalized form', () => {
  const base = 'https://example.com/';

  it('accepts exactly 2048 characters and refuses 2049', () => {
    expect(accepted(base + 'a'.repeat(REFERENCE_URL_MAX_LENGTH - base.length))).toHaveLength(2048);
    expect(reason(base + 'a'.repeat(REFERENCE_URL_MAX_LENGTH - base.length + 1))).toBe('tooLong');
  });

  it('measures after normalization: percent-encoding can push a value over', () => {
    // 2,040 raw characters; each space-free "ä" becomes six once encoded.
    expect(reason(base + 'ä'.repeat(400))).toBe('tooLong');
  });
});

describe('every reason has a message', () => {
  it('names each', () => {
    for (const key of [
      'type',
      'whitespace',
      'scheme',
      'credentials',
      'malformed',
      'host',
      'tooLong',
    ]) {
      expect(REFERENCE_URL_MESSAGES[key]).toEqual(expect.any(String));
    }
  });
});

describe('both item write schemas (POST and PATCH share itemFields)', () => {
  const base = { description: 'Laptop', quantityRequested: 1 };

  it('leaves the field out when it is not sent', () => {
    expect(createItem.parse(base)).not.toHaveProperty('referenceUrl');
    expect(updateItem.parse({ description: 'x' })).not.toHaveProperty('referenceUrl');
  });

  it('normalizes on both paths', () => {
    expect(createItem.parse({ ...base, referenceUrl: ' HTTPS://Example.com ' }).referenceUrl).toBe(
      'https://example.com/'
    );
    expect(updateItem.parse({ referenceUrl: 'http://example.com/x' }).referenceUrl).toBe(
      'http://example.com/x'
    );
  });

  it('turns null and blank into null — clearing on PATCH', () => {
    expect(createItem.parse({ ...base, referenceUrl: '' }).referenceUrl).toBeNull();
    expect(updateItem.parse({ referenceUrl: null }).referenceUrl).toBeNull();
    expect(updateItem.parse({ referenceUrl: '   ' }).referenceUrl).toBeNull();
  });

  it('refuses an unsafe value on both paths, with the field named', () => {
    for (const schema of [createItem, updateItem]) {
      const result = schema.safeParse({ ...base, referenceUrl: 'javascript:alert(1)' });
      expect(result.success).toBe(false);
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['referenceUrl'], message: REFERENCE_URL_MESSAGES.scheme }),
      ]);
    }
    expect(updateItem.safeParse({ referenceUrl: 5 }).success).toBe(false);
  });
});
