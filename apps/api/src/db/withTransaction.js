'use strict';

/**
 * Transaction helper — `IMPLEMENTATION_PLAN.md` §8.2, §35; REQ-NFR-REL-001/002.
 *
 * Multi-step writes must be atomic: the procurement-to-asset flow
 * (Contract Item → Asset → Asset Unit) and every history write that also updates
 * the denormalized columns on `asset_units` are the motivating cases. If one
 * step fails the whole operation rolls back, so no partially-created asset is
 * left behind.
 *
 * Passing an existing transaction joins it instead of opening a nested one, so a
 * service can be called standalone or as part of a larger operation without
 * knowing which.
 */

const { getSequelize } = require('./sequelize');

/**
 * @template T
 * @param {(transaction: import('sequelize').Transaction) => Promise<T>} work
 * @param {{transaction?: import('sequelize').Transaction,
 *          sequelize?: import('sequelize').Sequelize}} [options]
 * @returns {Promise<T>}
 */
async function withTransaction(work, { transaction, sequelize = getSequelize() } = {}) {
  if (transaction) return work(transaction);
  return sequelize.transaction((created) => work(created));
}

module.exports = { withTransaction };
