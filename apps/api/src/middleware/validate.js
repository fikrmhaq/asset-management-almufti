'use strict';

/**
 * Request validation — `IMPLEMENTATION_PLAN.md` §8.3, REQ-VAL-001/002/006.
 *
 * Zod schemas per request part. On failure the response carries `details[]` with
 * a `field` for each issue, which `07-ui.md` §4.3 maps straight onto form fields
 * — so the shape of this output is a contract, not a convenience.
 *
 * Validated values replace the raw ones on the request, so handlers receive
 * coerced types (numbers as numbers, defaults applied) and never see unvalidated
 * input.
 */

const { ValidationError } = require('../errors');

/** Flattens a ZodError into the API's `details` array. */
function toDetails(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    issue: issue.message,
  }));
}

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny,
 *          params?: import('zod').ZodTypeAny}} schemas
 * @returns {import('express').RequestHandler}
 */
function validate(schemas) {
  const parts = Object.entries(schemas);

  return function validateRequest(req, res, next) {
    const details = [];
    const parsed = {};

    for (const [part, schema] of parts) {
      const result = schema.safeParse(req[part]);

      if (result.success) {
        parsed[part] = result.data;
      } else {
        // Prefix with the part so `body.name` and `query.name` stay distinct.
        details.push(
          ...toDetails(result.error).map((detail) => ({
            ...detail,
            field: detail.field ? `${part}.${detail.field}` : part,
          }))
        );
      }
    }

    if (details.length > 0) {
      return next(new ValidationError('Request validation failed', details));
    }

    for (const [part, value] of Object.entries(parsed)) {
      // `req.query` and `req.params` are getter-only in Express 5 and lazily
      // built in Express 4; assigning to a plain own property is safe in both.
      Object.defineProperty(req, part, { value, writable: true, configurable: true });
    }

    return next();
  };
}

module.exports = { validate, toDetails };
