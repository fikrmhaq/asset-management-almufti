'use strict';

/**
 * Phase 20 (`CR-003`) — departments become institution-scoped.
 * `04-data-model.md` §5.2.2, creation order #40. REQ-ORG-003/004, `BR-007`.
 *
 * `public.departments` was created as a flat, GLOBAL list keyed by its natural
 * `VARCHAR(8)` code, which made two things impossible at once: two institutions
 * could not both run a department coded `TKJ`, and a department could not be
 * scoped to the institution that owns it. Three places in the repository already
 * recorded that as a known contradiction rather than a design — the model, the
 * service and the departments screen each carry a comment saying the schema
 * "cannot express" institution scope. This migration is what resolves them.
 *
 * The new shape is a surrogate UUID key with `UNIQUE (institution_id, code)`, so
 * the code becomes an institution-local label rather than a global identity.
 *
 * `institution_id` IS NULLABLE, AND NULL MEANS *UNASSIGNED* — never "shared" or
 * "visible to everyone" (`CR-003` §4.3). Existing rows land there because there
 * is no institution to infer for them and inventing one would be worse than an
 * honest absence. The state is deliberately inert: `assertDepartmentAssignable`
 * refuses to attach a department with no institution to any asset unit, so an
 * unassigned department can be listed and edited but never used.
 *
 * ── The guard ──────────────────────────────────────────────────────────────
 *
 * Retyping `asset_units.department_id` from `VARCHAR(8)` to `UUID` cannot carry
 * existing values across: the old value is a code, the new one is a surrogate
 * key, and no deterministic mapping exists once two institutions may share a
 * code. That is only safe because no unit has a department today — every write
 * path that can set one is unreachable from the UI, and no seeder assigns one.
 *
 * The migration does not TRUST that. It counts first and raises, so a wrong
 * assumption becomes a failed deploy instead of silently discarded assignments.
 * If this ever fires, the fix is to map codes to the new UUIDs explicitly in a
 * bespoke migration — not to delete the guard.
 */

const GUARD = `
DO $$
DECLARE assigned bigint;
BEGIN
  SELECT count(*) INTO assigned FROM public.asset_units WHERE department_id IS NOT NULL;
  IF assigned > 0 THEN
    RAISE EXCEPTION
      'Migration 040 aborted: % asset_units rows have a department assigned. CR-003 assumes none exist. Map codes to the new UUIDs explicitly before migrating.', assigned;
  END IF;
END $$;
`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(GUARD, { transaction });

      // The FK has to go before either side of it can be retyped.
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.asset_units
            DROP CONSTRAINT IF EXISTS fk_asset_units_department;

        DROP INDEX IF EXISTS public.idx_asset_units_department;
        `,
        { transaction }
      );

      /**
       * The old natural key becomes `code`, and a fresh surrogate takes its
       * place. Renaming rather than dropping keeps every existing department
       * row — its code, name and active flag all survive; only its identity
       * changes.
       */
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.departments
            DROP CONSTRAINT pk_departments;

        ALTER TABLE public.departments
            RENAME COLUMN id TO code;

        ALTER TABLE public.departments
            ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid(),
            ADD COLUMN institution_id UUID NULL;

        ALTER TABLE public.departments
            ADD CONSTRAINT pk_departments PRIMARY KEY (id),
            ADD CONSTRAINT fk_departments_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            ADD CONSTRAINT uq_departments_institution_code UNIQUE (institution_id, code);

        CREATE INDEX idx_departments_institution ON public.departments(institution_id);
        `,
        { transaction }
      );

      /**
       * Every value is NULL — the guard above proved it — so `USING NULL` is a
       * statement of that fact rather than a conversion. Spelling it out keeps
       * Postgres from refusing the cast and keeps the intent legible.
       */
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.asset_units
            ALTER COLUMN department_id TYPE UUID USING NULL;

        ALTER TABLE public.asset_units
            ADD CONSTRAINT fk_asset_units_department
                FOREIGN KEY (department_id) REFERENCES public.departments(id);

        CREATE INDEX idx_asset_units_department ON public.asset_units(department_id);
        `,
        { transaction }
      );
    });
  },

  /**
   * The mirror guard. Reversing this migration collapses `(institution_id, code)`
   * back onto a globally unique code, which cannot represent two institutions
   * sharing one — and cannot represent an assignment made since the up-migration
   * either. Both are refused rather than silently resolved.
   */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE assigned bigint; duplicated bigint;
        BEGIN
          SELECT count(*) INTO assigned FROM public.asset_units WHERE department_id IS NOT NULL;
          IF assigned > 0 THEN
            RAISE EXCEPTION
              'Migration 040 down aborted: % asset_units rows have a department assigned, which a VARCHAR(8) code column cannot represent.', assigned;
          END IF;

          SELECT count(*) INTO duplicated FROM (
            SELECT code FROM public.departments GROUP BY code HAVING count(*) > 1
          ) d;
          IF duplicated > 0 THEN
            RAISE EXCEPTION
              'Migration 040 down aborted: % department codes are used by more than one institution and cannot share a global primary key.', duplicated;
          END IF;
        END $$;
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.asset_units
            DROP CONSTRAINT IF EXISTS fk_asset_units_department;

        DROP INDEX IF EXISTS public.idx_asset_units_department;

        ALTER TABLE public.asset_units
            ALTER COLUMN department_id TYPE VARCHAR(8) USING NULL;

        DROP INDEX IF EXISTS public.idx_departments_institution;

        ALTER TABLE public.departments
            DROP CONSTRAINT IF EXISTS uq_departments_institution_code,
            DROP CONSTRAINT IF EXISTS fk_departments_institution,
            DROP CONSTRAINT IF EXISTS pk_departments;

        ALTER TABLE public.departments
            DROP COLUMN IF EXISTS institution_id,
            DROP COLUMN IF EXISTS id;

        ALTER TABLE public.departments
            RENAME COLUMN code TO id;

        ALTER TABLE public.departments
            ADD CONSTRAINT pk_departments PRIMARY KEY (id);

        ALTER TABLE public.asset_units
            ADD CONSTRAINT fk_asset_units_department
                FOREIGN KEY (department_id) REFERENCES public.departments(id);

        CREATE INDEX idx_asset_units_department ON public.asset_units(department_id);
        `,
        { transaction }
      );
    });
  },
};
