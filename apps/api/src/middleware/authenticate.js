'use strict';

/**
 * Authentication middleware — `IMPLEMENTATION_PLAN.md` §9.3, `06-api.md` §1.2.
 *
 * Requires `Authorization: Bearer <accessToken>` on every endpoint except
 * `POST /auth/login` and `POST /auth/refresh`. A missing, invalid or expired
 * token returns `401 UNAUTHORIZED`.
 *
 * The token is proof of identity only. Roles and permissions are re-read from
 * the database on every request (`resolvePrincipal`), so revoking a role takes
 * effect at once rather than when the token happens to expire.
 */

const { UnauthorizedError } = require('../errors');
const { verifyAccessToken } = require('../auth/tokens');
const { resolvePrincipal } = require('../auth/principal');
const { asyncHandler } = require('../http/asyncHandler');
const { setAuditActor } = require('../http/auditContext');

const BEARER = /^Bearer (.+)$/i;

function extractBearerToken(req) {
  const header = req.get('authorization');
  if (!header) return null;

  const match = BEARER.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * @param {{resolve?: typeof resolvePrincipal, config?: object}} [options]
 * @returns {import('express').RequestHandler}
 */
function authenticate({ resolve = resolvePrincipal, config } = {}) {
  return asyncHandler(async (req, res, next) => {
    const token = extractBearerToken(req);
    if (!token) throw new UnauthorizedError('Authentication is required');

    let payload;
    try {
      payload = verifyAccessToken(token, config);
    } catch (error) {
      // Distinguish expiry from invalidity: the frontend refreshes on the
      // former and forces a re-login on the latter (`07-ui.md` §6.1).
      throw new UnauthorizedError(
        error?.name === 'TokenExpiredError'
          ? 'The access token has expired'
          : 'The access token is invalid'
      );
    }

    const principal = await resolve(payload.sub);
    // Covers a deleted account and one deactivated since the token was issued
    // (REQ-USER-004).
    if (!principal) throw new UnauthorizedError('The account is no longer active');

    req.principal = principal;
    // Everything this request writes from here on is attributed to them
    // (REQ-AUDIT-002).
    setAuditActor(principal.userId);
    next();
  });
}

module.exports = { authenticate, extractBearerToken };
