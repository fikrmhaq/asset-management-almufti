'use strict';

/**
 * `public.assets` — 04-data-model.md §5.3.1. Creation order #23.
 *
 * `classification_id` MUST reference a leaf-level node (REQ-CLASS-009, BR-011),
 * enforced in the application layer as documented in §5.3.1's note.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.assets (
            id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
            name               VARCHAR(255) NOT NULL,     -- legacy: nama_asset
            classification_id  CHAR(12)     NOT NULL,     -- legacy: id_rincian_asset
            vendor_id          UUID         NULL,         -- legacy: id_vendor
            contract_id        UUID         NULL,
            institution_id     UUID         NULL,         -- legacy: instansi_id
            description        TEXT         NULL,         -- legacy: keterangan
            is_active          BOOLEAN      NOT NULL DEFAULT true,  -- legacy: soft_delete
            created_by         UUID         NULL,
            updated_by         UUID         NULL,         -- legacy: updater_id
            created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_assets PRIMARY KEY (id),
            CONSTRAINT fk_assets_classification
                FOREIGN KEY (classification_id) REFERENCES ref.asset_classifications(id),
            CONSTRAINT fk_assets_vendor
                FOREIGN KEY (vendor_id) REFERENCES public.vendors(id),
            CONSTRAINT fk_assets_contract
                FOREIGN KEY (contract_id) REFERENCES public.contracts(id),
            CONSTRAINT fk_assets_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            CONSTRAINT fk_assets_created_by
                FOREIGN KEY (created_by) REFERENCES public.users(id),
            CONSTRAINT fk_assets_updated_by
                FOREIGN KEY (updated_by) REFERENCES public.users(id)
        );

        CREATE INDEX idx_assets_classification ON public.assets(classification_id);
        CREATE INDEX idx_assets_vendor ON public.assets(vendor_id);
        CREATE INDEX idx_assets_contract ON public.assets(contract_id);
        CREATE INDEX idx_assets_institution ON public.assets(institution_id);
        CREATE INDEX idx_assets_active ON public.assets(is_active) WHERE is_active = true;
        CREATE INDEX idx_assets_name ON public.assets(name);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.assets;');
  },
};
