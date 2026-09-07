'use strict';

/**
 * `ref.permissions` — 04-data-model.md §5.1.10. Creation order #8.
 *
 * The table is created here; its rows are not. The catalog is generated from the
 * routes the API actually enforces (`06-api.md` §1.3), which do not exist until
 * Phase 3, so seeding is deferred to that phase by decision. Hand-authoring the
 * list now would create exactly the drift §1.3 exists to prevent.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.permissions (
            code         VARCHAR(100) NOT NULL,
            description  TEXT         NOT NULL,

            CONSTRAINT pk_permissions PRIMARY KEY (code)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.permissions;');
  },
};
