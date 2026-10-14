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

  // Login is deliberately NOT rate-limited, by request: users kept being locked
  // out with 429 on sign-in. It is also exempt from the app-wide limiter (see
  // `app.js`), so a login attempt never answers 429.
  //
  // Refresh keeps its own, loose limiter: it is authenticated by a signed
  // httpOnly cookie and spent once per page load, so its ceiling sits where
  // ordinary use cannot reach it, while a stolen cookie replayed in a loop is
  // still not free.
  const refreshLimiter = rateLimiter(config.http.refreshRateLimit);

  router.post(
    '/login',
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
