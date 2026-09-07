'use strict';

/**
 * Slash as an inventory code separator — Phase 27 (`CR-008`), REQ-ORG-007,
 * REQ-UNIT-011, `BR-026`. `04-data-model.md` §5.2.1.
 *
 * Institutional numbering here is written with slashes — `027/1234/BID.1/2026`
 * — and the requirement is that the separator appear as a slash in the unit
 * tables and the CSV exports. It cannot be a display-time substitution: the
 * boundaries are not recoverable from the stored text (`institutions.code` may
 * itself contain a hyphen, as `ALM-1` does), re-deriving them from the current
 * format would make a printed label's appearance depend on configuration edited
 * years later (`BR-020`), and a display form the search box cannot find is worse
 * than none. So the slash goes into the stored code, and this widens the check
 * that was stopping it.
 *
 * LITERALS ONLY. `chk_institutions_code_url_safe`,
 * `chk_funding_sources_code_url_safe` and every other value carried into a code
 * are untouched. A literal is chosen once by an administrator and validated the
 * moment it is stored; a code on a reference record is maintained by many people
 * over years and travels to places an inventory code does not.
 *
 * WHAT THIS COSTS ELSEWHERE, stated here because the constraint is where the
 * reason is easiest to lose: the generated code stops being safe in a URL PATH
 * segment. `%2F` inside a path is the least portable construct in HTTP routing —
 * Apache rejects it unless `AllowEncodedSlashes` is on, proxies decode before
 * routing and then split on it — so the scanned-label address now carries the
 * code in a QUERY VALUE (`/u?c=…`, `/asset-units/by-code?code=…`). The older
 * path routes stay, permanently, for the labels already printed onto them.
 *
 * WIDENING ONLY. Every format already stored satisfies the new pattern, so
 * there is nothing to backfill and no row to revalidate. `down` narrows it
 * again, which would fail against a format that has since taken a slash — a
 * correct failure: dropping the constraint's guarantee silently would leave
 * codes the older routes cannot resolve.
 */

/** The stored form: the URL-safe set, the token delimiters, and now the slash. */
const FORMAT_CHARS = '^[A-Za-z0-9._{}/-]+$';

/** What it was, so `down` is a literal restoration rather than a re-derivation. */
const FORMAT_CHARS_BEFORE = '^[A-Za-z0-9._{}-]+$';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.institutions
            DROP CONSTRAINT IF EXISTS chk_institutions_inventory_code_format;
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
      // Named rather than left to the constraint, following migration 038: an
      // operator can act on "these three institutions use a slash", and cannot
      // act on "some row violates a check".
      const [blocking] = await queryInterface.sequelize.query(
        `
        SELECT id, code, inventory_code_format
          FROM public.institutions
         WHERE inventory_code_format LIKE '%/%';
        `,
        { transaction }
      );

      if (blocking.length > 0) {
        console.log(
          `[migration] ${blocking.length} institution(s) use a slash in their inventory code format:`
        );
        for (const row of blocking) {
          console.log(`[migration]   id=${row.id} ${row.code} → ${row.inventory_code_format}`);
        }
      }

      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.institutions
            DROP CONSTRAINT IF EXISTS chk_institutions_inventory_code_format;
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.institutions
            ADD CONSTRAINT chk_institutions_inventory_code_format
                CHECK (inventory_code_format IS NULL
                       OR inventory_code_format ~ '${FORMAT_CHARS_BEFORE}');
        `,
        { transaction }
      );
    });
  },
};
