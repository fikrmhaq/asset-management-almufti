'use strict';

/**
 * Seeds `ref.permissions` and grants every code to the System Admin role.
 *
 * Deferred here from Phase 1 by decision: `06-api.md` §1.3 and
 * `05-infrastructure.md` §10.3 both require the catalog to be generated from the
 * operations the API actually guards, and there were no routes to generate from
 * until this phase.
 *
 * The catalog comes from `src/auth/permissionCatalog.js`, which derives every
 * code as `{resource}:{action}` — this seeder never contains a hand-written
 * list, which is what stops the catalog and the enforced routes drifting apart
 * (REQ-ROLE-006, BR-013).
 *
 * Idempotent, so it is safe on every deploy (§10.3). Re-running it after a later
 * phase adds resources will insert the new codes and grant them to System Admin,
 * which is exactly the intended behaviour.
 */

const { getCatalog } = require('../src/auth/permissionCatalog');

const SYSTEM_ADMIN_ROLE_NAME = 'System Admin';

function buildInsert(entries) {
  const values = [];
  const placeholders = entries.map((entry, index) => {
    values.push(entry.code, entry.description);
    return `($${index * 2 + 1}, $${index * 2 + 2})`;
  });

  return {
    sql: `
      INSERT INTO ref.permissions (code, description)
      VALUES ${placeholders.join(', ')}
      -- Descriptions are generated, so refresh them rather than skipping the row.
      ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
    `,
    values,
  };
}

module.exports = {
  async up(queryInterface) {
    const catalog = getCatalog();

    await queryInterface.sequelize.transaction(async (transaction) => {
      const { sql, values } = buildInsert(catalog);
      await queryInterface.sequelize.query(sql, { bind: values, transaction });

      // Grant everything to System Admin (05-infrastructure.md §10.3). This is a
      // real grant, not an implicit bypass, so the role's authority is visible
      // in the same table as every other role's.
      await queryInterface.sequelize.query(
        `
        INSERT INTO public.role_permissions (role_id, permission_code)
        SELECT r.id, p.code
          FROM ref.roles r
          CROSS JOIN ref.permissions p
         WHERE r.name = $1
        ON CONFLICT (role_id, permission_code) DO NOTHING;
        `,
        { bind: [SYSTEM_ADMIN_ROLE_NAME], transaction }
      );
    });

    const [[{ permissions }]] = await queryInterface.sequelize.query(
      'SELECT count(*)::int AS permissions FROM ref.permissions;'
    );
    const [[{ grants }]] = await queryInterface.sequelize.query(
      `SELECT count(*)::int AS grants
         FROM public.role_permissions rp
         JOIN ref.roles r ON r.id = rp.role_id
        WHERE r.name = $1;`,
      { bind: [SYSTEM_ADMIN_ROLE_NAME] }
    );

    console.log(
      `[seed] ref.permissions holds ${permissions} code(s); ` +
        `"${SYSTEM_ADMIN_ROLE_NAME}" granted ${grants}`
    );
  },

  async down(queryInterface) {
    // role_permissions cascades from the permission delete (04-data-model.md §8.2).
    await queryInterface.sequelize.query('DELETE FROM ref.permissions;');
  },
};
