'use strict';

/** `ref.contract_types` — 04-data-model.md §5.1.6. Creation order #4. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.contract_types (
            id    INTEGER     NOT NULL GENERATED ALWAYS AS IDENTITY,
            name  VARCHAR(50) NOT NULL,

            CONSTRAINT pk_contract_types PRIMARY KEY (id),
            CONSTRAINT uq_contract_types_name UNIQUE (name)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.contract_types;');
  },
};
