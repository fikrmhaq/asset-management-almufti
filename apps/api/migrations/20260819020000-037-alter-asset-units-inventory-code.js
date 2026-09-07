'use strict';

/**
 * Phase 18 (`CR-001`) — the printable identity of an asset unit.
 * `04-data-model.md` §5.3.2, creation order #36. REQ-UNIT-003/007/008.
 *
 * `asset_units` had no human-readable identifier at all: only a UUID, which
 * cannot be read off a scuffed label or quoted over a telephone. The code is
 * `{institution code}-{registration year}-{sequence}` — `ALM-1-2026-00042`.
 *
 * STORED, NOT DERIVED (`BR-020`). Deriving it on read would bind every printed
 * label to the institution's current code, so renaming an institution would
 * silently invalidate labels already stuck to physical items. Storing it means a
 * rename affects only units registered afterwards (REQ-UNIT-008).
 *
 * The unique index is PARTIAL. `asset_units` reaches an institution only through
 * `assets.institution_id`, which is nullable, so a unit whose asset has no
 * institution has nothing to build a code from and stores NULL. A plain UNIQUE
 * would tolerate that too, but the partial index says what is meant: uniqueness
 * applies to codes, and the absence of one is not a value to collide with.
 *
 * The backfill numbers existing units per institution and per registration year,
 * ordered by creation, so the sequence a unit receives matches the order it was
 * actually registered in rather than whatever order the update happened to visit
 * rows.
 */

const CODE_WIDTH = 5;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.asset_units
            ADD COLUMN inventory_code VARCHAR(40) NULL;
        `,
        { transaction }
      );

      // Backfill before the index exists: a duplicate would then fail loudly at
      // index creation rather than being silently written.
      await queryInterface.sequelize.query(
        `
        WITH numbered AS (
            SELECT u.id,
                   i.code                                        AS institution_code,
                   EXTRACT(YEAR FROM u.created_at)::int          AS year,
                   ROW_NUMBER() OVER (
                       PARTITION BY i.code, EXTRACT(YEAR FROM u.created_at)
                       ORDER BY u.created_at, u.id
                   )                                             AS seq
              FROM public.asset_units u
              JOIN public.assets a       ON a.id = u.asset_id
              JOIN public.institutions i ON i.id = a.institution_id
        )
        UPDATE public.asset_units u
           SET inventory_code = numbered.institution_code || '-' ||
                                numbered.year || '-' ||
                                lpad(numbered.seq::text, ${CODE_WIDTH}, '0')
          FROM numbered
         WHERE numbered.id = u.id;
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX uq_asset_units_inventory_code
            ON public.asset_units(inventory_code) WHERE inventory_code IS NOT NULL;
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DROP INDEX IF EXISTS public.uq_asset_units_inventory_code;
        ALTER TABLE public.asset_units DROP COLUMN IF EXISTS inventory_code;
        `,
        { transaction }
      );
    });
  },
};
