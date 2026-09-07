'use strict';

/**
 * Pagination — `06-api.md` §1.5.
 *
 * `?page=1&pageSize=20`, default `pageSize=20`, maximum `100`. The cap is not
 * advisory: REQ-NFR-PERF-002 requires list endpoints to stay paginated as data
 * grows, and an uncapped `pageSize` is how that quietly stops being true.
 */

const { z } = require('zod');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/**
 * Converts validated pagination params into Sequelize's `limit`/`offset`.
 *
 * @param {{page: number, pageSize: number}} params
 */
function toLimitOffset({ page, pageSize }) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginationSchema,
  toLimitOffset,
};
