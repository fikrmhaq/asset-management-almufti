'use strict';

/**
 * Application-layer security — `05-infrastructure.md` §12.3.
 *
 * These are the request-layer controls only. Organization scoping (`BR-007`,
 * REQ-AUTHZ-004) is enforced in the query layer, and there is no middleware
 * substitute for it.
 */

const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { ForbiddenError } = require('../errors');

/** Security headers. */
function securityHeaders() {
  return helmet({
    // The API returns JSON, never HTML, so the default CSP has nothing to
    // protect and would only complicate serving error pages.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
}

/**
 * CORS restricted to the configured origins — never `*`
 * (`05-infrastructure.md` §12.3). `credentials` is on because the refresh token
 * is an httpOnly cookie (§6.1), which a wildcard origin could not carry anyway.
 *
 * @param {{corsOrigins: string[]}} httpConfig
 */
function corsPolicy({ corsOrigins }) {
  return cors({
    origin(origin, callback) {
      // Same-origin and non-browser callers (curl, health checks) send no Origin.
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new ForbiddenError('Origin is not allowed'));
    },
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
}

/**
 * Request-layer rate limiting (REQ-NFR-SEC-004).
 *
 * This is the baseline for the whole API. Auth endpoints get their own,
 * stricter limiter in Phase 3 — `05-infrastructure.md` §12.3 calls them out
 * specifically, and a limit loose enough for browsing assets is far too loose
 * for password attempts.
 *
 * @param {{windowMs: number, max: number}} rateLimitConfig
 */
function rateLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Emit the documented error envelope rather than express-rate-limit's default.
    handler(req, res) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please retry later.',
        },
      });
    },
  });
}

module.exports = { securityHeaders, corsPolicy, rateLimiter };
