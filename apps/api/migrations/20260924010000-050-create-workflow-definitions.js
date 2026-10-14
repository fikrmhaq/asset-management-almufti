'use strict';

/**
 * Phase 36 (`CR-014`) — workflow definitions.
 * `04-data-model.md` §5.7.2; creation order #50. REQ-WF-001 – REQ-WF-004, REQ-WF-006.
 *
 * The process an institution follows for one request category from one
 * requester context: an ordered list of steps, versioned, and selected later by
 * an EXACT match on (institution, category, requester position) — with no
 * default, fallback or inherited definition (`BR-030`).
 *
 * ── The value lists ────────────────────────────────────────────────────────
 *
 * `VARCHAR` + named CHECKs, not enum types and not DOMAINs (`CR-014` `DEC-Q`,
 * `DEC-U`). The category and position lists are written out here, frozen as
 * migrations must be. `src/domain/requestCategories.js` and
 * `src/domain/schoolPositions.js` are the authoritative copies, and
 * `tests/database/30-workflow-definitions.test.js` fails if any CHECK below
 * disagrees with them.
 *
 * ── Approved departures from the §5.7.2 draft (Phase 36 plan) ─────────────
 *
 *   D1  `actor_position_code` is NULLABLE. A template may leave an undecided
 *       actor empty (`CR-014` Q3, Q4) rather than guess one. The service
 *       refuses to publish a definition with an empty actor, so every ACTIVE
 *       and RETIRED definition — and every Request snapshot copied from one —
 *       has a concrete position.
 *   D2  `uq_wf_def_draft`: at most one DRAFT per key, beside the documented
 *       `uq_wf_def_active`.
 *   `chk_wf_def_retired` makes `retired_at` and the RETIRED status one fact.
 *
 * ── Immutability ───────────────────────────────────────────────────────────
 *
 * ACTIVE and RETIRED definitions and their steps are never changed; that is a
 * service rule with tests, because "which rows may change" depends on the
 * parent's status and a CHECK cannot see another row. The cascade on
 * `fk_wf_step_definition` is the documented one; no endpoint deletes a
 * definition (Phase 36 decision D2).
 */

const POSITIONS = `'COMMON_TEACHER', 'JURUSAN_TEACHER', 'TOOLMAN', 'KAJUR',
                   'WAKASEK_SARPRAS', 'WAKASEK_KURIKULUM', 'WAKASEK_KESISWAAN',
                   'KEPALA_SEKOLAH'`;

const CATEGORIES = `'COMMON', 'JURUSAN', 'KBM', 'EKSKUL'`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.workflow_definitions (
            id                      UUID        NOT NULL DEFAULT gen_random_uuid(),
            institution_id          UUID        NOT NULL,
            category                VARCHAR(10) NOT NULL,
            requester_position_code VARCHAR(32) NOT NULL,
            version                 INTEGER     NOT NULL,
            status                  VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
            published_at            TIMESTAMPTZ     NULL,
            published_by            UUID            NULL,
            retired_at              TIMESTAMPTZ     NULL,
            created_by              UUID            NULL,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT pk_workflow_definitions PRIMARY KEY (id),
            CONSTRAINT fk_wf_def_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            CONSTRAINT fk_wf_def_published_by
                FOREIGN KEY (published_by) REFERENCES public.users(id),
            CONSTRAINT fk_wf_def_created_by
                FOREIGN KEY (created_by) REFERENCES public.users(id),
            CONSTRAINT chk_wf_def_category
                CHECK (category IN (${CATEGORIES})),
            CONSTRAINT chk_wf_def_requester
                CHECK (requester_position_code IN (${POSITIONS})),
            CONSTRAINT chk_wf_def_status
                CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
            CONSTRAINT chk_wf_def_version
                CHECK (version > 0),
            CONSTRAINT chk_wf_def_published
                CHECK (status = 'DRAFT' OR published_at IS NOT NULL),
            CONSTRAINT chk_wf_def_retired
                CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL)),
            CONSTRAINT uq_wf_def_version
                UNIQUE (institution_id, category, requester_position_code, version)
        );

        -- Exact selection: one ACTIVE definition per key, and no fallback
        -- exists (BR-030).
        CREATE UNIQUE INDEX uq_wf_def_active
            ON public.workflow_definitions(institution_id, category, requester_position_code)
            WHERE status = 'ACTIVE';

        -- One DRAFT per key (Phase 36 decision D2): a second would make "the
        -- next version" ambiguous.
        CREATE UNIQUE INDEX uq_wf_def_draft
            ON public.workflow_definitions(institution_id, category, requester_position_code)
            WHERE status = 'DRAFT';

        CREATE TABLE public.workflow_definition_steps (
            id                         UUID        NOT NULL DEFAULT gen_random_uuid(),
            definition_id              UUID        NOT NULL,
            sequence                   SMALLINT    NOT NULL,
            step_type                  VARCHAR(10) NOT NULL,
            actor_position_code        VARCHAR(32)     NULL,
            procurement_mode           VARCHAR(10)     NULL,
            skip_if_requester_is_actor BOOLEAN     NOT NULL DEFAULT false,

            CONSTRAINT pk_workflow_definition_steps PRIMARY KEY (id),
            CONSTRAINT fk_wf_step_definition
                FOREIGN KEY (definition_id) REFERENCES public.workflow_definitions(id)
                ON DELETE CASCADE,
            CONSTRAINT chk_wf_step_type
                CHECK (step_type IN ('DECIDE', 'PROCURE', 'REGISTER')),
            -- NULL admitted for an undecided DRAFT actor (D1); refused at publish.
            CONSTRAINT chk_wf_step_actor
                CHECK (actor_position_code IS NULL OR actor_position_code IN (${POSITIONS})),
            CONSTRAINT chk_wf_step_mode
                CHECK (procurement_mode IS NULL OR procurement_mode IN ('INTERNAL', 'EXTERNAL')),
            -- A procurement mode exactly on PROCURE steps.
            CONSTRAINT chk_wf_step_mode_use
                CHECK ((step_type = 'PROCURE') = (procurement_mode IS NOT NULL)),
            CONSTRAINT chk_wf_step_sequence
                CHECK (sequence > 0),
            CONSTRAINT uq_wf_step_sequence
                UNIQUE (definition_id, sequence)
        );
        `,
        { transaction }
      );
    });
  },

  /**
   * Refuses rather than discards. A definition, once published, is the record
   * of how requests were to be decided; from Phase 38 running requests point at
   * it. Dropping populated tables would erase that with no way back.
   */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE defined bigint;
        BEGIN
          IF to_regclass('public.workflow_definitions') IS NOT NULL THEN
            SELECT count(*) INTO defined FROM public.workflow_definitions;
            IF defined > 0 THEN
              RAISE EXCEPTION
                'Migration 050 rollback refused: public.workflow_definitions holds % workflow definition(s). Export or remove them deliberately first.', defined;
            END IF;
          END IF;
        END $$;

        DROP TABLE IF EXISTS public.workflow_definition_steps;
        DROP TABLE IF EXISTS public.workflow_definitions;
        `,
        { transaction }
      );
    });
  },
};
