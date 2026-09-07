'use strict';

/**
 * `public.asset_units` — 04-data-model.md §5.3.2. Creation order #24.
 *
 * `current_condition` and `current_location_id` are denormalized from
 * `longitudinal_history` for query performance and MUST be kept in sync when a
 * new history record is created (§5.3.2 note) — an application-layer duty.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.asset_units (
            id                  UUID                    NOT NULL DEFAULT gen_random_uuid(),
            asset_id            UUID                    NOT NULL,     -- legacy: id_asset
            description         TEXT                    NULL,         -- legacy: keterangan
            contract_item_id    UUID                    NULL,         -- legacy: id_detail_kontrak
            department_id       VARCHAR(8)              NULL,         -- legacy: id_jurusan
            lifecycle_state     public.lifecycle_state  NOT NULL DEFAULT 'REGISTERED',
            current_condition   public.condition_enum   NULL,
            current_location_id UUID                    NULL,
            is_active           BOOLEAN                 NOT NULL DEFAULT true,  -- legacy: soft_delete
            created_by          UUID                    NULL,
            updated_by          UUID                    NULL,         -- legacy: updater_id
            created_at          TIMESTAMPTZ             NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ             NOT NULL DEFAULT now(),

            CONSTRAINT pk_asset_units PRIMARY KEY (id),
            CONSTRAINT fk_asset_units_asset
                FOREIGN KEY (asset_id) REFERENCES public.assets(id),
            CONSTRAINT fk_asset_units_contract_item
                FOREIGN KEY (contract_item_id) REFERENCES public.contract_items(id),
            CONSTRAINT fk_asset_units_department
                FOREIGN KEY (department_id) REFERENCES public.departments(id),
            CONSTRAINT fk_asset_units_created_by
                FOREIGN KEY (created_by) REFERENCES public.users(id),
            CONSTRAINT fk_asset_units_updated_by
                FOREIGN KEY (updated_by) REFERENCES public.users(id),
            CONSTRAINT fk_asset_units_current_location
                FOREIGN KEY (current_location_id) REFERENCES public.locations(id)
        );

        CREATE INDEX idx_asset_units_asset ON public.asset_units(asset_id);
        CREATE INDEX idx_asset_units_department ON public.asset_units(department_id);
        CREATE INDEX idx_asset_units_lifecycle ON public.asset_units(lifecycle_state);
        CREATE INDEX idx_asset_units_condition ON public.asset_units(current_condition);
        CREATE INDEX idx_asset_units_location ON public.asset_units(current_location_id);
        CREATE INDEX idx_asset_units_active ON public.asset_units(is_active) WHERE is_active = true;
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.asset_units;');
  },
};
