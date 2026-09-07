'use strict';

/** `ref.account_codes` — 04-data-model.md §5.1.8. Creation order #6. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.account_codes (
            code  CHAR(12)     NOT NULL,    -- legacy: kode_rekening
            name  VARCHAR(250) NOT NULL,    -- legacy: nama_rekening

            CONSTRAINT pk_account_codes PRIMARY KEY (code)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.account_codes;');
  },
};
