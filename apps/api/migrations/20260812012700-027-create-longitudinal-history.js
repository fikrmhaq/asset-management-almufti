'use strict';

/**
 * `public.longitudinal_history` — 04-data-model.md §5.3.4. Creation order #26.
 *
 * Append-only: existing records MUST NOT be modified (REQ-TXN-007, REQ-LIFE-004).
 * Enforced through the application layer and access control, not a trigger.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.longitudinal_history (
            id              UUID                    NOT NULL DEFAULT gen_random_uuid(),
            asset_unit_id   UUID                    NOT NULL,     -- legacy: id_detail_asset
            description     TEXT                    NOT NULL,     -- legacy: keterangan
            condition       public.condition_enum   NOT NULL,     -- legacy: kondisi
            location_id     UUID                    NOT NULL,     -- legacy: lokasi
            lifecycle_state public.lifecycle_state  NULL,
            effective_from  TIMESTAMPTZ             NOT NULL DEFAULT now(),
            effective_to    TIMESTAMPTZ             NULL,
            created_by      UUID                    NULL,
            created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),

            CONSTRAINT pk_longitudinal_history PRIMARY KEY (id),
            CONSTRAINT fk_longitudinal_history_unit
                FOREIGN KEY (asset_unit_id) REFERENCES public.asset_units(id),
            CONSTRAINT fk_longitudinal_history_location
                FOREIGN KEY (location_id) REFERENCES public.locations(id),
            CONSTRAINT fk_longitudinal_history_created_by
                FOREIGN KEY (created_by) REFERENCES public.users(id),
            CONSTRAINT chk_longitudinal_history_dates
                CHECK (effective_to IS NULL OR effective_to >= effective_from)
        );

        CREATE INDEX idx_longitudinal_history_unit
            ON public.longitudinal_history(asset_unit_id);
        CREATE INDEX idx_longitudinal_history_unit_current
            ON public.longitudinal_history(asset_unit_id) WHERE effective_to IS NULL;
        CREATE INDEX idx_longitudinal_history_effective
            ON public.longitudinal_history(asset_unit_id, effective_from DESC);
        CREATE INDEX idx_longitudinal_history_location
            ON public.longitudinal_history(location_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.longitudinal_history;');
  },
};
