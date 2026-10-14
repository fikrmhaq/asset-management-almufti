'use strict';

/**
 * Phase 41 (`CR-014`) — receipt and closing the remainder. Creation order #55.
 * REQ-REQUEST-011 – REQ-REQUEST-013; `IMPLEMENTATION_PLAN.md` §60.
 *
 * ── request_item_unit_receipts ─────────────────────────────────────────────
 *
 * The receipt record: the requester received the Asset Unit of one
 * registration link. Append-only: a receipt is never deleted. A reversal
 * (decision Q2c) sets `reversed_at` / `reversed_by` / `reversal_reason` on the
 * row and keeps it, so a link's history reads receipt → reversed → receipt.
 * `uq_riu_receipts_active` allows at most one ACTIVE (unreversed) receipt per
 * link.
 *
 * `received_on` is the date the requester supplies (Q2b). "Not in the future"
 * and "not before the Request was created" are business-date rules checked by
 * the service: a CHECK cannot safely read today's date.
 *
 * Receipt is not registration, procurement, location or lifecycle (`BR-031`);
 * nothing here touches `asset_units`.
 *
 * ── request_close_events ──────────────────────────────────────────────────
 *
 * One row per successful close of a Request's remainder, written in the close's
 * own transaction. Never updated or deleted. `requests.close_reason` keeps the
 * first close's reason; every close, the first included, is here.
 *
 * Both foreign keys everywhere are NO ACTION: links are removed only while
 * REGISTER is ACTIVE and without an active receipt, requests are never deleted.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.request_item_unit_receipts (
            id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
            request_item_unit_id  UUID         NOT NULL,
            received_on           DATE         NOT NULL,
            recorded_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
            recorded_by           UUID         NOT NULL,
            note                  TEXT             NULL,
            reversed_at           TIMESTAMPTZ      NULL,
            reversed_by           UUID             NULL,
            reversal_reason       TEXT             NULL,

            CONSTRAINT pk_request_item_unit_receipts PRIMARY KEY (id),
            CONSTRAINT fk_riu_receipts_link
                FOREIGN KEY (request_item_unit_id) REFERENCES public.request_item_units(id),
            CONSTRAINT fk_riu_receipts_recorded_by
                FOREIGN KEY (recorded_by) REFERENCES public.users(id),
            CONSTRAINT fk_riu_receipts_reversed_by
                FOREIGN KEY (reversed_by) REFERENCES public.users(id),
            -- A reversal is one fact: who, when and why, all or none.
            CONSTRAINT chk_riu_receipts_reversal
                CHECK ((reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
                    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL
                        AND reversal_reason IS NOT NULL AND btrim(reversal_reason) <> ''))
        );

        -- At most one active receipt per registration link.
        CREATE UNIQUE INDEX uq_riu_receipts_active
            ON public.request_item_unit_receipts(request_item_unit_id)
            WHERE reversed_at IS NULL;

        CREATE TABLE public.request_close_events (
            id          UUID         NOT NULL DEFAULT gen_random_uuid(),
            request_id  UUID         NOT NULL,
            reason      TEXT         NOT NULL,
            closed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
            closed_by   UUID         NOT NULL,

            CONSTRAINT pk_request_close_events PRIMARY KEY (id),
            CONSTRAINT fk_request_close_events_request
                FOREIGN KEY (request_id) REFERENCES public.requests(id),
            CONSTRAINT fk_request_close_events_closed_by
                FOREIGN KEY (closed_by) REFERENCES public.users(id),
            CONSTRAINT chk_request_close_events_reason
                CHECK (btrim(reason) <> '')
        );

        CREATE INDEX idx_request_close_events_request
            ON public.request_close_events(request_id);
        `,
        { transaction }
      );
    });
  },

  /** Refuses rather than discards receipt or close history. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE receipts bigint := 0; closes bigint := 0;
        BEGIN
          IF to_regclass('public.request_item_unit_receipts') IS NOT NULL THEN
            SELECT count(*) INTO receipts FROM public.request_item_unit_receipts;
          END IF;
          IF to_regclass('public.request_close_events') IS NOT NULL THEN
            SELECT count(*) INTO closes FROM public.request_close_events;
          END IF;
          IF receipts > 0 OR closes > 0 THEN
            RAISE EXCEPTION
              'Migration 055 rollback refused: % receipt(s) and % close event(s) are recorded. Export or remove them deliberately first.', receipts, closes;
          END IF;
        END $$;

        DROP TABLE IF EXISTS public.request_close_events;
        DROP TABLE IF EXISTS public.request_item_unit_receipts;
        `,
        { transaction }
      );
    });
  },
};
