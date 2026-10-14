'use strict';

/**
 * `CR-014` — unit acquisition facts. `04-data-model.md` §5.7.7; creation order
 * #56. REQ-UNIT-012, `DEC-S`.
 *
 * A unit MAY record the funding source it was acquired with, and its
 * acquisition date, each independently of any Contract — a Contract is
 * optional (F8), so a donated, informally purchased or legacy unit could
 * previously record neither without inventing one.
 *
 * Exactly the §5.7.7 statement: both columns nullable, no default, no backfill,
 * so it is a metadata-only change on PG16 and no existing unit is given a value
 * it was never recorded with. `funding_source_id` is read by the inventory code
 * (`FUNDING_SOURCE_CODE`) ahead of the unit's Contract; `acquisition_date` is
 * added here as specified and has no reader yet.
 *
 * The foreign key is NO ACTION: a funding source a unit was acquired with is
 * not deleted from under it (the lookup service already refuses a referenced
 * row).
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.asset_units
            ADD COLUMN funding_source_id INTEGER NULL,
            ADD COLUMN acquisition_date  DATE    NULL,
            ADD CONSTRAINT fk_asset_units_funding_source
                FOREIGN KEY (funding_source_id) REFERENCES ref.funding_sources(id);

        CREATE INDEX idx_asset_units_funding_source
            ON public.asset_units(funding_source_id) WHERE funding_source_id IS NOT NULL;
        `,
        { transaction }
      );
    });
  },

  /**
   * Refuses rather than discards a recorded acquisition fact: an inventory code
   * may already carry the funding source, and dropping the column would leave
   * that code with no record of where its segment came from.
   */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
            SELECT count(*) INTO held
              FROM public.asset_units
             WHERE funding_source_id IS NOT NULL OR acquisition_date IS NOT NULL;
            IF held > 0 THEN
                RAISE EXCEPTION
                  'Migration 056 rollback refused: % asset unit(s) record an acquisition fact', held;
            END IF;
        END $$;

        DROP INDEX IF EXISTS public.idx_asset_units_funding_source;
        ALTER TABLE public.asset_units
            DROP CONSTRAINT IF EXISTS fk_asset_units_funding_source,
            DROP COLUMN IF EXISTS acquisition_date,
            DROP COLUMN IF EXISTS funding_source_id;
        `,
        { transaction }
      );
    });
  },
};
