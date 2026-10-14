'use strict';

/**
 * Inventory-code preview — P4 (`IMPLEMENTATION_PLAN.md` §64.4), `06-api.md` §5.2.
 *
 * A `POST` because it carries a list, not because it writes: nothing is stored,
 * locked or reserved (see `service.js`).
 */

const { Router } = require('express');
const { z } = require('zod');

const service = require('./service');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

const uuid = z.string().uuid('must be a UUID');

/**
 * The inputs of a registration, minus everything that does not reach the code.
 * Either an existing asset, or the classification (and institution) of the one
 * a registration would create.
 *
 * `unitNumbers` may hold empty strings — an empty field is a status the screen
 * shows (`EMPTY`), not a malformed request. Longer values than any format allows
 * are still accepted here so the preview can say why (`INVALID`) rather than
 * answer `400`; registration's own bound is 32.
 */
const previewBody = z
  .object({
    assetId: uuid.optional(),
    institutionId: uuid.optional(),
    classificationId: z.string().trim().length(12, 'must be a 12-character code').optional(),
    contractItemId: uuid.optional(),
    departmentId: uuid.nullish(),
    fundingSourceId: z.number().int().positive().nullish(),
    unitNumbers: z.array(z.string().max(64)).max(500).default([]),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (Boolean(body.assetId) === Boolean(body.classificationId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assetId'],
        message: 'give either an existing asset or the classification of a new one',
      });
    }
  });

function inventoryCodesRouter() {
  const router = Router();

  // Everyone who can register a unit — directly, or through a request — holds
  // `asset-unit:create`; nobody else has a code to preview.
  router.post(
    '/preview',
    requirePermission('asset-unit:create'),
    validate({ body: previewBody }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.preview(req.body, req.principal));
    })
  );

  return router;
}

module.exports = { inventoryCodesRouter };
