'use strict';

/**
 * Funding source business codes — Phase 26 (`CR-007`), REQ-REF-007.
 * `04-data-model.md` §5.1.7, creation order #45.
 *
 * An inventory code format may include the funding source (REQ-UNIT-007), and
 * `ref.funding_sources` had only a display name — `VARCHAR(100)`, free text,
 * far too long and too changeable to carry inside a permanent identifier.
 *
 * THIS MIGRATION WRITES NO CODES, AND THAT IS THE ENTIRE POINT OF THE COLUMN.
 *
 * `Dana Bos` is called `BOS`. That is a business abbreviation, not a
 * normalization of the name, and no transformation discovers it — normalizing
 * gives `DANA_BOS`, which is a different answer that would then be frozen into
 * every inventory code generated from it. Deriving a value here would make an
 * invented identifier permanent by default, which is precisely what `BR-027`
 * forbids. Truncating with a numeric suffix to force uniqueness would be worse:
 * it manufactures ambiguity rather than reporting it.
 *
 * So the column arrives NULLABLE and the codes are a business decision:
 *
 *   1. this migration adds the column, constrains its characters, and takes a
 *      PARTIAL unique index so codes assigned early cannot collide while the
 *      rest are still absent;
 *   2. it REPORTS every row needing one, with a suggestion clearly labelled as a
 *      suggestion — following migration 038, which names the rows an operator
 *      has to act on rather than letting PostgreSQL report only that something
 *      violates a constraint;
 *   3. administrators assign the real codes through the lookups screen. The API
 *      requires `code` on create from this phase onward, so no NEW gap appears;
 *   4. a later migration sets NOT NULL, refusing — by name — if any row still
 *      lacks one.
 *
 * The feature does not wait for step 4. A funding source with no code simply
 * cannot satisfy `{FUNDING_SOURCE_CODE}`, and a registration relying on it is
 * refused by the existing missing-value policy rather than given a code with the
 * segment missing. Step 4 closes the historical gap; it is hygiene, not a
 * prerequisite, which is what keeps a stalled business decision from blocking
 * the change.
 *
 * `VARCHAR(8)` is sized from evidence rather than copied from `departments.code`
 * happening to be 8: the longest existing name is 8 (`Anggaran`), the
 * abbreviation the client specified is 3 (`BOS`), and the common Indonesian
 * school sources — BOS, BOSDA, BOSNAS, APBD, APBN, DAK, DAU, BOP, KOMITE,
 * HIBAH — are all six characters or fewer.
 *
 * The character class mirrors `chk_institutions_code_url_safe`: the code may be
 * carried into an inventory code, and that code travels in the path of the
 * address a scanned label resolves to (REQ-UNIT-011).
 */

const URL_SAFE = '^[A-Za-z0-9._-]+$';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE ref.funding_sources
            ADD COLUMN code VARCHAR(8) NULL;
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
        ALTER TABLE ref.funding_sources
            ADD CONSTRAINT chk_funding_sources_code_url_safe
                CHECK (code IS NULL OR code ~ '${URL_SAFE}');
        `,
        { transaction }
      );

      // Partial, like `uq_asset_units_inventory_code`: uniqueness applies to
      // codes, and the absence of one is not a value to collide with. Several
      // rows may sit at NULL while the business decides.
      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX uq_funding_sources_code
            ON ref.funding_sources(code) WHERE code IS NOT NULL;
        `,
        { transaction }
      );

      const [pending] = await queryInterface.sequelize.query(
        `
        SELECT id, name,
               -- A HINT FOR A HUMAN, NEVER A STORED VALUE. Deliberately rough:
               -- it is read in a log line and then discarded, so it does not
               -- need to agree with the application's normalization, and must
               -- not be mistaken for an answer.
               left(upper(regexp_replace(trim(name), '[^A-Za-z0-9]+', '_', 'g')), 8) AS suggestion
          FROM ref.funding_sources
         WHERE code IS NULL
         ORDER BY id
        `,
        { transaction }
      );

      if (pending.length > 0) {
        console.log(
          `[migration] ref.funding_sources: ${pending.length} row(s) need a business code ` +
            'before it can be made NOT NULL. Assign them under Reference > Lookups > ' +
            'Funding Sources. The suggestions below are normalizations of the NAME and are ' +
            'usually NOT the code the institution actually uses — e.g. "Dana Bos" is "BOS".'
        );
        for (const row of pending) {
          console.log(
            `[migration]   id=${row.id} ${JSON.stringify(row.name)} → suggestion: ${row.suggestion}`
          );
        }
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DROP INDEX IF EXISTS ref.uq_funding_sources_code;
        ALTER TABLE ref.funding_sources
            DROP CONSTRAINT IF EXISTS chk_funding_sources_code_url_safe;
        ALTER TABLE ref.funding_sources
            DROP COLUMN IF EXISTS code;
        `,
        { transaction }
      );
    });
  },
};
