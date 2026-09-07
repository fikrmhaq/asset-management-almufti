'use strict';

/**
 * History entry provenance — Phase 31 (`CR-012` `DEC-A`, `DEC-B`),
 * REQ-COND-006. `04-data-model.md` §4 and §5.3.4, creation order #48.
 *
 * ── Why the column exists ──────────────────────────────────────────────────
 *
 * `longitudinal_history` records both kinds of state change through one writer:
 * a person who inspected an item, and the application moving a unit because it
 * was borrowed or returned. Once stored the two are indistinguishable — same
 * table, same columns, same shape.
 *
 * REQ-COND-006 makes that distinction load-bearing: only a deliberate
 * assessment satisfies the monthly obligation, and a month of borrowing traffic
 * must not look like a month of inspections. `CR-011` `DEC-E` had to infer it
 * from the SHAPE OF THE DESCRIPTION TEXT, which works for the two generated
 * strings and cannot work for anything else. This records the fact instead of
 * deducing it.
 *
 * ── NOT NULL, NO DEFAULT ───────────────────────────────────────────────────
 *
 * `DEFAULT 'MANUAL'` would mean a future writer that forgets the column
 * silently satisfies the monthly requirement, on a row that looks correct in
 * every other respect. There is no test that catches that. Requiring the value
 * makes a forgetful writer fail at insert time, which is the whole point.
 *
 * That is why the column is added NULLABLE and tightened at the end: the
 * backfill has to run between the two, and with no default there is nothing to
 * fill the existing rows in the meantime.
 *
 * ── `SYSTEM` has no writer, deliberately ───────────────────────────────────
 *
 * Every migration here wraps its DDL in a transaction, and PostgreSQL refuses
 * `ALTER TYPE … ADD VALUE` inside a transaction that also uses the type — so
 * adding a third value later would need an out-of-convention migration.
 * Migration 001 sets the precedent by creating `public.status_enum` unused.
 *
 * ── The backfill, and its one honest limitation ────────────────────────────
 *
 * Pass 1 is EXACT for activations: `borrowings/service.js` hardcodes that
 * description with no caller override, so every activation row matches.
 *
 * Returns are the ambiguous direction. `applyReturn` takes
 * `description ?? "Returned from borrowing <id>"`, so a return where the
 * returner typed their own note carries arbitrary text and pass 1 misses it.
 * Pass 2 recovers those by lifecycle signature — BORROWED → ACTIVE on a unit
 * belonging to a borrowing that was returned that day.
 *
 * Pass 2 is a HEURISTIC, not a proof. A PIC who manually moved a unit from
 * BORROWED to ACTIVE on the same calendar day as a real return is classified as
 * `BORROWING`. Nothing in the data can separate those two cases, because
 * nothing recorded the provenance — which is the defect this column closes.
 *
 * Both passes report their row counts through `RAISE NOTICE`. It does NOT abort
 * on an unexpected count, unlike migration 040: 040 guards an assumption that
 * must hold for correctness, whereas these counts are advisory and a heuristic
 * that reclassifies more rows than expected is information, not a failure.
 * Verify them against the source data — at the size this table is today, every
 * row can be checked by hand, and that will not be true again.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TYPE public.history_entry_type AS ENUM (
            'MANUAL',      -- a person recorded an assessment
            'BORROWING',   -- written by the borrowing activate / return paths
            'SYSTEM'       -- reserved; no writer today
        );

        ALTER TABLE public.longitudinal_history
            ADD COLUMN entry_type public.history_entry_type NULL;
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE
            generated integer;
            inferred  integer;
            manual    integer;
        BEGIN
            /*
             * Pass 1 — the two descriptions the application writes itself
             * (CR-011 DEC-E). Both embed a UUID, so a human note matches only by
             * reproducing the format exactly.
             */
            UPDATE public.longitudinal_history
               SET entry_type = 'BORROWING'
             WHERE description ~ '^Borrowed by .+ \\(borrowing [0-9a-f-]{36}\\)$'
                OR description ~ '^Returned from borrowing [0-9a-f-]{36}$';
            GET DIAGNOSTICS generated = ROW_COUNT;

            /*
             * Pass 2 — a return carrying the returner's own note.
             *
             * actual_return_date is a DATE, so the comparison converts the row's
             * effective instant into the business day it fell on. This is the one
             * place a timezone conversion on a column is correct: it is a
             * one-time backfill over a handful of rows, not a query plan.
             */
            UPDATE public.longitudinal_history h
               SET entry_type = 'BORROWING'
             WHERE h.entry_type IS NULL
               AND h.lifecycle_state = 'ACTIVE'
               AND EXISTS (
                   SELECT 1
                     FROM public.borrowing_items bi
                     JOIN public.borrowings b ON b.id = bi.borrowing_id
                    WHERE bi.asset_unit_id = h.asset_unit_id
                      AND b.actual_return_date
                          = (h.effective_from AT TIME ZONE 'Asia/Jakarta')::date
               );
            GET DIAGNOSTICS inferred = ROW_COUNT;

            -- Everything left was written by a person through the history endpoint.
            UPDATE public.longitudinal_history
               SET entry_type = 'MANUAL'
             WHERE entry_type IS NULL;
            GET DIAGNOSTICS manual = ROW_COUNT;

            RAISE NOTICE 'Migration 048 backfill: % BORROWING by generated description, % BORROWING inferred from a return, % MANUAL.',
                generated, inferred, manual;
        END $$;
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.longitudinal_history
            ALTER COLUMN entry_type SET NOT NULL;
        `,
        { transaction }
      );
    });
  },

  /**
   * Dropping the column discards the provenance permanently: it cannot be
   * rebuilt from the remaining data with any better fidelity than the backfill
   * above, which is exactly why the column was added. The type is dropped after
   * the column that references it.
   */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.longitudinal_history
            DROP COLUMN IF EXISTS entry_type;

        DROP TYPE IF EXISTS public.history_entry_type;
        `,
        { transaction }
      );
    });
  },
};
