'use strict';

/**
 * Express application factory — `IMPLEMENTATION_PLAN.md` §8.1, §8.3, §8.4.
 *
 * Middleware order is load-bearing:
 *
 *   1. `trust proxy` — Nginx terminates TLS (`05-infrastructure.md` §12.1), so
 *      without this every client looks like the proxy and rate limiting would
 *      bucket the entire internet together.
 *   2. request id and access log — so even a rejected request is traceable.
 *   3. security headers, CORS, rate limit — reject unwanted traffic before
 *      spending effort parsing its body.
 *   4. body parsers, bounded by config.
 *   5. routes.
 *   6. 404, then the error handler, which must be last.
 */

const express = require('express');
const cookieParser = require('cookie-parser');

const { getConfig } = require('./config');
const { getLogger } = require('./logger');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { requestId, requestLogger } = require('./middleware/requestContext');
const { auditContext } = require('./http/auditContext');
const { securityHeaders, corsPolicy, rateLimiter } = require('./middleware/security');
const { healthRouter } = require('./routes/health');
const { v1Router } = require('./routes/v1');

/**
 * @param {{config?: object, logger?: import('winston').Logger,
 *          health?: {checkDatabase?: () => Promise<unknown>,
 *                    checkRedis?: () => Promise<unknown>}}} [options]
 * @returns {import('express').Express}
 */
function createApp({ config = getConfig(), logger = getLogger(), health = {} } = {}) {
  const app = express();

  app.disable('x-powered-by');
  // One proxy hop: Nginx. Not `true`, which would trust any forwarded header.
  app.set('trust proxy', 1);

  app.use(requestId());
  app.use(requestLogger({ logger }));
  // Binds the actor and client IP that audit rows are stamped with (§14.4).
  // Must sit above the routes so every handler runs inside it.
  app.use(auditContext());

  app.use(securityHeaders());
  app.use(corsPolicy(config.http));
  // Login is never rate-limited, so a sign-in never answers 429.
  app.use(
    rateLimiter(config.http.rateLimit, {
      skip: (req) => req.method === 'POST' && req.path === '/api/v1/auth/login',
    })
  );

  const bodyLimit = `${config.http.maxRequestBodyKb}kb`;
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: bodyLimit }));
  // The refresh token is an httpOnly cookie (05-infrastructure.md §6.1).
  app.use(cookieParser());

  // Infrastructure polls this; it is not part of the versioned contract.
  app.use('/api', healthRouter({ logger, ...health }));
  app.use('/api/v1', v1Router({ config }));

  app.use(notFound());
  app.use(errorHandler({ logger }));

  return app;
}

module.exports = { createApp };
