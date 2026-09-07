'use strict';

/** `public.asset_unit_locations` — 04-data-model.md §5.3.3. Creation order #25. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.asset_unit_locations (
            id              UUID         NOT NULL DEFAULT gen_random_uuid(),
            asset_unit_id   UUID         NOT NULL,     -- legacy: id_detail_asset
            location_id     UUID         NOT NULL,     -- legacy: id_penyimpanan
            is_current      BOOLEAN      NOT NULL DEFAULT true,
            assigned_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
            unassigned_at   TIMESTAMPTZ  NULL,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_asset_unit_locations PRIMARY KEY (id),
            CONSTRAINT fk_asset_unit_locations_unit
                FOREIGN KEY (asset_unit_id) REFERENCES public.asset_units(id),
            CONSTRAINT fk_asset_unit_locations_location
                FOREIGN KEY (location_id) REFERENCES public.locations(id),
            CONSTRAINT chk_asset_unit_locations_dates
                CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at)
        );

        CREATE INDEX idx_asset_unit_locations_unit ON public.asset_unit_locations(asset_unit_id);
        CREATE INDEX idx_asset_unit_locations_location ON public.asset_unit_locations(location_id);
        CREATE INDEX idx_asset_unit_locations_current
            ON public.asset_unit_locations(asset_unit_id) WHERE is_current = true;
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.asset_unit_locations;');
  },
};
