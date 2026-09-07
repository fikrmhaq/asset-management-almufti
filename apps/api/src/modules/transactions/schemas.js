'use strict';

/** Request schemas for transactions — `06-api.md` §7.3, REQ-TXN-001–010. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');

const uuid = z.string().uuid('must be a UUID');

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    'must be a real calendar date'
  );

/**
 * Items are supplied WITH the transaction, not added afterwards: a transaction
 * is a historical record with no PATCH and no item endpoints of its own
 * (`06-api.md` §7.3, REQ-TXN-007), so the moment of creation is the only moment
 * its composition can be set.
 *
 * At least one unit is required — REQ-TXN-004 and REQ-TXN-010 both describe a
 * transaction as something that happened to specific units, and a transaction
 * naming none would be untraceable to any asset.
 */
const createTransaction = z
  .object({
    transactionDate: isoDate,
    transactionTypeId: z.number().int().positive(),
    description: z.string().trim().max(5000).nullish(),
    supplierId: uuid.nullish(),
    contractId: uuid.nullish(),
    institutionId: uuid.optional(),
    items: z
      .array(
        z
          .object({
            assetUnitId: uuid,
            notes: z.string().trim().max(5000).nullish(),
          })
          .strict()
      )
      .min(1, 'at least one asset unit is required')
      .max(500, 'must not exceed 500 items'),
  })
  .strict();

/** Filters — `06-api.md` §7.3. */
const listTransactions = listQuerySchema({
  transactionTypeId: z.coerce.number().int().positive().optional(),
  institutionId: uuid.optional(),
  contractId: uuid.optional(),
  supplierId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

const transactionParams = z.object({ id: uuid });

module.exports = { createTransaction, listTransactions, transactionParams };
