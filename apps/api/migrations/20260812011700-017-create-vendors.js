'use strict';

/** `public.vendors` — 04-data-model.md §5.4.1. Creation order #16. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.vendors (
            id           UUID         NOT NULL DEFAULT gen_random_uuid(),
            name         VARCHAR(255) NOT NULL,    -- legacy: nama
            contact_info TEXT         NULL,
            address      TEXT         NULL,
            is_active    BOOLEAN      NOT NULL DEFAULT true,
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_vendors PRIMARY KEY (id)
        );

        CREATE INDEX idx_vendors_name ON public.vendors(name);
        CREATE INDEX idx_vendors_active ON public.vendors(is_active) WHERE is_active = true;
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.vendors;');
  },
};
