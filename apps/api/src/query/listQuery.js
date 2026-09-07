'use strict';

/**
 * Shared list-endpoint plumbing — `06-api.md` §1.5, §1.6.
 *
 * Every list endpoint accepts `page`/`pageSize`, optional `sort`/`order`, and a
 * resource-specific set of filters. Composing that here means a new resource
 * declares only what is actually specific to it, and cannot accidentally ship a
 * list endpoint without a page cap.
 */

const { z } = require('zod');

const { paginationSchema, toLimitOffset } = require('./pagination');
const { sortingSchema, toOrder } = require('./sorting');
const { buildWhere } = require('./filtering');

/**
 * Builds the query schema for a list endpoint.
 *
 * `.strict()` is deliberately NOT used: an unknown query param is ignored rather
 * than rejected, so a stale bookmark or an extra tracking param does not turn
 * into a 400. Filters only ever come from the declared map (`buildWhere`), so
 * an unexpected param can never reach the database either way.
 *
 * @param {import('zod').ZodRawShape} [filters] resource-specific filter params
 */
function listQuerySchema(filters = {}) {
  return paginationSchema.merge(sortingSchema).merge(z.object(filters));
}

/**
 * Turns validated query params into Sequelize find options.
 *
 * @param {object} params validated by `listQuerySchema`
 * @param {{filters: Record<string, Function>, sortable: string[],
 *          defaultSort?: [string, 'ASC'|'DESC'][]}} spec
 * @returns {{where: object, order: Array, limit: number, offset: number,
 *            page: number, pageSize: number}}
 */
function toFindOptions(params, { filters, sortable, defaultSort = [['createdAt', 'DESC']] }) {
  return {
    where: buildWhere(params, filters),
    order: toOrder(params, { allowed: sortable, default: defaultSort }),
    ...toLimitOffset(params),
    page: params.page,
    pageSize: params.pageSize,
  };
}

/**
 * Runs a paginated query and returns rows plus the `meta` block's inputs.
 *
 * `findAndCountAll` is used rather than a separate count so the total always
 * reflects the same filters as the page.
 *
 * @param {import('sequelize').ModelStatic<import('sequelize').Model>} model
 * @param {object} findOptions from `toFindOptions`
 * @param {object} [extra] additional Sequelize options, e.g. `include`
 */
async function paginate(model, findOptions, extra = {}) {
  const { where, order, limit, offset, page, pageSize } = findOptions;

  const { rows, count } = await model.findAndCountAll({
    where,
    order,
    limit,
    offset,
    // An `include` with a hasMany would multiply the count; callers that need
    // one pass `distinct: true` themselves.
    ...extra,
  });

  return { rows, pagination: { page, pageSize, total: count } };
}

module.exports = { listQuerySchema, toFindOptions, paginate };
