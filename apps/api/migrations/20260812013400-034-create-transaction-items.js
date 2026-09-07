'use strict';

/**
 * `public.transaction_items` — 04-data-model.md §5.5.4. Creation order #33.
 *
 * Design change from legacy: references `asset_units` rather than the asset
 * master, for unit-level traceability (REQ-TXN-010). The recording user lives on
 * the parent `transactions.created_by`.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.transaction_items (
            id              UUID         NOT NULL DEFAULT gen_random_uuid(),
            transaction_id  UUID         NOT NULL,     -- legacy: id_transaksi
            asset_unit_id   UUID         NOT NULL,     -- legacy: id_asset (now references asset_units)
            notes           TEXT         NULL,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_transaction_items PRIMARY KEY (id),
            CONSTRAINT fk_transaction_items_transaction
                FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE,
            CONSTRAINT fk_transaction_items_unit
                FOREIGN KEY (asset_unit_id) REFERENCES public.asset_units(id),
            CONSTRAINT uq_transaction_items_txn_unit
                UNIQUE (transaction_id, asset_unit_id)
        );

        CREATE INDEX idx_transaction_items_transaction ON public.transaction_items(transaction_id);
        CREATE INDEX idx_transaction_items_unit ON public.transaction_items(asset_unit_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.transaction_items;');
  },
};
