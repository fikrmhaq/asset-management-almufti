'use strict';

/** `public.departments` — 04-data-model.md §5.2.2. Creation order #12. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.departments (
            id          VARCHAR(8)   NOT NULL,    -- legacy: id_jurusan
            name        VARCHAR(75)  NOT NULL,    -- legacy: nama
            is_active   BOOLEAN      NOT NULL DEFAULT true,
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_departments PRIMARY KEY (id)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.departments;');
  },
};
