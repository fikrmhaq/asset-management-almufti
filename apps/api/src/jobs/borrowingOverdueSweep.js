'use strict';

/**
 * Borrowing overdue sweep — `05-infrastructure.md` §7.2,
 * `IMPLEMENTATION_PLAN.md` §14.3, REQ-BORROW-012.
 *
 * `borrowing_status` has a real, stored `OVERDUE` value. This is the job that
 * writes it:
 *
 *   UPDATE borrowings SET status = 'OVERDUE'
 *   WHERE status = 'ACTIVE' AND expected_return_date < now()
 *
 * Safe to run twice, and safe to run concurrently with itself: the predicate
 * only matches `ACTIVE` rows, so a second pass over the same borrowings selects
 * nothing. Nothing else is touched — the dates stay exactly as recorded
 * (REQ-BORROW-015), and the units stay `BORROWED` because they are, in fact,
 * still out.
 *
 * The status change is audited per borrowing with a NULL actor, which
 * `04-data-model.md` §5.6.1 defines as "system". Bulk updates do not fire
 * per-row model hooks, so the rows are written here rather than left to
 * `db/auditHooks.js`; `returning: true` is what makes that possible without a
 * second query.
 */

const { Op } = require('sequelize');

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { getLogger } = require('../logger');
const audit = require('../services/audit');

const JOB_NAME = 'borrowing-overdue-sweep';

/** Today as `YYYY-MM-DD`, matching the SQL `DATE` column being compared. */
const asDate = (value) => value.toISOString().slice(0, 10);

/**
 * @param {{now?: Date, models?: object, sequelize?: object,
 *          logger?: import('winston').Logger}} [options]
 * @returns {Promise<{sweptCount: number, borrowingIds: string[]}>}
 */
async function runBorrowingOverdueSweep({
  now = new Date(),
  models = getModels(),
  sequelize = getSequelize(),
  logger = getLogger(),
} = {}) {
  const startedAt = process.hrtime.bigint();
  const cutoff = asDate(now);

  const borrowingIds = await withTransaction(
    async (transaction) => {
      const [, rows] = await models.Borrowing.update(
        { status: 'OVERDUE' },
        {
          where: { status: 'ACTIVE', expectedReturnDate: { [Op.lt]: cutoff } },
          returning: true,
          transaction,
        }
      );

      for (const row of rows ?? []) {
        await audit.record({
          action: audit.ACTIONS.STATUS_CHANGE,
          entityType: 'Borrowing',
          entityId: row.id,
          oldValues: { status: 'ACTIVE' },
          newValues: { status: 'OVERDUE' },
          metadata: { job: JOB_NAME, expectedReturnDate: row.expectedReturnDate },
          transaction,
        });
      }

      return (rows ?? []).map((row) => row.id);
    },
    { sequelize }
  );

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  // Logged on every run, including empty ones: "the sweep is running and found
  // nothing" and "the sweep stopped running" must not look the same (§14.3).
  logger.info('job completed', {
    job: JOB_NAME,
    sweptCount: borrowingIds.length,
    cutoff,
    durationMs: Number(durationMs.toFixed(1)),
  });

  return { sweptCount: borrowingIds.length, borrowingIds };
}

module.exports = { JOB_NAME, runBorrowingOverdueSweep };
