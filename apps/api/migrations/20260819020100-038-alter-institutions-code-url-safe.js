'use strict';

/**
 * Phase 18 (`CR-001`) — constrains `institutions.code` to URL-safe characters.
 * `04-data-model.md` §5.2.1, creation order #37. REQ-ORG-002, REQ-UNIT-011.
 *
 * The code is the leading segment of every asset unit inventory code, and that
 * code travels in the path of the address a scanned label resolves to. A code
 * containing a slash or a space would produce an address that does not point
 * where the label claims — and the label cannot be recalled to fix it.
 *
 * Letters, digits, hyphen, underscore and dot: the unreserved set from RFC 3986,
 * which needs no percent-encoding anywhere in a path segment. Deliberately
 * excludes the slash, which would split the segment.
 *
 * Applied now rather than at institution creation because there is exactly one
 * institution in any deployed environment so far and it already complies. The
 * same constraint later, against real data, would be a breaking change.
 */

const URL_SAFE = '^[A-Za-z0-9._-]+$';

module.exports = {
  async up(queryInterface) {
    const [offenders] = await queryInterface.sequelize.query(
      `SELECT code FROM public.institutions WHERE code !~ '${URL_SAFE}'`
    );

    if (offenders.length > 0) {
      // Fail with the actual values rather than letting PostgreSQL report only
      // that some row violates the constraint: the operator has to know which
      // institutions need renaming before this can be applied.
      throw new Error(
        `Cannot constrain institutions.code: ${offenders.length} row(s) contain ` +
          `characters that are unsafe in a URL path — ` +
          `${offenders.map((row) => JSON.stringify(row.code)).join(', ')}. ` +
          'Rename them to letters, digits, hyphen, underscore or dot, then re-run.'
      );
    }

    await queryInterface.sequelize.query(
      `
      ALTER TABLE public.institutions
          ADD CONSTRAINT chk_institutions_code_url_safe
              CHECK (code ~ '${URL_SAFE}');
      `
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `
      ALTER TABLE public.institutions
          DROP CONSTRAINT IF EXISTS chk_institutions_code_url_safe;
      `
    );
  },
};
