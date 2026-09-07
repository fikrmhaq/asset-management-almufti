'use strict';

/**
 * Refresh-token session storage — `05-infrastructure.md` §6.2.
 *
 * This is why Redis is required rather than optional. A pure stateless JWT
 * cannot satisfy REQ-AUTH-003 ("users MUST be able to terminate their session")
 * — a token stays valid until it expires no matter what the server does. So
 * every refresh token has a `sessionId` recorded here, and refresh only succeeds
 * while that record exists.
 *
 * Logout deletes the record. Deactivating a user deletes all of theirs, which is
 * what makes forced logout (REQ-USER-004) actually enforceable.
 *
 * The residual exposure is one access-token lifetime: an already-issued access
 * token remains valid until it expires. That is the documented trade-off of
 * §6.1's 15-minute access token.
 */

const { randomUUID } = require('node:crypto');

const { getRedis, ensureRedis } = require('../db/redis');
const { durationToMs } = require('./tokens');
const { getConfig } = require('../config');

const SESSION_PREFIX = 'session:';
/** Reverse index, so every session for a user can be revoked at once. */
const USER_SESSIONS_PREFIX = 'user-sessions:';

const sessionKey = (sessionId) => `${SESSION_PREFIX}${sessionId}`;
const userSessionsKey = (userId) => `${USER_SESSIONS_PREFIX}${userId}`;

/**
 * Records a new session and returns its id.
 *
 * @param {string} userId
 * @returns {Promise<string>} the session id to embed in the refresh token
 */
async function createSession(userId, { redis = getRedis(), config = getConfig() } = {}) {
  await ensureRedis(redis);
  const sessionId = randomUUID();
  const ttlSeconds = Math.floor(durationToMs(config.auth.refreshExpiry) / 1000);

  await redis
    .multi()
    .set(sessionKey(sessionId), userId, 'EX', ttlSeconds)
    .sadd(userSessionsKey(userId), sessionId)
    // Bound the index too, so a user who never logs out again does not leave a
    // set growing in Redis forever.
    .expire(userSessionsKey(userId), ttlSeconds)
    .exec();

  return sessionId;
}

/**
 * The user a session belongs to, or `null` if it has been revoked or expired.
 *
 * @returns {Promise<string|null>}
 */
async function getSessionUser(sessionId, { redis = getRedis() } = {}) {
  if (!sessionId) return null;
  await ensureRedis(redis);
  return redis.get(sessionKey(sessionId));
}

/** Revokes one session. Returns whether a session was actually removed. */
async function revokeSession(sessionId, { redis = getRedis() } = {}) {
  if (!sessionId) return false;
  await ensureRedis(redis);

  const userId = await redis.get(sessionKey(sessionId));
  const removed = await redis.del(sessionKey(sessionId));
  if (userId) await redis.srem(userSessionsKey(userId), sessionId);

  return removed > 0;
}

/**
 * Revokes every session belonging to a user.
 *
 * This is the mechanism behind forced logout when an administrator deactivates
 * an account mid-session (REQ-USER-004, §6.2).
 *
 * @returns {Promise<number>} how many sessions were revoked
 */
async function revokeAllUserSessions(userId, { redis = getRedis() } = {}) {
  await ensureRedis(redis);
  const sessionIds = await redis.smembers(userSessionsKey(userId));
  if (sessionIds.length === 0) return 0;

  const pipeline = redis.multi();
  for (const sessionId of sessionIds) pipeline.del(sessionKey(sessionId));
  pipeline.del(userSessionsKey(userId));
  await pipeline.exec();

  return sessionIds.length;
}

module.exports = {
  SESSION_PREFIX,
  USER_SESSIONS_PREFIX,
  sessionKey,
  userSessionsKey,
  createSession,
  getSessionUser,
  revokeSession,
  revokeAllUserSessions,
};
