'use strict';

/**
 * Phase 22 (`CR-003`) — the third organization-scope tier.
 * `04-data-model.md` §5.1.1, creation order #42. REQ-ROLE-011, `BR-023`.
 *
 * Until now a caller reached either every institution (`is_system_wide`) or
 * their own (everyone else). This adds a narrower tier: a role whose holders
 * reach only the asset units of departments they are CURRENTLY the person in
 * charge of.
 *
 * ── Why a Role flag and not a User one ─────────────────────────────────────
 *
 * Scope is a property of what someone is authorized to do, which this system
 * already expresses through roles — `is_system_wide` lifts scope, and it lives
 * here. Putting the narrowing on the user instead would mean two places decide
 * reach, and the same person could not hold a broad role in one capacity and a
 * narrow one in another.
 *
 * ── Aggregation ────────────────────────────────────────────────────────────
 *
 * `is_system_wide` aggregates with `.some()` — one such role lifts scope for the
 * whole principal, because it GRANTS. This flag RESTRICTS, so it aggregates with
 * `.every()`: a user is PIC-scoped only when nothing else gives them more.
 * Holding any ordinary role alongside re-grants institution scope, which is the
 * correct outcome — the alternative would let attaching a PIC-scoped role
 * silently demote an administrator.
 *
 * ── The constraint ─────────────────────────────────────────────────────────
 *
 * `chk_roles_system_wide_not_pic_scoped` follows `DEC-067`: a database invariant
 * rather than an application check, because it is the one rule that must hold
 * even if the application is wrong. "Reaches every institution" and "reaches
 * only my own departments" are not a combination with a meaning — a role that
 * claimed both would leave `organizationScope` to pick one, and whichever it
 * picked would be a guess.
 *
 * NOT mutually exclusive with `is_institution_assignable` (`CR-003` B3). That
 * flag governs who may hand a role out, not what its holder reaches, and a
 * PIC-scoped role is the natural thing for an institution administrator to
 * delegate: it grants strictly less than any ordinary role, so CR-002's ceiling
 * is not raised by allowing it.
 *
 * DEFAULT false. Every existing role, and every role created without someone
 * deciding, keeps exactly today's reach.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE ref.roles
            ADD COLUMN is_pic_scoped BOOLEAN NOT NULL DEFAULT false;

        ALTER TABLE ref.roles
            ADD CONSTRAINT chk_roles_system_wide_not_pic_scoped
                CHECK (NOT (is_system_wide AND is_pic_scoped));
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE ref.roles
            DROP CONSTRAINT IF EXISTS chk_roles_system_wide_not_pic_scoped;

        ALTER TABLE ref.roles
            DROP COLUMN IF EXISTS is_pic_scoped;
        `,
        { transaction }
      );
    });
  },
};
