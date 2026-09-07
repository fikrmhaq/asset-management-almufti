'use strict';

/**
 * Seeds the `System Admin` role.
 *
 * `05-infrastructure.md` §10.3: without at least one system-wide role present on
 * a fresh install, REQ-ROLE-001's "authorized administrators manage roles" has
 * nobody who qualifies. Seeding the role resolves that bootstrap problem.
 *
 * Deliberately NOT seeded here:
 *
 *   - `public.role_permissions` — granting every permission to this role
 *     requires `ref.permissions` to be populated, and that catalog is generated
 *     from the routes the API enforces (`06-api.md` §1.3), which do not exist
 *     until Phase 3. Both are seeded there, by decision.
 *
 *   - Any user. A baked-in default password is a real credential risk; the first
 *     user is created by a one-time bootstrap command in Phase 3
 *     (`05-infrastructure.md` §10.3).
 *
 * Idempotent through `uq_roles_name`.
 */

const SYSTEM_ADMIN_ROLE_NAME = 'System Admin';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `
      INSERT INTO ref.roles (name, is_system_wide)
      VALUES ($1, true)
      ON CONFLICT ON CONSTRAINT uq_roles_name DO NOTHING;
      `,
      { bind: [SYSTEM_ADMIN_ROLE_NAME] }
    );

    const [[{ count }]] = await queryInterface.sequelize.query(
      'SELECT count(*)::int AS count FROM ref.roles WHERE name = $1;',
      { bind: [SYSTEM_ADMIN_ROLE_NAME] }
    );
    console.log(`[seed] ref.roles "${SYSTEM_ADMIN_ROLE_NAME}" present: ${count === 1}`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM ref.roles WHERE name = $1;', {
      bind: [SYSTEM_ADMIN_ROLE_NAME],
    });
  },
};
