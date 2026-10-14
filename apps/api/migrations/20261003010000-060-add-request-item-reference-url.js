'use strict';

/**
 * Request item reference URL — REQ-REQUEST-019 (`IMPLEMENTATION_PLAN.md` §66).
 * Creation order #60.
 *
 * One optional external product link per Request Item. Informational only: the
 * system never fetches, previews or checks it. Live item state like every other
 * field — no history table, no per-cycle snapshot; the RequestItem audit
 * records each change, before and after.
 *
 * Every existing item gets NULL: no backfill. No index: nothing searches it.
 *
 * The application validates and normalizes (`domain/referenceUrl.js`). The
 * CHECK is only a backstop for a write that bypasses it — HTTP(S), something
 * after the `//`, no whitespace or control character, no credentials in the
 * authority — not a URL parser. The length is the column's.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.request_items
            ADD COLUMN reference_url VARCHAR(2048) NULL,
            ADD CONSTRAINT chk_request_items_reference_url CHECK (
                reference_url IS NULL
                OR (    reference_url ~ '^https?://[^/?#]'
                    AND reference_url !~ '[[:space:][:cntrl:]]'
                    AND reference_url !~ '^https?://[^/?#]*@')
            );
        `,
        { transaction }
      );
    });
  },

  /** Refuses rather than discards links a requester entered. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          SELECT count(*) INTO held FROM public.request_items WHERE reference_url IS NOT NULL;
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 060 rollback refused: % request item(s) carry a reference URL. Export or clear them deliberately first.', held;
          END IF;
        END $$;

        ALTER TABLE public.request_items
            DROP CONSTRAINT chk_request_items_reference_url,
            DROP COLUMN reference_url;
        `,
        { transaction }
      );
    });
  },
};
