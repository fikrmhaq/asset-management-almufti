'use strict';

/**
 * Request numbers — `REQ/{YYYY}/{NNNN}` per institution, Phase 37 decision E7
 * (`CR-014` §5.1; the format itself is a safe-to-defer assumption, §17.2).
 *
 * Allocated when the DRAFT is created, under a transaction-scoped advisory lock
 * per (institution, year) — the pattern inventory codes use — so two concurrent
 * drafts never receive the same number. `uq_requests_number` is the backstop.
 *
 * NEVER REUSED. No endpoint deletes a request, so the highest number issued is
 * always still in the table and the next one follows it.
 *
 * The year is the business year (`domain/businessMonth.js`): a draft created
 * at 00:30 on 1 January in Jakarta belongs to the new year, whatever UTC says.
 */

const { currentBusinessMonth } = require('./businessMonth');

const PREFIX = 'REQ';

function formatRequestNumber(year, sequence) {
  return `${PREFIX}/${year}/${String(sequence).padStart(4, '0')}`;
}

/**
 * The next number for the institution, allocated inside `transaction`.
 *
 * @returns {Promise<string>}
 */
async function allocateRequestNumber(institutionId, { sequelize, transaction, now = new Date() }) {
  const { year } = currentBusinessMonth(now);

  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext($1))', {
    bind: [`request-number:${institutionId}:${year}`],
    transaction,
    type: sequelize.QueryTypes.SELECT,
  });

  const [row] = await sequelize.query(
    `SELECT COALESCE(MAX(split_part(request_number, '/', 3)::integer), 0) AS highest
       FROM public.requests
      WHERE institution_id = $1 AND request_number LIKE $2`,
    {
      bind: [institutionId, `${PREFIX}/${year}/%`],
      transaction,
      type: sequelize.QueryTypes.SELECT,
    }
  );

  return formatRequestNumber(year, Number(row.highest) + 1);
}

module.exports = { formatRequestNumber, allocateRequestNumber };
