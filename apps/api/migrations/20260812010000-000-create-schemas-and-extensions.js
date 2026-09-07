'use strict';

/**
 * Schema organization and extension dependencies.
 * 04-data-model.md §2, §3.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE SCHEMA IF NOT EXISTS public;
        CREATE SCHEMA IF NOT EXISTS ref;
        CREATE SCHEMA IF NOT EXISTS audit;

        CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // `public` is intentionally not dropped: it is PostgreSQL's default schema
      // and it holds SequelizeMeta, which must survive a full rollback.
      await queryInterface.sequelize.query(
        `
        DROP SCHEMA IF EXISTS audit CASCADE;
        DROP SCHEMA IF EXISTS ref CASCADE;
        DROP EXTENSION IF EXISTS "pgcrypto";
        `,
        { transaction }
      );
    });
  },
};
