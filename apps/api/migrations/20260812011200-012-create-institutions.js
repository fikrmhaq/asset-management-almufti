'use strict';

/** `public.institutions` — 04-data-model.md §5.2.1. Creation order #11. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.institutions (
            id          UUID         NOT NULL DEFAULT gen_random_uuid(),
            name        VARCHAR(50)  NOT NULL,    -- legacy: nama
            code        VARCHAR(25)  NOT NULL,    -- legacy: instansi_code
            address     TEXT         NOT NULL,    -- legacy: alamat
            is_active   BOOLEAN      NOT NULL DEFAULT true,
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_institutions PRIMARY KEY (id),
            CONSTRAINT uq_institutions_code UNIQUE (code)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.institutions;');
  },
};
