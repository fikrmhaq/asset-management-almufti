'use strict';

/**
 * `public.floor_plan_areas` — 04-data-model.md §5.3.10. Creation order #22.
 *
 * `location_id` MUST be a descendant of the floor plan's own location (BR-014,
 * REQ-LOC-012). That crosses rows, so it is enforced in the application layer.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.floor_plan_areas (
            id              UUID         NOT NULL DEFAULT gen_random_uuid(),
            floor_plan_id   UUID         NOT NULL,
            location_id     UUID         NOT NULL,
            polygon         JSONB        NOT NULL,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_floor_plan_areas PRIMARY KEY (id),
            CONSTRAINT uq_floor_plan_areas_location UNIQUE (location_id),
            CONSTRAINT fk_floor_plan_areas_floor_plan
                FOREIGN KEY (floor_plan_id) REFERENCES public.location_floor_plans(id) ON DELETE CASCADE,
            CONSTRAINT fk_floor_plan_areas_location
                FOREIGN KEY (location_id) REFERENCES public.locations(id)
        );

        CREATE INDEX idx_floor_plan_areas_floor_plan ON public.floor_plan_areas(floor_plan_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.floor_plan_areas;');
  },
};
