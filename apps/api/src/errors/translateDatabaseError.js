'use strict';

/**
 * Database error translation — `IMPLEMENTATION_PLAN.md` §8.2.
 *
 * Turns Sequelize/PostgreSQL failures into the API's own error vocabulary, so
 * a constraint violation surfaces as a `CONFLICT` rather than a 500, and so no
 * SQL text ever reaches a response body (REQ-VAL-006).
 *
 * The named constraints from `04-data-model.md` are what make this possible:
 * `uq_users_username` tells us which field conflicted without parsing driver
 * messages.
 */

const {
  ValidationError: SequelizeValidationError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  ExclusionConstraintError,
  DatabaseError,
  TimeoutError,
  ConnectionError,
} = require('sequelize');

const { ConflictError, ValidationError, InternalError } = require('./index');

/** PostgreSQL SQLSTATE codes we translate deliberately. */
const SQL_STATE = {
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  INVALID_TEXT_REPRESENTATION: '22P02',
  STRING_DATA_RIGHT_TRUNCATION: '22001',
  NUMERIC_VALUE_OUT_OF_RANGE: '22003',
};

function fieldsOf(error) {
  const fields = error?.fields;
  if (!fields) return undefined;
  return Array.isArray(fields) ? fields : Object.keys(fields);
}

function detailFor(constraint, issue, fields) {
  const list = fields?.length ? fields : [undefined];
  return list.map((field) => ({ field, issue, constraint }));
}

/**
 * @param {Error} error
 * @returns {import('./index').AppError|undefined} the translated error, or
 *   `undefined` when this is not a database error we recognize.
 */
function translateDatabaseError(error) {
  if (error instanceof UniqueConstraintError) {
    const fields = fieldsOf(error);
    return new ConflictError(
      fields?.length
        ? `A record with this ${fields.join(', ')} already exists`
        : 'A record with these values already exists',
      detailFor(error.parent?.constraint, 'must be unique', fields)
    );
  }

  if (error instanceof ForeignKeyConstraintError) {
    const constraint = error.parent?.constraint ?? error.index;
    // A failed insert/update references something absent; a failed delete means
    // something still references this row. Both are conflicts, not crashes.
    return new ConflictError(
      'The request references a record that does not exist, or a record that is still in use',
      detailFor(constraint, 'violates a foreign key constraint', fieldsOf(error))
    );
  }

  if (error instanceof ExclusionConstraintError) {
    return new ConflictError(
      'The request conflicts with an existing record',
      detailFor(error.parent?.constraint, 'violates an exclusion constraint')
    );
  }

  if (error instanceof SequelizeValidationError) {
    return new ValidationError(
      'Request validation failed',
      error.errors.map((item) => ({ field: item.path ?? undefined, issue: item.message }))
    );
  }

  if (error instanceof TimeoutError) {
    return new InternalError('The database did not respond in time', { cause: error });
  }

  if (error instanceof ConnectionError) {
    return new InternalError('The database is unavailable', { cause: error });
  }

  if (error instanceof DatabaseError) {
    const code = error.parent?.code;
    const constraint = error.parent?.constraint;

    if (code === SQL_STATE.CHECK_VIOLATION) {
      return new ValidationError(
        'A value in the request violates a data integrity rule',
        detailFor(constraint, 'violates a check constraint')
      );
    }

    if (code === SQL_STATE.NOT_NULL_VIOLATION) {
      return new ValidationError('A required value is missing', [
        { field: error.parent?.column, issue: 'is required' },
      ]);
    }

    if (
      code === SQL_STATE.INVALID_TEXT_REPRESENTATION ||
      code === SQL_STATE.STRING_DATA_RIGHT_TRUNCATION ||
      code === SQL_STATE.NUMERIC_VALUE_OUT_OF_RANGE
    ) {
      return new ValidationError('A value in the request has the wrong type or is out of range');
    }

    // Anything else is a genuine fault. Wrap it so the SQL text stays server-side.
    return new InternalError('A database error occurred', { cause: error });
  }

  return undefined;
}

module.exports = { translateDatabaseError, SQL_STATE };
