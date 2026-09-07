'use strict';

/**
 * Sequelize instance — `IMPLEMENTATION_PLAN.md` §8.2.
 *
 * The schema itself is owned by the Phase 1 migrations. Sequelize never syncs,
 * never alters, and never creates: `sequelize.sync()` must not be called
 * anywhere in this codebase. Models describe the migrated schema; they do not
 * define it.
 */

const { Sequelize } = require('sequelize');

const { getConfig } = require('../config');
const { getLogger } = require('../logger');
const { sslDialectOptions } = require('./connectionSsl');

/**
 * @param {object} [config]
 * @param {import('winston').Logger} [logger]
 * @returns {Sequelize}
 */
function createSequelize(config = getConfig(), logger = getLogger()) {
  return new Sequelize(config.database.url, {
    dialect: 'postgres',
    // Starting point from 05-infrastructure.md §4, to be revisited under load.
    pool: { max: 20, min: 2, idle: 10000 },
    // SQL at debug level only, and the statement ONLY.
    //
    // Sequelize passes its full options object as the second argument, and that
    // object carries the query's bind values — including the password hash on a
    // user insert. Logging it would put credentials in the log despite the
    // redaction in src/logger.js, which matches on key names and cannot see a
    // positional array. The statement itself contains only `$1` placeholders.
    logging: config.isProduction ? false : (sql) => logger.debug(sql),
    define: {
      // Model attributes are camelCase; columns are snake_case (§1.2).
      underscored: true,
      freezeTableName: true,
      timestamps: true,
    },
    dialectOptions: {
      // Return DATE/DATEONLY as strings rather than JS Dates: a DATE column has
      // no timezone, and converting it to a Date silently shifts the day.
      useUTC: false,
      // TLS when the connection string asks for it, and nothing otherwise —
      // Sequelize drops `sslmode` from the URL, so it has to be restated here
      // (`db/connectionSsl.js`). A managed Postgres will not accept the
      // connection without this; a local container does not want it.
      ...sslDialectOptions(config.database.url),
    },
  });
}

let instance;

/** Memoized instance for the running process. */
function getSequelize() {
  if (!instance) instance = createSequelize();
  return instance;
}

/** Verifies the connection is usable. Used by bootstrap and the health check. */
async function assertDatabaseConnection(sequelize = getSequelize()) {
  await sequelize.authenticate();
}

/** Closes the pool. Called during graceful shutdown. */
async function closeSequelize() {
  if (instance) {
    await instance.close();
    instance = undefined;
  }
}

module.exports = { createSequelize, getSequelize, assertDatabaseConnection, closeSequelize };
