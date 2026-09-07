'use strict';

/**
 * `public.locations` — 04-data-model.md §5.3.8. Creation order #20.
 *
 * `classification_id` MUST reference a leaf-level node (REQ-CLASS-009,
 * REQ-LOC-008, BR-011). That depends on the absence of child rows, so it is
 * enforced in the application layer, not by a column-level CHECK.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.locations (
            id                   UUID         NOT NULL DEFAULT gen_random_uuid(),
            name                 VARCHAR(255) NOT NULL,
            classification_id    CHAR(12)     NOT NULL,     -- legacy: id_rincian_asset (leaf node only)
            parent_location_id   UUID         NULL,
            institution_id       UUID         NULL,
            is_active            BOOLEAN      NOT NULL DEFAULT true,
            created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_locations PRIMARY KEY (id),
            CONSTRAINT fk_locations_classification
                FOREIGN KEY (classification_id) REFERENCES ref.asset_classifications(id),
            CONSTRAINT fk_locations_parent
                FOREIGN KEY (parent_location_id) REFERENCES public.locations(id),
            CONSTRAINT fk_locations_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            CONSTRAINT chk_locations_no_self_ref
                CHECK (id <> parent_location_id)
        );

        CREATE INDEX idx_locations_classification ON public.locations(classification_id);
        CREATE INDEX idx_locations_parent ON public.locations(parent_location_id);
        CREATE INDEX idx_locations_institution ON public.locations(institution_id);
        CREATE INDEX idx_locations_active ON public.locations(is_active) WHERE is_active = true;
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.locations;');
  },
};
