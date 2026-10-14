'use strict';

/**
 * Consumables — quantity-based stock (`IMPLEMENTATION_PLAN.md` §73). Creation
 * order #67.
 *
 * A consumable is NOT an Asset: no units, no inventory code, no lifecycle, no
 * condition, no location history, no QR. It is a master record of one stock
 * item of an institution (A4 paper, markers) counted in one measurement unit
 * (`ref.measurement_units`, the existing lookup) — whole numbers, never
 * converted.
 *
 * ── public.consumables ───────────────────────────────────────────────────
 *
 * `quantity_on_hand` is the running balance, never negative. It is written only
 * together with a movement, in one transaction, under the consumable's row lock;
 * it always equals the sum of its movements.
 *
 * ── public.consumable_stock_movements ────────────────────────────────────
 *
 * Append-only: every change of stock is one row — RECEIPT (+), ISSUE (−),
 * ADJUSTMENT (±, with a reason) — carrying the balance it left. An ISSUE names
 * the request item it fulfils; the composite foreign key holds that item to the
 * SAME consumable.
 *
 * ── public.request_items.consumable_id ───────────────────────────────────
 *
 * A request line may name a consumable: it is then issued from stock, never
 * registered as Asset Units. NULL keeps every existing line an asset line.
 */

const CONSUMABLES = `
CREATE TABLE public.consumables (
    id                   UUID          NOT NULL DEFAULT gen_random_uuid(),
    institution_id       UUID          NOT NULL,
    name                 VARCHAR(255)  NOT NULL,
    description          TEXT          NULL,
    measurement_unit_id  UUID          NOT NULL,
    quantity_on_hand     INTEGER       NOT NULL DEFAULT 0,
    is_active            BOOLEAN       NOT NULL DEFAULT true,
    created_by           UUID          NULL,
    updated_by           UUID          NULL,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_consumables PRIMARY KEY (id),
    CONSTRAINT fk_consumables_institution FOREIGN KEY (institution_id)
        REFERENCES public.institutions (id),
    CONSTRAINT fk_consumables_measurement_unit FOREIGN KEY (measurement_unit_id)
        REFERENCES ref.measurement_units (id),
    CONSTRAINT fk_consumables_created_by FOREIGN KEY (created_by)
        REFERENCES public.users (id),
    CONSTRAINT fk_consumables_updated_by FOREIGN KEY (updated_by)
        REFERENCES public.users (id),
    CONSTRAINT chk_consumables_name CHECK (btrim(name) <> ''),
    CONSTRAINT chk_consumables_on_hand CHECK (quantity_on_hand >= 0)
);

-- One name per institution, whatever its case.
CREATE UNIQUE INDEX uq_consumables_institution_name
    ON public.consumables (institution_id, lower(name));

ALTER TABLE public.request_items
    ADD COLUMN consumable_id UUID NULL,
    ADD CONSTRAINT fk_request_items_consumable FOREIGN KEY (consumable_id)
        REFERENCES public.consumables (id),
    -- The target of the movements' composite key: an issue fulfils a line of
    -- the consumable it moves.
    ADD CONSTRAINT uq_request_items_id_consumable UNIQUE (id, consumable_id),
    -- A classification is a hint for registering Asset Units; a consumable
    -- line registers none.
    ADD CONSTRAINT chk_request_items_consumable
        CHECK (consumable_id IS NULL OR classification_id IS NULL);

CREATE INDEX idx_request_items_consumable
    ON public.request_items (consumable_id) WHERE consumable_id IS NOT NULL;

CREATE TABLE public.consumable_stock_movements (
    id               UUID          NOT NULL DEFAULT gen_random_uuid(),
    consumable_id    UUID          NOT NULL,
    movement_type    VARCHAR(20)   NOT NULL,
    quantity         INTEGER       NOT NULL,
    balance_after    INTEGER       NOT NULL,
    request_item_id  UUID          NULL,
    note             TEXT          NULL,
    created_by       UUID          NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_consumable_stock_movements PRIMARY KEY (id),
    CONSTRAINT fk_csm_consumable FOREIGN KEY (consumable_id)
        REFERENCES public.consumables (id),
    CONSTRAINT fk_csm_request_item FOREIGN KEY (request_item_id, consumable_id)
        REFERENCES public.request_items (id, consumable_id),
    CONSTRAINT fk_csm_created_by FOREIGN KEY (created_by)
        REFERENCES public.users (id),

    CONSTRAINT chk_csm_type CHECK (movement_type IN ('RECEIPT', 'ISSUE', 'ADJUSTMENT')),
    -- The sign is the direction: in, out, or either for a correction.
    CONSTRAINT chk_csm_quantity CHECK (
        (movement_type = 'RECEIPT' AND quantity > 0)
        OR (movement_type = 'ISSUE' AND quantity < 0)
        OR (movement_type = 'ADJUSTMENT' AND quantity <> 0)),
    CONSTRAINT chk_csm_balance CHECK (balance_after >= 0),
    -- An issue fulfils a request line; nothing else names one.
    CONSTRAINT chk_csm_request_item CHECK ((movement_type = 'ISSUE') = (request_item_id IS NOT NULL)),
    -- An adjustment says why.
    CONSTRAINT chk_csm_adjustment_note CHECK (
        movement_type <> 'ADJUSTMENT' OR (note IS NOT NULL AND btrim(note) <> ''))
);

CREATE INDEX idx_csm_consumable ON public.consumable_stock_movements (consumable_id, created_at);
CREATE INDEX idx_csm_request_item
    ON public.consumable_stock_movements (request_item_id) WHERE request_item_id IS NOT NULL;
`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(CONSUMABLES, { transaction });
    });
  },

  /** Refuses rather than discards stock, its history, or request lines naming it. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          SELECT count(*) INTO held FROM public.request_items WHERE consumable_id IS NOT NULL;
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 067 rollback refused: % request item(s) name a consumable. Remove them deliberately first.', held;
          END IF;
          SELECT count(*) INTO held FROM public.consumables;
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 067 rollback refused: % consumable(s) exist. Export or remove them deliberately first.', held;
          END IF;
        END $$;

        DROP TABLE public.consumable_stock_movements;
        DROP INDEX public.idx_request_items_consumable;
        ALTER TABLE public.request_items
            DROP CONSTRAINT chk_request_items_consumable,
            DROP CONSTRAINT uq_request_items_id_consumable,
            DROP CONSTRAINT fk_request_items_consumable,
            DROP COLUMN consumable_id;
        DROP TABLE public.consumables;
        `,
        { transaction }
      );
    });
  },
};
