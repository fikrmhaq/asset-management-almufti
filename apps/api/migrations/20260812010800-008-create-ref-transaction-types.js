'use strict';

/** `ref.transaction_types` — 04-data-model.md §5.1.9. Creation order #7. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.transaction_types (
            id    INTEGER      NOT NULL GENERATED ALWAYS AS IDENTITY,
            name  VARCHAR(100) NOT NULL,

            CONSTRAINT pk_transaction_types PRIMARY KEY (id),
            CONSTRAINT uq_transaction_types_name UNIQUE (name)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.transaction_types;');
  },
};
