'use strict';

/**
 * Consumable request schemas (`IMPLEMENTATION_PLAN.md` §73). Quantities are
 * whole numbers in the consumable's own measurement unit; nothing converts.
 * A balance is never accepted from a client — the server computes it.
 */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');

const uuid = z.string().uuid('must be a UUID');
const MAX_QUANTITY = 1000000;

const master = {
  name: z.string().trim().min(1, 'is required').max(255),
  description: z.string().trim().max(5000).nullish(),
  measurementUnitId: uuid,
};

const createConsumable = z
  .object({
    ...master,
    // A scoped caller gets their own institution; a system-wide caller names one.
    institutionId: uuid.optional(),
  })
  .strict();

/** `institutionId` and the balance are not updatable. */
const updateConsumable = z
  .object(master)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const receiveStock = z
  .object({
    quantity: z
      .number()
      .int('must be a whole number')
      .positive('must be greater than zero')
      .max(MAX_QUANTITY),
    note: z.string().trim().max(5000).nullish(),
  })
  .strict();

/** A signed correction: + adds, − removes. Never zero; a reason is required. */
const adjustStock = z
  .object({
    quantity: z
      .number()
      .int('must be a whole number')
      .refine((value) => value !== 0, 'must not be zero')
      .refine((value) => Math.abs(value) <= MAX_QUANTITY, `must be at most ${MAX_QUANTITY}`),
    reason: z.string().trim().min(1, 'is required').max(5000),
  })
  .strict();

const listConsumables = listQuerySchema({
  status: z.enum(['active', 'inactive']).optional(),
  institutionId: uuid.optional(),
  q: z.string().trim().max(255).optional(),
});

const listMovements = listQuerySchema({
  movementType: z.enum(['RECEIPT', 'ISSUE', 'ADJUSTMENT']).optional(),
});

const optionsQuery = z.object({ institutionId: uuid.optional() }).strict();

const consumableParams = z.object({ id: uuid });

module.exports = {
  createConsumable,
  updateConsumable,
  receiveStock,
  adjustStock,
  listConsumables,
  listMovements,
  optionsQuery,
  consumableParams,
  MAX_QUANTITY,
};
