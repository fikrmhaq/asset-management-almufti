'use strict';

/**
 * Phase 17 (`CR-001`) — extends `ref.asset_classifications` so institutions can
 * register leaf classifications the government catalogue does not cover.
 * `04-data-model.md` §5.1.3, creation order #35.
 *
 * Ordered after every Phase 1–7 table rather than folded into migration 010 for
 * two reasons:
 *
 *   1. `institution_id` and `created_by` reference `public.institutions` and
 *      `public.users`, neither of which exists at creation order #9.
 *   2. Migration 010 stays a faithful record of the legacy shape. The table's
 *      history should show that local extension was added, not pretend it was
 *      always there.
 *
 * The four new columns are NULL for every existing row and stay that way:
 * externally-sourced classifications have no creating user and no owning
 * institution. Only `origin = 3` rows populate them (BR-016).
 *
 * `chk_asset_classifications_origin` is added last, after the existing data has
 * been checked. The seeded data uses only 1 and 2, so it validates without a
 * backfill — but the constraint is what stops a fourth provenance value being
 * invented later without a matching amendment to BR-016.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE ref.asset_classifications
            ADD COLUMN institution_id UUID        NULL,
            ADD COLUMN created_by     UUID        NULL,
            ADD COLUMN created_at     TIMESTAMPTZ NULL,
            ADD COLUMN updated_at     TIMESTAMPTZ NULL;

        ALTER TABLE ref.asset_classifications
            ADD CONSTRAINT fk_asset_classifications_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            ADD CONSTRAINT fk_asset_classifications_created_by
                FOREIGN KEY (created_by) REFERENCES public.users(id),
            ADD CONSTRAINT chk_asset_classifications_origin
                CHECK (origin IN (1, 2, 3));

        CREATE INDEX idx_asset_classifications_institution
            ON ref.asset_classifications(institution_id);

        -- Partial: the only queries that filter on origin are looking for the
        -- application-defined rows, which are a rounding error beside the 14,738
        -- seeded ones.
        CREATE INDEX idx_asset_classifications_origin
            ON ref.asset_classifications(origin) WHERE origin = 3;
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DROP INDEX IF EXISTS ref.idx_asset_classifications_origin;
        DROP INDEX IF EXISTS ref.idx_asset_classifications_institution;

        ALTER TABLE ref.asset_classifications
            DROP CONSTRAINT IF EXISTS chk_asset_classifications_origin,
            DROP CONSTRAINT IF EXISTS fk_asset_classifications_created_by,
            DROP CONSTRAINT IF EXISTS fk_asset_classifications_institution;

        ALTER TABLE ref.asset_classifications
            DROP COLUMN IF EXISTS updated_at,
            DROP COLUMN IF EXISTS created_at,
            DROP COLUMN IF EXISTS created_by,
            DROP COLUMN IF EXISTS institution_id;
        `,
        { transaction }
      );
    });
  },
};
