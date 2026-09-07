'use strict';

/**
 * sequelize-cli configuration.
 *
 * Connection settings only — the ORM model layer is Phase 2
 * (`IMPLEMENTATION_PLAN.md` §8.2). Migrations run as a deploy step, never as a
 * side effect of application boot (`05-infrastructure.md` §11.2).
 */

const { loadDotEnvFiles } = require('../src/config');
const { sslDialectOptions } = require('../src/db/connectionSsl');

loadDotEnvFiles();

/**
 * TLS is derived from the connection string, exactly as the application derives
 * it (`src/db/connectionSsl.js`).
 *
 * Sequelize drops `sslmode` when it parses the URL, so a managed Postgres
 * refuses the CLI with `connection is insecure (try using sslmode=require)` —
 * naming a parameter the string already carries. Restating it here is what lets
 * migrations run against the same database the application will connect to.
 *
 * Read at module load rather than baked in: `use_env_variable` means the CLI
 * takes the URL from the environment, so this must read the same variable.
 */
const ssl = (name) => sslDialectOptions(process.env[name]);

const common = {
  dialect: 'postgres',
  // Starting point from 05-infrastructure.md §4, to be revisited under real load.
  pool: { max: 20, min: 2, idle: 10000 },
  migrationStorageTableName: 'SequelizeMeta',
  // Seed state is deliberately NOT tracked: every seeder is idempotent and must
  // be safe to run on each deploy (05-infrastructure.md §10.3). Tracking would
  // silently skip a seeder whose data had since been removed.
  seederStorage: 'none',
  logging: false,
};

module.exports = {
  development: {
    ...common,
    use_env_variable: 'DATABASE_URL',
    dialectOptions: ssl('DATABASE_URL'),
  },
  test: {
    ...common,
    use_env_variable: 'TEST_DATABASE_URL',
    dialectOptions: ssl('TEST_DATABASE_URL'),
  },
  production: {
    ...common,
    use_env_variable: 'DATABASE_URL',
    dialectOptions: ssl('DATABASE_URL'),
  },
};
