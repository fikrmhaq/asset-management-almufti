'use strict';

/** `public.location_floor_plans` — 04-data-model.md §5.3.9. Creation order #21. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.location_floor_plans (
            id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
            location_id        UUID         NOT NULL,
            file_name          VARCHAR(255) NOT NULL,
            file_type          VARCHAR(100) NOT NULL,
            file_size          BIGINT       NOT NULL,
            storage_reference  TEXT         NOT NULL,
            uploaded_by        UUID         NOT NULL,
            created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_location_floor_plans PRIMARY KEY (id),
            CONSTRAINT uq_location_floor_plans_location UNIQUE (location_id),
            CONSTRAINT fk_location_floor_plans_location
                FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE,
            CONSTRAINT fk_location_floor_plans_uploaded_by
                FOREIGN KEY (uploaded_by) REFERENCES public.users(id),
            CONSTRAINT chk_location_floor_plans_file_size
                CHECK (file_size > 0)
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.location_floor_plans;');
  },
};
