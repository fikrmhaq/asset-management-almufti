import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { loadConfig } = require('../../src/config/index.js');
const { createLogger } = require('../../src/logger.js');
const { createApp } = require('../../src/app.js');

/**
 * A configuration that does not depend on the developer's `.env`, so the unit
 * suite behaves identically on any machine and in CI.
 */
export const TEST_ENV = Object.freeze({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/asset_management_unit',
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_PATH: './storage/attachments',
  MAX_UPLOAD_SIZE_MB: '10',
  CORS_ORIGIN: 'http://localhost:5173',
  // Fixed, distinct, obviously-not-real secrets. Never reuse these anywhere.
  JWT_ACCESS_SECRET: 'test-access-secret-not-for-real-use-0000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-not-for-real-use-000',
});

/** A logger that writes nowhere, so a failing assertion is not buried in output. */
export function silentLogger() {
  const logger = createLogger(loadConfig(TEST_ENV));
  logger.silent = true;
  return logger;
}

/**
 * Builds the application with injected config, a silent logger, and health
 * checks that resolve by default — no PostgreSQL or Redis required.
 *
 * @param {{env?: object, health?: object}} [overrides]
 */
export function buildTestApp({ env = {}, health = {} } = {}) {
  return createApp({
    config: loadConfig({ ...TEST_ENV, ...env }),
    logger: silentLogger(),
    health: {
      checkDatabase: async () => undefined,
      checkRedis: async () => 'PONG',
      ...health,
    },
  });
}
