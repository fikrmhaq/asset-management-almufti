import { defineConfig } from 'vitest/config';

/**
 * Schema verification suite.
 *
 * Separate from the unit suite because it needs a live PostgreSQL instance. Run
 * with `npm run test:db`. It targets TEST_DATABASE_URL, whose schemas are
 * dropped and rebuilt on every run — never point that at the development
 * database.
 *
 * Files run sequentially and in name order: `01-migration-cycle` leaves the
 * database freshly migrated, and the later files assert against that state.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/database/**/*.test.js'],
    globalSetup: ['./tests/database/globalSetup.js'],
    globals: false,
    fileParallelism: false,
    sequence: { shuffle: false, concurrent: false },
    testTimeout: 180000,
    hookTimeout: 180000,
  },
});
