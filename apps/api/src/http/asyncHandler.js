'use strict';

/**
 * Forwards rejected promises from async route handlers to Express's error
 * middleware.
 *
 * Express 4 does not await handlers, so an unhandled rejection would otherwise
 * hang the request until it times out instead of returning a 500. Every async
 * handler in the codebase must be wrapped.
 *
 * @param {(req, res, next) => Promise<unknown>} handler
 * @returns {(req, res, next) => void}
 */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
