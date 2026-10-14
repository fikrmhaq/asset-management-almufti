'use strict';

/**
 * The `REPORT` history entry type — REQ-REQUEST-025 (`IMPLEMENTATION_PLAN.md`
 * §72). Creation order #65; conditional procurement moves to `067+`.
 *
 * A Room PIC's report, once a reviewer confirms it, changes a unit's condition or
 * location through the authoritative history as ONE `REPORT` row. Not `MANUAL`:
 * that is the monthly assessment (`CR-012`) and has one writer, Record History;
 * a reviewer-written row would never count for the department under `DEC-F`
 * anyway, would make every confirmed move read as an inspection, and could not
 * move a unit that has no condition without one being invented.
 *
 * ── Why the value is added alone ─────────────────────────────────────────
 *
 * PostgreSQL lets `ALTER TYPE … ADD VALUE` run inside a transaction but refuses
 * any USE of the new value before that transaction commits. Everything that uses
 * `REPORT` — the widened condition CHECK, the reports table — is migration 066.
 *
 * ── The rollback rebuilds the type ───────────────────────────────────────
 *
 * PostgreSQL cannot drop an enum value, so `down()` re-creates the type without
 * it and moves the one column across. It refuses while any `REPORT` row exists.
 * The type's only dependants are `longitudinal_history.entry_type` and 064's
 * `chk_longitudinal_history_condition`, which is dropped and restored around it.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TYPE public.history_entry_type ADD VALUE IF NOT EXISTS 'REPORT';`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          SELECT count(*) INTO held FROM public.longitudinal_history
           WHERE entry_type::text = 'REPORT';
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 065 rollback refused: % history row(s) came from a confirmed report. Remove them deliberately first.', held;
          END IF;
        END $$;

        ALTER TABLE public.longitudinal_history
            DROP CONSTRAINT chk_longitudinal_history_condition;

        CREATE TYPE public.history_entry_type_065 AS ENUM ('MANUAL', 'BORROWING', 'SYSTEM');
        ALTER TABLE public.longitudinal_history
            ALTER COLUMN entry_type TYPE public.history_entry_type_065
            USING entry_type::text::public.history_entry_type_065;
        DROP TYPE public.history_entry_type;
        ALTER TYPE public.history_entry_type_065 RENAME TO history_entry_type;

        ALTER TABLE public.longitudinal_history
            ADD CONSTRAINT chk_longitudinal_history_condition
                CHECK (condition IS NOT NULL OR entry_type = 'SYSTEM');
        `,
        { transaction }
      );
    });
  },
};
