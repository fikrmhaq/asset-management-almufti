'use strict';

/**
 * Application bootstrap and lifecycle — `IMPLEMENTATION_PLAN.md` §8.1.
 *
 * Order matters: configuration is validated, then the datastores are proven
 * reachable, and only then does the port open. A process that binds first and
 * discovers a broken database later would be marked healthy by its orchestrator
 * while serving 500s.
 *
 * Migrations are NOT run here. They are a deploy step
 * (`05-infrastructure.md` §11.2).
 */

const { loadDotEnvFiles, loadConfig } = require('./config');
const { createApp } = require('./app');
const { createLogger } = require('./logger');
const { assertDatabaseConnection, closeSequelize } = require('./db/sequelize');
const { pingRedis, closeRedis } = require('./db/redis');
const { startJobs, stopJobs } = require('./jobs');

const SHUTDOWN_TIMEOUT_MS = 10000;

async function start() {
  loadDotEnvFiles();

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // The logger needs config, so this one failure has to use the console.
    console.error(`[api] ${error.message}`);
    process.exit(1);
  }

  const logger = createLogger(config);

  try {
    await assertDatabaseConnection();
    logger.info('database connection established');
    await pingRedis();
    logger.info('redis connection established');
  } catch (error) {
    // Sequelize wraps driver failures and often leaves its own message empty,
    // so fall back to the original error before giving up on a useful line.
    logger.error('failed to reach a required datastore', {
      error: error.message || error.original?.message || error.name,
    });
    await shutdownResources(logger);
    process.exit(1);
  }

  // The worker shares this process — `05-infrastructure.md` §7.3. Started after
  // the datastores are proven, so it never picks up a job it cannot complete.
  let jobs = null;
  try {
    jobs = await startJobs({ config, logger });
  } catch (error) {
    logger.error('failed to start background jobs', { error: error.message });
    await shutdownResources(logger);
    process.exit(1);
  }

  const server = createApp({ config, logger }).listen(config.port, () => {
    logger.info('api listening', { port: config.port, env: config.nodeEnv });
  });

  registerShutdownHandlers(server, logger, jobs);
  registerCrashHandlers(logger);

  return server;
}

async function shutdownResources(logger, jobs = null) {
  // Jobs first: the worker holds its own Redis connections and may be mid-job,
  // so it has to finish before the pools it depends on are closed.
  await stopJobs(jobs, { logger });

  const results = await Promise.allSettled([closeSequelize(), closeRedis()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn('error while closing a connection', { error: result.reason?.message });
    }
  }
}

/**
 * Graceful shutdown: stop accepting connections, drain in-flight requests, then
 * close the datastore pools. The timer is the backstop for a request that never
 * finishes — a container that refuses to stop is worse than a dropped response.
 */
function registerShutdownHandlers(server, logger, jobs = null) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });

    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out, exiting immediately');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async () => {
      await shutdownResources(logger, jobs);
      clearTimeout(forceExit);
      logger.info('shutdown complete');
      process.exit(0);
    });
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(signal));
  }
}

/**
 * An unhandled rejection or uncaught exception leaves the process in an unknown
 * state. Log it and exit non-zero so the orchestrator restarts cleanly rather
 * than letting it limp along.
 */
function registerCrashHandlers(logger) {
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { error: reason?.message ?? reason });
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

if (require.main === module) {
  start();
}

module.exports = { start };
