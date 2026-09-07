'use strict';

/**
 * The manually supplied component of an inventory code — Phase 26 (`CR-007`),
 * REQ-UNIT-007, REQ-ORG-007. `04-data-model.md` §5.3.2, creation order #44.
 *
 * `CR-006` gave institutions a configurable format built from tokens that were
 * all either derived from existing records or allocated by the application. An
 * institution numbering its assets by a maintained composition — `001-02-03` —
 * has a component that is neither: a person types it.
 *
 * ON `asset_units`, NOT `assets`. It identifies the individual physical item,
 * which is the same reason `inventory_code` lives here.
 *
 * NULLABLE, AND REQUIRED ONLY WHERE THE FORMAT ASKS FOR IT. An institution whose
 * format contains no `{NUMBER_COMPOSITION}` never supplies one, and every unit
 * registered before a format gained the token keeps NULL. Making it NOT NULL
 * would break every existing registration path for no benefit.
 *
 * NO UNIQUE INDEX, DELIBERATELY. Uniqueness belongs to the finished
 * `inventory_code` (`BR-020`): the same composition may legitimately recur
 * wherever the rest of the format distinguishes the result — a different year, a
 * different classification — and a standalone constraint would forbid what
 * nothing requires.
 *
 * NO CHARACTER CHECK, ALSO DELIBERATELY. The value is validated at registration
 * against the code alphabet and the token's budget, where the error can name the
 * field the caller wrote. A constraint here would report a violation against a
 * column instead, which is exactly the reporting problem `CR-007` set out to
 * avoid.
 *
 * `VARCHAR(32)` sits above the validated maximum of 16 on purpose: raising that
 * budget later is then a registry change alone, with no migration. Widening a
 * `varchar` is catalog-only in PostgreSQL, so the headroom costs nothing.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `
      ALTER TABLE public.asset_units
          ADD COLUMN number_composition VARCHAR(32) NULL;
      `
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `
      ALTER TABLE public.asset_units
          DROP COLUMN IF EXISTS number_composition;
      `
    );
  },
};
