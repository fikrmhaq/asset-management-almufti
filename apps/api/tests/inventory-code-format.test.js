import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  TOKENS,
  DEFAULT_FORMAT,
  MAX_FORMAT_LENGTH,
  formatFor,
  isDefaultFormat,
  parseFormat,
  validateFormat,
  worstCaseLength,
  buildPrefix,
  renderParts,
  catalog,
  renderPreview,
} = require('../src/domain/inventoryCodeFormat.js');

const { MAX_LENGTH, formatCode } = require('../src/domain/inventoryCode.js');

/**
 * Institution-configurable inventory code formats — Phase 25 (`CR-006`),
 * REQ-ORG-007, REQ-UNIT-007, `BR-026`.
 *
 * The grammar, the registry and the rendering are pure, so they are tested
 * here. The database suite covers the endpoints, the authorization and real
 * concurrent allocation.
 */

const institution = { id: 'inst-1', code: 'ALM-1' };
const department = { id: 'dept-1', code: 'TKJ' };
const at = new Date('2026-08-27T00:00:00Z');

const context = {
  institution,
  department,
  classificationId: '202010500200',
  at,
};

/** Every rule that must hold for a format to be storable. */
const expectInvalid = (format) => expect(() => validateFormat(format)).toThrow();

/**
 * The reasons a call reported, joined.
 *
 * Errors here follow the convention the rest of the services use: a general
 * `message`, with what actually went wrong in `details[].issue` so a form can
 * map each one onto the field or chip that caused it. Asserting on `message`
 * would test the wrong half.
 */
function issuesFrom(run) {
  try {
    run();
  } catch (error) {
    if (!error.details) throw error;
    return error.details.map((detail) => detail.issue).join(' | ');
  }

  throw new Error('expected a ValidationError, but the call succeeded');
}

describe('the default format (backward compatibility)', () => {
  it('is what an institution with no configured format receives', () => {
    expect(formatFor({ code: 'ALM-1', inventoryCodeFormat: null })).toBe(DEFAULT_FORMAT);
    expect(formatFor({ code: 'ALM-1' })).toBe(DEFAULT_FORMAT);
    expect(isDefaultFormat({ inventoryCodeFormat: null })).toBe(true);
  });

  it('yields to a configured format once one is set', () => {
    const configured = { code: 'ALM-1', inventoryCodeFormat: '{INSTITUTION_CODE}-{SEQUENCE}' };

    expect(formatFor(configured)).toBe('{INSTITUTION_CODE}-{SEQUENCE}');
    expect(isDefaultFormat(configured)).toBe(false);
  });

  it('treats an empty stored format as unconfigured rather than as a format', () => {
    expect(formatFor({ inventoryCodeFormat: '' })).toBe(DEFAULT_FORMAT);
  });

  /**
   * THE BACKWARD-COMPATIBILITY TEST. Phase 18 produced `ALM-1-2026-00042`, and
   * an institution that never configures anything must keep producing exactly
   * that — byte for byte, not merely something similar.
   */
  it('renders byte-identically to what Phase 18 produced', () => {
    const prefix = buildPrefix(DEFAULT_FORMAT, context);

    expect(prefix).toBe('ALM-1-2026-');
    expect(formatCode(prefix, 42)).toBe('ALM-1-2026-00042');
  });
});

describe('grammar (REQ-ORG-007)', () => {
  it('splits a format into literals and tokens', () => {
    expect(parseFormat('INV-{INSTITUTION_CODE}.{SEQUENCE}').map((s) => [s.type, s.value])).toEqual([
      ['literal', 'INV-'],
      ['token', 'INSTITUTION_CODE'],
      ['literal', '.'],
      ['token', 'SEQUENCE'],
    ]);
  });

  it.each([
    ['{INSTITUTION_CODE-{SEQUENCE}', 'a "{" that is never closed'],
    ['INSTITUTION_CODE}-{SEQUENCE}', 'a closing brace with no opener'],
    ['{}{SEQUENCE}', 'an empty token'],
    ['{IN{STITUTION}-{SEQUENCE}', 'a nested brace'],
  ])('rejects %s — %s', (format) => {
    expectInvalid(format);
  });

  it('rejects a token the registry does not define', () => {
    // `BR-026`: an unknown identifier is an error, never an empty string, and
    // there is no path by which it could be evaluated as anything.
    expect(issuesFrom(() => validateFormat('{ASSET_NAME}-{SEQUENCE}'))).toMatch(
      /not a supported token/
    );
  });

  it.each([
    ['{INSTITUTION_CODE} {SEQUENCE}', 'a space needs encoding'],
    ['{INSTITUTION_CODE}#{SEQUENCE}', 'a fragment marker truncates the address'],
    ['{INSTITUTION_CODE}%{SEQUENCE}', 'a percent starts an escape'],
    ['{INSTITUTION_CODE}?{SEQUENCE}', 'a question mark starts the query string'],
    ['{INSTITUTION_CODE}&{SEQUENCE}', 'an ampersand separates query parameters'],
  ])('rejects the literal in %s — %s', (format) => {
    expect(issuesFrom(() => validateFormat(format))).toMatch(/unsafe in a web address/);
  });

  it('accepts the four supported separators and alphanumeric literals', () => {
    expect(() =>
      validateFormat('INV-{INSTITUTION_CODE}_{REGISTRATION_YEAR}.{SEQUENCE}')
    ).not.toThrow();
  });

  /**
   * `CR-008`. The slash is a SEPARATOR, and only that — the values the tokens
   * resolve to still cannot carry one, which the `buildPrefix` cases below
   * assert from the other side.
   */
  it('accepts a slash between tokens, which is what CR-008 exists for', () => {
    expect(() =>
      validateFormat('{NUMBER_COMPOSITION}/{CLASSIFICATION_CODE}/{REGISTRATION_YEAR}')
    ).not.toThrow();
  });

  it('rejects a format longer than the column holds', () => {
    expectInvalid(`${'A'.repeat(MAX_FORMAT_LENGTH)}{SEQUENCE}`);
  });

  it('rejects an empty format', () => {
    expectInvalid('');
    expectInvalid('   ');
  });
});

describe('the sequence rule (REQ-UNIT-007)', () => {
  it('requires a distinguishing segment, not specifically a sequence', () => {
    // `CR-007`: a sequence OR a number composition. This format has neither.
    expect(issuesFrom(() => validateFormat('{INSTITUTION_CODE}-{REGISTRATION_YEAR}'))).toMatch(
      /must contain \{SEQUENCE\} or \{NUMBER_COMPOSITION\}/
    );
  });

  it('allows a format with no sequence when a composition distinguishes the units', () => {
    expect(() => validateFormat('{NUMBER_COMPOSITION}-{REGISTRATION_YEAR}')).not.toThrow();
  });

  it('requires at most one sequence', () => {
    expect(issuesFrom(() => validateFormat('{SEQUENCE}-{SEQUENCE}'))).toMatch(/at most once/);
  });

  it('requires at most one composition', () => {
    expect(issuesFrom(() => validateFormat('{NUMBER_COMPOSITION}-{NUMBER_COMPOSITION}'))).toMatch(
      /at most once/
    );
  });

  it('allows both a composition and a sequence together', () => {
    // The supported answer for procurement batches: one typed value, and the
    // allocator distinguishes the units.
    expect(() =>
      validateFormat('{NUMBER_COMPOSITION}-{INSTITUTION_CODE}-{SEQUENCE}')
    ).not.toThrow();
  });

  it('requires it to be last, so a token may not follow it', () => {
    // Allocation reads the codes sharing everything BEFORE the number. A token
    // after it would put the reset period behind the digits that reset.
    expect(
      issuesFrom(() => validateFormat('{INSTITUTION_CODE}-{SEQUENCE}-{REGISTRATION_YEAR}'))
    ).toMatch(/must end with \{SEQUENCE\}/);
  });

  it('requires it to be last, so a literal may not follow it either', () => {
    expect(issuesFrom(() => validateFormat('{INSTITUTION_CODE}-{SEQUENCE}-X'))).toMatch(
      /must end with \{SEQUENCE\}/
    );
  });

  it('rejects a format that is nothing but a sequence', () => {
    expect(issuesFrom(() => validateFormat('{SEQUENCE}'))).toMatch(/besides the number/);
  });
});

describe('length ceiling (`BR-026`)', () => {
  it('sums token maxima and literal lengths', () => {
    // 25 + 1 + 4 + 1 + 8 (the sequence budget, wider than its padding)
    expect(worstCaseLength(parseFormat(DEFAULT_FORMAT))).toBe(39);
  });

  it('budgets the sequence above its padding, so growth cannot overflow', () => {
    const sequenceOnly = worstCaseLength(parseFormat('X{SEQUENCE}')) - 1;

    expect(sequenceOnly).toBe(8);
  });

  it('accepts every token at once, which lands exactly on the ceiling', () => {
    // 25 + 12 + 8 + 4 + 2 + 8, plus five single-character separators = 64.
    // Recorded because it is the property the column width was chosen for: the
    // widest thing the registry can express is storable, and nothing wider is.
    const everything =
      '{INSTITUTION_CODE}-{CLASSIFICATION_CODE}-{DEPARTMENT_CODE}-' +
      '{REGISTRATION_YEAR}-{REGISTRATION_YEAR_SHORT}-{SEQUENCE}';

    expect(worstCaseLength(parseFormat(everything))).toBe(MAX_LENGTH);
    expect(() => validateFormat(everything)).not.toThrow();
  });

  it('refuses a format one character past the ceiling', () => {
    const tooWide =
      'X{INSTITUTION_CODE}-{CLASSIFICATION_CODE}-{DEPARTMENT_CODE}-' +
      '{REGISTRATION_YEAR}-{REGISTRATION_YEAR_SHORT}-{SEQUENCE}';

    expect(worstCaseLength(parseFormat(tooWide))).toBe(MAX_LENGTH + 1);
    expect(issuesFrom(() => validateFormat(tooWide))).toMatch(/could produce a code of 65/);
  });

  it('accepts the realistic wide case', () => {
    // Classification, department, year and sequence — the shape the change
    // request was actually asked for.
    const format = '{CLASSIFICATION_CODE}-{DEPARTMENT_CODE}-{REGISTRATION_YEAR}-{SEQUENCE}';

    expect(worstCaseLength(parseFormat(format))).toBeLessThanOrEqual(MAX_LENGTH);
    expect(() => validateFormat(format)).not.toThrow();
  });

  it('checks the ceiling when the format is stored, not when a code is generated', () => {
    // A format that passes now and overflows years later fails at a moment
    // nobody chose, in a registration nobody can complete.
    expect(issuesFrom(() => validateFormat(`INV${'-X'.repeat(40)}{SEQUENCE}`))).toMatch(
      /could produce a code of/
    );
  });
});

describe('rendering a prefix (REQ-UNIT-007)', () => {
  it('resolves every supported token', () => {
    const format =
      '{INSTITUTION_CODE}.{REGISTRATION_YEAR}.{REGISTRATION_YEAR_SHORT}.' +
      '{CLASSIFICATION_CODE}.{DEPARTMENT_CODE}.{SEQUENCE}';

    expect(buildPrefix(format, context)).toBe('ALM-1.2026.26.202010500200.TKJ.');
  });

  it('trims a blank-padded classification key', () => {
    // `ref.asset_classifications.id` is CHAR(12) and comes back padded.
    const prefix = buildPrefix('{CLASSIFICATION_CODE}-{SEQUENCE}', {
      ...context,
      classificationId: '2020105002  ',
    });

    expect(prefix).toBe('2020105002-');
  });

  it('stops at the sequence, which the allocator supplies', () => {
    expect(buildPrefix('{INSTITUTION_CODE}-{SEQUENCE}', context)).toBe('ALM-1-');
  });

  describe('missing values reject rather than degrade', () => {
    const withDepartment = '{INSTITUTION_CODE}-{DEPARTMENT_CODE}-{SEQUENCE}';

    it('refuses when a configured token has no value, naming the field', () => {
      expect(
        issuesFrom(() => buildPrefix(withDepartment, { ...context, department: null }))
      ).toMatch(/requires department code/);

      try {
        buildPrefix(withDepartment, { ...context, department: null });
        throw new Error('should have thrown');
      } catch (error) {
        // A validation error against the field the caller can actually change,
        // not a 500 and not a silently unlabelled unit.
        expect(error.status).toBe(400);
        expect(error.details[0].field).toBe('departmentId');
      }
    });

    it('does not omit the token', () => {
      // `ITB--2026-00042` must be unreachable.
      expect(() => buildPrefix(withDepartment, { ...context, department: null })).toThrow();
    });

    it('does not treat an empty-string value as a value', () => {
      expect(
        issuesFrom(() => buildPrefix(withDepartment, { ...context, department: { code: '' } }))
      ).toMatch(/requires department code/);
    });

    it('refuses a value that could not survive the scanned-label URL', () => {
      // `departments.code` carries no character constraint in the database, so
      // this is the only thing standing between a slash and a printed label.
      expect(
        issuesFrom(() => buildPrefix(withDepartment, { ...context, department: { code: 'TK/J' } }))
      ).toMatch(/unsafe in a web address/);
    });

    it('refuses an institution code that could not survive it either', () => {
      expect(
        issuesFrom(() =>
          buildPrefix(DEFAULT_FORMAT, { ...context, institution: { code: 'SMK N/1' } })
        )
      ).toMatch(/unsafe in a web address/);
    });

    it('reports every unusable value at once, not one per round-trip', () => {
      try {
        buildPrefix('{INSTITUTION_CODE}-{DEPARTMENT_CODE}-{SEQUENCE}', {
          ...context,
          institution: { code: 'BAD CODE' },
          department: null,
        });
        throw new Error('should have thrown');
      } catch (error) {
        expect(error.details).toHaveLength(2);
        expect(error.details.map((d) => d.field)).toEqual(['institutionId', 'departmentId']);
      }
    });
  });
});

describe('the token registry (`BR-026`)', () => {
  it('publishes exactly the nine approved tokens', () => {
    // Six from `CR-006`, three added by `CR-007`. Pinned so a tenth is a
    // deliberate act rather than something that drifts in.
    expect(TOKENS.map((token) => token.id)).toEqual([
      'INSTITUTION_CODE',
      'REGISTRATION_YEAR',
      'REGISTRATION_YEAR_SHORT',
      'CLASSIFICATION_CODE',
      'CLASSIFICATION_LEAF_LABEL',
      'DEPARTMENT_CODE',
      'FUNDING_SOURCE_CODE',
      'NUMBER_COMPOSITION',
      'SEQUENCE',
    ]);
  });

  it('classifies every token by who supplies its value', () => {
    const byKind = (kind) => TOKENS.filter((t) => t.kind === kind).map((t) => t.id);

    expect(byKind('supplied')).toEqual(['NUMBER_COMPOSITION']);
    expect(byKind('allocated')).toEqual(['SEQUENCE']);
    expect(byKind('derived')).toHaveLength(7);
  });

  it('gives every token the controlled definition the requirement asks for', () => {
    for (const token of TOKENS) {
      expect(typeof token.id).toBe('string');
      expect(typeof token.name).toBe('string');
      expect(typeof token.description).toBe('string');
      expect(typeof token.source).toBe('string');
      expect(typeof token.alwaysAvailable).toBe('boolean');
      expect(['derived', 'supplied', 'allocated']).toContain(token.kind);

      // Either a fixed maximum, or a floor/cap pair for an elastic one.
      if (token.elastic) {
        expect(token.floor).toBeGreaterThan(0);
        expect(token.cap).toBeGreaterThan(token.floor);
      } else {
        expect(token.maxLength).toBeGreaterThan(0);
      }
    }
  });

  it('marks exactly the three tokens whose value may be missing', () => {
    const optional = TOKENS.filter((token) => !token.alwaysAvailable).map((token) => token.id);

    // Each optional for a different reason: a unit may have no department, an
    // asset may have no contract to reach a funding source through, and a
    // composition is typed only where the format asks for one.
    expect(optional).toEqual(['DEPARTMENT_CODE', 'FUNDING_SOURCE_CODE', 'NUMBER_COMPOSITION']);
  });

  it('has exactly one elastic token', () => {
    // More than one could not share the remaining room; the validation rule
    // that forbids two of the same in a format assumes this.
    expect(TOKENS.filter((token) => token.elastic).map((t) => t.id)).toEqual([
      'CLASSIFICATION_LEAF_LABEL',
    ]);
  });

  it('does not publish the resolver, which a client has no use for', () => {
    for (const entry of catalog({ institution, department })) {
      expect(entry.resolve).toBeUndefined();
    }
  });

  it('exposes no token for configurable attributes', () => {
    // `CR-006` §2.2 — not available at generation, classification-scoped,
    // unbounded and optional. Pinned so a future addition is a deliberate act.
    const ids = TOKENS.map((token) => token.id).join(' ');

    expect(ids).not.toMatch(/ATTRIBUTE/);
  });
});

describe('preview (REQ-ORG-007)', () => {
  it("uses the institution's real values rather than invented ones", () => {
    const { preview } = renderPreview(DEFAULT_FORMAT, { institution, department, at });

    expect(preview).toBe(`ALM-1-${new Date().getFullYear()}-00001`);
  });

  it('shows the sequence as a padded 1', () => {
    const { preview } = renderPreview('{INSTITUTION_CODE}-{SEQUENCE}', { institution, at });

    expect(preview.endsWith('00001')).toBe(true);
  });

  it('uses a real department code when the institution has one', () => {
    const { preview, unresolved } = renderPreview('{DEPARTMENT_CODE}-{SEQUENCE}', {
      institution,
      department: { code: 'RPL' },
      at,
    });

    expect(preview).toBe('RPL-00001');
    expect(unresolved).toEqual([]);
  });

  it('marks a token it cannot resolve instead of inventing a value', () => {
    const { preview, unresolved } = renderPreview('{DEPARTMENT_CODE}-{SEQUENCE}', {
      institution,
      department: null,
      at,
    });

    expect(preview).toBe('{DEPARTMENT_CODE}-00001');
    expect(unresolved).toEqual(['DEPARTMENT_CODE']);
  });

  it('falls back to a representative sample for tokens that are always present', () => {
    // The classification varies per asset, so there is no "real" value to show —
    // but every asset has one, so it is a sample rather than unresolved.
    const { preview, unresolved } = renderPreview('{CLASSIFICATION_CODE}-{SEQUENCE}', {
      institution,
      at,
    });

    expect(preview).toBe('202010500200-00001');
    expect(unresolved).toEqual([]);
  });

  it('refuses to preview a format that could not be saved', () => {
    expect(() => renderPreview('{NOPE}-{SEQUENCE}', { institution })).toThrow();
  });
});

// --- CR-007 -----------------------------------------------------------------

const {
  budgetsFor,
  budgetForToken,
  formatHasSequence,
  formatUsesComposition,
} = require('../src/domain/inventoryCodeFormat.js');

/** The client's target format, and the reason the elastic budget exists. */
const CLIENT_FORMAT =
  '{NUMBER_COMPOSITION}-{CLASSIFICATION_LEAF_LABEL}-{FUNDING_SOURCE_CODE}-{REGISTRATION_YEAR}';

describe('elastic budgets (`CR-007`, `BR-026`)', () => {
  it('gives the label whatever the rest of the format leaves', () => {
    // 16 + 8 + 4 + three separators = 31 fixed, so 64 − 31 = 33.
    const { budget, fixedTotal, worstCase } = budgetsFor(parseFormat(CLIENT_FORMAT));

    expect(fixedTotal).toBe(31);
    expect(budget).toBe(33);
    expect(worstCase).toBe(64);
  });

  it('caps the budget so a code stays readable on an asset tag', () => {
    // 64 − 9 = 55 available, but the cap is 40: the printed line is the fallback
    // when the QR is scuffed, and 55 characters is not legible at label size.
    expect(budgetsFor(parseFormat('{CLASSIFICATION_LEAF_LABEL}-{SEQUENCE}')).budget).toBe(40);
  });

  it('refuses a format that leaves the label below its floor', () => {
    // 25 + 8 + 4 + 8 + four separators = 49, leaving 15 — below the floor of 24.
    const cramped =
      '{INSTITUTION_CODE}-{DEPARTMENT_CODE}-{CLASSIFICATION_LEAF_LABEL}-' +
      '{REGISTRATION_YEAR}-{SEQUENCE}';

    expect(budgetsFor(parseFormat(cramped)).belowFloor).toBe(true);
    expect(issuesFrom(() => validateFormat(cramped))).toMatch(/needs at least 24/);
  });

  it('keeps the worst case computable, so the ceiling is still a save-time check', () => {
    // `BR-026`: elastic does not mean unbounded.
    for (const format of [CLIENT_FORMAT, '{CLASSIFICATION_LEAF_LABEL}-{SEQUENCE}']) {
      expect(budgetsFor(parseFormat(format)).worstCase).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });

  it('leaves fixed tokens at their declared maximum', () => {
    const segments = parseFormat(CLIENT_FORMAT);

    expect(budgetForToken(segments, 'NUMBER_COMPOSITION')).toBe(16);
    expect(budgetForToken(segments, 'FUNDING_SOURCE_CODE')).toBe(8);
    expect(budgetForToken(segments, 'CLASSIFICATION_LEAF_LABEL')).toBe(33);
  });

  it('refuses two elastic tokens, which cannot share the remainder', () => {
    expect(
      issuesFrom(() =>
        validateFormat('{CLASSIFICATION_LEAF_LABEL}-{CLASSIFICATION_LEAF_LABEL}-{SEQUENCE}')
      )
    ).toMatch(/at most once/);
  });

  it('still allows a repeated fixed token, as CR-006 did', () => {
    // Deliberately narrower than "no token may repeat": a format stored under
    // `CR-006` could contain one, and refusing it now would break a
    // configuration that has been generating codes.
    expect(() => validateFormat('{INSTITUTION_CODE}-{INSTITUTION_CODE}-{SEQUENCE}')).not.toThrow();
  });
});

describe('which generation path a format takes (`CR-007`)', () => {
  it.each([
    ['{INSTITUTION_CODE}-{SEQUENCE}', true, false],
    [CLIENT_FORMAT, false, true],
    ['{NUMBER_COMPOSITION}-{INSTITUTION_CODE}-{SEQUENCE}', true, true],
  ])('%s → sequence %s, composition %s', (format, sequence, composition) => {
    expect(formatHasSequence(format)).toBe(sequence);
    expect(formatUsesComposition(format)).toBe(composition);
  });
});

describe('rendering the new tokens (`CR-007`)', () => {
  const clientContext = {
    ...context,
    classificationName: 'Computer Equipment',
    fundingSourceCode: 'BOS',
    numberComposition: '001-02-03',
  };

  it('renders the whole code when the format has no sequence', () => {
    // Nothing is appended afterwards: `buildPrefix` has produced the finished
    // code, and there is no allocation.
    expect(buildPrefix(CLIENT_FORMAT, clientContext)).toBe(
      `001-02-03-COMPUTER_EQUIPMENT-BOS-${new Date().getFullYear()}`
    );
  });

  it('normalizes a multi-word classification label', () => {
    expect(buildPrefix('{CLASSIFICATION_LEAF_LABEL}-{SEQUENCE}', clientContext)).toBe(
      'COMPUTER_EQUIPMENT-'
    );
  });

  it('normalizes the punctuation the real catalog actually contains', () => {
    const prefix = buildPrefix('{CLASSIFICATION_LEAF_LABEL}-{SEQUENCE}', {
      ...clientContext,
      classificationName: 'Minyak Cat/Thinner',
    });

    expect(prefix).toBe('MINYAK_CAT_THINNER-');
  });

  it('refuses a label carrying a character with no safe representation', () => {
    // `Inde[endent` is in the live catalog, and is plainly a typo. Turning it
    // into a permanent code silently would be the worst outcome.
    expect(
      issuesFrom(() =>
        buildPrefix('{CLASSIFICATION_LEAF_LABEL}-{SEQUENCE}', {
          ...clientContext,
          classificationName: 'Stage With 4 Inde[endent',
        })
      )
    ).toMatch(/no safe representation/);
  });

  it('refuses a label longer than the format leaves room for, never truncating', () => {
    const issues = issuesFrom(() =>
      buildPrefix(CLIENT_FORMAT, {
        ...clientContext,
        classificationName: 'Akumulasi Penyusutan Bangunan Pengaman Sungai Pantai Lainnya',
      })
    );

    expect(issues).toMatch(/this format leaves 33/);
    expect(issues).toMatch(/cannot be shortened/);
  });

  it('validates a typed composition rather than rewriting it', () => {
    // `BR-027`: a person meant what they typed, so an unusable character is an
    // error to report — not something to silently turn into `001_02`.
    expect(
      issuesFrom(() =>
        buildPrefix(CLIENT_FORMAT, { ...clientContext, numberComposition: '001/02' })
      )
    ).toMatch(/unsafe in a web address/);
  });

  it('refuses a composition longer than its budget', () => {
    expect(
      issuesFrom(() =>
        buildPrefix(CLIENT_FORMAT, { ...clientContext, numberComposition: '0'.repeat(17) })
      )
    ).toMatch(/this format leaves 16/);
  });

  it.each([
    ['numberComposition', 'numberComposition'],
    ['fundingSourceCode', 'contractId'],
  ])('refuses a missing %s, naming %s', (key, field) => {
    try {
      buildPrefix(CLIENT_FORMAT, { ...clientContext, [key]: null });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.details.map((d) => d.field)).toContain(field);
    }
  });
});

describe('the registration hint names the funding source (REQ-UNIT-012)', () => {
  const { registrationHint } = require('../src/domain/inventoryCodeFormat.js');
  const ALM =
    '{NUMBER_COMPOSITION}/{CLASSIFICATION_LEAF_LABEL}/{FUNDING_SOURCE_CODE}/{REGISTRATION_YEAR}';

  it('says the code carries the funding source when the format uses it', () => {
    const hint = registrationHint({ code: 'ALM-1', inventoryCodeFormat: ALM });

    expect(hint.fundingSource).toEqual({ inCode: true });
    expect(hint.numberComposition.required).toBe(true);
  });

  it('says it does not for the default format, or with no institution', () => {
    expect(registrationHint({ code: 'X' }).fundingSource).toEqual({ inCode: false });
    expect(registrationHint(null)).toEqual({
      numberComposition: { required: false },
      fundingSource: { inCode: false },
    });
  });

  it('discloses only the flag, never the format', () => {
    const hint = registrationHint({ code: 'ALM-1', inventoryCodeFormat: ALM });

    expect(Object.keys(hint.fundingSource)).toEqual(['inCode']);
    expect(JSON.stringify(hint)).not.toContain('FUNDING_SOURCE_CODE');
  });
});

/**
 * The one renderer — P4 (`IMPLEMENTATION_PLAN.md` §64.4). `buildPrefix` and the
 * inventory-code preview both walk the format through `renderParts`, so the
 * preview can never show a code that registration would not issue.
 */
describe('renderParts (P4)', () => {
  const format = '{NUMBER_COMPOSITION}/{CLASSIFICATION_CODE}/{DEPARTMENT_CODE}/{REGISTRATION_YEAR}';

  it('returns every part, literal or token, in order', () => {
    const { parts, problems } = renderParts(format, { ...context, numberComposition: '1.6' });
    expect(problems).toEqual([]);
    expect(parts).toEqual([
      { kind: 'TOKEN', tokenId: 'NUMBER_COMPOSITION', text: '1.6' },
      { kind: 'LITERAL', text: '/' },
      { kind: 'TOKEN', tokenId: 'CLASSIFICATION_CODE', text: '202010500200' },
      { kind: 'LITERAL', text: '/' },
      { kind: 'TOKEN', tokenId: 'DEPARTMENT_CODE', text: 'TKJ' },
      { kind: 'LITERAL', text: '/' },
      { kind: 'TOKEN', tokenId: 'REGISTRATION_YEAR', text: '2026' },
    ]);
  });

  it('agrees with buildPrefix — the joined parts are the issued code', () => {
    for (const value of ['1.9', '1.10', '001-02-03']) {
      const ctx = { ...context, numberComposition: value };
      expect(
        renderParts(format, ctx)
          .parts.map((part) => part.text)
          .join('')
      ).toBe(buildPrefix(format, ctx));
    }
  });

  it('marks the sequence as allocated, never rendered', () => {
    const { parts } = renderParts('{INSTITUTION_CODE}-{SEQUENCE}', context);
    expect(parts.at(-1)).toEqual({
      kind: 'TOKEN',
      tokenId: 'SEQUENCE',
      text: null,
      allocated: true,
    });
    expect(buildPrefix('{INSTITUTION_CODE}-{SEQUENCE}', context)).toBe('ALM-1-');
  });

  it('reports a problem on the part itself instead of throwing', () => {
    const { parts, problems } = renderParts(format, {
      ...context,
      department: null,
      numberComposition: '1/6',
    });
    expect(problems.map((problem) => problem.field).sort()).toEqual([
      'departmentId',
      'numberComposition',
    ]);
    const unit = parts.find((part) => part.tokenId === 'NUMBER_COMPOSITION');
    expect(unit.text).toBeNull();
    expect(unit.problem.issue).toMatch(/unsafe/);
    expect(() =>
      buildPrefix(format, { ...context, department: null, numberComposition: '1/6' })
    ).toThrow();
  });
});
