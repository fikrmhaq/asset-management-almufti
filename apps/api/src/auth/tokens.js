'use strict';

/**
 * JWT issuing and verification — `05-infrastructure.md` §6.1.
 *
 * Access token  — short-lived (15 min), `Authorization: Bearer`, carries
 *                 `userId`, `roleIds` and `institutionId`. REQ-AUTHZ-004's
 *                 org scoping reads `institutionId` off it.
 * Refresh token — long-lived (7 days), httpOnly cookie, carries only a
 *                 `sessionId` and `userId`. It deliberately carries no roles or
 *                 permissions: those are re-read on refresh so a permission
 *                 change takes effect within one access-token lifetime.
 *
 * The two are signed with different secrets and stamped with distinct `typ`
 * claims, so neither can be presented in the other's place even if a secret
 * were ever reused.
 */

const jwt = require('jsonwebtoken');

const { getConfig } = require('../config');

const TOKEN_TYPE = Object.freeze({ ACCESS: 'access', REFRESH: 'refresh' });
const ISSUER = 'asset-management-api';

/**
 * @param {{userId: string, roleIds: string[], institutionId: string|null}} claims
 * @param {object} [config]
 * @returns {string}
 */
function signAccessToken({ userId, roleIds, institutionId }, config = getConfig()) {
  return jwt.sign(
    { typ: TOKEN_TYPE.ACCESS, roleIds, institutionId: institutionId ?? null },
    config.auth.accessSecret,
    { subject: userId, expiresIn: config.auth.accessExpiry, issuer: ISSUER }
  );
}

/**
 * @param {{userId: string, sessionId: string}} claims
 * @param {object} [config]
 * @returns {string}
 */
function signRefreshToken({ userId, sessionId }, config = getConfig()) {
  return jwt.sign({ typ: TOKEN_TYPE.REFRESH, sessionId }, config.auth.refreshSecret, {
    subject: userId,
    expiresIn: config.auth.refreshExpiry,
    issuer: ISSUER,
  });
}

/**
 * Verifies a token and asserts it is of the expected type.
 *
 * @throws {jsonwebtoken.JsonWebTokenError|jsonwebtoken.TokenExpiredError}
 */
function verifyToken(token, expectedType, config = getConfig()) {
  const secret =
    expectedType === TOKEN_TYPE.ACCESS ? config.auth.accessSecret : config.auth.refreshSecret;

  const payload = jwt.verify(token, secret, { issuer: ISSUER });

  if (payload.typ !== expectedType) {
    throw new jwt.JsonWebTokenError(`Expected a ${expectedType} token`);
  }

  return payload;
}

const verifyAccessToken = (token, config) => verifyToken(token, TOKEN_TYPE.ACCESS, config);
const verifyRefreshToken = (token, config) => verifyToken(token, TOKEN_TYPE.REFRESH, config);

/**
 * Milliseconds for a `jsonwebtoken` duration string (`15m`, `7d`, `3600`).
 * Used to align the Redis session TTL with the refresh token's own lifetime.
 */
function durationToMs(duration) {
  if (typeof duration === 'number') return duration * 1000;

  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(String(duration).trim());
  if (!match) throw new Error(`Unsupported duration: ${duration}`);

  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];

  return value * multiplier;
}

module.exports = {
  TOKEN_TYPE,
  ISSUER,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  verifyAccessToken,
  verifyRefreshToken,
  durationToMs,
};
