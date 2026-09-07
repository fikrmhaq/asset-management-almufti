'use strict';

/**
 * Institution-configurable inventory code formats — Phase 25 (`CR-006`),
 * REQ-ORG-007, REQ-UNIT-007, `BR-026`.
 *
 * An institution designs the shape of its own inventory codes:
 *
 *   {INSTITUTION_CODE}-{REGISTRATION_YEAR}-{SEQUENCE}   ALM-1-2026-00042
 *   INV-{CLASSIFICATION_CODE}.{DEPARTMENT_CODE}.{SEQUENCE}
 *
 * This module owns the grammar and the token registry. It knows nothing about
 * allocation: it turns a format plus the facts of one registration into the
 * PREFIX, and `inventoryCode.js` decides which number goes after it.
 *
 * THE REGISTRY IS THE WHOLE SECURITY MODEL (`BR-026`). A format is an
 * arrangement of identifiers THIS FILE defines, plus literal text. Nothing here
 * evaluates anything the user wrote: there is no expression, no property path,
 * no column name, and no way to reach a value a token does not already name.
 * A token the registry does not define is an error, never an empty string.
 *
 * Three properties the rest of the system depends on:
 *
 *   ONE SEQUENCE, ALWAYS LAST.  Not merely permitted to be last — required
 *   (REQ-UNIT-007). It keeps allocation a prefix scan rather than a
 *   prefix-and-suffix pair, and it stops formats whose sequence resets on
 *   something printed after it, which nobody can read correctly.
 *
 *   NOTHING IS SILENTLY DROPPED.  A token with no value at registration fails
 *   the registration, naming the field. Omitting it would leave `ITB--2026-1`;
 *   substituting an empty string is the same thing wearing a hat.
 *
 *   URL-SAFE OR NOTHING.  Every literal, and every resolved token value, must
 *   survive the address a scanned label resolves to (REQ-UNIT-011), and a label
 *   cannot be recalled. Since `CR-008` that address carries the code in a QUERY
 *   VALUE rather than a path segment, so a literal may be a slash — see
 *   `LITERAL_CHARS`. Token values may not; the two alphabets are different on
 *   purpose.
 */

const { ValidationError } = require('../errors');
const { MAX_LENGTH, SEQUENCE_WIDTH, URL_SAFE_CODE, registrationYear } = require('./inventoryCode');
const { normalize, isSafe } = require('./identifierText');

/**
 * The token that carries the allocated number. At most one, always last.
 *
 * `CR-006` required exactly one. `CR-007` made it optional: an institution
 * numbering by a manually maintained composition has no sequence to allocate,
 * and forcing one would append a number nobody uses to every printed label.
 */
const SEQUENCE_TOKEN = 'SEQUENCE';

/** The token a person types. At most one, any position. */
const COMPOSITION_TOKEN = 'NUMBER_COMPOSITION';

/**
 * What the sequence is allowed to grow to when budgeting a format's worst case.
 *
 * Wider than `SEQUENCE_WIDTH` on purpose. The padding is a minimum, not a
 * ceiling — `formatCode` widens rather than truncating past 99,999, because
 * truncating would collide with a code already issued. Budgeting the padded
 * width would let a format pass validation and then, years later, produce a
 * code the column cannot hold.
 */
const SEQUENCE_MAX_WIDTH = 8;

/** The stored format. Long enough for any sensible arrangement, bounded so a
 *  pathological one cannot be stored at all. Mirrors `VARCHAR(200)`. */
const MAX_FORMAT_LENGTH = 200;

/**
 * What a literal may contain: the RFC 3986 unreserved set minus the tilde, plus
 * the slash `CR-008` added. Braces are excluded, which is what makes the grammar
 * unambiguous without escaping rules.
 *
 * WIDER THAN `institutions.code` AND EVERY OTHER TOKEN VALUE, deliberately
 * (`CR-008` DEC-A). A literal is chosen once, by an administrator, in a builder,
 * and checked the moment it is stored. A token value comes from a record many
 * people maintain over years and travels to places an inventory code does not.
 * The slash is a separator; it is not a character any code, name or identifier
 * in the system may now contain.
 */
const LITERAL_CHARS = /^[A-Za-z0-9._/-]+$/;

/** Trims a `CHAR(n)` natural key. `ref.asset_classifications.id` is blank-padded. */
const trimKey = (value) => (typeof value === 'string' ? value.trim() : value);

/**
 * The supported tokens.
 *
 * Every entry is available when a code is minted, bounded in length, and either
 * already character-constrained or checked at generation. Adding one widens
 * what an institution may print on a physical label, so each needs all four.
 *
 * `field` is the request field an unusable value is reported against, so the
 * error points at what the caller can actually change.
 *
 * DELIBERATELY ABSENT, each for a reason recorded in `CR-006` §2.2:
 *
 *   configurable attributes  not written until AFTER the unit exists, scoped to
 *                            one classification, free-form and unbounded
 *   asset / institution name  free text with spaces, and mutable
 *   location, condition,      not set at registration, and `BR-021` forbids
 *   lifecycle state           mutable state on a printed identity
 *   contract number, vendor   null for donated, self-constructed and migrated
 *                             assets by design
 *   month and other date      would silently change the sequence reset period
 *   parts                     (§ `CR-006` §4)
 */
const TOKENS = Object.freeze([
  {
    id: 'INSTITUTION_CODE',
    name: 'Institution code',
    description: "The owning institution's code",
    source: 'institutions.code',
    field: 'institutionId',
    kind: 'derived',
    maxLength: 25,
    alwaysAvailable: true,
    sample: 'ALM-1',
    resolve: (context) => context.institution?.code ?? null,
  },
  {
    id: 'REGISTRATION_YEAR',
    name: 'Registration year',
    description: 'The four-digit year the unit was registered',
    source: 'the registration date',
    field: null,
    kind: 'derived',
    maxLength: 4,
    alwaysAvailable: true,
    sample: String(registrationYear()),
    resolve: (context) => String(registrationYear(context.at)),
  },
  {
    id: 'REGISTRATION_YEAR_SHORT',
    name: 'Registration year (2-digit)',
    description: 'The last two digits of the year the unit was registered',
    source: 'the registration date',
    field: null,
    kind: 'derived',
    maxLength: 2,
    alwaysAvailable: true,
    sample: String(registrationYear()).slice(-2),
    resolve: (context) => String(registrationYear(context.at)).slice(-2),
  },
  {
    id: 'CLASSIFICATION_CODE',
    name: 'Classification code',
    description: "The code of the asset's classification",
    source: 'assets.classification_id',
    field: 'classificationId',
    kind: 'derived',
    maxLength: 12,
    alwaysAvailable: true,
    sample: '202010500200',
    resolve: (context) => trimKey(context.classificationId) || null,
  },
  {
    /**
     * The classification's NAME, normalized — Phase 26 (`CR-007`).
     *
     * Kept alongside `CLASSIFICATION_CODE` rather than replacing it: they answer
     * different questions and neither is derivable from the other. The code is
     * the stable 12-digit government key that sorts and machine-matches; this is
     * what a storekeeper can read.
     *
     * NO HIERARCHY WALK. `assets.classification_id` is always already a leaf —
     * `assertLeafClassification` enforces it on create and on reclassify, and
     * `assertAttachableParent` refuses to add a child beneath a childless node,
     * so a leaf can never stop being one. The requirement's "the leaf, not its
     * ancestors" concern is structural rather than something to implement.
     *
     * THE ONLY ELASTIC TOKEN. Its useful size is a property of the format it
     * sits in, not of the token: a fixed maximum either wastes the ceiling in a
     * short format or refuses too much of the catalog in a long one. Measured
     * over the live catalog, a budget of 24 represents 66% of leaf labels, 33
     * represents 82%, and 40 represents 89% — there is no natural limit to pick,
     * which is exactly why it is computed per format and reported to the
     * administrator in absolute counts (`classificationCoverage.js`).
     */
    id: 'CLASSIFICATION_LEAF_LABEL',
    name: 'Classification label',
    description:
      "The name of the asset's classification, upper-cased with words joined by underscores",
    source: 'ref.asset_classifications.name',
    field: 'classificationId',
    kind: 'derived',
    elastic: true,
    floor: 24,
    // Not a storage limit: the QR carries the URL and the printed line is the
    // fallback when the QR is scuffed, so a 60-character code stops being
    // readable at asset-tag size long before the column runs out.
    cap: 40,
    alwaysAvailable: true,
    sample: 'LAP_TOP',
    normalize: true,
    resolve: (context) => context.classificationName ?? null,
  },
  {
    /**
     * The only optional token, and the reason `alwaysAvailable` exists.
     *
     * `asset_units.department_id` is nullable, so selecting this makes a
     * department REQUIRED for every subsequent registration in the institution
     * — the client says so at the point of the choice. It is also the only
     * token whose value is unconstrained in the database: `departments.code` is
     * a `VARCHAR(8)` with no character check, so a code containing a space or a
     * slash is refused at generation rather than stripped into something that
     * resolves to nothing.
     */
    id: 'DEPARTMENT_CODE',
    name: 'Department code',
    description: 'The code of the department the unit is assigned to',
    source: 'departments.code',
    field: 'departmentId',
    kind: 'derived',
    maxLength: 8,
    alwaysAvailable: false,
    sample: 'TKJ',
    resolve: (context) => context.department?.code ?? null,
  },
  {
    /**
     * The funding source's business code — Phase 26 (`CR-007`), REQ-REF-007.
     *
     * The CODE, never the name. `Dana Bos` is called `BOS`, which no
     * normalization of the name discovers, and a `VARCHAR(100)` display name is
     * neither short enough nor stable enough for a permanent identifier
     * (`BR-027`). Already confined to the identifier alphabet by
     * `chk_funding_sources_code_url_safe`, so it needs no normalization here.
     *
     * TWO NULLABLE HOPS AWAY. The model reaches a funding source only through
     * `asset.contract_id → contract.funding_source_id`, and both are nullable by
     * design — `assets.contract_id` for donated, self-constructed and migrated
     * assets. A format using this token therefore cannot register those at all,
     * which is stated at the control rather than designed around.
     */
    id: 'FUNDING_SOURCE_CODE',
    name: 'Funding source code',
    description: "The code of the funding source on the asset's contract",
    source: 'ref.funding_sources.code',
    field: 'contractId',
    kind: 'derived',
    maxLength: 8,
    alwaysAvailable: false,
    sample: 'BOS',
    resolve: (context) => context.fundingSourceCode ?? null,
  },
  {
    /**
     * The manually supplied component — Phase 26 (`CR-007`).
     *
     * The only `supplied` token: its value comes from the request rather than
     * from a record or the allocator. Required exactly when a format uses it,
     * and never generated, incremented or parsed — `001-02-03` has
     * domain-specific internal segments the application does not understand, so
     * incrementing the last one may denote a different sub-category rather than
     * the next item.
     *
     * VALIDATED, NOT NORMALIZED (`BR-027`). A person typed it and meant what
     * they wrote; rewriting `001/02` into `001_02` would issue a permanent code
     * they never asked for.
     *
     * Fixed at 16 rather than elastic. Making it elastic too was considered and
     * rejected: the label outranks it, so it would only ever expand in a format
     * containing no label — and the format this exists to support contains one.
     * Sixteen is nearly twice the client's real values, and every character
     * given to it is taken from the label's budget in that same format.
     */
    id: COMPOSITION_TOKEN,
    name: 'Number composition',
    description: 'A number entered by the person registering the unit, such as 001-02-03',
    source: 'supplied at registration',
    field: 'numberComposition',
    kind: 'supplied',
    maxLength: 16,
    alwaysAvailable: false,
    sample: '001-02-03',
    resolve: (context) => context.numberComposition ?? null,
  },
  {
    id: SEQUENCE_TOKEN,
    name: 'Sequence',
    description:
      'The allocated number, padded to five digits. Required, and always last — ' +
      'it restarts whenever the text before it changes',
    source: 'allocated by the application',
    field: null,
    kind: 'allocated',
    maxLength: SEQUENCE_MAX_WIDTH,
    alwaysAvailable: true,
    sample: String(1).padStart(SEQUENCE_WIDTH, '0'),
    // Never resolved here: the allocation query decides it (`inventoryCode.js`).
    resolve: () => null,
  },
]);

const TOKENS_BY_ID = new Map(TOKENS.map((token) => [token.id, token]));

/** The shape Phase 18 (`CR-001`) produced, and what an unconfigured institution gets. */
const DEFAULT_FORMAT = `{INSTITUTION_CODE}-{REGISTRATION_YEAR}-{${SEQUENCE_TOKEN}}`;

/** The format in force for an institution. `null` means "not configured". */
function formatFor(institution) {
  return institution?.inventoryCodeFormat || DEFAULT_FORMAT;
}

/** Whether `institution` is running the default rather than a chosen format. */
const isDefaultFormat = (institution) => !institution?.inventoryCodeFormat;

const invalid = (issue, field = 'format') =>
  new ValidationError('The inventory code format is not valid', [{ field, issue }]);

/**
 * Splits a format into literal and token segments.
 *
 * Unambiguous without escaping rules because `{` and `}` cannot appear in a
 * literal — see `LITERAL_CHARS`. Structural problems throw immediately; there
 * is no meaningful way to keep parsing past an unterminated token.
 *
 * @param {string} format
 * @returns {{type: 'literal'|'token', value: string, position: number}[]}
 * @throws {ValidationError}
 */
function parseFormat(format) {
  const segments = [];
  let literal = '';
  let literalStart = 0;

  const flushLiteral = () => {
    if (literal.length > 0) {
      segments.push({ type: 'literal', value: literal, position: literalStart });
      literal = '';
    }
  };

  for (let index = 0; index < format.length; index += 1) {
    const char = format[index];

    if (char === '}') {
      throw invalid(`has a closing brace with no matching "{" at position ${index + 1}`);
    }

    if (char !== '{') {
      if (literal.length === 0) literalStart = index;
      literal += char;
      continue;
    }

    const end = format.indexOf('}', index + 1);
    if (end === -1) {
      throw invalid(`has a "{" at position ${index + 1} that is never closed`);
    }

    const id = format.slice(index + 1, end);
    if (id.includes('{')) {
      throw invalid(`has a nested "{" inside the token at position ${index + 1}`);
    }
    if (id.length === 0) {
      throw invalid(`has an empty token "{}" at position ${index + 1}`);
    }

    flushLiteral();
    segments.push({ type: 'token', value: id, position: index });
    index = end;
  }

  flushLiteral();

  return segments;
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/**
 * How many characters each token gets in THIS format — Phase 26 (`CR-007`).
 *
 * Most tokens carry a fixed maximum. One may instead absorb whatever the others
 * leave, because its useful size is a property of the format rather than of the
 * token: a fixed classification-label limit either wastes the ceiling in a short
 * format or refuses too much of the catalog in a long one.
 *
 * `BR-026` still holds. The longest code a format can produce remains
 * computable from the format and the registry alone — it is the fixed segments
 * plus the elastic one — so the ceiling is still checked when the format is
 * stored rather than when a code is generated from it.
 *
 * The elastic token is capped as well as floored. The cap is physical: past
 * roughly forty characters the human-readable line on an asset tag stops being
 * legible, and that line is the fallback when the QR is scuffed.
 *
 * @returns {{elastic: object|null, fixedTotal: number, budget: number,
 *            worstCase: number, belowFloor: boolean}}
 */
function budgetsFor(segments) {
  const elastic =
    segments
      .filter((segment) => segment.type === 'token')
      .map((segment) => TOKENS_BY_ID.get(segment.value))
      .find((token) => token?.elastic) ?? null;

  const fixedTotal = segments.reduce((total, segment) => {
    if (segment.type === 'literal') return total + segment.value.length;

    const token = TOKENS_BY_ID.get(segment.value);
    if (!token || token === elastic) return total;
    return total + token.maxLength;
  }, 0);

  if (!elastic) return { elastic, fixedTotal, budget: 0, worstCase: fixedTotal, belowFloor: false };

  const available = MAX_LENGTH - fixedTotal;
  const budget = clamp(available, elastic.floor, elastic.cap);

  return {
    elastic,
    fixedTotal,
    budget,
    worstCase: fixedTotal + budget,
    // A format leaving the token less than its floor is refused outright rather
    // than stored and then refusing most registrations — a failure moved to the
    // worst possible moment.
    belowFloor: available < elastic.floor,
  };
}

/** The budget one token receives in a format, or its fixed maximum. */
function budgetForToken(segments, tokenId) {
  const token = TOKENS_BY_ID.get(tokenId);
  if (!token) return 0;
  if (!token.elastic) return token.maxLength;
  return budgetsFor(segments).budget;
}

/** The longest code a format could ever render (`BR-026`). */
const worstCaseLength = (segments) => budgetsFor(segments).worstCase;

/**
 * Checks a format against the registry and the grammar rules.
 *
 * Semantic problems are collected and reported together rather than one per
 * round-trip, following `buildAttributeValues` — the builder maps
 * `details[].field` and the position in `issue` back onto the offending chip.
 *
 * @param {string} format
 * @returns {{type: 'literal'|'token', value: string, position: number}[]} the parsed segments
 * @throws {ValidationError}
 */
function validateFormat(format) {
  if (typeof format !== 'string' || format.trim().length === 0) {
    throw invalid('is required');
  }
  if (format.length > MAX_FORMAT_LENGTH) {
    throw invalid(`must be at most ${MAX_FORMAT_LENGTH} characters`);
  }

  const segments = parseFormat(format);
  const problems = [];

  for (const segment of segments) {
    if (segment.type === 'literal') {
      if (!LITERAL_CHARS.test(segment.value)) {
        problems.push({
          field: 'format',
          issue:
            `the text "${segment.value}" at position ${segment.position + 1} uses characters ` +
            'that are unsafe in a web address; use letters, digits, hyphen, underscore, dot ' +
            'or slash (REQ-ORG-002, REQ-UNIT-011)',
        });
      }
      continue;
    }

    if (!TOKENS_BY_ID.has(segment.value)) {
      problems.push({
        field: 'format',
        issue:
          `"{${segment.value}}" at position ${segment.position + 1} is not a supported token; ` +
          `choose from ${TOKENS.map((token) => token.id).join(', ')}`,
      });
    }
  }

  const occurrences = (id) =>
    segments.filter((segment) => segment.type === 'token' && segment.value === id);

  const sequences = occurrences(SEQUENCE_TOKEN);
  const compositions = occurrences(COMPOSITION_TOKEN);

  /**
   * A format needs something that distinguishes one unit from another —
   * REQ-UNIT-007 as amended by `CR-007`.
   *
   * `CR-006` required a sequence. It is now one of two ways: an allocated number
   * or a manually supplied composition, or both. What cannot happen is NEITHER,
   * because every unit sharing the same derived values would then render an
   * identical code — a guaranteed collision on the second registration.
   */
  if (sequences.length === 0 && compositions.length === 0) {
    problems.push({
      field: 'format',
      issue:
        `must contain {${SEQUENCE_TOKEN}} or {${COMPOSITION_TOKEN}} — without one of them ` +
        'every unit registered would produce the same code',
    });
  }

  if (sequences.length > 1) {
    problems.push({
      field: 'format',
      issue: `may contain {${SEQUENCE_TOKEN}} at most once, but contains ${sequences.length}`,
    });
  } else if (sequences.length === 1 && segments.at(-1) !== sequences[0]) {
    // Allocation reads the codes sharing everything BEFORE the number; a token
    // or literal after it would put the reset period behind the digits that
    // reset, which nobody can read correctly.
    problems.push({
      field: 'format',
      issue: `must end with {${SEQUENCE_TOKEN}} — nothing may follow it`,
    });
  }

  if (compositions.length > 1) {
    problems.push({
      field: 'format',
      issue: `may contain {${COMPOSITION_TOKEN}} at most once, but contains ${compositions.length}`,
    });
  }

  if (segments.length < 2) {
    problems.push({
      field: 'format',
      issue:
        'must contain something besides the number — a bare identifier names ' +
        'no institution, year or classification',
    });
  }

  /**
   * The elastic token at most once, so the remainder is never split.
   *
   * Deliberately narrower than "no token may repeat": a format stored under
   * `CR-006` could legitimately contain a repeated fixed-width token, and
   * refusing it now would break a configuration that has been generating codes.
   * No stored format can contain an elastic token, since none existed before
   * this phase.
   */
  const elasticOccurrences = segments.filter(
    (segment) => segment.type === 'token' && TOKENS_BY_ID.get(segment.value)?.elastic
  );

  if (elasticOccurrences.length > 1) {
    problems.push({
      field: 'format',
      issue:
        `{${elasticOccurrences[0].value}} may appear at most once — it takes whatever room ` +
        'the rest of the format leaves, which two of them cannot share',
    });
  }

  // Checked HERE rather than at generation (`BR-026`): a format that passes now
  // and overflows the column at some future registration is a failure nobody
  // can act on, at a moment nobody chose.
  const budgets = budgetsFor(segments);

  if (budgets.belowFloor) {
    problems.push({
      field: 'format',
      issue:
        `leaves {${budgets.elastic.id}} only ${MAX_LENGTH - budgets.fixedTotal} characters, ` +
        `and it needs at least ${budgets.elastic.floor} to be usable; remove a token or ` +
        'shorten the separators',
    });
  } else if (budgets.worstCase > MAX_LENGTH) {
    problems.push({
      field: 'format',
      issue:
        `could produce a code of ${budgets.worstCase} characters, and the limit is ` +
        `${MAX_LENGTH}; remove a token or shorten the separators`,
    });
  }

  if (problems.length > 0) {
    throw new ValidationError('The inventory code format is not valid', problems);
  }

  return segments;
}

/**
 * Everything before the sequence, resolved for one registration.
 *
 * `inventoryCode.allocateCodes` takes it from here: the codes sharing this
 * prefix are what the next number is allocated above.
 *
 * @param {string} format
 * @param {{institution: object, classificationId: string,
 *          department: object|null, at?: Date}} context
 * @returns {string}
 * @throws {ValidationError} when a token has no value, or one that cannot be
 *   carried in a URL path segment
 */
function buildPrefix(format, context) {
  const segments = validateFormat(format);
  const problems = [];
  let prefix = '';

  for (const segment of segments) {
    if (segment.type === 'literal') {
      prefix += segment.value;
      continue;
    }

    // Always the last segment — `validateFormat` guarantees it.
    if (segment.value === SEQUENCE_TOKEN) break;

    const token = TOKENS_BY_ID.get(segment.value);
    const raw = token.resolve(context);

    if (raw === null || raw === undefined || raw === '') {
      problems.push({
        field: token.field ?? 'format',
        issue:
          `this institution's inventory code format requires ${token.name.toLowerCase()}, ` +
          'and this registration has none (REQ-UNIT-007)',
      });
      continue;
    }

    /**
     * Free text is transformed; a typed value is only checked (`BR-027`).
     *
     * The distinction matters: a classification label was written for people and
     * has to be made safe, but a number composition was typed by someone who
     * meant what they wrote — rewriting it would issue a permanent code they
     * never asked for.
     */
    let value = String(raw);

    if (token.normalize) {
      const normalized = normalize(value);

      if (normalized.value === null) {
        problems.push({
          field: token.field ?? 'format',
          issue:
            normalized.reason === 'empty'
              ? `"${value}" has nothing left once it is made safe for an inventory code`
              : `"${value}" cannot be used in an inventory code: ${normalized.offending} ` +
                'has no safe representation, and shortening or dropping it would put a ' +
                'misleading code on a permanent label (BR-027)',
        });
        continue;
      }

      value = normalized.value;
    } else if (!isSafe(value)) {
      problems.push({
        field: token.field ?? 'format',
        issue:
          `"${value}" contains characters that are unsafe in a web address, and it would be ` +
          'carried in the inventory code; use letters, digits, hyphen, underscore or dot ' +
          '(REQ-UNIT-011)',
      });
      continue;
    }

    /**
     * The budget is a property of the format, so it is checked here rather than
     * in the registry. Refused, never truncated: a shortened label is lossy on a
     * sticker that outlives the record, and collapses classifications sharing a
     * prefix onto one string (`BR-027`).
     */
    const budget = budgetForToken(segments, token.id);

    if (value.length > budget) {
      problems.push({
        field: token.field ?? 'format',
        issue:
          `"${value}" is ${value.length} characters and this format leaves ${budget} for ` +
          `${token.name.toLowerCase()}; it cannot be shortened, so either the format or the ` +
          'source record has to change (BR-027)',
      });
      continue;
    }

    prefix += value;
  }

  if (problems.length > 0) {
    throw new ValidationError('The inventory code cannot be generated for this unit', problems);
  }

  return prefix;
}

/**
 * The token registry as the API publishes it — `06-api.md` §4.7.
 *
 * Institution-aware where the server can be certain: the institution's real
 * code and the current year rather than invented ones, and a real department
 * code where the institution has one. A preview built from a plausible-looking
 * invention teaches the wrong thing about what will be printed.
 *
 * `resolve` is not published — it is a function, and the client has no use for
 * one. What the client needs is what it renders: names, descriptions, samples,
 * lengths, and whether a token can be shown at all.
 */
function catalog({
  institution = null,
  department = null,
  fundingSourceCode = null,
  at = new Date(),
  segments = null,
} = {}) {
  const context = {
    institution,
    department,
    fundingSourceCode,
    at,
    classificationId: null,
    numberComposition: null,
  };

  return TOKENS.map((token) => {
    // Neither the allocator's number nor a value the user has yet to type can be
    // resolved from context; both fall back to their sample.
    const live =
      token.kind === 'allocated' || token.kind === 'supplied' ? null : token.resolve(context);
    const usable = live !== null && live !== undefined && live !== '' && URL_SAFE_CODE.test(live);

    return {
      id: token.id,
      name: token.name,
      description: token.description,
      source: token.source,
      // `derived` | `supplied` | `allocated` — what the client needs in order to
      // know whether registration will ask the user for this value (`CR-007`).
      kind: token.kind,
      alwaysAvailable: token.alwaysAvailable,
      elastic: Boolean(token.elastic),
      /**
       * The room this token actually has in the format being configured, which
       * for an elastic token is not its declared maximum. Falls back to the cap
       * when no format is in hand, so the value is never misleadingly small.
       */
      maxLength: segments
        ? budgetForToken(segments, token.id)
        : (token.maxLength ?? token.cap ?? 0),
      sample: usable ? live : token.sample,
      /**
       * `false` when the server has nothing genuine to show and the token is
       * not one that is always present — today, `DEPARTMENT_CODE` for an
       * institution with no usable department. The client renders it as
       * unresolved rather than as something that looks like a real code
       * (REQ-ORG-007), because a preview that invents a department code teaches
       * the wrong thing about what will be printed.
       */
      resolvable: usable || token.alwaysAvailable,
    };
  });
}

/**
 * What a format would produce, without allocating anything.
 *
 * The sequence renders as `00001`. NOTHING HERE TOUCHES THE DATABASE: no
 * transaction, no advisory lock, no scan, and above all no number consumed
 * (REQ-ORG-007). A preview that burned a sequence would leave a gap for every
 * keystroke in the builder.
 *
 * An unresolvable token is left in the string as its own `{TOKEN}` and named in
 * `unresolved`, so the reader can see that it was not substituted.
 *
 * @returns {{preview: string, unresolved: string[]}}
 */
function renderPreview(
  format,
  { institution = null, department = null, fundingSourceCode = null, at = new Date() } = {}
) {
  const segments = validateFormat(format);
  const entries = new Map(
    catalog({ institution, department, fundingSourceCode, at, segments }).map((row) => [
      row.id,
      row,
    ])
  );
  const unresolved = [];

  const preview = segments
    .map((segment) => {
      if (segment.type === 'literal') return segment.value;

      const entry = entries.get(segment.value);
      if (!entry.resolvable) {
        unresolved.push(entry.id);
        return `{${entry.id}}`;
      }

      return entry.sample;
    })
    .join('');

  return { preview, unresolved };
}

/**
 * Whether a format allocates a number — Phase 26 (`CR-007`).
 *
 * The one bit that decides which generation path runs: with a sequence,
 * `buildPrefix` returns the leading text and `allocateCodes` mints the rest
 * under a lock; without one, `buildPrefix` has already returned the whole code
 * and there is nothing to allocate.
 */
const formatHasSequence = (format) =>
  parseFormat(format).some(
    (segment) => segment.type === 'token' && segment.value === SEQUENCE_TOKEN
  );

/** Whether a format asks the person registering a unit for a value (`CR-007`). */
const formatUsesComposition = (format) =>
  parseFormat(format).some(
    (segment) => segment.type === 'token' && segment.value === COMPOSITION_TOKEN
  );

/**
 * The token ids a format uses, so a caller can load only what it needs.
 *
 * Generation reaches for a classification name and a funding source code through
 * joins that most formats never want; asking the format first keeps the common
 * registration path at the queries `CR-006` already made.
 */
const tokensIn = (format) =>
  new Set(
    parseFormat(format)
      .filter((segment) => segment.type === 'token')
      .map((segment) => segment.value)
  );

/**
 * What a registration form needs to know, and nothing more — `CR-007`
 * `DEC-133`, REQ-ORG-007.
 *
 * A user registering a unit has to know whether to type a composition, but the
 * format itself lives behind `inventory-code-format:read` — an administration
 * permission a registrar has no reason to hold. Widening that permission to make
 * a form field appear would trade a real boundary for a convenience, so the
 * asset and contract-item responses carry this derived hint instead.
 *
 * It discloses one bit beyond "is a value needed": whether the institution's
 * codes carry a sequence, which is legible on any printed label. No format
 * string, no token list, and no other token's presence.
 *
 * @param {{inventoryCodeFormat?: string|null}|null} institution
 */
function registrationHint(institution) {
  // No institution means no format to apply, so the unit registers with no code
  // at all and there is nothing to ask for (REQ-UNIT-007).
  if (!institution) return { numberComposition: { required: false } };

  const format = formatFor(institution);
  if (!formatUsesComposition(format)) return { numberComposition: { required: false } };

  return {
    numberComposition: {
      required: true,
      // One value per unit when nothing else separates them; one value for a
      // whole batch when an allocated sequence does.
      perUnit: !formatHasSequence(format),
      maxLength: budgetForToken(parseFormat(format), COMPOSITION_TOKEN),
    },
  };
}

module.exports = {
  TOKENS,
  SEQUENCE_TOKEN,
  COMPOSITION_TOKEN,
  SEQUENCE_MAX_WIDTH,
  MAX_FORMAT_LENGTH,
  LITERAL_CHARS,
  DEFAULT_FORMAT,
  formatFor,
  isDefaultFormat,
  parseFormat,
  validateFormat,
  worstCaseLength,
  budgetsFor,
  budgetForToken,
  formatHasSequence,
  formatUsesComposition,
  tokensIn,
  registrationHint,
  buildPrefix,
  catalog,
  renderPreview,
};
