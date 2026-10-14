'use strict';

/**
 * Receipt confirmation — the requester's evidence when recording receipt
 * (UAT decision, 2026-09-28; `IMPLEMENTATION_PLAN.md` §63). Creation order #57;
 * conditional procurement moves to `058`.
 *
 * ── request_receipt_confirmations ─────────────────────────────────────────
 *
 * One row per Record Receipt action: who confirmed, when, a required
 * description, and where the units are relative to the Request's intended
 * place. Units received together share one confirmation, through
 * `request_item_unit_receipts.receipt_confirmation_id`.
 *
 * The intended place is SNAPSHOT: `destination_location_id` and
 * `destination_name` are copied from the Request at confirmation time, so a
 * later change of destination — or a rename of the location — never rewrites
 * what the requester confirmed against. `placement` is asked only when there
 * is an intended place; a Request with no destination records none of the
 * three (`chk_rrc_destination`).
 *
 * Placement is the requester's statement, not a verified fact, and nothing
 * here touches `asset_units`: no location, lifecycle or PIC change (`BR-031`).
 *
 * Immutable: no `updated_at`, no update or delete endpoint. When every receipt
 * of a confirmation is reversed, the confirmation and its photos stay; it reads
 * as superseded, derived from the receipts, never stored.
 *
 * ── request_item_unit_receipts.receipt_confirmation_id ────────────────────
 *
 * Nullable: a Phase 41 receipt has none and is not backfilled. The service sets
 * it on every new receipt. `note` is kept as-is for those older receipts.
 *
 * ── request_documents ─────────────────────────────────────────────────────
 *
 * The photos are request documents of type `CONFIRMATION_PHOTO` — the same
 * storage, sharded under the request. `document_type` widens to 20 characters
 * for the name. `chk_request_documents_confirmation` makes the type and the
 * link one fact: a confirmation photo always belongs to a confirmation, and no
 * other document ever does.
 *
 * Every foreign key is NO ACTION.
 */

const TYPES_BEFORE = `'PROPOSAL', 'SUPPORTING', 'INVOICE', 'RECEIPT', 'BAST', 'OTHER'`;
const TYPES_AFTER = `${TYPES_BEFORE}, 'CONFIRMATION_PHOTO'`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.request_receipt_confirmations (
            id                       UUID          NOT NULL DEFAULT gen_random_uuid(),
            request_id               UUID          NOT NULL,
            placement                VARCHAR(24)       NULL,
            description              TEXT          NOT NULL,
            destination_location_id  UUID              NULL,
            destination_name         VARCHAR(255)      NULL,
            confirmed_by             UUID          NOT NULL,
            confirmed_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),

            CONSTRAINT pk_request_receipt_confirmations PRIMARY KEY (id),
            CONSTRAINT fk_rrc_request
                FOREIGN KEY (request_id) REFERENCES public.requests(id),
            CONSTRAINT fk_rrc_destination
                FOREIGN KEY (destination_location_id) REFERENCES public.locations(id),
            CONSTRAINT fk_rrc_confirmed_by
                FOREIGN KEY (confirmed_by) REFERENCES public.users(id),
            CONSTRAINT chk_rrc_placement
                CHECK (placement IS NULL
                    OR placement IN ('AT_INTENDED_PLACE', 'NOT_AT_INTENDED_PLACE')),
            -- The intended place is one snapshot, and placement is asked only
            -- against it: all three, or none.
            CONSTRAINT chk_rrc_destination
                CHECK ((destination_location_id IS NULL AND destination_name IS NULL
                        AND placement IS NULL)
                    OR (destination_location_id IS NOT NULL AND destination_name IS NOT NULL
                        AND placement IS NOT NULL)),
            CONSTRAINT chk_rrc_description
                CHECK (btrim(description) <> '')
        );

        CREATE INDEX idx_rrc_request ON public.request_receipt_confirmations(request_id);

        ALTER TABLE public.request_item_unit_receipts
            ADD COLUMN receipt_confirmation_id UUID NULL,
            ADD CONSTRAINT fk_riu_receipts_confirmation
                FOREIGN KEY (receipt_confirmation_id)
                REFERENCES public.request_receipt_confirmations(id);

        CREATE INDEX idx_riu_receipts_confirmation
            ON public.request_item_unit_receipts(receipt_confirmation_id)
            WHERE receipt_confirmation_id IS NOT NULL;

        ALTER TABLE public.request_documents
            ALTER COLUMN document_type TYPE VARCHAR(20),
            ADD COLUMN receipt_confirmation_id UUID NULL,
            DROP CONSTRAINT chk_request_documents_type,
            ADD CONSTRAINT chk_request_documents_type
                CHECK (document_type IN (${TYPES_AFTER})),
            ADD CONSTRAINT fk_request_documents_confirmation
                FOREIGN KEY (receipt_confirmation_id)
                REFERENCES public.request_receipt_confirmations(id),
            ADD CONSTRAINT chk_request_documents_confirmation
                CHECK ((document_type = 'CONFIRMATION_PHOTO') = (receipt_confirmation_id IS NOT NULL));

        CREATE INDEX idx_request_documents_confirmation
            ON public.request_documents(receipt_confirmation_id)
            WHERE receipt_confirmation_id IS NOT NULL;
        `,
        { transaction }
      );
    });
  },

  /**
   * Refuses rather than discards a confirmation: it is the requester's evidence,
   * and its photos are stored files a rollback would orphan.
   */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint := 0;
        BEGIN
          IF to_regclass('public.request_receipt_confirmations') IS NOT NULL THEN
            SELECT count(*) INTO held FROM public.request_receipt_confirmations;
          END IF;
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 057 rollback refused: % receipt confirmation(s) are recorded, with their photos. Export or remove them deliberately first.', held;
          END IF;
        END $$;

        DROP INDEX IF EXISTS public.idx_request_documents_confirmation;
        ALTER TABLE public.request_documents
            DROP CONSTRAINT IF EXISTS chk_request_documents_confirmation,
            DROP CONSTRAINT IF EXISTS fk_request_documents_confirmation,
            DROP CONSTRAINT IF EXISTS chk_request_documents_type,
            DROP COLUMN IF EXISTS receipt_confirmation_id,
            ALTER COLUMN document_type TYPE VARCHAR(12),
            ADD CONSTRAINT chk_request_documents_type
                CHECK (document_type IN (${TYPES_BEFORE}));

        DROP INDEX IF EXISTS public.idx_riu_receipts_confirmation;
        ALTER TABLE public.request_item_unit_receipts
            DROP CONSTRAINT IF EXISTS fk_riu_receipts_confirmation,
            DROP COLUMN IF EXISTS receipt_confirmation_id;

        DROP TABLE IF EXISTS public.request_receipt_confirmations;
        `,
        { transaction }
      );
    });
  },
};
