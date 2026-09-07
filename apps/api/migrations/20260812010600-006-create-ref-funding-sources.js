'use strict';

/** `ref.funding_sources` — 04-data-model.md §5.1.7. Creation order #5. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.funding_sources (
            id    INTEGER      NOT NULL GENERATED ALWAYS AS IDENTITY,
            name  VARCHAR(100) NOT NULL,

            CONSTRAINT pk_funding_sources PRIMARY KEY (id),
            CONSTRAINT uq_funding_sources_name UNIQUE (name)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.funding_sources;');
  },
};
