'use strict';

/** Request schemas for suppliers — `06-api.md` §6.1, REQ-SUPPLIER-002. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');

/** Columns from `04-data-model.md` §5.4.2. */
const supplierBody = {
  name: z.string().trim().min(1, 'is required').max(255),
  address: z.string().trim().max(5000).nullish(),
  contactInfo: z.string().trim().max(5000).nullish(),
};

const createSupplier = z.object(supplierBody).strict();

const updateSupplier = z
  .object({
    name: z.string().trim().min(1).max(255),
    address: z.string().trim().max(5000).nullable(),
    contactInfo: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const listSuppliers = listQuerySchema({
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),
});

const supplierParams = z.object({ id: z.string().uuid('must be a UUID') });

module.exports = { createSupplier, updateSupplier, listSuppliers, supplierParams };
