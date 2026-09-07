'use strict';

/**
 * `ref.asset_classifications` — 04-data-model.md §5.1.3. Creation order #9.
 *
 * Read-only through the application (REQ-CLASS-003, REQ-REF-003). The leaf-level
 * rule for referencing tables (BR-011) crosses rows and is enforced in the
 * application layer, not by a constraint here.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE ref.asset_classifications (
            id           CHAR(12)     NOT NULL,                -- legacy: id_rincian_asset
            parent_id    CHAR(12)     NULL,                    -- legacy: mst_rincian_asset
            name         VARCHAR(255) NOT NULL,                -- legacy: rincian_asset
            origin       INTEGER      NOT NULL DEFAULT 1,      -- legacy: asal_rincian
            category_id  UUID         NULL,                    -- legacy: kategori

            CONSTRAINT pk_asset_classifications PRIMARY KEY (id),
            CONSTRAINT fk_asset_classifications_parent
                FOREIGN KEY (parent_id) REFERENCES ref.asset_classifications(id),
            CONSTRAINT fk_asset_classifications_category
                FOREIGN KEY (category_id) REFERENCES ref.categories(id),
            CONSTRAINT chk_asset_classifications_no_self_ref
                CHECK (id <> parent_id)
        );

        CREATE INDEX idx_asset_classifications_parent ON ref.asset_classifications(parent_id);
        CREATE INDEX idx_asset_classifications_category ON ref.asset_classifications(category_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS ref.asset_classifications;');
  },
};
