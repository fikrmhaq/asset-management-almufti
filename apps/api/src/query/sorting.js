'use strict';

/**
 * Sorting — `06-api.md` §1.6: `?sort=<field>&order=asc|desc`.
 *
 * A sort field is an identifier interpolated into SQL, so it is validated
 * against an allow-list per resource rather than passed through. Never widen
 * this to accept arbitrary column names.
 */

const { z } = require('zod');

const { ValidationError } = require('../errors');

const sortingSchema = z.object({
  sort: z.string().min(1).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

/**
 * Builds a Sequelize `order` clause from validated params.
 *
 * @param {{sort?: string, order: 'asc'|'desc'}} params
 * @param {{allowed: string[], default?: [string, 'ASC'|'DESC'][]}} options
 *   `allowed` lists the sortable fields for this resource.
 * @returns {[string, 'ASC'|'DESC'][]}
 * @throws {ValidationError} when the requested field is not sortable
 */
function toOrder({ sort, order }, { allowed, default: fallback = [] }) {
  if (!sort) return fallback;

  if (!allowed.includes(sort)) {
    throw new ValidationError(`Cannot sort by "${sort}"`, [
      { field: 'sort', issue: `must be one of: ${allowed.join(', ')}` },
    ]);
  }

  return [[sort, order.toUpperCase()]];
}

module.exports = { sortingSchema, toOrder };
