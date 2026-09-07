'use strict';

/**
 * Terminal error middleware — `06-api.md` §1.4.
 *
 * Every failure in the API ends here and leaves as the documented error
 * envelope. Two rules it exists to enforce:
 *
 *   1. A 5xx response never carries a stack trace, SQL text, or a driver
 *      message (REQ-VAL-006). Those are logged server-side instead.
 *   2. An unrecognized error is a genuine fault, so it is logged at `error`
 *      level rather than being quietly reshaped into a 400.
 */

const { AppError, InternalError } = require('../errors');
const { translateDatabaseError } = require('../errors/translateDatabaseError');
const { sendError } = require('../http/respond');
const { getLogger } = require('../logger');

/** Body parser failures arrive as generic errors; they are the client's fault. */
function translateBodyParserError(error) {
  if (error?.type === 'entity.too.large') {
    return new AppError('VALIDATION_ERROR', 'Request body is too large');
  }
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return new AppError('VALIDATION_ERROR', 'Request body is not valid JSON');
  }
  return undefined;
}

function normalize(error) {
  if (error instanceof AppError) return error;

  return (
    translateBodyParserError(error) ??
    translateDatabaseError(error) ??
    new InternalError('An unexpected error occurred', { cause: error })
  );
}

/**
 * @param {{logger?: import('winston').Logger}} [options]
 * @returns {import('express').ErrorRequestHandler}
 */
function errorHandler({ logger = getLogger() } = {}) {
  // Express identifies error middleware by arity: all four parameters are
  // required even though `next` is only used for the headers-sent case.
  return function handleError(error, req, res, next) {
    const appError = normalize(error);

    const context = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      code: appError.code,
      status: appError.status,
    };

    if (appError.expected) {
      logger.warn(appError.message, context);
    } else {
      // The cause holds the real failure; the client only ever sees the
      // generic message above.
      logger.error(appError.message, {
        ...context,
        error: appError.cause ?? appError,
        stack: (appError.cause ?? appError).stack,
      });
    }

    // Streaming responses may have already started; Express's default handler
    // is the only thing that can close them cleanly.
    if (res.headersSent) return next(error);

    return sendError(res, {
      status: appError.status,
      code: appError.code,
      message: appError.message,
      details: appError.details,
    });
  };
}

module.exports = { errorHandler, normalize };
