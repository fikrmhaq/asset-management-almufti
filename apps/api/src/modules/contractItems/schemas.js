'use strict';

/** Request schemas for contract items — `06-api.md` §6.3, REQ-PROC-004/005/009. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');

const uuid = z.string().uuid('must be a UUID');

/** Mirrors `chk_contract_items_price` — `04-data-model.md` §5.4.4. */
const unitPrice = z.number().nonnegative('must not be negative').max(9999999999999.99);

/** Mirrors `chk_contract_items_quantity`. */
const quantity = z.number().int('must be a whole number').positive('must be greater than zero');

/**
 * A manually supplied inventory code component — `CR-007`.
 *
 * Bounded by the column; the token's budget depends on the institution's format
 * and is enforced where that format is in hand.
 */
const numberComposition = z.string().trim().min(1, 'is required').max(32);

const contractItemBody = {
  assetName: z.string().trim().min(1, 'is required').max(150),
  specification: z.string().trim().max(5000).nullish(),
  quantity: quantity.nullish(),
  unitPrice: unitPrice.nullish(),
  unitType: z.string().trim().max(50).nullish(),
};

const createContractItem = z.object(contractItemBody).strict();

const updateContractItem = z
  .object({
    assetName: z.string().trim().min(1).max(150),
    specification: z.string().trim().max(5000).nullable(),
    quantity: quantity.nullable(),
    unitPrice: unitPrice.nullable(),
    unitType: z.string().trim().max(50).nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const listContractItems = listQuerySchema({
  q: z.string().trim().min(1).optional(),
});

/**
 * `POST /contract-items/:id/assets` — REQ-PROC-009.
 *
 * `contractId` and `contractItemId` are deliberately absent: the server derives
 * both from `:id` so the caller cannot detach the created records from the
 * procurement they came from (`06-api.md` §6.3).
 *
 * `unitCount` is bounded at 500 purely as request validation (REQ-VAL-001). It
 * is NOT checked against `quantity`: no requirement says the units registered
 * must equal the quantity ordered, and partial or staged registration is normal.
 */
const createAssetFromItem = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    classificationId: z.string().trim().length(12, 'must be a 12-character code'),
    institutionId: uuid.optional(),
    // A UUID since Phase 20 (`CR-003`); it is written onto the created UNITS,
    // never onto the Asset — department is an asset-unit property.
    departmentId: uuid.optional(),
    vendorId: uuid.optional(),
    description: z.string().trim().max(5000).optional(),
    unitCount: z
      .number()
      .int('must be a whole number')
      .min(1, 'must be at least 1')
      .max(500, 'must not exceed 500'),
    /**
     * The manually supplied component, in whichever shape the institution's
     * format calls for — `CR-007` `DEC-130`.
     *
     * `numberComposition` when an allocated sequence distinguishes the units, so
     * one value covers the batch; `numberCompositions` when nothing else does
     * and each unit needs its own. Which one is required cannot be known here —
     * it depends on a format this schema cannot see — so both are optional and
     * the service decides, refusing the wrong one by name.
     *
     * Nothing is ever incremented: `001-02-03` has domain-specific segments the
     * application does not interpret.
     */
    numberComposition: numberComposition.optional(),
    numberCompositions: z.array(numberComposition).min(1).max(500).optional(),
  })
  .strict();

const contractItemParams = z.object({ id: uuid });

module.exports = {
  createContractItem,
  updateContractItem,
  listContractItems,
  createAssetFromItem,
  contractItemParams,
};
