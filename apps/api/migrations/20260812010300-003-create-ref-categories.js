'use strict';

/** `ref.categories` — 04-data-model.md §5.1.2. Creation order #2. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.categories (
            id    UUID         NOT NULL DEFAULT gen_random_uuid(),
            name  VARCHAR(100) NOT NULL,

            CONSTRAINT pk_categories PRIMARY KEY (id),
            CONSTRAINT uq_categories_name UNIQUE (name)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.categories;');
  },
};
