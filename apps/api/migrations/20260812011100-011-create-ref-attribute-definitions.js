'use strict';

/** `ref.attribute_definitions` — 04-data-model.md §5.1.5. Creation order #10. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.attribute_definitions (
            id                    UUID              NOT NULL DEFAULT gen_random_uuid(),
            classification_id     CHAR(12)          NOT NULL,    -- legacy: id_rincian_asset
            name                  VARCHAR(100)      NOT NULL,    -- legacy: nama
            attribute_type        ref.attribute_type NOT NULL DEFAULT 'TEXT',
            scope                 ref.attribute_scope NOT NULL DEFAULT 'ASSET',
            is_required           BOOLEAN           NOT NULL DEFAULT false,
            uses_measurement_unit BOOLEAN           NOT NULL DEFAULT false, -- legacy: is_using_satuan
            measurement_unit_id   UUID              NULL,        -- legacy: jenis_satuan
            description           TEXT              NULL,        -- legacy: keterangan
            sort_order            INTEGER           NOT NULL DEFAULT 0,
            is_active             BOOLEAN           NOT NULL DEFAULT true,
            created_at            TIMESTAMPTZ       NOT NULL DEFAULT now(),
            updated_at            TIMESTAMPTZ       NOT NULL DEFAULT now(),

            CONSTRAINT pk_attribute_definitions PRIMARY KEY (id),
            CONSTRAINT fk_attribute_definitions_classification
                FOREIGN KEY (classification_id) REFERENCES ref.asset_classifications(id),
            CONSTRAINT fk_attribute_definitions_unit
                FOREIGN KEY (measurement_unit_id) REFERENCES ref.measurement_units(id)
        );

        CREATE INDEX idx_attribute_definitions_classification
            ON ref.attribute_definitions(classification_id);

        CREATE INDEX idx_attribute_definitions_scope
            ON ref.attribute_definitions(scope);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.attribute_definitions;');
  },
};
