'use strict';

/**
 * Filtering — `06-api.md` §1.6.
 *
 * Filters arrive as flat query params and combine with AND (REQ-SEARCH-002).
 * Each resource declares which params it accepts and how each maps to a
 * Sequelize `where` fragment; nothing is derived from the raw query object, so
 * an unexpected param can never reach the database.
 */

const { Op } = require('sequelize');

/** Escapes the wildcards PostgreSQL's LIKE/ILIKE treats specially. */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Case-insensitive "contains" match, for `?q=` style search params. */
function contains(column, value) {
  return { [column]: { [Op.iLike]: `%${escapeLike(value)}%` } };
}

/** Case-insensitive "contains" across several columns, OR-ed together. */
function containsAny(columns, value) {
  return { [Op.or]: columns.map((column) => contains(column, value)) };
}

/** Exact match. */
function equals(column, value) {
  return { [column]: value };
}

/**
 * The `status` filter used by every soft-deletable resource (`06-api.md` §1.7).
 * `active` / `inactive` map onto the `is_active` boolean; anything else — including
 * an absent param — means "no filter".
 */
function activeStatus(column = 'isActive') {
  return (value) => {
    if (value === 'active') return { [column]: true };
    if (value === 'inactive') return { [column]: false };
    return undefined;
  };
}

/** Inclusive date range on one column, from optional `dateFrom`/`dateTo`. */
function dateRange(column, { from, to }) {
  const bounds = {};
  if (from !== undefined) bounds[Op.gte] = from;
  if (to !== undefined) bounds[Op.lte] = to;
  return Object.getOwnPropertySymbols(bounds).length ? { [column]: bounds } : undefined;
}

/**
 * Builds a `where` clause by applying each declared filter to its param.
 *
 * @param {Record<string, unknown>} params validated query params
 * @param {Record<string, (value: unknown, params: object) => object|undefined>} filters
 *   param name → fragment builder. A builder returning `undefined` contributes
 *   nothing, which is how "filter not supplied" stays distinct from "filter
 *   matched nothing".
 * @returns {object} a Sequelize `where` clause; `{}` when no filter applied
 */
function buildWhere(params, filters) {
  const fragments = [];

  for (const [name, build] of Object.entries(filters)) {
    const value = params[name];
    if (value === undefined || value === null || value === '') continue;

    const fragment = build(value, params);
    if (fragment) fragments.push(fragment);
  }

  if (fragments.length === 0) return {};
  if (fragments.length === 1) return fragments[0];
  return { [Op.and]: fragments };
}

module.exports = {
  buildWhere,
  escapeLike,
  contains,
  containsAny,
  equals,
  activeStatus,
  dateRange,
};
