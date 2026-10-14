'use strict';

/**
 * Teacher Storage Room — REQ-REQUEST-023 (`IMPLEMENTATION_PLAN.md` §70).
 * Creation order #63; conditional procurement moves to `064+`.
 *
 * Each institution may name ONE physical Location as its Teacher Storage Room:
 * the room shared by all teachers. It is only a DEFAULT — the intended location
 * a request form proposes to a teacher who is no Location PIC. It moves no unit,
 * grants nothing, and is never copied into a request or a receipt snapshot; a
 * later change reaches future defaults only.
 *
 * ── institutions.teacher_storage_location_id ─────────────────────────────
 *
 * NULL — every existing row: not configured, so the default stays exactly as
 * before (empty for a non-PIC teacher). No backfill.
 *
 * ── The invariant, in the schema ─────────────────────────────────────────
 *
 * The room belongs to THE SAME institution. The composite key
 * `(teacher_storage_location_id, id)` references `locations (id,
 * institution_id)` — made referenceable by `uq_locations_id_institution`,
 * trivially unique since `id` is the key. With MATCH SIMPLE an institution with
 * no room is not checked; one with a room cannot name another institution's
 * location, and a location cannot leave its institution while it is the room
 * (the service clears the setting first, as a move already ends the PIC).
 *
 * NO ACTION throughout: locations and institutions are only ever deactivated.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.locations
            ADD CONSTRAINT uq_locations_id_institution UNIQUE (id, institution_id);

        ALTER TABLE public.institutions
            ADD COLUMN teacher_storage_location_id UUID NULL,
            ADD CONSTRAINT fk_institutions_teacher_storage
                FOREIGN KEY (teacher_storage_location_id, id)
                REFERENCES public.locations (id, institution_id);

        CREATE INDEX idx_institutions_teacher_storage
            ON public.institutions(teacher_storage_location_id)
            WHERE teacher_storage_location_id IS NOT NULL;
        `,
        { transaction }
      );
    });
  },

  /** Refuses rather than silently forgets an institution's configured room. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          SELECT count(*) INTO held FROM public.institutions
           WHERE teacher_storage_location_id IS NOT NULL;
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 063 rollback refused: % institution(s) have a Teacher Storage Room configured. Clear it deliberately first.', held;
          END IF;
        END $$;

        DROP INDEX IF EXISTS public.idx_institutions_teacher_storage;
        ALTER TABLE public.institutions
            DROP CONSTRAINT fk_institutions_teacher_storage,
            DROP COLUMN teacher_storage_location_id;
        ALTER TABLE public.locations
            DROP CONSTRAINT uq_locations_id_institution;
        `,
        { transaction }
      );
    });
  },
};
