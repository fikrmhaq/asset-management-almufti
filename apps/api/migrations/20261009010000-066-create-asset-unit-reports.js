'use strict';

/**
 * Room PIC reports — REQ-REQUEST-025 (`IMPLEMENTATION_PLAN.md` §72). Creation
 * order #66; conditional procurement moves to `067+`.
 *
 * The person in charge of a room REPORTS what they see about a unit currently in
 * that exact room — a condition, a move, or another observation. A report is a
 * claim, never state: it does not touch `longitudinal_history`. A reviewer
 * confirms or rejects it; confirming a CONDITION or MOVEMENT report changes the
 * unit through the authoritative writer as one `REPORT` history row (migration
 * 065), linked back here.
 *
 * ── public.asset_unit_reports ────────────────────────────────────────────
 *
 * The ORIGINAL OBSERVATION never changes: kind, narrative, the reported
 * condition or destination (its NAME snapshotted, so a later rename or move of
 * that location does not alter what was reported), the unit's state when it was
 * reported (location and its name, condition, and the open history row — the
 * stale check compares against it), reporter and time. Only the review fields
 * are written afterwards, once. A rejected report stays.
 *
 * VARCHAR + named CHECKs for kind and status, as everywhere in CR-014.
 *
 * ── longitudinal_history ─────────────────────────────────────────────────
 *
 * `chk_longitudinal_history_condition` widens to `SYSTEM` and `REPORT`: a
 * confirmed MOVEMENT of a unit that has never had a condition records none. A
 * confirmed CONDITION report always carries its condition (the service).
 */

const REPORT_TABLE = `
CREATE TABLE public.asset_unit_reports (
    id                       UUID          NOT NULL DEFAULT gen_random_uuid(),
    institution_id           UUID          NOT NULL,
    asset_unit_id            UUID          NOT NULL,
    kind                     VARCHAR(20)   NOT NULL,
    narrative                TEXT          NOT NULL,
    reported_condition       public.condition_enum NULL,
    destination_location_id  UUID          NULL,
    destination_name         VARCHAR(255)  NULL,
    snapshot_location_id     UUID          NOT NULL,
    snapshot_location_name   VARCHAR(255)  NOT NULL,
    snapshot_condition       public.condition_enum NULL,
    snapshot_history_id      UUID          NULL,
    reporter_id              UUID          NOT NULL,
    reported_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    status                   VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
    reviewed_by              UUID          NULL,
    reviewed_at              TIMESTAMPTZ   NULL,
    review_note              TEXT          NULL,
    stale_acknowledged       BOOLEAN       NOT NULL DEFAULT false,
    history_id               UUID          NULL,
    created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_asset_unit_reports PRIMARY KEY (id),
    CONSTRAINT fk_aur_institution FOREIGN KEY (institution_id)
        REFERENCES public.institutions (id),
    CONSTRAINT fk_aur_unit FOREIGN KEY (asset_unit_id)
        REFERENCES public.asset_units (id),
    CONSTRAINT fk_aur_destination FOREIGN KEY (destination_location_id)
        REFERENCES public.locations (id),
    CONSTRAINT fk_aur_snapshot_location FOREIGN KEY (snapshot_location_id)
        REFERENCES public.locations (id),
    CONSTRAINT fk_aur_snapshot_history FOREIGN KEY (snapshot_history_id)
        REFERENCES public.longitudinal_history (id),
    CONSTRAINT fk_aur_reporter FOREIGN KEY (reporter_id)
        REFERENCES public.users (id),
    CONSTRAINT fk_aur_reviewer FOREIGN KEY (reviewed_by)
        REFERENCES public.users (id),
    CONSTRAINT fk_aur_history FOREIGN KEY (history_id)
        REFERENCES public.longitudinal_history (id),
    -- One history row comes from one report.
    CONSTRAINT uq_aur_history UNIQUE (history_id),

    CONSTRAINT chk_aur_kind CHECK (kind IN ('CONDITION', 'MOVEMENT', 'OBSERVATION')),
    CONSTRAINT chk_aur_status CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
    CONSTRAINT chk_aur_narrative CHECK (btrim(narrative) <> ''),
    -- A CONDITION report names exactly one condition; no other kind does.
    CONSTRAINT chk_aur_condition CHECK ((kind = 'CONDITION') = (reported_condition IS NOT NULL)),
    -- A MOVEMENT report names its destination, with its name as reported.
    CONSTRAINT chk_aur_destination CHECK (
        (kind = 'MOVEMENT' AND destination_location_id IS NOT NULL AND destination_name IS NOT NULL)
        OR (kind <> 'MOVEMENT' AND destination_location_id IS NULL AND destination_name IS NULL)),
    -- Review fields: all unset while PENDING, reviewer and time once reviewed.
    CONSTRAINT chk_aur_review CHECK (
        (status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL
             AND review_note IS NULL AND stale_acknowledged = false)
        OR (status <> 'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
    CONSTRAINT chk_aur_reject_note CHECK (
        status <> 'REJECTED' OR (review_note IS NOT NULL AND btrim(review_note) <> '')),
    -- Never one's own report.
    CONSTRAINT chk_aur_reviewer CHECK (reviewed_by IS NULL OR reviewed_by <> reporter_id),
    -- The history row exactly when a CONDITION or MOVEMENT report is confirmed.
    CONSTRAINT chk_aur_history CHECK (
        (status = 'CONFIRMED' AND kind <> 'OBSERVATION') = (history_id IS NOT NULL))
);

CREATE INDEX idx_aur_unit ON public.asset_unit_reports(asset_unit_id);
CREATE INDEX idx_aur_reporter ON public.asset_unit_reports(reporter_id);
CREATE INDEX idx_aur_institution_status ON public.asset_unit_reports(institution_id, status);
`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.longitudinal_history
            DROP CONSTRAINT chk_longitudinal_history_condition,
            ADD CONSTRAINT chk_longitudinal_history_condition
                CHECK (condition IS NOT NULL OR entry_type IN ('SYSTEM', 'REPORT'));
        ${REPORT_TABLE}
        `,
        { transaction }
      );
    });
  },

  /** Refuses rather than discards reports, or a confirmed move with no condition. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          SELECT count(*) INTO held FROM public.asset_unit_reports;
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 066 rollback refused: % unit report(s) exist. Export or remove them deliberately first.', held;
          END IF;
          SELECT count(*) INTO held FROM public.longitudinal_history
           WHERE condition IS NULL AND entry_type::text = 'REPORT';
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 066 rollback refused: % REPORT history row(s) have no condition.', held;
          END IF;
        END $$;

        DROP TABLE public.asset_unit_reports;
        ALTER TABLE public.longitudinal_history
            DROP CONSTRAINT chk_longitudinal_history_condition,
            ADD CONSTRAINT chk_longitudinal_history_condition
                CHECK (condition IS NOT NULL OR entry_type = 'SYSTEM');
        `,
        { transaction }
      );
    });
  },
};
