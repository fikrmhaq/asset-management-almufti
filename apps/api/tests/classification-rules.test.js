import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  ORIGIN,
  MAX_ORDINAL,
  isSecondToLastLevel,
  isAppDefined,
  prefixOf,
  ordinalOf,
  allocateChildCode,
  assertAppDefined,
  assertUnreferenced,
} = require('../src/domain/classificationRules.js');

/**
 * Classification domain rules — Phase 17 (`CR-001`), REQ-CLASS-011 through
 * REQ-CLASS-017, `BR-016`–`BR-019`.
 *
 * The pure rules are tested here against the real code scheme; the database
 * suite covers the endpoints end to end.
 */

/** A models double exposing only what the function under test reaches for. */
function fakeModels({ children = [], counts = {} } = {}) {
  return {
    AssetClassification: {
      findAll: async () => children.map((id) => ({ id })),
      count: async () => children.length,
    },
    Asset: { count: async () => counts.Asset ?? 0 },
    Location: { count: async () => counts.Location ?? 0 },
    AttributeDefinition: { count: async () => counts.AttributeDefinition ?? 0 },
  };
}

describe('code scheme (REQ-CLASS-013)', () => {
  it.each([
    ['132080141000', true, 'a second-to-last-level node'],
    ['117010101000', true, 'another one, in a different branch'],
    ['117010100000', false, 'one level higher — the objek group is still zero'],
    ['100000000000', false, 'the root'],
    ['132080141007', false, 'a leaf, which has no room beneath it'],
  ])('%s → %s (%s)', (code, expected) => {
    expect(isSecondToLastLevel(code)).toBe(expected);
  });

  it('rejects anything that is not twelve digits', () => {
    expect(isSecondToLastLevel('13208014100')).toBe(false);
    expect(isSecondToLastLevel('13208014100X')).toBe(false);
    expect(isSecondToLastLevel('')).toBe(false);
  });

  it('splits a code into the parent prefix and the leaf ordinal', () => {
    expect(prefixOf('132080141007')).toBe('132080141');
    expect(ordinalOf('132080141007')).toBe(7);
    expect(ordinalOf('132080141412')).toBe(412);
  });

  it('tolerates the blank padding CHAR(12) adds on read', () => {
    expect(prefixOf('132080141007  ')).toBe('132080141');
    expect(isSecondToLastLevel('132080141000 ')).toBe(true);
  });
});

describe('identifier allocation (REQ-CLASS-013)', () => {
  it('allocates downward from 999, clear of the government range', async () => {
    const models = fakeModels({ children: ['132080141001', '132080141002'] });

    expect(await allocateChildCode('132080141000', { models })).toBe('132080141999');
  });

  it('skips ordinals already taken, so a second addition does not collide', async () => {
    const models = fakeModels({ children: ['132080141999', '132080141998'] });

    expect(await allocateChildCode('132080141000', { models })).toBe('132080141997');
  });

  it('stays clear of the busiest real parent, which reaches 412', async () => {
    // 412 children, ordinals 1..412 — the densest branch in the seeded data.
    const children = Array.from({ length: 412 }, (_, i) =>
      `132080141${String(i + 1).padStart(3, '0')}`
    );

    const allocated = await allocateChildCode('132080141000', { models: fakeModels({ children }) });

    expect(allocated).toBe('132080141999');
    expect(ordinalOf(allocated)).toBeGreaterThan(412);
  });

  it('refuses once every ordinal beneath the parent is used', async () => {
    const children = Array.from({ length: MAX_ORDINAL }, (_, i) =>
      `132080141${String(i + 1).padStart(3, '0')}`
    );

    await expect(
      allocateChildCode('132080141000', { models: fakeModels({ children }) })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('provenance (BR-016)', () => {
  it('treats only origin 3 as application-defined', () => {
    expect(isAppDefined({ origin: ORIGIN.APP_DEFINED })).toBe(true);
    expect(isAppDefined({ origin: ORIGIN.GOVERNMENT })).toBe(false);
    expect(isAppDefined({ origin: ORIGIN.LEGACY_LOCAL })).toBe(false);
  });

  it('lets an application-defined node through', () => {
    expect(() => assertAppDefined({ origin: 3, name: 'Mesin Batik' }, 'renamed')).not.toThrow();
  });

  it.each([
    [1, /government-issued/],
    [2, /legacy system/],
  ])('refuses a node of origin %s, and says why rather than just refusing', (origin, expected) => {
    // The headline stays short; the reason belongs in the field detail, which is
    // what the form renders beside the offending input.
    let error = null;
    try {
      assertAppDefined({ origin, name: 'Whatever' }, 'renamed');
    } catch (thrown) {
      error = thrown;
    }

    expect(error).not.toBeNull();
    expect(error.status).toBe(400);
    expect(error.details[0].issue).toMatch(expected);
  });
});

describe('deletion integrity (BR-018)', () => {
  it('allows deletion when nothing references the classification', async () => {
    await expect(assertUnreferenced('132080141999', { models: fakeModels() })).resolves.toBeUndefined();
  });

  it.each([
    ['Asset', 'asset'],
    ['Location', 'location'],
    ['AttributeDefinition', 'attribute definition'],
  ])('blocks deletion while a %s references it, and names it', async (model, label) => {
    const models = fakeModels({ counts: { [model]: 3 } });

    const error = await assertUnreferenced('132080141999', { models }).catch((thrown) => thrown);

    expect(error.status).toBe(409);
    expect(error.details[0].issue).toMatch(new RegExp(`3 ${label}s`));
  });

  it('reports every blocking referent, not just the first', async () => {
    const models = fakeModels({ counts: { Asset: 1, AttributeDefinition: 2 } });

    const error = await assertUnreferenced('132080141999', { models }).catch((e) => e);

    expect(error.status).toBe(409);
    expect(error.details[0].issue).toMatch(/1 asset/);
    expect(error.details[0].issue).toMatch(/2 attribute definitions/);
  });
});
