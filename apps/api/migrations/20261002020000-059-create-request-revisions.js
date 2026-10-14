'use strict';

/**
 * Request Revision — REQ-REQUEST-018 (`IMPLEMENTATION_PLAN.md` §65). Creation
 * order #59; conditional procurement moves to `060+`.
 *
 * An approver may return a SUBMITTED request to its requester for revision. The
 * requester edits it and resubmits, and the approval chain restarts from its
 * first decision — on the SAME frozen step snapshot the request already has.
 * The workflow definition is never consulted again (`DEC-K`, `BR-029`).
 *
 * ── requests.status ───────────────────────────────────────────────────────
 *
 * `REVISION_REQUESTED`: returned to the requester, editable by them, not
 * terminal. 18 characters; the column is `VARCHAR(20)`.
 *
 * ── request_steps.cycle ───────────────────────────────────────────────────
 *
 * One request may run its approval chain several times. Each run is a CYCLE;
 * resubmission copies the newest cycle's rows into the next one. The current
 * cycle is DERIVED — the highest — never stored. A finished cycle is never
 * written again, so who decided what, when, and why survives every revision.
 *
 * Every existing row becomes cycle 1 through the column default: no backfill,
 * and no historical revision is invented. `(request_id, sequence)` was already
 * unique, so `(request_id, cycle, sequence)` holds for them.
 *
 * ── RETURNED ──────────────────────────────────────────────────────────────
 *
 * The state of a DECIDE step whose actor requested revision. Like APPROVED and
 * REJECTED it is the decision's outcome, and like REJECTED it carries its
 * reason in `comment` (`chk_request_steps_decision_comment`) and records who
 * acted, as which assignment, and when (`chk_request_steps_acted`).
 *
 * ── request_step_item_notes ───────────────────────────────────────────────
 *
 * Optional per-item notes of a revision decision. Immutable: no update or
 * delete endpoint. `line_no` and `item_description` are SNAPSHOTS: the item
 * may be edited, renumbered or deleted during the revision. A deletion detaches
 * the live reference (`request_item_id` → NULL, through the audited service) and
 * the snapshot keeps the note meaningful. At most one note per item per
 * decision.
 *
 * Every foreign key is NO ACTION.
 */

const STATUSES_BEFORE = `'DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_FULFILLED',
                         'FULFILLED', 'CLOSED', 'REJECTED', 'CANCELLED'`;
const STATUSES_AFTER = `'DRAFT', 'SUBMITTED', 'REVISION_REQUESTED', 'APPROVED',
                        'PARTIALLY_FULFILLED', 'FULFILLED', 'CLOSED', 'REJECTED', 'CANCELLED'`;

const STATES_BEFORE = `'PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'DONE', 'SKIPPED', 'CLOSED'`;
const STATES_AFTER = `'PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'RETURNED', 'DONE', 'SKIPPED', 'CLOSED'`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.requests
            DROP CONSTRAINT chk_requests_status,
            ADD CONSTRAINT chk_requests_status CHECK (status IN (${STATUSES_AFTER}));

        ALTER TABLE public.request_steps
            ADD COLUMN cycle SMALLINT NOT NULL DEFAULT 1,
            ADD CONSTRAINT chk_request_steps_cycle CHECK (cycle > 0),
            DROP CONSTRAINT uq_request_steps_sequence,
            ADD CONSTRAINT uq_request_steps_cycle_sequence UNIQUE (request_id, cycle, sequence),
            DROP CONSTRAINT chk_request_steps_state,
            ADD CONSTRAINT chk_request_steps_state CHECK (state IN (${STATES_AFTER})),
            DROP CONSTRAINT chk_request_steps_reject_comment,
            ADD CONSTRAINT chk_request_steps_decision_comment
                CHECK (state NOT IN ('REJECTED', 'RETURNED') OR comment IS NOT NULL),
            DROP CONSTRAINT chk_request_steps_acted,
            ADD CONSTRAINT chk_request_steps_acted
                CHECK (state NOT IN ('APPROVED', 'REJECTED', 'RETURNED', 'DONE')
                       OR (acted_by_user_id IS NOT NULL
                           AND acted_as_assignment_id IS NOT NULL
                           AND completed_at IS NOT NULL)),
            -- Only a decision can be returned for revision.
            ADD CONSTRAINT chk_request_steps_returned_decide
                CHECK (state <> 'RETURNED' OR step_type = 'DECIDE');

        CREATE TABLE public.request_step_item_notes (
            id                UUID          NOT NULL DEFAULT gen_random_uuid(),
            request_step_id   UUID          NOT NULL,
            request_item_id   UUID              NULL,
            line_no           SMALLINT      NOT NULL,
            item_description  VARCHAR(255)  NOT NULL,
            note              TEXT          NOT NULL,
            created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),

            CONSTRAINT pk_request_step_item_notes PRIMARY KEY (id),
            CONSTRAINT fk_rsin_step
                FOREIGN KEY (request_step_id) REFERENCES public.request_steps(id),
            CONSTRAINT fk_rsin_item
                FOREIGN KEY (request_item_id) REFERENCES public.request_items(id),
            CONSTRAINT uq_rsin_step_item UNIQUE (request_step_id, request_item_id),
            CONSTRAINT chk_rsin_note CHECK (btrim(note) <> ''),
            CONSTRAINT chk_rsin_line CHECK (line_no > 0)
        );

        CREATE INDEX idx_rsin_step ON public.request_step_item_notes(request_step_id);
        CREATE INDEX idx_rsin_item ON public.request_step_item_notes(request_item_id)
            WHERE request_item_id IS NOT NULL;
        `,
        { transaction }
      );
    });
  },

  /**
   * Refuses rather than discards a revision: returned decisions, their notes
   * and later cycles are the record of how a request was decided.
   */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint := 0;
        BEGIN
          IF to_regclass('public.request_step_item_notes') IS NOT NULL THEN
            SELECT count(*) INTO held FROM public.request_step_item_notes;
          END IF;
          SELECT held + count(*) INTO held FROM public.request_steps
           WHERE state = 'RETURNED' OR cycle > 1;
          SELECT held + count(*) INTO held FROM public.requests
           WHERE status = 'REVISION_REQUESTED';
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 059 rollback refused: % revision record(s) exist (returned decisions, later cycles, item notes or requests awaiting revision). Export or remove them deliberately first.', held;
          END IF;
        END $$;

        DROP TABLE IF EXISTS public.request_step_item_notes;

        ALTER TABLE public.request_steps
            DROP CONSTRAINT IF EXISTS chk_request_steps_returned_decide,
            DROP CONSTRAINT chk_request_steps_acted,
            ADD CONSTRAINT chk_request_steps_acted
                CHECK (state NOT IN ('APPROVED', 'REJECTED', 'DONE')
                       OR (acted_by_user_id IS NOT NULL
                           AND acted_as_assignment_id IS NOT NULL
                           AND completed_at IS NOT NULL)),
            DROP CONSTRAINT chk_request_steps_decision_comment,
            ADD CONSTRAINT chk_request_steps_reject_comment
                CHECK (state <> 'REJECTED' OR comment IS NOT NULL),
            DROP CONSTRAINT chk_request_steps_state,
            ADD CONSTRAINT chk_request_steps_state CHECK (state IN (${STATES_BEFORE})),
            DROP CONSTRAINT uq_request_steps_cycle_sequence,
            ADD CONSTRAINT uq_request_steps_sequence UNIQUE (request_id, sequence),
            DROP CONSTRAINT chk_request_steps_cycle,
            DROP COLUMN cycle;

        ALTER TABLE public.requests
            DROP CONSTRAINT chk_requests_status,
            ADD CONSTRAINT chk_requests_status CHECK (status IN (${STATUSES_BEFORE}));
        `,
        { transaction }
      );
    });
  },
};
