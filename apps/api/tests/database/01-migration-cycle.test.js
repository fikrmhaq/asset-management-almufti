import { describe, it, expect, beforeAll } from 'vitest';

import {
  countManagedObjects,
  cycleDatabaseUrl,
  migrate,
  migrateUndoAll,
  query,
  schemaSnapshot,
} from './helpers/db.js';

/**
 * IMPLEMENTATION_PLAN.md §7.9 — the database must be reproducible from an empty
 * PostgreSQL instance, fully reversible, and reproducible again afterwards.
 *
 * This file owns its own database (globalSetup leaves it empty) because the
 * rollback step is destructive and file order is not guaranteed.
 */

const DB = cycleDatabaseUrl();

describe('migration cycle', () => {
  let afterFirstMigrate;
  let afterRollback;
  let firstSnapshot;
  let secondSnapshot;

  beforeAll(async () => {
    await migrate(DB);
    afterFirstMigrate = await countManagedObjects(DB);
    firstSnapshot = await schemaSnapshot(DB);

    await migrateUndoAll(DB);
    afterRollback = await countManagedObjects(DB);

    await migrate(DB);
    secondSnapshot = await schemaSnapshot(DB);
  });

  it('builds the complete schema from an empty database', () => {
    // 50 since migration 066 (REQ-REQUEST-025) added `asset_unit_reports`;
    // 52 since migration 067 (§73) added consumables and their movements.
    expect(afterFirstMigrate).toEqual({ tables: 52, enums: 8, schemas: 2 });
  });

  it('applies every migration exactly once', async () => {
    const rows = await query('SELECT name FROM "SequelizeMeta" ORDER BY name', [], DB);

    expect(rows).toHaveLength(68);
    expect(rows[0].name).toContain('000-create-schemas-and-extensions');
    expect(rows.at(-1).name).toContain('067-create-consumables');
  });

  it('rolls back to an empty database, leaving no tables, enums or schemas', () => {
    expect(afterRollback).toEqual({ tables: 0, enums: 0, schemas: 0 });
  });

  it('produces a byte-identical schema when migrated again', () => {
    expect(secondSnapshot).toBe(firstSnapshot);
  });

  it('tracks all 68 migrations again after re-migration', async () => {
    const [{ count }] = await query('SELECT count(*)::int AS count FROM "SequelizeMeta"', [], DB);

    expect(count).toBe(68);
  });
});
