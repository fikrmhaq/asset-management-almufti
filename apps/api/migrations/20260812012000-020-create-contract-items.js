'use strict';

/**
 * `public.contract_items` — 04-data-model.md §5.4.4. Creation order #19.
 *
 * `total_value` is deliberately not stored; it is derived as
 * `quantity * unit_price` in queries and application logic.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.contract_items (
            id             UUID           NOT NULL DEFAULT gen_random_uuid(),
            contract_id    UUID           NOT NULL,     -- legacy: id_kontrak
            asset_name     VARCHAR(150)   NOT NULL,     -- legacy: nama_aset
            specification  TEXT           NULL,         -- legacy: spesifikasi
            quantity       INTEGER        NULL,         -- legacy: jumlah
            unit_price     NUMERIC(15,2)  NULL,         -- legacy: harga_satuan
            unit_type      VARCHAR(50)    NULL,         -- legacy: jenis_satuan
            created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),

            CONSTRAINT pk_contract_items PRIMARY KEY (id),
            CONSTRAINT fk_contract_items_contract
                FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE,
            CONSTRAINT chk_contract_items_quantity
                CHECK (quantity IS NULL OR quantity > 0),
            CONSTRAINT chk_contract_items_price
                CHECK (unit_price IS NULL OR unit_price >= 0)
        );

        CREATE INDEX idx_contract_items_contract ON public.contract_items(contract_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.contract_items;');
  },
};
