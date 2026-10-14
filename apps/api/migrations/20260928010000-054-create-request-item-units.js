'use strict';

/**
 * Phase 40 (`CR-014`) — the fulfilment-unit linkage. `04-data-model.md` §5.7.6;
 * creation order #54. REQ-REQUEST-010.
 *
 * One row says: this Asset Unit was registered against that Request Item, by
 * `linked_by`, at `linked_at`. That is REGISTRATION — it is not receipt, and it
 * is not fulfilment (`BR-031`); Phase 41 adds the receipt record to this table
 * in migration 055, once `CR-014` Q2 fixes its shape. No receipt column here.
 *
 * `uq_request_item_units_unit`: a unit fulfils at most one item. Registered is
 * the COUNT of these rows per item, whatever the linked unit's current state
 * (Phase 40 decision D4) — a link is a historical fact. The "registered ≤
 * required" cap and "unlink only while REGISTER is ACTIVE" (D5) span rows and
 * steps, so they are service rules taken under the Request's row lock.
 *
 * `public.asset_units` is not altered, nothing is back-filled, and no existing
 * unit is linked (`BR-032`). Both foreign keys are NO ACTION: units and assets
 * are never hard-deleted, and request items only in a DRAFT, which has no links.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.request_item_units (
            id               UUID         NOT NULL DEFAULT gen_random_uuid(),
            request_item_id  UUID         NOT NULL,
            asset_unit_id    UUID         NOT NULL,
            linked_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
            linked_by        UUID         NOT NULL,

            CONSTRAINT pk_request_item_units PRIMARY KEY (id),
            -- A unit fulfils one item.
            CONSTRAINT uq_request_item_units_unit UNIQUE (asset_unit_id),
            CONSTRAINT fk_riu_item
                FOREIGN KEY (request_item_id) REFERENCES public.request_items(id),
            CONSTRAINT fk_riu_unit
                FOREIGN KEY (asset_unit_id) REFERENCES public.asset_units(id),
            CONSTRAINT fk_riu_linked_by
                FOREIGN KEY (linked_by) REFERENCES public.users(id)
        );

        CREATE INDEX idx_riu_item ON public.request_item_units(request_item_id);
        `,
        { transaction }
      );
    });
  },

  /** Refuses rather than discards the record of which units were registered. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          IF to_regclass('public.request_item_units') IS NOT NULL THEN
            SELECT count(*) INTO held FROM public.request_item_units;
            IF held > 0 THEN
              RAISE EXCEPTION
                'Migration 054 rollback refused: public.request_item_units holds % registration link(s). Export or remove them deliberately first.', held;
            END IF;
          END IF;
        END $$;

        DROP TABLE IF EXISTS public.request_item_units;
        `,
        { transaction }
      );
    });
  },
};
