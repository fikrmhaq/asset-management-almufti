'use strict';

/**
 * Receipt photos per received unit — REQ-REQUEST-022 (`IMPLEMENTATION_PLAN.md`
 * §69). Creation order #62; conditional procurement moves to `063+`.
 *
 * A receipt confirmation's photos (migration 057, `CONFIRMATION_PHOTO` request
 * documents) may now each name ONE received unit: the photo then evidences that
 * unit's receipt, not only the confirmation as a whole. Still the requester's
 * evidence, still given only with Record Receipt, still never deleted.
 *
 * ── request_documents.request_item_unit_receipt_id ───────────────────────
 *
 * NULL — every existing row, and every general confirmation photo: evidence of
 * the whole confirmation. Set — the receipt of the unit the photo shows. No
 * backfill: a 057 photo never said which unit it shows.
 *
 * ── The invariant, in the schema ─────────────────────────────────────────
 *
 * A unit photo belongs to a receipt OF ITS OWN CONFIRMATION. The composite key
 * `(request_item_unit_receipt_id, receipt_confirmation_id)` references
 * `request_item_unit_receipts (id, receipt_confirmation_id)` — made referenceable
 * by `uq_riu_receipts_id_confirmation`, trivially unique since `id` is the key.
 * With MATCH SIMPLE a general photo (receipt NULL) is not checked; a unit photo
 * cannot point at a receipt of another confirmation — so of another receive
 * action, unit or request. `chk_request_documents_receipt_photo` keeps the link
 * to confirmation photos; `chk_request_documents_confirmation` (057) already
 * makes those carry their confirmation.
 *
 * Every foreign key is NO ACTION. Receipt semantics are unchanged.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.request_item_unit_receipts
            ADD CONSTRAINT uq_riu_receipts_id_confirmation UNIQUE (id, receipt_confirmation_id);

        ALTER TABLE public.request_documents
            ADD COLUMN request_item_unit_receipt_id UUID NULL,
            ADD CONSTRAINT fk_request_documents_receipt
                FOREIGN KEY (request_item_unit_receipt_id, receipt_confirmation_id)
                REFERENCES public.request_item_unit_receipts (id, receipt_confirmation_id),
            ADD CONSTRAINT chk_request_documents_receipt_photo
                CHECK (request_item_unit_receipt_id IS NULL
                       OR document_type = 'CONFIRMATION_PHOTO');

        CREATE INDEX idx_request_documents_receipt
            ON public.request_documents(request_item_unit_receipt_id)
            WHERE request_item_unit_receipt_id IS NOT NULL;
        `,
        { transaction }
      );
    });
  },

  /** Refuses rather than turns unit photos back into anonymous ones. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          SELECT count(*) INTO held FROM public.request_documents
           WHERE request_item_unit_receipt_id IS NOT NULL;
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 062 rollback refused: % confirmation photo(s) name the received unit they show. Export or remove them deliberately first.', held;
          END IF;
        END $$;

        DROP INDEX IF EXISTS public.idx_request_documents_receipt;
        ALTER TABLE public.request_documents
            DROP CONSTRAINT chk_request_documents_receipt_photo,
            DROP CONSTRAINT fk_request_documents_receipt,
            DROP COLUMN request_item_unit_receipt_id;
        ALTER TABLE public.request_item_unit_receipts
            DROP CONSTRAINT uq_riu_receipts_id_confirmation;
        `,
        { transaction }
      );
    });
  },
};
