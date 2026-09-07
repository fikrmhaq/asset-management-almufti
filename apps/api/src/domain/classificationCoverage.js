'use strict';

/**
 * How much of the classification catalog a label budget can represent —
 * Phase 26 (`CR-007`), REQ-ORG-007.
 *
 * An institution choosing `{CLASSIFICATION_LEAF_LABEL}` is choosing, without
 * being told, how many of its future assets can be registered at all: the token
 * absorbs whatever room the rest of the format leaves, and a label longer than
 * that refuses the registration. REQ-ORG-007 requires that constraint to be
 * visible when the format is configured rather than discovered later, and in
 * absolute counts rather than only a ratio — "2,486 classifications will be
 * refused" is a decision; "81.6%" is a statistic.
 *
 * COMPUTED IN JAVASCRIPT, FROM THE SAME NORMALIZATION THE GENERATOR USES.
 *
 * The obvious implementation is a SQL aggregate with a regular expression, and
 * it is wrong: it would be a second implementation of `identifierText.normalize`
 * that has to agree with the first forever. The moment they disagree the builder
 * reports a coverage figure that registration does not honour, and the number is
 * worse than useless because it is believed. So the leaf labels are normalized
 * once, through the real function, and only their LENGTHS are kept.
 *
 * That costs about 13,500 small integers — a few tens of kilobytes — and makes
 * any budget a count over an array. The alternative, recomputing per request,
 * would re-scan a 14,739-row table on a screen an administrator opens to think.
 *
 * The cache is invalidated explicitly rather than given a TTL: classifications
 * change only through this application (`classifications/service.js`), so there
 * is an exact moment to invalidate at, and a TTL would spend most of its life
 * either stale or pointlessly recomputing.
 */

const { getModels } = require('../db/models');
const { normalize } = require('./identifierText');

/** @type {{lengths: Int32Array, unrepresentable: number, total: number}|null} */
let cache = null;

/**
 * Loads and normalizes every leaf classification label.
 *
 * A leaf is a node with no children — the only kind an Asset may reference
 * (`BR-011`), and by `assertAttachableParent` a node that can never gain one, so
 * "leaf" is a stable property rather than a moment in time.
 */
async function load(models) {
  const sequelize = models.AssetClassification.sequelize;

  const rows = await sequelize.query(
    `
    SELECT c.name
      FROM ref.asset_classifications c
     WHERE NOT EXISTS (
             SELECT 1 FROM ref.asset_classifications k WHERE k.parent_id = c.id
           )
    `,
    { type: sequelize.QueryTypes.SELECT }
  );

  const lengths = new Int32Array(rows.length);
  let unrepresentable = 0;
  let kept = 0;

  for (const row of rows) {
    const { value } = normalize(row.name);
    if (value === null) unrepresentable += 1;
    else lengths[kept++] = value.length;
  }

  return { lengths: lengths.subarray(0, kept), unrepresentable, total: rows.length };
}

/** Forgets the cached lengths. Call after any classification write. */
function invalidate() {
  cache = null;
}

/**
 * @param {number} budget characters available to the label in one format
 * @returns {Promise<{total: number, representable: number, exceeding: number,
 *                    unrepresentable: number}>}
 *   `representable + exceeding + unrepresentable === total`.
 */
async function coverageAt(budget, { models = getModels() } = {}) {
  if (!cache) cache = await load(models);

  let representable = 0;
  for (const length of cache.lengths) {
    if (length <= budget) representable += 1;
  }

  return {
    total: cache.total,
    representable,
    // Normalizes cleanly but does not fit — the count an administrator trades
    // against when adding another token to the format.
    exceeding: cache.lengths.length - representable,
    // Cannot be represented at any budget: five names in the live catalog carry
    // `#`, `?`, `[` or `>`. Kept separate because no format change fixes them.
    unrepresentable: cache.unrepresentable,
  };
}

module.exports = { coverageAt, invalidate };
