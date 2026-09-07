'use strict';

/**
 * Widens the inventory code — Phase 25 (`CR-006`), REQ-UNIT-007.
 * `04-data-model.md` §5.3.2, creation order #43.
 *
 * `VARCHAR(40)` was sized for the one shape Phase 18 could produce:
 * institution code, year, sequence. The token registry now permits others, and
 * the widest a valid format can render does not fit:
 *
 *   institution code   25
 *   classification     12
 *   department          8
 *   year                4
 *   sequence            8   (5 padded, budgeted to 8 so growth past the
 *                            padding cannot overflow the column)
 *   separators          4+
 *                    ----
 *                      61+
 *
 * THE WIDTH IS DERIVED, NOT PICKED. 64 is that worst case with a little room,
 * and the application refuses to save a format whose computed worst-case
 * rendered length exceeds it (REQ-ORG-007, `BR-026`). Widening the column
 * without that check would only move the failure from configuration time to a
 * registration years later that nobody can complete.
 *
 * Existing codes are untouched: this changes what the column can hold, not
 * anything held in it (REQ-UNIT-008, `BR-020`).
 *
 * Cheap in PostgreSQL. Increasing a `varchar` length limit is a catalog-only
 * change — no table rewrite, and the on-disk representation is unchanged, so
 * `uq_asset_units_inventory_code` is not rebuilt either.
 */

const PREVIOUS_WIDTH = 40;
const WIDTH = 64;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `
      ALTER TABLE public.asset_units
          ALTER COLUMN inventory_code TYPE VARCHAR(${WIDTH});
      `
    );
  },

  async down(queryInterface) {
    /**
     * Narrowing can destroy data, so it refuses rather than truncating.
     *
     * Reported with the offending codes, following migration 038: PostgreSQL
     * would say only that some value is too long, and the operator has to know
     * which units are affected before deciding what to do. There is no safe
     * automatic answer here — a code cannot be shortened, because printed
     * labels already carry it.
     */
    const [offenders] = await queryInterface.sequelize.query(
      `SELECT inventory_code FROM public.asset_units
        WHERE length(inventory_code) > ${PREVIOUS_WIDTH}`
    );

    if (offenders.length > 0) {
      throw new Error(
        `Cannot narrow asset_units.inventory_code to VARCHAR(${PREVIOUS_WIDTH}): ` +
          `${offenders.length} unit(s) carry a longer code — ` +
          `${offenders
            .slice(0, 5)
            .map((row) => JSON.stringify(row.inventory_code))
            .join(', ')}` +
          `${offenders.length > 5 ? ', …' : ''}. ` +
          'These codes are printed on physical labels and cannot be shortened.'
      );
    }

    await queryInterface.sequelize.query(
      `
      ALTER TABLE public.asset_units
          ALTER COLUMN inventory_code TYPE VARCHAR(${PREVIOUS_WIDTH});
      `
    );
  },
};
