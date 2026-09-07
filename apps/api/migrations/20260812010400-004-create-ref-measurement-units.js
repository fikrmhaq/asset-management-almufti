'use strict';

/** `ref.measurement_units` — 04-data-model.md §5.1.4. Creation order #3. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.measurement_units (
            id    UUID         NOT NULL DEFAULT gen_random_uuid(),
            name  VARCHAR(100) NOT NULL,

            CONSTRAINT pk_measurement_units PRIMARY KEY (id),
            CONSTRAINT uq_measurement_units_name UNIQUE (name)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.measurement_units;');
  },
};
