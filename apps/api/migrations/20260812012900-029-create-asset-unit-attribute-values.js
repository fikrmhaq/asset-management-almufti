'use strict';

/**
 * `public.asset_unit_attribute_values` — 04-data-model.md §5.3.6.
 * Creation order #28.
 *
 * Same polymorphic pattern as `asset_attribute_values`. Only definitions with
 * `scope = 'ASSET_UNIT'` may be referenced, and the definition must belong to
 * the classification of the unit's parent asset (BR-009, BR-010) — enforced in
 * the application layer.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.asset_unit_attribute_values (
            id                       UUID           NOT NULL DEFAULT gen_random_uuid(),
            asset_unit_id            UUID           NOT NULL,
            attribute_definition_id  UUID           NOT NULL,
            value_text               TEXT           NULL,
            value_numeric            NUMERIC(20,4)  NULL,
            value_boolean            BOOLEAN        NULL,
            value_date               DATE           NULL,
            value_reference          VARCHAR(255)   NULL,
            created_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),
            updated_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),

            CONSTRAINT pk_asset_unit_attribute_values PRIMARY KEY (id),
            CONSTRAINT uq_asset_unit_attribute_values_unit_attr
                UNIQUE (asset_unit_id, attribute_definition_id),
            CONSTRAINT fk_asset_unit_attribute_values_unit
                FOREIGN KEY (asset_unit_id) REFERENCES public.asset_units(id) ON DELETE CASCADE,
            CONSTRAINT fk_asset_unit_attribute_values_definition
                FOREIGN KEY (attribute_definition_id) REFERENCES ref.attribute_definitions(id)
        );

        CREATE INDEX idx_asset_unit_attribute_values_unit
            ON public.asset_unit_attribute_values(asset_unit_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP TABLE IF EXISTS public.asset_unit_attribute_values;'
    );
  },
};
