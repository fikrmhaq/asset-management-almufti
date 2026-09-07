import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';

import { silentLogger } from './helpers/testApp.js';

const require = createRequire(import.meta.url);

const {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalError,
  ERROR_CODES,
} = require('../src/errors/index.js');
const { errorHandler, normalize } = require('../src/middleware/errorHandler.js');
const { translateDatabaseError } = require('../src/errors/translateDatabaseError.js');
const { notFound } = require('../src/middleware/notFound.js');

/** Builds a tiny app whose single route throws whatever is handed to it. */
function appThatThrows(error, logger = silentLogger()) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/boom', () => {
    throw error;
  });
  app.get(
    '/async-boom',
    // Deliberately unwrapped, to prove asyncHandler is required for async routes.
    (req, res, next) => Promise.reject(error).catch(next)
  );
  app.use(notFound());
  app.use(errorHandler({ logger }));
  return app;
}

describe('error classes (§1.4)', () => {
  it.each([
    [ValidationError, 'VALIDATION_ERROR', 400],
    [UnauthorizedError, 'UNAUTHORIZED', 401],
    [ForbiddenError, 'FORBIDDEN', 403],
    [NotFoundError, 'NOT_FOUND', 404],
    [ConflictError, 'CONFLICT', 409],
    [InternalError, 'INTERNAL_ERROR', 500],
  ])('%s maps to %s / %i', (ErrorClass, code, status) => {
    const error = new ErrorClass();

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(ERROR_CODES[code]).toBe(status);
  });

  it('marks 4xx as expected and 5xx as not', () => {
    expect(new ConflictError().expected).toBe(true);
    expect(new InternalError().expected).toBe(false);
  });
});

describe('error middleware', () => {
  it('emits the documented error envelope', async () => {
    const response = await request(appThatThrows(new NotFoundError('Asset not found'))).get(
      '/boom'
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Asset not found' },
    });
  });

  it('includes field-level details when present', async () => {
    const error = new ValidationError('Request validation failed', [
      { field: 'expectedReturnDate', issue: 'must be on or after borrowDate' },
    ]);
    const response = await request(appThatThrows(error)).get('/boom');

    expect(response.body.error.details).toEqual([
      { field: 'expectedReturnDate', issue: 'must be on or after borrowDate' },
    ]);
  });

  it('omits the details key entirely when there are none', async () => {
    const response = await request(appThatThrows(new ConflictError('Nope'))).get('/boom');

    expect(response.body.error).not.toHaveProperty('details');
  });

  it('converts an unknown error into INTERNAL_ERROR without leaking it (REQ-VAL-006)', async () => {
    const leaky = new Error('SELECT * FROM users WHERE password_hash = $1 failed');
    const response = await request(appThatThrows(leaky)).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/SELECT|password_hash/);
  });

  it('never sends a stack trace', async () => {
    const response = await request(appThatThrows(new Error('boom'))).get('/boom');

    expect(JSON.stringify(response.body)).not.toMatch(/at |\.js:/);
  });

  it('handles rejected promises forwarded by asyncHandler', async () => {
    const response = await request(appThatThrows(new ConflictError('Async conflict'))).get(
      '/async-boom'
    );

    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe('Async conflict');
  });

  it('logs 5xx at error level and 4xx at warn', async () => {
    const logger = silentLogger();
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');

    await request(appThatThrows(new NotFoundError(), logger)).get('/boom');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();

    await request(appThatThrows(new Error('crash'), logger)).get('/boom');
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('normalize', () => {
  it('passes an AppError through untouched', () => {
    const original = new ConflictError('Already exists');

    expect(normalize(original)).toBe(original);
  });

  it('wraps a plain Error, keeping the original as the cause', () => {
    const original = new Error('driver exploded');
    const normalized = normalize(original);

    expect(normalized.code).toBe('INTERNAL_ERROR');
    expect(normalized.cause).toBe(original);
  });
});

describe('database error translation (§8.2)', () => {
  it('turns a unique violation into a CONFLICT naming the field', () => {
    const { UniqueConstraintError } = require('sequelize');
    const error = new UniqueConstraintError({
      fields: { username: 'jdoe' },
      errors: [],
      parent: { constraint: 'uq_users_username' },
    });

    const translated = translateDatabaseError(error);

    expect(translated.code).toBe('CONFLICT');
    expect(translated.message).toMatch(/username/);
    expect(translated.details[0]).toMatchObject({
      field: 'username',
      constraint: 'uq_users_username',
    });
  });

  it('turns a foreign key violation into a CONFLICT', () => {
    const { ForeignKeyConstraintError } = require('sequelize');
    const error = new ForeignKeyConstraintError({
      parent: { constraint: 'fk_asset_units_asset' },
    });

    expect(translateDatabaseError(error).code).toBe('CONFLICT');
  });

  it('turns a check violation into a VALIDATION_ERROR', () => {
    const { DatabaseError } = require('sequelize');
    const error = new DatabaseError({
      message: 'check constraint violated',
      code: '23514',
      constraint: 'chk_borrowings_return_after_borrow',
    });
    error.parent = { code: '23514', constraint: 'chk_borrowings_return_after_borrow' };

    const translated = translateDatabaseError(error);

    expect(translated.code).toBe('VALIDATION_ERROR');
    expect(translated.details[0].constraint).toBe('chk_borrowings_return_after_borrow');
  });

  it('wraps an unrecognized database error without exposing SQL', () => {
    const { DatabaseError } = require('sequelize');
    const error = new DatabaseError({ message: 'syntax error at or near "SELCT"' });
    error.parent = { code: '42601' };

    const translated = translateDatabaseError(error);

    expect(translated.code).toBe('INTERNAL_ERROR');
    expect(translated.message).not.toMatch(/SELCT/);
  });

  it('leaves an unrelated error alone', () => {
    expect(translateDatabaseError(new TypeError('not a database problem'))).toBeUndefined();
  });
});
