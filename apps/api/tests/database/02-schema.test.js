import { describe, it, expect } from 'vitest';

import { query, normalizeType } from './helpers/db.js';
import { TABLES, ENUMS, UUID_DEFAULT_TABLES, IDENTITY_TABLES } from './fixtures/schema.js';

/** Schemas, extensions, enum types, tables and columns — 04-data-model.md §2–§5. */

describe('schemas and extensions', () => {
  it('creates the documented schemas', async () => {
    const rows = await query(
      `SELECT nspname FROM pg_namespace WHERE nspname IN ('public','ref','audit') ORDER BY nspname`
    );

    expect(rows.map((r) => r.nspname)).toEqual(['audit', 'public', 'ref']);
  });

  it('enables pgcrypto for gen_random_uuid()', async () => {
    const rows = await query(`SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'`);

    expect(rows).toHaveLength(1);
  });
});

describe('enumerated types (§4)', () => {
  it.each(Object.entries(ENUMS))('%s has the documented labels in order', async (name, labels) => {
    const [schema, typeName] = name.split('.');
    const rows = await query(
      `
      SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE n.nspname = $1 AND t.typname = $2
       ORDER BY e.enumsortorder
      `,
      [schema, typeName]
    );

    expect(rows.map((r) => r.enumlabel)).toEqual(labels);
  });
});

describe('tables (§5)', () => {
  it('creates exactly the 34 documented tables', async () => {
    const rows = await query(`
      SELECT table_schema || '.' || table_name AS name
        FROM information_schema.tables
       WHERE table_schema IN ('public','ref','audit')
         AND table_type = 'BASE TABLE'
         AND table_name <> 'SequelizeMeta'
       ORDER BY name
    `);

    expect(rows.map((r) => r.name)).toEqual(Object.keys(TABLES).sort());
  });

  it.each(Object.entries(TABLES))('%s has the documented columns', async (table, expected) => {
    const [schema, name] = table.split('.');
    const rows = await query(
      `
      SELECT column_name, data_type, udt_schema, udt_name, character_maximum_length,
             numeric_precision, numeric_scale, is_nullable
        FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position
      `,
      [schema, name]
    );

    const actual = rows.map((row) => [
      row.column_name,
      normalizeType(row),
      row.is_nullable === 'NO',
    ]);

    expect(actual).toEqual(expected);
  });
});

describe('ID strategy (§1.6)', () => {
  it.each(UUID_DEFAULT_TABLES)('%s.id defaults to gen_random_uuid()', async (table) => {
    const [schema, name] = table.split('.');
    const rows = await query(
      `
      SELECT column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = 'id'
      `,
      [schema, name]
    );

    expect(rows[0].column_default).toContain('gen_random_uuid()');
  });

  it.each(IDENTITY_TABLES)('%s.id is GENERATED ALWAYS AS IDENTITY', async (table) => {
    const [schema, name] = table.split('.');
    const rows = await query(
      `
      SELECT is_identity, identity_generation FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = 'id'
      `,
      [schema, name]
    );

    expect(rows[0].is_identity).toBe('YES');
    expect(rows[0].identity_generation).toBe('ALWAYS');
  });
});

describe('column defaults', () => {
  it.each([
    ['ref.asset_classifications', 'origin', '1'],
    ['ref.attribute_definitions', 'attribute_type', "'TEXT'"],
    ['ref.attribute_definitions', 'scope', "'ASSET'"],
    ['ref.attribute_definitions', 'sort_order', '0'],
    ['ref.attribute_definitions', 'is_active', 'true'],
    ['ref.roles', 'is_system_wide', 'false'],
    ['public.institutions', 'is_active', 'true'],
    ['public.asset_units', 'lifecycle_state', "'REGISTERED'"],
    ['public.asset_unit_locations', 'is_current', 'true'],
    ['public.borrowings', 'status', "'DRAFT'"],
  ])('%s.%s defaults to %s', async (table, column, expected) => {
    const [schema, name] = table.split('.');
    const rows = await query(
      `
      SELECT column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
      `,
      [schema, name, column]
    );

    expect(rows[0].column_default).toContain(expected);
  });

  it('gives every timestamp column a now() default', async () => {
    const rows = await query(`
      SELECT table_schema || '.' || table_name AS name, column_name
        FROM information_schema.columns
       WHERE table_schema IN ('public','ref','audit')
         AND column_name IN ('created_at','updated_at','assigned_at','effective_from','timestamp')
         AND (column_default IS NULL OR column_default NOT LIKE '%now()%')
         -- ref.asset_classifications is the documented exception (Phase 17,
         -- 04-data-model.md §5.1.3). Its timestamps are nullable with no
         -- default because they mean "when the application created this row",
         -- and 14,738 of its rows were not created by the application at all. A
         -- now() default would stamp every seeded government classification
         -- with a creation time it never had.
         AND table_name <> 'asset_classifications'
    `);

    expect(rows).toEqual([]);
  });

  it('leaves the classification timestamps nullable and undefaulted (Phase 17)', async () => {
    const rows = await query(`
      SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'ref' AND table_name = 'asset_classifications'
         AND column_name IN ('created_at','updated_at')
       ORDER BY column_name
    `);

    expect(rows).toEqual([
      { column_name: 'created_at', is_nullable: 'YES', column_default: null },
      { column_name: 'updated_at', is_nullable: 'YES', column_default: null },
    ]);
  });

  it('leaves every seeded classification without a creation stamp or owner', async () => {
    const [{ count }] = await query(`
      SELECT count(*)::int AS count
        FROM ref.asset_classifications
       WHERE origin IN (1, 2)
         AND (created_at IS NOT NULL OR created_by IS NOT NULL OR institution_id IS NOT NULL)
    `);

    expect(count).toBe(0);
  });
});
