'use strict';

/** `public.suppliers` — 04-data-model.md §5.4.2. Creation order #17. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.suppliers (
            id           UUID         NOT NULL DEFAULT gen_random_uuid(),
            name         VARCHAR(255) NOT NULL,    -- legacy: nama_supplier
            address      TEXT         NULL,        -- legacy: alamat
            contact_info TEXT         NULL,
            is_active    BOOLEAN      NOT NULL DEFAULT true,  -- legacy: soft_delete
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_suppliers PRIMARY KEY (id)
        );

        CREATE INDEX idx_suppliers_name ON public.suppliers(name);
        CREATE INDEX idx_suppliers_active ON public.suppliers(is_active) WHERE is_active = true;
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.suppliers;');
  },
};
