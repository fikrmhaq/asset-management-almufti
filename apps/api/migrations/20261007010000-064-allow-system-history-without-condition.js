'use strict';

/**
 * Receipt places the unit at its intended location — REQ-REQUEST-024
 * (`IMPLEMENTATION_PLAN.md` §71). Creation order #64; conditional procurement
 * moves to `065+`.
 *
 * A receipt confirmed `AT_INTENDED_PLACE` now places an unplaced unit at the
 * snapshotted intended location, through the one authoritative writer — a
 * `SYSTEM` history row. That row records WHERE the unit is, not how it is: it is
 * no assessment, and a newly registered unit has no condition to carry. Inventing
 * one (`GOOD`) would fabricate a fact.
 *
 * ── longitudinal_history.condition ───────────────────────────────────────
 *
 * NULL is allowed ONLY on a `SYSTEM` row: `chk_longitudinal_history_condition`
 * keeps `MANUAL` (an assessment) and `BORROWING` rows exactly as strict as
 * before. Every existing row has a condition; nothing is backfilled.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.longitudinal_history
            ALTER COLUMN condition DROP NOT NULL,
            ADD CONSTRAINT chk_longitudinal_history_condition
                CHECK (condition IS NOT NULL OR entry_type = 'SYSTEM');
        `,
        { transaction }
      );
    });
  },

  /** Refuses rather than invents a condition for a placement row. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          SELECT count(*) INTO held FROM public.longitudinal_history WHERE condition IS NULL;
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 064 rollback refused: % history row(s) record a location with no condition. Remove or correct them deliberately first.', held;
          END IF;
        END $$;

        ALTER TABLE public.longitudinal_history
            DROP CONSTRAINT chk_longitudinal_history_condition,
            ALTER COLUMN condition SET NOT NULL;
        `,
        { transaction }
      );
    });
  },
};
