'use strict';

/**
 * First-user bootstrap — `IMPLEMENTATION_PLAN.md` §9.4,
 * `05-infrastructure.md` §10.3.
 *
 * No user is seeded, deliberately: a baked-in default password is a real
 * credential risk, because someone always forgets to change it. Instead the
 * first account is created once, by hand, after deploy — and from there that
 * user creates institutions and institution-scoped roles through the normal
 * application flow.
 *
 * The service is separate from the CLI so the rules below are testable without
 * driving an interactive prompt.
 */

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { hashPassword } = require('./password');

const SYSTEM_ADMIN_ROLE_NAME = 'System Admin';
const MIN_PASSWORD_LENGTH = 12;

class BootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootstrapError';
  }
}

/**
 * Validates a candidate password.
 *
 * The floor is length. Requiring particular character classes pushes people
 * toward `Passw0rd!` — length is what actually costs an attacker.
 */
function assertUsablePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new BootstrapError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

/**
 * Creates the first user and assigns the seeded System Admin role.
 *
 * Safety checks, in order:
 *   1. Refuses if ANY user already exists. This command exists to solve a
 *      chicken-and-egg problem; once solved, further accounts are created
 *      through the API where they are authorized and audited.
 *   2. Requires the System Admin role to have been seeded, rather than creating
 *      it — a role invented here would not carry the seeded permission grants.
 *   3. Enforces a minimum password length.
 *
 * The user and the role assignment are written in one transaction, so a failure
 * cannot leave an account with no role (REQ-NFR-REL-002).
 *
 * @returns {Promise<{id: string, username: string, role: string}>}
 */
async function bootstrapAdmin(
  { username, password, firstName = 'System', lastName = 'Administrator', contactInfo = null },
  { models = getModels(), sequelize = getSequelize() } = {}
) {
  if (!username || typeof username !== 'string') {
    throw new BootstrapError('A username is required.');
  }
  assertUsablePassword(password);

  const existingUsers = await models.User.count();
  if (existingUsers > 0) {
    throw new BootstrapError(
      `Bootstrap refused: ${existingUsers} user(s) already exist. ` +
        'Create further accounts through the API, where they are authorized and audited.'
    );
  }

  const role = await models.Role.findOne({ where: { name: SYSTEM_ADMIN_ROLE_NAME } });
  if (!role) {
    throw new BootstrapError(
      `The "${SYSTEM_ADMIN_ROLE_NAME}" role is missing. Run the seeders first: npm run db:seed`
    );
  }

  const passwordHash = await hashPassword(password);

  return withTransaction(
    async (transaction) => {
      const user = await models.User.create(
        { username, passwordHash, firstName, lastName, contactInfo, isActive: true },
        { transaction }
      );

      await models.UserRole.create({ userId: user.id, roleId: role.id }, { transaction });

      return { id: user.id, username: user.username, role: role.name };
    },
    { sequelize }
  );
}

module.exports = {
  bootstrapAdmin,
  BootstrapError,
  SYSTEM_ADMIN_ROLE_NAME,
  MIN_PASSWORD_LENGTH,
};
