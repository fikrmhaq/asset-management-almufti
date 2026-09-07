'use strict';

/** `ref.roles` — 04-data-model.md §5.1.1. Creation order #1. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.roles (
            id              UUID         NOT NULL DEFAULT gen_random_uuid(),
            name            VARCHAR(50)  NOT NULL,
            is_system_wide  BOOLEAN      NOT NULL DEFAULT false,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_roles PRIMARY KEY (id),
            CONSTRAINT uq_roles_name UNIQUE (name)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.roles;');
  },
};
