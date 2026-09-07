'use strict';

/** `public.borrowing_items` — 04-data-model.md §5.5.2. Creation order #31. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.borrowing_items (
            id              UUID         NOT NULL DEFAULT gen_random_uuid(),
            borrowing_id    UUID         NOT NULL,     -- legacy: id_peminjaman
            asset_unit_id   UUID         NOT NULL,     -- legacy: id_detail_asset
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_borrowing_items PRIMARY KEY (id),
            CONSTRAINT fk_borrowing_items_borrowing
                FOREIGN KEY (borrowing_id) REFERENCES public.borrowings(id) ON DELETE CASCADE,
            CONSTRAINT fk_borrowing_items_unit
                FOREIGN KEY (asset_unit_id) REFERENCES public.asset_units(id),
            CONSTRAINT uq_borrowing_items_borrowing_unit
                UNIQUE (borrowing_id, asset_unit_id)
        );

        CREATE INDEX idx_borrowing_items_borrowing ON public.borrowing_items(borrowing_id);
        CREATE INDEX idx_borrowing_items_unit ON public.borrowing_items(asset_unit_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.borrowing_items;');
  },
};
