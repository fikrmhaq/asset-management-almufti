'use strict';

/**
 * Application error classes.
 *
 * Each maps to exactly one of the error codes in `06-api.md` §1.4, so the HTTP
 * status and payload of a failure are decided where the failure happens rather
 * than being guessed at by the error middleware.
 *
 * `AUTHENTICATION`/`AUTHORIZATION` errors are defined here because the envelope
 * is Phase 2's responsibility; nothing throws them until Phase 3.
 */

/** The complete code → status mapping from `06-api.md` §1.4. */
const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
});

class AppError extends Error {
  /**
   * @param {keyof ERROR_CODES} code
   * @param {string} message client-safe; never include SQL text or stack traces
   * @param {{details?: Array<{field?: string, issue: string}>, cause?: Error}} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.status = ERROR_CODES[code] ?? 500;
    this.details = options.details;
    // Distinguishes errors we raised deliberately from genuine crashes, which
    // the error middleware must not leak details from (REQ-VAL-006).
    this.expected = this.status < 500;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Request body, query or params failed schema or business-rule validation. */
class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details) {
    super('VALIDATION_ERROR', message, { details });
  }
}

/** Missing, invalid or expired credentials. */
class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required') {
    super('UNAUTHORIZED', message);
  }
}

/** Authenticated, but lacking permission or outside the caller's org scope. */
class ForbiddenError extends AppError {
  /**
   * `details` is optional and names the specific reason where one exists — e.g.
   * a refused self-assignment (`CR-014` `BR-033`). The error code stays
   * `FORBIDDEN`; no new top-level code is introduced.
   */
  constructor(message = 'You do not have permission to perform this action', details) {
    super('FORBIDDEN', message, { details });
  }
}

/** Resource does not exist, or is outside the caller's org scope (`06-api.md` §1.4). */
class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message);
  }
}

/** Uniqueness violation, or an invalid state/lifecycle transition. */
class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state', details) {
    super('CONFLICT', message, { details });
  }
}

/** Unhandled failure. The message is never sent to the client verbatim. */
class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred', options) {
    super('INTERNAL_ERROR', message, options);
  }
}

module.exports = {
  ERROR_CODES,
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalError,
};
