'use strict';

/** Request schemas for institutions — `06-api.md` §3.1, REQ-ORG-001/002. */

const { z } = require('zod');

const { URL_SAFE_CODE } = require('../../domain/inventoryCode');
const { MAX_FORMAT_LENGTH } = require('../../domain/inventoryCodeFormat');

const { listQuerySchema } = require('../../query/listQuery');

/** Column widths come from `04-data-model.md` §5.2.1. */
const institutionBody = {
  name: z.string().trim().min(1, 'is required').max(50),
  // URL-safe only (REQ-ORG-002). The code is the leading segment of every asset
  // unit inventory code, and that code travels in the path of the address a
  // scanned label resolves to — a slash or a space would produce an address that
  // does not point where the printed label claims. Mirrors
  // `chk_institutions_code_url_safe`.
  code: z
    .string()
    .trim()
    .min(1, 'is required')
    .max(25)
    .regex(URL_SAFE_CODE, 'must use only letters, digits, hyphen, underscore or dot'),
  address: z.string().trim().min(1, 'is required'),
};

const createInstitution = z.object(institutionBody).strict();

/**
 * Update is a PATCH, so every field is optional — but an empty body is rejected
 * rather than silently succeeding as a no-op that looks like a change.
 */
const updateInstitution = z
  .object(institutionBody)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const listInstitutions = listQuerySchema({
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),
});

const institutionParams = z.object({ id: z.string().uuid('must be a UUID') });

/**
 * The inventory code format — Phase 25 (`CR-006`), REQ-ORG-007.
 *
 * Shape only. The grammar — which tokens exist, the single trailing sequence,
 * the literal character class, the worst-case length — is checked by
 * `domain/inventoryCodeFormat.js validateFormat`, which is also what the
 * generation path uses. Restating any of it here would create a second
 * definition to keep in step, and `BR-026` requires the registry to be the one
 * authority.
 *
 * `null` is meaningful and distinct from omitted: it CLEARS the configuration,
 * returning the institution to the application default. `.strict()` makes an
 * omitted `format` an explicit error rather than a silent no-op.
 */
const inventoryCodeFormat = z
  .object({
    format: z
      .string()
      .trim()
      .min(1, 'is required')
      .max(MAX_FORMAT_LENGTH)
      .nullable(),
  })
  .strict();

module.exports = {
  createInstitution,
  updateInstitution,
  listInstitutions,
  institutionParams,
  inventoryCodeFormat,
};
