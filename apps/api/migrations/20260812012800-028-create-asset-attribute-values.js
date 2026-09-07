'use strict';

/**
 * `public.asset_attribute_values` — 04-data-model.md §5.3.5. Creation order #27.
 *
 * Polymorphic value pattern: the active `value_*` column is determined by
 * `attribute_definitions.attribute_type`, and only definitions with
 * `scope = 'ASSET'` may be referenced (BR-009, BR-010). Both rules are
 * application-layer duties, as the data model states.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.asset_attribute_values (
            id                       UUID           NOT NULL DEFAULT gen_random_uuid(),
            asset_id                 UUID           NOT NULL,
            attribute_definition_id  UUID           NOT NULL,
            value_text               TEXT           NULL,
            value_numeric            NUMERIC(20,4)  NULL,
            value_boolean            BOOLEAN        NULL,
            value_date               DATE           NULL,
            value_reference          VARCHAR(255)   NULL,
            created_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),
            updated_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),

            CONSTRAINT pk_asset_attribute_values PRIMARY KEY (id),
            CONSTRAINT uq_asset_attribute_values_asset_attr
                UNIQUE (asset_id, attribute_definition_id),
            CONSTRAINT fk_asset_attribute_values_asset
                FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE,
            CONSTRAINT fk_asset_attribute_values_definition
                FOREIGN KEY (attribute_definition_id) REFERENCES ref.attribute_definitions(id)
        );

        CREATE INDEX idx_asset_attribute_values_asset
            ON public.asset_attribute_values(asset_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.asset_attribute_values;');
  },
};
