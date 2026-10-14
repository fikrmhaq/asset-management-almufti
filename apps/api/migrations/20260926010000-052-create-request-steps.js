'use strict';

/**
 * Phase 38 (`CR-014`) — request steps: the workflow snapshot and its execution.
 * `04-data-model.md` §5.7.4; creation order #52. REQ-WF-005 – REQ-WF-007,
 * REQ-REQUEST-008, REQ-REQUEST-009.
 *
 * At submission every step of the selected ACTIVE definition is COPIED here
 * (`BR-029`, `DEC-K`); the request then proceeds by these rows alone, so a later
 * definition version can never change a running request.
 *
 * ── The invariant (Phase 38 decisions G1, G4) ─────────────────────────────
 *
 * At most one ACTIVE `DECIDE` per request (`uq_request_steps_one_active_decision`).
 * `PROCURE` and `REGISTER` open together, in the same transaction that finishes
 * the last `DECIDE`; they are never ACTIVE beside a `DECIDE`. That ordering spans
 * rows and is a service rule with tests.
 *
 * ── The value lists ────────────────────────────────────────────────────────
 *
 * `VARCHAR` + named CHECKs (`DEC-Q`, `DEC-U`). `src/domain/workflowShape.js`,
 * `src/domain/schoolPositions.js` and `src/domain/requestStepStates.js` are the
 * authoritative copies; `tests/database/32-request-workflow.test.js` fails on
 * drift.
 *
 * ── Approved additions beyond §5.7.4 (decision F7) ────────────────────────
 *
 *   `chk_request_steps_acted`     APPROVED / REJECTED / DONE record who acted,
 *                                 in which capacity, and when.
 *   `chk_request_steps_finished`  SKIPPED / CLOSED record when.
 *   `chk_request_steps_activated` ACTIVE records when it opened.
 *
 * `actor_position_code` is NOT NULL: publication refuses an empty actor
 * (Phase 36 decision D1), so a snapshot always has one.
 */

const POSITIONS = `'COMMON_TEACHER', 'JURUSAN_TEACHER', 'TOOLMAN', 'KAJUR',
                   'WAKASEK_SARPRAS', 'WAKASEK_KURIKULUM', 'WAKASEK_KESISWAAN',
                   'KEPALA_SEKOLAH'`;

const STATES = `'PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'DONE', 'SKIPPED', 'CLOSED'`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.request_steps (
            id                         UUID        NOT NULL DEFAULT gen_random_uuid(),
            request_id                 UUID        NOT NULL,
            sequence                   SMALLINT    NOT NULL,
            step_type                  VARCHAR(10) NOT NULL,
            actor_position_code        VARCHAR(32) NOT NULL,
            procurement_mode           VARCHAR(10)     NULL,
            skip_if_requester_is_actor BOOLEAN     NOT NULL,
            state                      VARCHAR(10) NOT NULL DEFAULT 'PENDING',
            skip_reason                VARCHAR(10)     NULL,
            acted_by_user_id           UUID            NULL,
            acted_as_assignment_id     UUID            NULL,
            comment                    TEXT            NULL,
            activated_at               TIMESTAMPTZ     NULL,
            completed_at               TIMESTAMPTZ     NULL,
            created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT pk_request_steps PRIMARY KEY (id),
            CONSTRAINT uq_request_steps_sequence UNIQUE (request_id, sequence),
            CONSTRAINT fk_request_steps_request
                FOREIGN KEY (request_id) REFERENCES public.requests(id),
            CONSTRAINT fk_request_steps_acted_by
                FOREIGN KEY (acted_by_user_id) REFERENCES public.users(id),
            CONSTRAINT fk_request_steps_acted_as
                FOREIGN KEY (acted_as_assignment_id) REFERENCES public.position_assignments(id),
            CONSTRAINT chk_request_steps_type
                CHECK (step_type IN ('DECIDE', 'PROCURE', 'REGISTER')),
            CONSTRAINT chk_request_steps_actor
                CHECK (actor_position_code IN (${POSITIONS})),
            CONSTRAINT chk_request_steps_mode
                CHECK ((step_type = 'PROCURE') = (procurement_mode IS NOT NULL)
                       AND (procurement_mode IS NULL OR procurement_mode IN ('INTERNAL', 'EXTERNAL'))),
            CONSTRAINT chk_request_steps_state
                CHECK (state IN (${STATES})),
            CONSTRAINT chk_request_steps_skip
                CHECK ((state = 'SKIPPED') = (skip_reason IS NOT NULL)
                       AND (skip_reason IS NULL OR skip_reason = 'SELF')),
            CONSTRAINT chk_request_steps_reject_comment
                CHECK (state <> 'REJECTED' OR comment IS NOT NULL),
            -- F7: a finished action records who acted, in which capacity, and when.
            CONSTRAINT chk_request_steps_acted
                CHECK (state NOT IN ('APPROVED', 'REJECTED', 'DONE')
                       OR (acted_by_user_id IS NOT NULL
                           AND acted_as_assignment_id IS NOT NULL
                           AND completed_at IS NOT NULL)),
            CONSTRAINT chk_request_steps_finished
                CHECK (state NOT IN ('SKIPPED', 'CLOSED') OR completed_at IS NOT NULL),
            CONSTRAINT chk_request_steps_activated
                CHECK (state <> 'ACTIVE' OR activated_at IS NOT NULL)
        );

        -- Decisions run strictly in sequence (G1).
        CREATE UNIQUE INDEX uq_request_steps_one_active_decision
            ON public.request_steps(request_id)
            WHERE state = 'ACTIVE' AND step_type = 'DECIDE';

        -- "Awaiting my action" and actor visibility (REQ-REQUEST-015).
        CREATE INDEX idx_request_steps_open
            ON public.request_steps(actor_position_code, request_id)
            WHERE state = 'ACTIVE';
        `,
        { transaction }
      );
    });
  },

  /** Refuses rather than discards the record of how requests were decided. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          IF to_regclass('public.request_steps') IS NOT NULL THEN
            SELECT count(*) INTO held FROM public.request_steps;
            IF held > 0 THEN
              RAISE EXCEPTION
                'Migration 052 rollback refused: public.request_steps holds % step(s) of request history. Export or remove them deliberately first.', held;
            END IF;
          END IF;
        END $$;

        DROP TABLE IF EXISTS public.request_steps;
        `,
        { transaction }
      );
    });
  },
};
