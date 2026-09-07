'use strict';

/**
 * Authentication endpoints — `06-api.md` §2.
 *
 *   POST /auth/login    REQ-AUTH-002
 *   POST /auth/refresh  REQ-AUTH-005
 *   POST /auth/logout   REQ-AUTH-003
 *   GET  /auth/me       REQ-AUTH-001
 *
 * These are authenticated but NOT permission-gated: a signed-in user must always
 * be able to read their own profile and end their own session, whatever
 * permissions they hold.
 */

const { Router } = require('express');
const { z } = require('zod');

const { getConfig } = require('../../config');
const authService = require('../../auth/authService');
const { durationToMs } = require('../../auth/tokens');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendNoContent } = require('../../http/respond');
const { authenticate } = require('../../middleware/authenticate');
const { validate } = require('../../middleware/validate');
const { rateLimiter } = require('../../middleware/security');

const REFRESH_COOKIE = 'refreshToken';

const loginSchema = z.object({
  username: z.string().min(1, 'is required').max(25),
  password: z.string().min(1, 'is required'),
});

/**
 * Cookie options for the refresh token — `05-infrastructure.md` §6.1.
 *
 * `httpOnly` keeps it out of reach of JavaScript, so an XSS flaw cannot exfiltrate
 * it. `sameSite: 'strict'` blocks cross-site submission. `path` scopes it to the
 * only two endpoints that read it, so it is not attached to every API call.
 */
function refreshCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: durationToMs(config.auth.refreshExpiry),
  };
}

function authRouter({ config = getConfig(), service = authService } = {}) {
  const router = Router();

  // Stricter than the global limiter: this is the control that makes password
  // guessing impractical (§12.3, REQ-NFR-SEC-004).
  const loginLimiter = rateLimiter(config.http.authRateLimit);

  // Refresh gets its OWN, far looser limiter, and this separation matters.
  //
  // It used to share `loginLimiter`. But refresh is not a guessing surface — it
  // is authenticated by a signed httpOnly cookie, so there is no secret to try
  // repeatedly — while it IS spent once on every single page load. Sharing a
  // ceiling of 10 per 15 minutes meant the eleventh reload returned 429, the
  // client read that as "not signed in", and the user was silently logged out of
  // a perfectly valid session.
  //
  // A limit still applies, so a stolen cookie replayed in a loop is not free. It
  // is set where ordinary use cannot reach it.
  const refreshLimiter = rateLimiter(config.http.refreshRateLimit);

  router.post(
    '/login',
    loginLimiter,
    validate({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      const { accessToken, refreshToken, user } = await service.login(req.body, { config });

      res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(config));
      sendItem(res, { accessToken, user });
    })
  );

  router.post(
    '/refresh',
    refreshLimiter,
    asyncHandler(async (req, res) => {
      const { accessToken, user } = await service.refresh(
        { refreshToken: req.cookies?.[REFRESH_COOKIE] },
        { config }
      );

      sendItem(res, { accessToken, user });
    })
  );

  router.post(
    '/logout',
    authenticate({ config }),
    asyncHandler(async (req, res) => {
      await service.logout({ refreshToken: req.cookies?.[REFRESH_COOKIE] }, { config });

      // Clear with the same attributes it was set with, or the browser keeps it.
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(config));
      sendNoContent(res);
    })
  );

  router.get(
    '/me',
    authenticate({ config }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.currentUser(req.principal));
    })
  );

  return router;
}

module.exports = { authRouter, REFRESH_COOKIE, refreshCookieOptions };
