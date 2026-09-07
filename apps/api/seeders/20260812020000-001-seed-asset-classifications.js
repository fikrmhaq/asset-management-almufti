'use strict';

/**
 * Seeds `ref.asset_classifications` from `rincian_asset.csv`.
 *
 * Fixed, government-sourced reference data (`05-infrastructure.md` §10.3,
 * REQ-CLASS-001, REQ-CLASS-005). The seed preserves the source identifiers and
 * parent relationships exactly — it does not renumber, reparent, or invent rows
 * (REQ-CLASS-005, REQ-REF-004).
 *
 * Two properties this seeder has to satisfy:
 *
 *   1. Idempotent — safe to run on every deploy (`05-infrastructure.md` §10.3).
 *      `ON CONFLICT (id) DO NOTHING` also repairs a partially completed load.
 *
 *   2. Self-referential FK safe — `fk_asset_classifications_parent` is not
 *      deferrable, so rows are inserted parent-before-child, one depth level at
 *      a time.
 *
 * Source data note: three rows (`202010500200`, `202010500300`, `202010500400`)
 * name a parent `202010500000` that exists in neither the CSV nor the legacy
 * dump. `parent_id` is nullable, so they are loaded as root-level records rather
 * than being dropped or given a synthesized parent. This is a known defect in
 * the source data, reported and accepted; it is logged at seed time so it stays
 * visible rather than silently absorbed.
 */

const fs = require('node:fs');
const path = require('node:path');

const { parse } = require('csv-parse/sync');

const { REPO_ROOT } = require('../src/config');

const DEFAULT_CSV_PATH = path.join(REPO_ROOT, 'rincian_asset.csv');
const INSERT_CHUNK_SIZE = 500;

/** Resolves the source CSV, allowing an override for containerized runs. */
function resolveCsvPath() {
  return process.env.CLASSIFICATION_CSV_PATH || DEFAULT_CSV_PATH;
}

/** Normalizes the CSV's literal `NULL` markers and blank strings to `null`. */
function nullable(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed === 'NULL' ? null : trimmed;
}

function readClassifications(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true });

  return records.map((row) => ({
    id: String(row.id_rincian_asset).trim(),
    parentId: nullable(row.mst_rincian_asset),
    name: String(row.rincian_asset),
    origin: Number(nullable(row.asal_rincian) ?? 1),
    categoryId: nullable(row.kategori),
  }));
}

/**
 * Orders rows so every parent precedes its children.
 *
 * Rows whose parent is absent from the data set are treated as roots — see the
 * source data note above. Returns the ordered rows plus the ids that were
 * re-rooted, so the caller can report them.
 */
function orderByDepth(rows) {
  const known = new Set(rows.map((row) => row.id));
  const orphanedIds = [];

  const normalized = rows.map((row) => {
    if (row.parentId !== null && !known.has(row.parentId)) {
      orphanedIds.push(row.id);
      return { ...row, parentId: null };
    }
    return row;
  });

  const childrenByParent = new Map();
  for (const row of normalized) {
    const key = row.parentId ?? '__root__';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(row);
  }

  const ordered = [];
  let level = childrenByParent.get('__root__') ?? [];

  while (level.length > 0) {
    ordered.push(...level);
    level = level.flatMap((row) => childrenByParent.get(row.id) ?? []);
  }

  if (ordered.length !== normalized.length) {
    // Only reachable if the source data contains a parent cycle, which the
    // no-self-reference CHECK alone would not catch.
    throw new Error(
      `Classification hierarchy is not acyclic: ordered ${ordered.length} of ${normalized.length} rows.`
    );
  }

  return { ordered, orphanedIds };
}

function buildInsert(chunk) {
  const values = [];
  const placeholders = chunk.map((row, index) => {
    const base = index * 5;
    values.push(row.id, row.parentId, row.name, row.origin, row.categoryId);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  return {
    sql: `
      INSERT INTO ref.asset_classifications (id, parent_id, name, origin, category_id)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (id) DO NOTHING;
    `,
    values,
  };
}

module.exports = {
  async up(queryInterface) {
    const csvPath = resolveCsvPath();

    if (!fs.existsSync(csvPath)) {
      throw new Error(
        `Classification source data not found at ${csvPath}. ` +
          'Set CLASSIFICATION_CSV_PATH to override the location.'
      );
    }

    const rows = readClassifications(csvPath);
    const { ordered, orphanedIds } = orderByDepth(rows);

    if (orphanedIds.length > 0) {
      console.log(
        `[seed] ${orphanedIds.length} classification(s) name a parent absent from the source ` +
          `data and are loaded as root-level records: ${orphanedIds.join(', ')}`
      );
    }

    await queryInterface.sequelize.transaction(async (transaction) => {
      for (let offset = 0; offset < ordered.length; offset += INSERT_CHUNK_SIZE) {
        const { sql, values } = buildInsert(ordered.slice(offset, offset + INSERT_CHUNK_SIZE));
        await queryInterface.sequelize.query(sql, { bind: values, transaction });
      }
    });

    const [[{ count }]] = await queryInterface.sequelize.query(
      'SELECT count(*)::int AS count FROM ref.asset_classifications;'
    );
    console.log(`[seed] ref.asset_classifications now holds ${count} row(s)`);
  },

  async down(queryInterface) {
    // Fails loudly if assets or locations still reference a classification —
    // the RESTRICT behaviour is the point, not an obstacle to work around.
    await queryInterface.sequelize.query('DELETE FROM ref.asset_classifications;');
  },
};
