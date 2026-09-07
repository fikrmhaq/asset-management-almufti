'use strict';

/**
 * Password hashing — `05-infrastructure.md` §6.3, REQ-NFR-SEC-001.
 *
 * bcrypt, cost factor 12. The cost is a constant, not configuration: lowering
 * it via an environment variable is exactly the kind of change nobody notices
 * until credentials are already cheap to crack.
 *
 * bcrypt produces a 60-character hash, which is why `users.password_hash` is
 * `CHAR(60)` (`04-data-model.md` §5.2.3).
 */

const bcrypt = require('bcrypt');

const COST_FACTOR = 12;
const HASH_LENGTH = 60;

/**
 * @param {string} plainPassword
 * @returns {Promise<string>} a 60-character bcrypt hash
 */
async function hashPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    throw new TypeError('A password is required to hash.');
  }
  return bcrypt.hash(plainPassword, COST_FACTOR);
}

/**
 * Constant-time comparison of a candidate password against a stored hash.
 *
 * Returns `false` rather than throwing on a malformed or absent hash, so a
 * corrupt row cannot be distinguished from a wrong password by timing or by
 * error shape (REQ-AUTH-004).
 *
 * @param {string} plainPassword
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plainPassword, hash) {
  if (typeof plainPassword !== 'string' || typeof hash !== 'string' || hash.length === 0) {
    return false;
  }
  try {
    return await bcrypt.compare(plainPassword, hash);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword, COST_FACTOR, HASH_LENGTH };
