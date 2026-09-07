import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  SEQUENCE_WIDTH,
  MAX_LENGTH,
  formatCode,
  isWellFormed,
  isUrlSafeInstitutionCode,
  registrationYear,
  allocateCodes,
} = require('../src/domain/inventoryCode.js');

/**
 * Inventory code allocation — Phase 18 (`CR-001`), generalised by Phase 25
 * (`CR-006`). REQ-UNIT-007/008, `BR-020`.
 *
 * This module now owns only the NUMBER on the end of a code; the shape in front
 * of it belongs to `inventoryCodeFormat.js` and is tested there. The pure rules
 * are tested here; the database suite covers allocation against real rows and
 * real concurrency.
 */

/** A sequelize double returning one canned `MAX(...)` row. */
function fakeSequelize(highest) {
  const calls = [];
  return {
    calls,
    QueryTypes: { SELECT: 'SELECT' },
    query: async (sql, options) => {
      calls.push({ sql, bind: options?.bind });
      if (sql.includes('pg_advisory_xact_lock')) return [];
      return [{ highest }];
    },
  };
}

describe('code assembly (REQ-UNIT-007)', () => {
  it('puts the padded sequence on the end of the prefix', () => {
    expect(formatCode('ALM-1-2026-', 42)).toBe('ALM-1-2026-00042');
  });

  it('pads to a fixed width so codes sort and align on a printed sheet', () => {
    expect(formatCode('ALM-1-2026-', 1)).toBe('ALM-1-2026-00001');
    expect(String(SEQUENCE_WIDTH)).toBe('5');
  });

  it('does not truncate a sequence that outgrows the padding', () => {
    // 99,999 registrations in one pool is beyond the padding, and silently
    // wrapping would collide with a code already issued.
    expect(formatCode('ALM-1-2026-', 100000)).toBe('ALM-1-2026-100000');
  });

  it('tolerates a prefix that itself contains hyphens', () => {
    // The code is looked up whole and never parsed back into parts, which is
    // what makes `ALM-1` safe as a segment.
    expect(formatCode('ALM-1-2026-', 7)).toBe('ALM-1-2026-00007');
    expect(isWellFormed(formatCode('ALM-1-2026-', 7))).toBe(true);
  });

  it('works with a prefix from any configured format, not only the default', () => {
    // `CR-006`: the prefix is whatever the institution's format rendered.
    expect(formatCode('INV-202010500200.TKJ.', 3)).toBe('INV-202010500200.TKJ.00003');
  });

  it('stamps the registration year, which is always known', () => {
    expect(registrationYear(new Date('2026-08-19T00:00:00Z'))).toBe(2026);
  });
});

describe('URL safety (REQ-ORG-002, REQ-UNIT-011)', () => {
  it.each(['ALM-1', 'SMKN1', 'dinas.pendidikan', 'a_b-c.1'])('accepts %s', (code) => {
    expect(isUrlSafeInstitutionCode(code)).toBe(true);
  });

  it.each([
    ['SMK N/1', 'a slash would split the path segment'],
    ['SMK 1', 'a space needs encoding'],
    ['SMK#1', 'a fragment marker truncates the address'],
    ['SMK?1', 'a query marker truncates the address'],
    ['', 'empty'],
  ])('rejects %s — %s', (code) => {
    expect(isUrlSafeInstitutionCode(code)).toBe(false);
  });

  it('rejects a code longer than the column allows', () => {
    expect(isWellFormed('A'.repeat(MAX_LENGTH))).toBe(true);
    expect(isWellFormed('A'.repeat(MAX_LENGTH + 1))).toBe(false);
  });

  it('allows 64 characters, the width a configurable format can reach', () => {
    // `CR-006` widened this from 40. A format is refused at save time unless its
    // worst case fits, so every code that can be minted can also be scanned.
    expect(MAX_LENGTH).toBe(64);
  });
});

describe('allocation (REQ-UNIT-007)', () => {
  const prefix = 'ALM-1-2026-';

  it('starts at one when nothing has been registered into this pool', async () => {
    const sequelize = fakeSequelize(0);

    expect(await allocateCodes({ prefix }, { sequelize, transaction: {} })).toEqual([
      'ALM-1-2026-00001',
    ]);
  });

  it('continues from the highest code already issued', async () => {
    const sequelize = fakeSequelize(41);

    expect(await allocateCodes({ prefix }, { sequelize, transaction: {} })).toEqual([
      'ALM-1-2026-00042',
    ]);
  });

  it('allocates a contiguous run for a batch, in one pass', async () => {
    const sequelize = fakeSequelize(10);

    const codes = await allocateCodes({ prefix, count: 3 }, { sequelize, transaction: {} });

    expect(codes).toEqual(['ALM-1-2026-00011', 'ALM-1-2026-00012', 'ALM-1-2026-00013']);
    // One lock and one scan for the whole batch, not three of each.
    expect(sequelize.calls.filter((c) => c.sql.includes('pg_advisory_xact_lock'))).toHaveLength(1);
    expect(sequelize.calls.filter((c) => c.sql.includes('MAX('))).toHaveLength(1);
  });

  it('takes the advisory lock before reading the highest code', async () => {
    const sequelize = fakeSequelize(0);

    await allocateCodes({ prefix }, { sequelize, transaction: {} });

    // Reading first would let two concurrent registrations see the same highest.
    expect(sequelize.calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(sequelize.calls[1].sql).toContain('MAX(');
  });

  it('keys the lock on the prefix, so unrelated pools do not wait', async () => {
    // `CR-006`: the prefix IS the pool. Keying on the institution would
    // serialize registrations that cannot collide, and — worse — leave ones
    // that can share a prefix unprotected.
    const sequelize = fakeSequelize(0);

    await allocateCodes({ prefix }, { sequelize, transaction: {} });

    expect(sequelize.calls[0].bind[0]).toBe('inventory-code:ALM-1-2026-');
  });

  it('scans exactly the codes sharing this prefix', async () => {
    const sequelize = fakeSequelize(0);

    await allocateCodes({ prefix }, { sequelize, transaction: {} });

    expect(sequelize.calls[1].bind[0]).toBe(prefix);
    // Anchored, digits-only, to the end: every generated code is this prefix
    // followed by digits, so any code that could collide is necessarily matched
    // and seen (`BR-020`).
    expect(sequelize.calls[1].bind[1]).toBe('^ALM-1-2026-(\\d+)$');
  });

  it('escapes regex metacharacters in the prefix', async () => {
    // A classification code is dotted, and `.` matches anything unescaped —
    // which would pull other pools' codes into this one's scan.
    const sequelize = fakeSequelize(0);

    await allocateCodes({ prefix: 'A.B-' }, { sequelize, transaction: {} });

    // The dot is escaped; the hyphen needs no escaping outside a character class.
    expect(sequelize.calls[1].bind[1]).toBe('^A\\.B-(\\d+)$');
  });

  it('casts to bigint, so a long digit run cannot overflow the scan', async () => {
    const sequelize = fakeSequelize(0);

    await allocateCodes({ prefix }, { sequelize, transaction: {} });

    expect(sequelize.calls[1].sql).toContain('::bigint');
  });
});
