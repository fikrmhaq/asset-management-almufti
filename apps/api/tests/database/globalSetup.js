import {
  closePools,
  cycleDatabaseUrl,
  ensureDatabase,
  mainDatabaseUrl,
  migrate,
  resetDatabase,
  seed,
} from './helpers/db.js';

/**
 * Brings both verification databases to a known state before any test runs.
 *
 * The main database is migrated and seeded here rather than by a test file, so
 * no file depends on another's ordering — Vitest does not guarantee file order.
 * The cycle database is left empty for the migration-cycle test, which owns it.
 */
export async function setup() {
  const main = mainDatabaseUrl();
  const cycle = cycleDatabaseUrl();

  await Promise.all([ensureDatabase(main), ensureDatabase(cycle)]);
  await Promise.all([resetDatabase(main), resetDatabase(cycle)]);

  await migrate(main);
  await seed(main);

  await closePools();
}

export async function teardown() {
  await closePools();
}
