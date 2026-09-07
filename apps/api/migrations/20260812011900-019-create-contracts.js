'use strict';

/** `public.contracts` — 04-data-model.md §5.4.3. Creation order #18. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.contracts (
            id                  UUID           NOT NULL DEFAULT gen_random_uuid(),
            contract_number     VARCHAR(150)   NOT NULL,     -- legacy: nomor_kontrak
            supplier_id         UUID           NULL,         -- legacy: id_supplier
            contract_type_id    INTEGER        NULL,         -- legacy: id_jenis_kontrak
            contract_date       DATE           NOT NULL,
            funding_source_id   INTEGER        NULL,         -- legacy: id_sumber_anggaran
            contract_value      NUMERIC(15,2)  NULL,         -- legacy: nilai_kontrak
            receiving_document  VARCHAR(255)   NULL,         -- legacy: ba_penerimaan
            receiving_date      DATE           NULL,         -- legacy: tanggal_ba_penerimaan
            institution_id      UUID           NULL,         -- legacy: instansi_id
            account_code        CHAR(12)       NULL,         -- legacy: kode_rekening
            notes               TEXT           NULL,
            is_active           BOOLEAN        NOT NULL DEFAULT true,
            created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),

            CONSTRAINT pk_contracts PRIMARY KEY (id),
            CONSTRAINT uq_contracts_number UNIQUE (contract_number),
            CONSTRAINT fk_contracts_supplier
                FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id),
            CONSTRAINT fk_contracts_type
                FOREIGN KEY (contract_type_id) REFERENCES ref.contract_types(id),
            CONSTRAINT fk_contracts_funding
                FOREIGN KEY (funding_source_id) REFERENCES ref.funding_sources(id),
            CONSTRAINT fk_contracts_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            CONSTRAINT fk_contracts_account
                FOREIGN KEY (account_code) REFERENCES ref.account_codes(code)
        );

        CREATE INDEX idx_contracts_supplier ON public.contracts(supplier_id);
        CREATE INDEX idx_contracts_institution ON public.contracts(institution_id);
        CREATE INDEX idx_contracts_number ON public.contracts(contract_number);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.contracts;');
  },
};
