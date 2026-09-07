import { describe, it, expect } from 'vitest';

import { query } from './helpers/db.js';
import { INDEXES, PARTIAL_INDEXES, UNIQUE_INDEXES } from './fixtures/schema.js';

/** Indexes — 04-data-model.md §5 DDL and §7. */

async function explicitIndexes() {
  return query(`
    SELECT indexname AS name, indexdef AS definition, schemaname AS schema, tablename AS table
      FROM pg_indexes
     WHERE schemaname IN ('public','ref','audit')
       AND indexname LIKE 'idx_%'
     ORDER BY indexname
  `);
}

describe('indexes', () => {
  it('creates exactly the documented indexes', async () => {
    const rows = await explicitIndexes();

    expect(rows.map((r) => r.name).sort()).toEqual([...INDEXES].sort());
  });

  it.each(Object.entries(PARTIAL_INDEXES))(
    '%s is partial with the documented predicate',
    async (name, predicate) => {
      const rows = await explicitIndexes();
      const index = rows.find((r) => r.name === name);

      expect(index, `${name} is missing`).toBeDefined();
      expect(index.definition).toContain('WHERE');
      expect(index.definition).toContain(predicate);
    }
  );

  it.each(Object.entries(UNIQUE_INDEXES))(
    '%s is a partial unique index with the documented predicate',
    async (name, predicate) => {
      // Its own query: `explicitIndexes` scans `idx_%` only, and a partial
      // unique index cannot be a constraint, so it appears in neither of the
      // places the other checks look.
      const [index] = await query(
        `
        SELECT indexdef AS definition
          FROM pg_indexes
         WHERE schemaname IN ('public','ref','audit') AND indexname = $1
        `,
        [name]
      );

      expect(index, `${name} is missing`).toBeDefined();
      expect(index.definition).toContain('CREATE UNIQUE INDEX');
      expect(index.definition).toContain(predicate);
    }
  );

  it('creates no partial indexes beyond the documented nine', async () => {
    const rows = await explicitIndexes();
    const partial = rows.filter((r) => r.definition.includes(' WHERE ')).map((r) => r.name);

    expect(partial.sort()).toEqual(Object.keys(PARTIAL_INDEXES).sort());
  });

  it('orders the longitudinal history temporal index by effective_from DESC', async () => {
    const rows = await explicitIndexes();
    const index = rows.find((r) => r.name === 'idx_longitudinal_history_effective');

    expect(index.definition).toContain('asset_unit_id');
    expect(index.definition).toContain('effective_from DESC');
  });

  it('orders the audit log timestamp index descending', async () => {
    const rows = await explicitIndexes();
    const index = rows.find((r) => r.name === 'idx_audit_logs_timestamp');

    expect(index.definition).toContain('"timestamp" DESC');
  });

  it('indexes the composite audit lookup on entity type and id', async () => {
    const rows = await explicitIndexes();
    const index = rows.find((r) => r.name === 'idx_audit_logs_entity');

    expect(index.definition).toContain('entity_type');
    expect(index.definition).toContain('entity_id');
  });

  it('indexes borrowing dates as a composite temporal index', async () => {
    const rows = await explicitIndexes();
    const index = rows.find((r) => r.name === 'idx_borrowings_dates');

    expect(index.definition).toContain('borrow_date');
    expect(index.definition).toContain('expected_return_date');
  });
});
