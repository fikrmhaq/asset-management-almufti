'use strict';

/**
 * Institution-configurable inventory code formats — Phase 25 (`CR-006`),
 * REQ-ORG-007, REQ-UNIT-007, `BR-026`. `04-data-model.md` §5.2.1, creation
 * order #42.
 *
 * Until now every institution's inventory codes had the same shape, written
 * into `domain/inventoryCode.js` and into the requirement itself. This column
 * holds the shape one institution chose:
 *
 *   {INSTITUTION_CODE}-{REGISTRATION_YEAR}-{SEQUENCE}
 *
 * NULL MEANS "NOT CONFIGURED", AND IS NOT BACKFILLED. Such an institution
 * receives the application default, which renders exactly what Phase 18
 * produced. Writing the default literally into every row would make "never
 * configured" indistinguishable from "configured to today's default", and would
 * pin every existing institution to that default for good — a later change to
 * it could then never reach them.
 *
 * THE CHECK CONSTRAINS CHARACTERS, NOT GRAMMAR. Tokens, ordering, the single
 * trailing sequence and the worst-case rendered length are validated in the
 * application against the token registry, where they can produce an error that
 * names the offending position (REQ-ORG-007). What belongs here is the backstop
 * that stops a slash, a space or a percent reaching the column at all: literal
 * text is carried into an inventory code, and that code travels in the path of
 * the address a scanned label resolves to (REQ-UNIT-011). Braces are permitted
 * in addition to the URL-safe set because they delimit tokens in the stored
 * form and never survive into a generated code.
 *
 * Exactly the division of labour `chk_institutions_code_url_safe` already has.
 *
 * No format history table. `institutions` is an audited model
 * (`db/auditHooks.js`), so `audit.audit_logs` already records every change to
 * this column together with its previous value — and nothing ever re-derives a
 * code from a historical format, because the generated string is stored on the
 * unit (`BR-020`). A version table would have no reader.
 */

/** The stored form: the URL-safe set plus the token delimiters. */
const FORMAT_CHARS = '^[A-Za-z0-9._{}-]+$';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.institutions
            ADD COLUMN inventory_code_format VARCHAR(200) NULL;
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.institutions
            ADD CONSTRAINT chk_institutions_inventory_code_format
                CHECK (inventory_code_format IS NULL
                       OR inventory_code_format ~ '${FORMAT_CHARS}');
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.institutions
            DROP CONSTRAINT IF EXISTS chk_institutions_inventory_code_format;
        ALTER TABLE public.institutions
            DROP COLUMN IF EXISTS inventory_code_format;
        `,
        { transaction }
      );
    });
  },
};
