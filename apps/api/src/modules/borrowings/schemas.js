'use strict';

/** Request schemas for borrowings — `06-api.md` §7.2, REQ-BORROW-001–014. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');
const { BORROWING_STATUSES } = require('../../db/enums');

const uuid = z.string().uuid('must be a UUID');

/** `borrow_date`, `expected_return_date` and `actual_return_date` are SQL `DATE`. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    'must be a real calendar date'
  );

/**
 * `borrowerName` and `borrowerContact` are both NOT NULL
 * (`04-data-model.md` §5.5.1) — REQ-BORROW-002 requires the record to identify
 * who holds the item, and a name with no way to reach them does not.
 */
const createBorrowing = z
  .object({
    borrowerName: z.string().trim().min(1, 'is required').max(255),
    borrowerContact: z.string().trim().min(1, 'is required').max(5000),
    borrowDate: isoDate,
    expectedReturnDate: isoDate,
    responsiblePersonId: uuid.nullish(),
    institutionId: uuid.optional(),
    description: z.string().trim().max(5000).nullish(),
  })
  .strict();

/** Editable while DRAFT only — `06-api.md` §7.2. Status is never a plain field. */
const updateBorrowing = z
  .object({
    borrowerName: z.string().trim().min(1).max(255),
    borrowerContact: z.string().trim().min(1).max(5000),
    borrowDate: isoDate,
    expectedReturnDate: isoDate,
    responsiblePersonId: uuid.nullable(),
    institutionId: uuid,
    description: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * Filters — `06-api.md` §7.2. `overdue=true` selects borrowings still holding
 * their units past the expected return date, whether or not the Phase 8 sweep
 * has already stamped the status (REQ-BORROW-012).
 */
const listBorrowings = listQuerySchema({
  status: z.enum(BORROWING_STATUSES).optional(),
  institutionId: uuid.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  q: z.string().trim().min(1).optional(),
});

const addItem = z.object({ assetUnitId: uuid }).strict();

/** `actualReturnDate` defaults to today when the caller does not name one. */
const returnBorrowing = z
  .object({
    actualReturnDate: isoDate.optional(),
    description: z.string().trim().max(5000).optional(),
  })
  .strict();

/**
 * Extension — REQ-BORROW-014. The new expected return date is required: an
 * extension with no new deadline would be a return, not an extension.
 */
const extendBorrowing = z
  .object({
    expectedReturnDate: isoDate,
    actualReturnDate: isoDate.optional(),
    description: z.string().trim().max(5000).optional(),
  })
  .strict();

const borrowingParams = z.object({ id: uuid });
const borrowingItemParams = z.object({ id: uuid, itemId: uuid });

module.exports = {
  createBorrowing,
  updateBorrowing,
  listBorrowings,
  addItem,
  returnBorrowing,
  extendBorrowing,
  borrowingParams,
  borrowingItemParams,
};
