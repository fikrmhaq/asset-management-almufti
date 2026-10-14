'use strict';

/**
 * Phase 35 (`CR-014`) — school position assignments.
 * `04-data-model.md` §5.7.1; creation order #49. REQ-POS-001 – REQ-POS-003.
 *
 * Who holds, and who held, each school position: the Kajur and Toolman of a
 * department, the Wakasek posts, the Kepala Sekolah, and the two teacher
 * request contexts.
 *
 * ── Not an authorization table ─────────────────────────────────────────────
 *
 * A position grants no permission and no record reach (`BR-028`). It is also
 * independent of `department_pic_assignments` and `location_pic_assignments`:
 * there is no foreign key to either and no trigger on them. From Phase 38 the
 * workflow reads the CURRENT row to decide whose turn a step is — never what
 * that person may do.
 *
 * ── Shape ──────────────────────────────────────────────────────────────────
 *
 * The temporal pattern of migration 041: one row per period, `is_current` plus a
 * null `ended_at` marking the live one, closed rows never updated, and the two
 * facts made incapable of disagreeing by `chk_pos_assign_current`.
 *
 * ── The value list ─────────────────────────────────────────────────────────
 *
 * `VARCHAR` + a named CHECK, not an enum type and not a DOMAIN (`CR-014`
 * `DEC-Q`, `DEC-U`). The list is written out here, frozen as migrations must be;
 * `src/domain/schoolPositions.js` is the authoritative copy, and
 * `tests/database/29-position-assignments.test.js` fails if the two disagree.
 *
 * `SARPRAS_STAFF` is deliberately absent: whether it exists is `CR-014` Q4.
 *
 * `COMMON_TEACHER` and `JURUSAN_TEACHER` are two encodings of ONE concept —
 * a teacher without a Jurusan, and a teacher for Jurusan X — kept as two codes so
 * that workflow selection stays an exact match (`CR-014` §4.2).
 */

const POSITIONS = `'COMMON_TEACHER', 'JURUSAN_TEACHER', 'TOOLMAN', 'KAJUR',
                   'WAKASEK_SARPRAS', 'WAKASEK_KURIKULUM', 'WAKASEK_KESISWAAN',
                   'KEPALA_SEKOLAH'`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.position_assignments (
            id             UUID        NOT NULL DEFAULT gen_random_uuid(),
            institution_id UUID        NOT NULL,
            user_id        UUID        NOT NULL,
            position_code  VARCHAR(32) NOT NULL,
            department_id  UUID            NULL,
            is_current     BOOLEAN     NOT NULL DEFAULT true,
            assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            ended_at       TIMESTAMPTZ     NULL,
            assigned_by    UUID            NULL,
            ended_by       UUID            NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT pk_position_assignments PRIMARY KEY (id),
            CONSTRAINT fk_pos_assign_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            CONSTRAINT fk_pos_assign_user
                FOREIGN KEY (user_id) REFERENCES public.users(id),
            CONSTRAINT fk_pos_assign_department
                FOREIGN KEY (department_id) REFERENCES public.departments(id),
            CONSTRAINT fk_pos_assign_assigned_by
                FOREIGN KEY (assigned_by) REFERENCES public.users(id),
            CONSTRAINT fk_pos_assign_ended_by
                FOREIGN KEY (ended_by) REFERENCES public.users(id),
            CONSTRAINT chk_pos_assign_position
                CHECK (position_code IN (${POSITIONS})),
            -- A department exactly for the department-bound positions.
            CONSTRAINT chk_pos_assign_department
                CHECK ((position_code IN ('JURUSAN_TEACHER', 'TOOLMAN', 'KAJUR'))
                       = (department_id IS NOT NULL)),
            CONSTRAINT chk_pos_assign_dates
                CHECK (ended_at IS NULL OR ended_at >= assigned_at),
            -- is_current and ended_at are one fact, not two that may disagree.
            CONSTRAINT chk_pos_assign_current
                CHECK ((is_current = true  AND ended_at IS NULL)
                    OR (is_current = false AND ended_at IS NOT NULL))
        );

        CREATE INDEX idx_pos_assign_user_current
            ON public.position_assignments(user_id) WHERE is_current;
        CREATE INDEX idx_pos_assign_department
            ON public.position_assignments(department_id) WHERE department_id IS NOT NULL;
        CREATE INDEX idx_pos_assign_institution
            ON public.position_assignments(institution_id, position_code) WHERE is_current;

        -- One current holder of each single-holder post.
        CREATE UNIQUE INDEX uq_pos_assign_institution_post
            ON public.position_assignments(institution_id, position_code)
            WHERE is_current AND position_code IN ('WAKASEK_SARPRAS', 'WAKASEK_KURIKULUM',
                                                   'WAKASEK_KESISWAAN', 'KEPALA_SEKOLAH');
        CREATE UNIQUE INDEX uq_pos_assign_department_post
            ON public.position_assignments(department_id, position_code)
            WHERE is_current AND position_code IN ('KAJUR', 'TOOLMAN');

        -- A person is the Toolman of one department at a time.
        CREATE UNIQUE INDEX uq_pos_assign_one_toolman
            ON public.position_assignments(user_id)
            WHERE is_current AND position_code = 'TOOLMAN';

        -- No duplicate live assignment. NULLS NOT DISTINCT makes COMMON_TEACHER
        -- (no department) holdable at most once per user.
        CREATE UNIQUE INDEX uq_pos_assign_no_duplicate
            ON public.position_assignments(user_id, position_code, department_id)
            NULLS NOT DISTINCT
            WHERE is_current;
        `,
        { transaction }
      );
    });
  },

  /**
   * Refuses rather than discards. Assignment history is the record of who held
   * which post when; dropping a populated table would erase it with no way back.
   */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          IF to_regclass('public.position_assignments') IS NOT NULL THEN
            SELECT count(*) INTO held FROM public.position_assignments;
            IF held > 0 THEN
              RAISE EXCEPTION
                'Migration 049 rollback refused: public.position_assignments holds % row(s) of assignment history. Export or remove them deliberately first.', held;
            END IF;
          END IF;
        END $$;

        DROP TABLE IF EXISTS public.position_assignments;
        `,
        { transaction }
      );
    });
  },
};
