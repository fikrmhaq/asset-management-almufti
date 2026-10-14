'use strict';

/**
 * Phase 37 (`CR-014`) — requests and their items, drafting only.
 * `04-data-model.md` §5.7.3; creation order #51. REQ-REQUEST-001 – REQ-REQUEST-006,
 * REQ-REQUEST-015.
 *
 * A Request is a need raised by a person acting in one of their school
 * positions. It is OPTIONAL, always: no asset or unit requires one, and none is
 * ever linked to a fabricated one (`CR-014` `DEC-A`, `BR-032`). Nothing in this
 * migration touches `assets` or `asset_units`.
 *
 * ── The value lists ────────────────────────────────────────────────────────
 *
 * `VARCHAR` + named CHECKs, not enum types and not DOMAINs (`CR-014` `DEC-Q`,
 * `DEC-U`). Frozen here; the authoritative copies are
 * `src/domain/requestCategories.js`, `src/domain/schoolPositions.js` and
 * `src/domain/requestStatuses.js`, and `tests/database/31-requests.test.js`
 * fails if any CHECK disagrees with them.
 *
 * ── Quantity (`CR-014` Q1, working assumption approved for Phase 37) ─────────
 *
 * `quantity_requested` is a positive whole number of Asset Units. Consumable and
 * measured goods (metres of cable, litres of paint) are out of scope for
 * Requests; there is deliberately no second quantity model.
 *
 * ── Approved additions beyond the §5.7.3 draft (Phase 37 decision E6) ────────
 *
 *   `chk_requests_requester_department` — the requester-context snapshot has a
 *       department exactly when its position is held for one, mirroring
 *       `chk_pos_assign_department`.
 *   `chk_requests_department_locked` — for such a context, the Request's
 *       department IS that department.
 *
 * No cascade from `requests` to `request_items`: items are deleted only while
 * their Request is a DRAFT, which the service enforces.
 */

const POSITIONS = `'COMMON_TEACHER', 'JURUSAN_TEACHER', 'TOOLMAN', 'KAJUR',
                   'WAKASEK_SARPRAS', 'WAKASEK_KURIKULUM', 'WAKASEK_KESISWAAN',
                   'KEPALA_SEKOLAH'`;

const CATEGORIES = `'COMMON', 'JURUSAN', 'KBM', 'EKSKUL'`;

const STATUSES = `'DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_FULFILLED',
                  'FULFILLED', 'CLOSED', 'REJECTED', 'CANCELLED'`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.requests (
            id                        UUID         NOT NULL DEFAULT gen_random_uuid(),
            institution_id            UUID         NOT NULL,
            request_number            VARCHAR(32)  NOT NULL,
            category                  VARCHAR(10)  NOT NULL,
            title                     VARCHAR(255) NOT NULL,
            justification             TEXT             NULL,
            requester_user_id         UUID         NOT NULL,
            requester_assignment_id   UUID         NOT NULL,
            requester_position_code   VARCHAR(32)  NOT NULL,
            requester_department_id   UUID             NULL,
            department_id             UUID             NULL,
            destination_location_id   UUID             NULL,
            needed_by                 DATE             NULL,
            workflow_definition_id    UUID             NULL,
            status                    VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
            submitted_at              TIMESTAMPTZ      NULL,
            approved_at               TIMESTAMPTZ      NULL,
            closed_at                 TIMESTAMPTZ      NULL,
            close_reason              TEXT             NULL,
            created_by                UUID             NULL,
            updated_by                UUID             NULL,
            created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_requests PRIMARY KEY (id),
            CONSTRAINT uq_requests_number UNIQUE (institution_id, request_number),
            CONSTRAINT fk_requests_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            CONSTRAINT fk_requests_requester
                FOREIGN KEY (requester_user_id) REFERENCES public.users(id),
            CONSTRAINT fk_requests_assignment
                FOREIGN KEY (requester_assignment_id) REFERENCES public.position_assignments(id),
            CONSTRAINT fk_requests_req_dept
                FOREIGN KEY (requester_department_id) REFERENCES public.departments(id),
            CONSTRAINT fk_requests_department
                FOREIGN KEY (department_id) REFERENCES public.departments(id),
            CONSTRAINT fk_requests_destination
                FOREIGN KEY (destination_location_id) REFERENCES public.locations(id),
            CONSTRAINT fk_requests_definition
                FOREIGN KEY (workflow_definition_id) REFERENCES public.workflow_definitions(id),
            CONSTRAINT fk_requests_created_by
                FOREIGN KEY (created_by) REFERENCES public.users(id),
            CONSTRAINT fk_requests_updated_by
                FOREIGN KEY (updated_by) REFERENCES public.users(id),
            CONSTRAINT chk_requests_category
                CHECK (category IN (${CATEGORIES})),
            CONSTRAINT chk_requests_requester
                CHECK (requester_position_code IN (${POSITIONS})),
            CONSTRAINT chk_requests_status
                CHECK (status IN (${STATUSES})),
            -- A JURUSAN request always concerns a Jurusan (CR-014 §4.4).
            CONSTRAINT chk_requests_jurusan_department
                CHECK (category <> 'JURUSAN' OR department_id IS NOT NULL),
            -- The definition followed is set on submission (Phase 38).
            CONSTRAINT chk_requests_definition
                CHECK (status IN ('DRAFT', 'CANCELLED') OR workflow_definition_id IS NOT NULL),
            -- E6: the context snapshot has a department exactly for the
            -- department-bound positions.
            CONSTRAINT chk_requests_requester_department
                CHECK ((requester_position_code IN ('JURUSAN_TEACHER', 'TOOLMAN', 'KAJUR'))
                       = (requester_department_id IS NOT NULL)),
            -- E6: and for those, the request's department is locked to it.
            CONSTRAINT chk_requests_department_locked
                CHECK (requester_department_id IS NULL OR department_id = requester_department_id)
        );

        CREATE INDEX idx_requests_institution_status
            ON public.requests(institution_id, status);
        CREATE INDEX idx_requests_requester
            ON public.requests(requester_user_id);
        CREATE INDEX idx_requests_department
            ON public.requests(department_id) WHERE department_id IS NOT NULL;

        CREATE TABLE public.request_items (
            id                   UUID          NOT NULL DEFAULT gen_random_uuid(),
            request_id           UUID          NOT NULL,
            line_no              SMALLINT      NOT NULL,
            description          VARCHAR(255)  NOT NULL,
            specification        TEXT              NULL,
            quantity_requested   INTEGER       NOT NULL,
            quantity_cancelled   INTEGER       NOT NULL DEFAULT 0,
            measurement_unit_id  UUID              NULL,
            estimated_unit_price NUMERIC(15,2)     NULL,
            classification_id    CHAR(12)          NULL,
            created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),

            CONSTRAINT pk_request_items PRIMARY KEY (id),
            CONSTRAINT uq_request_items_line UNIQUE (request_id, line_no),
            CONSTRAINT fk_request_items_request
                FOREIGN KEY (request_id) REFERENCES public.requests(id),
            CONSTRAINT fk_request_items_unit
                FOREIGN KEY (measurement_unit_id) REFERENCES ref.measurement_units(id),
            CONSTRAINT fk_request_items_classification
                FOREIGN KEY (classification_id) REFERENCES ref.asset_classifications(id),
            CONSTRAINT chk_request_items_quantity
                CHECK (quantity_requested > 0),
            CONSTRAINT chk_request_items_cancelled
                CHECK (quantity_cancelled >= 0 AND quantity_cancelled <= quantity_requested),
            CONSTRAINT chk_request_items_price
                CHECK (estimated_unit_price IS NULL OR estimated_unit_price >= 0)
        );
        `,
        { transaction }
      );
    });
  },

  /**
   * Refuses rather than discards. A request — even a draft — carries a number
   * that is never reused; dropping populated tables would erase that record.
   */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          IF to_regclass('public.requests') IS NOT NULL THEN
            SELECT count(*) INTO held FROM public.requests;
            IF held > 0 THEN
              RAISE EXCEPTION
                'Migration 051 rollback refused: public.requests holds % request(s). Export or remove them deliberately first.', held;
            END IF;
          END IF;
        END $$;

        DROP TABLE IF EXISTS public.request_items;
        DROP TABLE IF EXISTS public.requests;
        `,
        { transaction }
      );
    });
  },
};
