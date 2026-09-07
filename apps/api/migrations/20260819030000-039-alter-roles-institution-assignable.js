'use strict';

/**
 * Phase 19 (`CR-002`) — delegated role assignment.
 * `04-data-model.md` §5.1.1, creation order #38. REQ-ROLE-009, `BR-022`.
 *
 * Roles stay authored centrally: only a system-wide caller creates one, edits
 * it, or changes what it grants (`BR-015`). This column governs a different
 * question — which of those roles an institution administrator may hand out to
 * users in their own institution.
 *
 * DEFAULT false, deliberately. Every existing role, and every role created
 * without someone making a decision, is undelegatable until deliberately opted
 * in. The safe state is the one you get by not thinking about it.
 *
 * `chk_roles_system_wide_not_assignable` is a database invariant rather than an
 * application check because it is the one rule that must hold even if the
 * application is wrong. A system-wide role handed to an institution
 * administrator would defeat organization scope entirely — and this guarantees
 * the seeded `System Admin` role can never be flagged assignable, by mistake or
 * by a future code path nobody re-read.
 *
 * Marking a role assignable grants its permissions to every institution
 * administrator in the system: whoever creates a user account sets its password
 * and can sign in as it, so any role they can assign, they can become
 * (`BR-022`). That is why this defaults off and why the UI warns at the toggle.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE ref.roles
            ADD COLUMN is_institution_assignable BOOLEAN NOT NULL DEFAULT false;

        ALTER TABLE ref.roles
            ADD CONSTRAINT chk_roles_system_wide_not_assignable
                CHECK (NOT (is_system_wide AND is_institution_assignable));
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
            DROP CONSTRAINT IF EXISTS chk_roles_system_wide_not_assignable;

        ALTER TABLE ref.roles
            DROP COLUMN IF EXISTS is_institution_assignable;
        `,
        { transaction }
      );
    });
  },
};
