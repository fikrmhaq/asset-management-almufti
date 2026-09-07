'use strict';

/** Request schemas for contracts — `06-api.md` §6.2, REQ-PROC-002/003/007/008. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');

const uuid = z.string().uuid('must be a UUID');

/**
 * `contract_date` and `receiving_date` are SQL `DATE` columns
 * (`04-data-model.md` §5.4.3), so they are exchanged as `YYYY-MM-DD` strings —
 * a full timestamp would carry a zone the column cannot store, and converting
 * one shifts the day for anyone not on UTC.
 */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    'must be a real calendar date'
  );

/**
 * `NUMERIC(15,2)`. Accepted as a number and rejected when negative — a contract
 * cannot be worth less than nothing. Note that `04-data-model.md` §5.4.3 carries
 * no CHECK for this, unlike `chk_contract_items_price`; this is request
 * validation (REQ-VAL-001), not a claimed database constraint.
 */
const money = z.number().nonnegative('must not be negative').max(9999999999999.99);

/**
 * `ref.account_codes.code` is `CHAR(12)`. PostgreSQL blank-pads it, so input is
 * trimmed here and compared against a trimmed key (`normalizeCharKey`).
 */
const accountCode = z.string().trim().min(1).max(12);

const contractBody = {
  contractNumber: z.string().trim().min(1, 'is required').max(150),
  supplierId: uuid.nullish(),
  contractTypeId: z.number().int().positive().nullish(),
  contractDate: isoDate,
  fundingSourceId: z.number().int().positive().nullish(),
  contractValue: money.nullish(),
  receivingDocument: z.string().trim().max(255).nullish(),
  receivingDate: isoDate.nullish(),
  institutionId: uuid.nullish(),
  accountCode: accountCode.nullish(),
  notes: z.string().trim().max(5000).nullish(),
};

const createContract = z.object(contractBody).strict();

const updateContract = z
  .object({
    contractNumber: z.string().trim().min(1).max(150),
    supplierId: uuid.nullable(),
    contractTypeId: z.number().int().positive().nullable(),
    contractDate: isoDate,
    fundingSourceId: z.number().int().positive().nullable(),
    contractValue: money.nullable(),
    receivingDocument: z.string().trim().max(255).nullable(),
    receivingDate: isoDate.nullable(),
    institutionId: uuid.nullable(),
    accountCode: accountCode.nullable(),
    notes: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

/** Filters — `06-api.md` §6.2. `q` searches the contract number. */
const listContracts = listQuerySchema({
  supplierId: uuid.optional(),
  institutionId: uuid.optional(),
  contractTypeId: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),
});

const contractParams = z.object({ id: uuid });

module.exports = { createContract, updateContract, listContracts, contractParams };
