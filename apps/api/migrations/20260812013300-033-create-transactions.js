'use strict';

/**
 * `public.transactions` — 04-data-model.md §5.5.3. Creation order #32.
 *
 * Design change from legacy: `supplier_id` is nullable so transactions can be
 * independent of procurement (REQ-TXN-008), and `contract_id` is an optional FK
 * linking procurement-originated transactions (REQ-TXN-009).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.transactions (
            id                   UUID         NOT NULL DEFAULT gen_random_uuid(),
            transaction_date     DATE         NOT NULL,     -- legacy: tanggal_transaksi
            transaction_type_id  INTEGER      NOT NULL,     -- legacy: tipe_transaksi
            description          TEXT         NULL,         -- legacy: keterangan
            supplier_id          UUID         NULL,         -- legacy: id_supplier (made nullable)
            contract_id          UUID         NULL,
            institution_id       UUID         NULL,         -- legacy: instansi_id
            created_by           UUID         NOT NULL,     -- legacy: updater_id
            created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_transactions PRIMARY KEY (id),
            CONSTRAINT fk_transactions_type
                FOREIGN KEY (transaction_type_id) REFERENCES ref.transaction_types(id),
            CONSTRAINT fk_transactions_supplier
                FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id),
            CONSTRAINT fk_transactions_contract
                FOREIGN KEY (contract_id) REFERENCES public.contracts(id),
            CONSTRAINT fk_transactions_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            CONSTRAINT fk_transactions_created_by
                FOREIGN KEY (created_by) REFERENCES public.users(id)
        );

        CREATE INDEX idx_transactions_type ON public.transactions(transaction_type_id);
        CREATE INDEX idx_transactions_supplier ON public.transactions(supplier_id);
        CREATE INDEX idx_transactions_institution ON public.transactions(institution_id);
        CREATE INDEX idx_transactions_date ON public.transactions(transaction_date);
        CREATE INDEX idx_transactions_contract ON public.transactions(contract_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.transactions;');
  },
};
