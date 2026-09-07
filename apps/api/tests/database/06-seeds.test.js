import { describe, it, expect, beforeAll } from 'vitest';

import { query, seed, seedUndoAll } from './helpers/db.js';

/**
 * Seed data — `IMPLEMENTATION_PLAN.md` §7.10, `05-infrastructure.md` §10.3.
 *
 * Runs the seeders twice to prove idempotency, since they must be safe to
 * execute on every deploy.
 */

const EXPECTED_CLASSIFICATIONS = 14738;
const ORPHANED_IDS = ['202010500200', '202010500300', '202010500400'];

async function classificationCount() {
  const [{ count }] = await query('SELECT count(*)::int AS count FROM ref.asset_classifications');
  return count;
}

describe('seed execution', () => {
  let firstRunCount;
  let secondRunCount;

  beforeAll(async () => {
    await seedUndoAll();
    await seed();
    firstRunCount = await classificationCount();

    await seed();
    secondRunCount = await classificationCount();
  });

  it('loads every classification row from the source data', () => {
    expect(firstRunCount).toBe(EXPECTED_CLASSIFICATIONS);
  });

  it('is idempotent — a second run changes nothing', () => {
    expect(secondRunCount).toBe(firstRunCount);
  });

  it('preserves the source identifiers unchanged (REQ-CLASS-005)', async () => {
    const rows = await query(
      `SELECT id, name FROM ref.asset_classifications WHERE trim(id) IN ('100000000000', '117010101001')
       ORDER BY id`
    );

    expect(rows.map((r) => [r.id.trim(), r.name])).toEqual([
      ['100000000000', 'ASET'],
      ['117010101001', 'Aspal'],
    ]);
  });

  it('keeps every id at the natural key width', async () => {
    const [{ count }] = await query(
      `SELECT count(*)::int AS count FROM ref.asset_classifications WHERE length(id) <> 12`
    );

    expect(count).toBe(0);
  });

  it('preserves the parent hierarchy', async () => {
    const [{ count }] = await query(`
      SELECT count(*)::int AS count
        FROM ref.asset_classifications c
        LEFT JOIN ref.asset_classifications p ON p.id = c.parent_id
       WHERE c.parent_id IS NOT NULL AND p.id IS NULL
    `);

    expect(count).toBe(0);
  });

  it('loads the documented single root plus the three orphaned rows as roots', async () => {
    const rows = await query(
      `SELECT trim(id) AS id FROM ref.asset_classifications WHERE parent_id IS NULL ORDER BY id`
    );

    expect(rows.map((r) => r.id)).toEqual(['100000000000', ...ORPHANED_IDS]);
  });

  it('does not synthesize the missing parent record', async () => {
    const rows = await query(
      `SELECT 1 FROM ref.asset_classifications WHERE trim(id) = '202010500000'`
    );

    expect(rows).toHaveLength(0);
  });

  it('leaves category_id unset, since the source data carries no category', async () => {
    const [{ count }] = await query(
      `SELECT count(*)::int AS count FROM ref.asset_classifications WHERE category_id IS NOT NULL`
    );

    expect(count).toBe(0);
  });

  it('records the origin values present in the source data', async () => {
    const rows = await query(
      `SELECT origin, count(*)::int AS count FROM ref.asset_classifications
       GROUP BY origin ORDER BY origin`
    );

    expect(rows).toEqual([
      { origin: 1, count: 14679 },
      { origin: 2, count: 59 },
    ]);
  });

  it('seeds exactly one system-wide System Admin role', async () => {
    const rows = await query(
      `SELECT name, is_system_wide FROM ref.roles WHERE name = 'System Admin'`
    );

    expect(rows).toEqual([{ name: 'System Admin', is_system_wide: true }]);
  });

  it('seeds no other roles', async () => {
    const [{ count }] = await query('SELECT count(*)::int AS count FROM ref.roles');

    expect(count).toBe(1);
  });

  it('seeds no users — the first user comes from the Phase 3 bootstrap command', async () => {
    const [{ count }] = await query('SELECT count(*)::int AS count FROM public.users');

    expect(count).toBe(0);
  });

  it('seeds the generated permission catalog and grants it all to System Admin', async () => {
    // Phase 3 added this seeder. The catalog's contents are asserted against the
    // generator in 08-auth.test.js; here we only check the seed ran and that
    // System Admin holds every code (05-infrastructure.md §10.3).
    const [{ permissions }] = await query(
      'SELECT count(*)::int AS permissions FROM ref.permissions'
    );
    const [{ grants }] = await query(`
      SELECT count(*)::int AS grants
        FROM public.role_permissions rp
        JOIN ref.roles r ON r.id = rp.role_id
       WHERE r.name = 'System Admin'
    `);

    expect(permissions).toBeGreaterThan(0);
    expect(grants).toBe(permissions);
  });

  it('leaves every other reference table empty (05-infrastructure.md §10.3)', async () => {
    const counts = await query(`
      SELECT 'categories' AS name, count(*)::int AS count FROM ref.categories
      UNION ALL SELECT 'measurement_units', count(*)::int FROM ref.measurement_units
      UNION ALL SELECT 'contract_types', count(*)::int FROM ref.contract_types
      UNION ALL SELECT 'funding_sources', count(*)::int FROM ref.funding_sources
      UNION ALL SELECT 'account_codes', count(*)::int FROM ref.account_codes
      UNION ALL SELECT 'transaction_types', count(*)::int FROM ref.transaction_types
      ORDER BY name
    `);

    expect(counts.filter((row) => row.count !== 0)).toEqual([]);
  });
});

describe('seed rollback', () => {
  it('removes seeded data and can reload it', async () => {
    await seedUndoAll();

    const [{ classifications }] = await query(
      'SELECT count(*)::int AS classifications FROM ref.asset_classifications'
    );
    const [{ roles }] = await query('SELECT count(*)::int AS roles FROM ref.roles');
    expect({ classifications, roles }).toEqual({ classifications: 0, roles: 0 });

    await seed();
    expect(await classificationCount()).toBe(EXPECTED_CLASSIFICATIONS);
  });
});
