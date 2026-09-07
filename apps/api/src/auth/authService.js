'use strict';

/**
 * Authentication use cases — `IMPLEMENTATION_PLAN.md` §9.1.
 *
 * Business logic lives here, not in the controllers (§29, REQ-NFR-MAIN-002).
 */

const { getModels } = require('../db/models');
const { UnauthorizedError } = require('../errors');
const { verifyPassword } = require('./password');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('./tokens');
const { createSession, getSessionUser, revokeSession } = require('./sessionStore');
const { resolvePrincipal, toPublicProfile } = require('./principal');

/**
 * A single message for every failure mode.
 *
 * REQ-AUTH-004: never reveal whether it was the username or the password that
 * was wrong, and never reveal that an account exists but is deactivated. All
 * three must be indistinguishable to the caller.
 */
const GENERIC_CREDENTIALS_MESSAGE = 'Invalid username or password';

/**
 * A bcrypt hash of a value nobody can supply, compared against when no user
 * matched. Without it, a missing username would return measurably faster than a
 * wrong password and the endpoint would leak account existence by timing.
 */
const TIMING_DECOY_HASH = '$2b$12$......................................................';

function issueTokens(principal, sessionId, config) {
  return {
    accessToken: signAccessToken(
      {
        userId: principal.userId,
        roleIds: principal.roleIds,
        institutionId: principal.institutionId,
      },
      config
    ),
    refreshToken: signRefreshToken({ userId: principal.userId, sessionId }, config),
  };
}

/**
 * Authenticates a username/password pair — REQ-AUTH-002.
 *
 * @returns {Promise<{accessToken: string, refreshToken: string, user: object}>}
 * @throws {UnauthorizedError} for unknown user, wrong password, or inactive account
 */
async function login({ username, password }, { models = getModels(), config } = {}) {
  const user = await models.User.scope('withPassword').findOne({ where: { username } });

  // Always run a comparison, even with no user, so both paths cost the same.
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? TIMING_DECOY_HASH);

  if (!user || !passwordMatches || !user.isActive) {
    throw new UnauthorizedError(GENERIC_CREDENTIALS_MESSAGE);
  }

  const principal = await resolvePrincipal(user.id, { models });
  if (!principal) throw new UnauthorizedError(GENERIC_CREDENTIALS_MESSAGE);

  const sessionId = await createSession(principal.userId, { config });

  return {
    ...issueTokens(principal, sessionId, config),
    user: await toPublicProfile(principal, { models }),
  };
}

/**
 * Exchanges a refresh token for a new access token — REQ-AUTH-005.
 *
 * The session must still exist in Redis and the user must still be active, so a
 * logout or a mid-session deactivation stops refreshes immediately (§6.2).
 *
 * The refresh token is not rotated: `05-infrastructure.md` §6.2 specifies
 * checking the session and issuing a new access token, and nothing more.
 */
async function refresh({ refreshToken }, { models = getModels(), config } = {}) {
  if (!refreshToken) throw new UnauthorizedError('No refresh token was provided');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken, config);
  } catch {
    throw new UnauthorizedError('The refresh token is invalid or has expired');
  }

  const sessionUserId = await getSessionUser(payload.sessionId);
  if (!sessionUserId || sessionUserId !== payload.sub) {
    throw new UnauthorizedError('The session has ended. Please sign in again.');
  }

  const principal = await resolvePrincipal(payload.sub, { models });
  if (!principal) {
    // The account was deactivated or deleted while the session was live.
    await revokeSession(payload.sessionId);
    throw new UnauthorizedError('The session has ended. Please sign in again.');
  }

  const { accessToken } = issueTokens(principal, payload.sessionId, config);

  return { accessToken, user: await toPublicProfile(principal, { models }) };
}

/**
 * Ends a session — REQ-AUTH-003.
 *
 * Succeeds even when the token is missing or already invalid: logging out is
 * idempotent, and telling a caller their token was malformed would leak more
 * than it helps.
 *
 * @returns {Promise<{revoked: boolean}>}
 */
async function logout({ refreshToken }, { config } = {}) {
  if (!refreshToken) return { revoked: false };

  try {
    const payload = verifyRefreshToken(refreshToken, config);
    return { revoked: await revokeSession(payload.sessionId) };
  } catch {
    return { revoked: false };
  }
}

/** The current user's profile, roles and effective permissions — REQ-AUTH-001. */
async function currentUser(principal, { models } = {}) {
  return toPublicProfile(principal, models ? { models } : undefined);
}

module.exports = {
  login,
  refresh,
  logout,
  currentUser,
  GENERIC_CREDENTIALS_MESSAGE,
};
