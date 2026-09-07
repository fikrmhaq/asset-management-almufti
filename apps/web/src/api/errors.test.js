import { describe, it, expect } from 'vitest';

import { ApiError, ERROR_CODES, normalizeError } from './errors';

/**
 * Error normalization — `IMPLEMENTATION_PLAN.md` §15.2, `06-api.md` §1.4.
 */

const responseError = (status, body) => ({ response: { status, data: body } });

describe('normalizeError', () => {
  it('reads the documented error envelope', () => {
    const error = normalizeError(
      responseError(409, {
        error: { code: 'CONFLICT', message: 'That asset unit is already out on another borrowing' },
      })
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe(ERROR_CODES.CONFLICT);
    expect(error.status).toBe(409);
    // The API's message is written to be shown to users (REQ-VAL-006).
    expect(error.message).toBe('That asset unit is already out on another borrowing');
  });

  it('exposes validation details as a field map for the form layer', () => {
    const error = normalizeError(
      responseError(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'expectedReturnDate must be on or after borrowDate',
          details: [
            { field: 'expectedReturnDate', issue: 'must be on or after 2026-01-01' },
            { field: 'borrowerName', issue: 'is required' },
          ],
        },
      })
    );

    expect(error.isValidation).toBe(true);
    expect(error.fieldErrors).toEqual({
      expectedReturnDate: 'must be on or after 2026-01-01',
      borrowerName: 'is required',
    });
  });

  it('keeps the first issue when a field appears twice', () => {
    const error = normalizeError(
      responseError(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'invalid',
          details: [
            { field: 'name', issue: 'is required' },
            { field: 'name', issue: 'must be shorter' },
          ],
        },
      })
    );

    expect(error.fieldErrors.name).toBe('is required');
  });

  it('never surfaces a server message for a 500 (REQ-VAL-006)', () => {
    const error = normalizeError(
      responseError(500, { error: { code: 'INTERNAL_ERROR', message: 'ECONNREFUSED at pg.js:42' } })
    );

    expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error.message).not.toContain('pg.js');
  });

  it('falls back to the status when a response has no envelope', () => {
    expect(normalizeError(responseError(403, '<html>Forbidden</html>')).code).toBe(
      ERROR_CODES.FORBIDDEN
    );
    expect(normalizeError(responseError(404, undefined)).code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('distinguishes a network failure from a server error', () => {
    const error = normalizeError(new Error('Network Error'));

    expect(error.code).toBe(ERROR_CODES.NETWORK_ERROR);
    expect(error.status).toBeNull();
  });

  it('recognises a cancelled request', () => {
    const error = normalizeError({ code: 'ERR_CANCELED', name: 'CanceledError' });

    expect(error.code).toBe(ERROR_CODES.CANCELLED);
  });

  it('flags an auth failure so the shell can react', () => {
    const error = normalizeError(
      responseError(401, {
        error: { code: 'UNAUTHORIZED', message: 'The access token has expired' },
      })
    );

    expect(error.isAuthFailure).toBe(true);
  });

  it('passes an already-normalized error through unchanged', () => {
    const original = normalizeError(responseError(404, undefined));

    expect(normalizeError(original)).toBe(original);
  });
});
