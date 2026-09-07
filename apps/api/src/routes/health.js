'use strict';

/**
 * Health check — `05-infrastructure.md` §8.2.
 *
 * Used by Docker's HEALTHCHECK and Nginx's upstream check. It reports DB and
 * Redis connectivity rather than only "the process is up", because a process
 * that cannot reach its datastores should be taken out of rotation.
 *
 * Mounted at `/api/health`, deliberately outside `/api/v1`: infrastructure polls
 * it, and its path must not move when the API is versioned.
 */

const { Router } = require('express');

const { assertDatabaseConnection } = require('../db/sequelize');
const { pingRedis } = require('../db/redis');
const { asyncHandler } = require('../http/asyncHandler');
const { getLogger } = require('../logger');

const CHECK_TIMEOUT_MS = 3000;

/** Bounds a check so a hung datastore cannot hold the health request open. */
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} check timed out`)), CHECK_TIMEOUT_MS).unref()
    ),
  ]);
}

async function runCheck(label, check, logger) {
  try {
    await withTimeout(check(), label);
    return { status: 'up' };
  } catch (error) {
    logger.error(`health check failed: ${label}`, { error: error.message });
    // The reason is intentionally omitted: this endpoint is reachable through
    // Nginx and must not disclose connection strings or driver internals.
    return { status: 'down' };
  }
}

/**
 * @param {{logger?: import('winston').Logger,
 *          checkDatabase?: () => Promise<unknown>,
 *          checkRedis?: () => Promise<unknown>}} [options]
 *   The checks are injectable so the endpoint's contract can be tested without
 *   standing up PostgreSQL and Redis.
 */
function healthRouter({
  logger = getLogger(),
  checkDatabase = assertDatabaseConnection,
  checkRedis = pingRedis,
} = {}) {
  const router = Router();

  router.get(
    '/health',
    asyncHandler(async (req, res) => {
      const [database, redis] = await Promise.all([
        runCheck('postgres', checkDatabase, logger),
        runCheck('redis', checkRedis, logger),
      ]);

      const healthy = database.status === 'up' && redis.status === 'up';

      // 503 when a dependency is down, so orchestrators react to the status code
      // and not only to the body.
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        checks: { database, redis },
        uptimeSeconds: Math.floor(process.uptime()),
      });
    })
  );

  return router;
}

module.exports = { healthRouter };
