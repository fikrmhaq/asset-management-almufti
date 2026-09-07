'use strict';

/**
 * Unmatched-route handler.
 *
 * Mounted after every route so an unknown path returns the documented
 * `NOT_FOUND` envelope rather than Express's HTML error page.
 */

const { NotFoundError } = require('../errors');

/** @returns {import('express').RequestHandler} */
function notFound() {
  return function handleNotFound(req, res, next) {
    next(new NotFoundError(`Cannot ${req.method} ${req.path}`));
  };
}

module.exports = { notFound };
