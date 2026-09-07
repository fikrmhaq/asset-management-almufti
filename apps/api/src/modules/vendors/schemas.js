'use strict';

/** Request schemas for vendors — `06-api.md` §7.1, REQ-VENDOR-002. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');

/** Columns from `04-data-model.md` §5.4.1. */
const vendorBody = {
  name: z.string().trim().min(1, 'is required').max(255),
  contactInfo: z.string().trim().max(5000).nullish(),
  address: z.string().trim().max(5000).nullish(),
};

const createVendor = z.object(vendorBody).strict();

const updateVendor = z
  .object({
    name: z.string().trim().min(1).max(255),
    contactInfo: z.string().trim().max(5000).nullable(),
    address: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const listVendors = listQuerySchema({
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),
});

const vendorParams = z.object({ id: z.string().uuid('must be a UUID') });

module.exports = { createVendor, updateVendor, listVendors, vendorParams };
