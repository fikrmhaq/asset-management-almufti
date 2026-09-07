'use strict';

/**
 * Classification domain rules.
 *
 * Two groups:
 *
 *   LEAF ENFORCEMENT (Phase 1)  `BR-011`, REQ-CLASS-009, REQ-LOC-008. Assets and
 *   Locations must be classified against the most specific node.
 *   `04-data-model.md` §5.3.1 and §5.3.8 both note this cannot be a column-level
 *   CHECK, because it depends on whether any other row names this one as its
 *   parent.
 *
 *   LOCAL EXTENSION (Phase 17, `CR-001`)  `BR-016`–`BR-019`, REQ-CLASS-011
 *   through REQ-CLASS-017. Institutions may register leaf classifications the
 *   government catalogue does not cover.
 */

const { getModels, normalizeCharKey } = require('../db/models');
const { ValidationError, ConflictError } = require('../errors');

/**
 * Provenance — `BR-016`. Decides what may be done to a row, and is itself
 * immutable, so a read-only row can never become a writable one.
 */
const ORIGIN = Object.freeze({
  /** Government-issued reference data — 14,679 seeded rows. */
  GOVERNMENT: 1,
  /** Local additions inherited from the legacy system — 59 seeded rows. */
  LEGACY_LOCAL: 2,
  /** Created through this application. The only writable kind. */
  APP_DEFINED: 3,
});

/**
 * The identifier scheme — `04-data-model.md` §5.1.3.
 *
 * A 12-digit positional code in `1/1/1/2/2/2/3` groups. The final three digits
 * are the ordinal of a leaf beneath a second-to-last-level parent, which makes
 * the first nine the parent's own prefix.
 */
const CODE_LENGTH = 12;
const PREFIX_LENGTH = 9;
const MIN_ORDINAL = 1;
const MAX_ORDINAL = 999;

/**
 * Externally-sourced data allocates ordinals upward and currently reaches 412.
 * Allocating downward from 999 keeps application-defined codes clear of any
 * future government release without reserving a range that would then need
 * policing. See `04-data-model.md` §5.1.3.
 */
const ALLOCATION_DESCENDS = true;

/** @param {string} id */
const prefixOf = (id) => normalizeCharKey(id).slice(0, PREFIX_LENGTH);

/** @param {string} id */
const ordinalOf = (id) => Number.parseInt(normalizeCharKey(id).slice(PREFIX_LENGTH), 10);

/**
 * Whether a code sits at the level whose children are terminal — REQ-CLASS-012.
 *
 * Structural rather than data-driven: the ordinal group is unused (`000`) while
 * the group above it is not (`!= 00`). Asking the data instead ("does every
 * child of this node happen to be a leaf?") would answer yes for any node whose
 * subtree is merely shallow, which is a different question.
 *
 * @param {string} id
 */
function isSecondToLastLevel(id) {
  const code = normalizeCharKey(id);
  if (!/^\d{12}$/.test(code)) return false;
  return code.slice(PREFIX_LENGTH) === '000' && code.slice(7, 9) !== '00';
}

/** @param {{origin: number}} classification */
const isAppDefined = (classification) => classification.origin === ORIGIN.APP_DEFINED;

/**
 * @param {string} classificationId
 * @param {object} [options]
 * @param {string|null} [options.institutionId] the institution of the record
 *   being classified. When given, an institution-owned classification belonging
 *   to a different institution is rejected (`BR-019`).
 * @throws {ValidationError} when the classification does not exist, has children
 *   and is therefore not a leaf, or is owned by another institution
 */
async function assertLeafClassification(
  classificationId,
  { models = getModels(), institutionId } = {}
) {
  const classification = await models.AssetClassification.findByPk(classificationId);

  if (!classification) {
    throw new ValidationError('The classification does not exist', [
      { field: 'classificationId', issue: 'must reference an existing classification' },
    ]);
  }

  const childCount = await models.AssetClassification.count({
    where: { parentId: classificationId },
  });

  if (childCount > 0) {
    throw new ValidationError('The classification is not the most specific one available', [
      {
        field: 'classificationId',
        issue:
          `"${classification.name}" has ${childCount} more specific classification(s) beneath ` +
          'it; choose one of those instead (BR-011)',
      },
    ]);
  }

  // `BR-019` at assignment time. The picker already narrows what is offered, but
  // the picker is a convenience — this is the rule. A global classification
  // (owner `null`) suits any record; an owned one suits only its own
  // institution's, whatever role the caller holds, because the alternative
  // leaves the owning institution's users unable to see a classification their
  // records depend on.
  const owner = classification.institutionId ?? null;

  if (institutionId !== undefined && owner !== null && owner !== (institutionId ?? null)) {
    throw new ValidationError('That classification belongs to another institution', [
      {
        field: 'classificationId',
        issue:
          `"${classification.name}" was added by a different institution and cannot be used ` +
          'here (BR-019)',
      },
    ]);
  }
}

/**
 * Guards a write against provenance — `BR-016`, REQ-CLASS-003.
 *
 * `ValidationError` rather than `ForbiddenError`: the caller may well hold the
 * permission. The row is what refuses, not the role.
 *
 * @param {object} classification
 * @param {string} action for the message — "renamed", "deleted", "promoted"
 * @throws {ValidationError}
 */
function assertAppDefined(classification, action, { field = 'id' } = {}) {
  if (isAppDefined(classification)) return;

  const source =
    classification.origin === ORIGIN.GOVERNMENT
      ? 'is government-issued reference data'
      : 'was inherited from the legacy system';

  throw new ValidationError(`Only locally-added classifications can be ${action}`, [
    {
      field,
      issue: `"${classification.name}" ${source} and cannot be ${action} (BR-016)`,
    },
  ]);
}

/**
 * Guards the parent a new classification is attaching to — REQ-CLASS-012,
 * `BR-017`.
 *
 * Two checks, and the second is not redundant. The level rule is what the
 * requirement states; the "already has children" rule is what it is FOR. All 980
 * second-to-last-level nodes in the seeded data already have children, so the
 * second check never fires today — but if a future data load ever produced a
 * childless one, attaching to it would turn an in-use leaf into a branch and put
 * every Asset and Location classified against it in breach of `BR-011`.
 *
 * @returns {Promise<object>} the parent, loaded
 * @throws {ValidationError}
 */
async function assertAttachableParent(parentId, { models = getModels() } = {}) {
  const parent = await models.AssetClassification.findByPk(parentId);

  if (!parent) {
    throw new ValidationError('The parent classification does not exist', [
      { field: 'parentId', issue: 'must reference an existing classification' },
    ]);
  }

  if (!isSecondToLastLevel(parentId)) {
    throw new ValidationError(
      'A classification can only be added at the most specific level of the hierarchy',
      [
        {
          field: 'parentId',
          issue:
            `"${parent.name}" is not a second-to-last-level classification; drill down to one ` +
            'whose children are the most specific entries and add there (REQ-CLASS-012)',
        },
      ]
    );
  }

  const childCount = await models.AssetClassification.count({ where: { parentId } });

  if (childCount === 0) {
    throw new ValidationError('The parent classification has no entries beneath it', [
      {
        field: 'parentId',
        issue:
          `adding beneath "${parent.name}" would make it a grouping rather than a choice, and ` +
          'any Asset or Location already classified against it would become invalid (BR-017)',
      },
    ]);
  }

  return parent;
}

/**
 * Allocates the identifier for a new child of `parentId` — REQ-CLASS-013.
 *
 * MUST run inside a transaction that holds `lockParentForAllocation`, otherwise
 * two concurrent creates read the same set of used ordinals and mint the same
 * id. The primary key would catch that, but as a 500 rather than as the retry
 * this avoids entirely.
 *
 * @returns {Promise<string>} the allocated 12-character code
 * @throws {ConflictError} when every ordinal beneath the parent is taken
 */
async function allocateChildCode(parentId, { models = getModels(), transaction } = {}) {
  const rows = await models.AssetClassification.findAll({
    attributes: ['id'],
    where: { parentId },
    transaction,
  });

  const taken = new Set(
    rows.map((row) => ordinalOf(row.id)).filter((ordinal) => Number.isInteger(ordinal))
  );

  const first = ALLOCATION_DESCENDS ? MAX_ORDINAL : MIN_ORDINAL;
  const step = ALLOCATION_DESCENDS ? -1 : 1;

  for (let ordinal = first, n = 0; n < MAX_ORDINAL; ordinal += step, n += 1) {
    if (!taken.has(ordinal)) {
      return `${prefixOf(parentId)}${String(ordinal).padStart(3, '0')}`;
    }
  }

  throw new ConflictError(
    'There is no room for another classification beneath this one',
    [{ field: 'parentId', issue: `all ${MAX_ORDINAL} identifiers beneath this parent are in use` }]
  );
}

/**
 * Serializes allocation beneath one parent for the life of the transaction.
 *
 * A transaction-scoped advisory lock keyed on the parent code: it releases on
 * commit or rollback with no unlock call to forget, and it blocks only the
 * parent being written to, so two institutions adding under different parents
 * never wait on each other.
 */
async function lockParentForAllocation(parentId, { models = getModels(), transaction }) {
  const sequelize = models.AssetClassification.sequelize;

  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext($1))', {
    bind: [`classification:${normalizeCharKey(parentId)}`],
    transaction,
    type: sequelize.QueryTypes.SELECT,
  });
}

/**
 * The referents that block deletion — REQ-CLASS-017, `BR-018`.
 *
 * `attribute_definitions` belongs here as much as the two asset-core tables: it
 * carries a foreign key to the classification, so omitting it would turn a
 * blocked delete into a database-level failure.
 */
const REFERENTS = Object.freeze([
  { model: 'Asset', label: 'asset' },
  { model: 'Location', label: 'location' },
  { model: 'AttributeDefinition', label: 'attribute definition' },
]);

/**
 * @throws {ConflictError} naming which referent is holding the classification —
 *   "in use" without saying where is not actionable
 */
async function assertUnreferenced(classificationId, { models = getModels() } = {}) {
  const blocking = [];

  for (const { model, label } of REFERENTS) {
    const count = await models[model].count({ where: { classificationId } });
    if (count > 0) blocking.push({ label, count });
  }

  if (blocking.length === 0) return;

  const detail = blocking
    .map(({ label, count }) => `${count} ${label}${count === 1 ? '' : 's'}`)
    .join(', ');

  throw new ConflictError('The classification is still in use', [
    {
      field: 'id',
      issue: `${detail} still reference it; reassign them before deleting (BR-018)`,
    },
  ]);
}

module.exports = {
  ORIGIN,
  CODE_LENGTH,
  MAX_ORDINAL,
  assertLeafClassification,
  assertAppDefined,
  assertAttachableParent,
  assertUnreferenced,
  allocateChildCode,
  lockParentForAllocation,
  isSecondToLastLevel,
  isAppDefined,
  prefixOf,
  ordinalOf,
};
