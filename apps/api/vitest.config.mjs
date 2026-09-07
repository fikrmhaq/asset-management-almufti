import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // The schema verification suite needs a live PostgreSQL instance, so it is
    // kept out of the default run and has its own config (`npm run test:db`).
    exclude: ['tests/database/**'],
    globals: false,
    restoreMocks: true,
  },
});
