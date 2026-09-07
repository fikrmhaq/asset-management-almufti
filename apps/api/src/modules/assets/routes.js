'use strict';

/** Asset endpoints — `06-api.md` §5.1. */

const { Router } = require('express');
const { z } = require('zod');

const service = require('./service');
const unitService = require('../assetUnits/service');
const attributeValueService = require('../attributeValues/service');
const attachmentService = require('../attachments/service');
const { CONDITIONS, LIFECYCLE_STATES } = require('../../db/enums');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList, sendCollection } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { singleUpload, requireFile } = require('../../middleware/upload');

const classificationId = z.string().trim().length(12, 'must be a 12-character code');
const uuid = z.string().uuid('must be a UUID');

const createAsset = z
  .object({
    name: z.string().trim().min(1, 'is required').max(255),
    classificationId,
    vendorId: uuid.nullish(),
    contractId: uuid.nullish(),
    institutionId: uuid.nullish(),
    description: z.string().trim().max(5000).nullish(),
  })
  .strict();

const updateAsset = z
  .object({
    name: z.string().trim().min(1).max(255),
    classificationId,
    vendorId: uuid.nullable(),
    contractId: uuid.nullable(),
    institutionId: uuid.nullable(),
    description: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

/** Filters from `06-api.md` §5.1 / REQ-ASSET-009. */
const listAssets = listQuerySchema({
  q: z.string().trim().min(1).optional(),
  classificationId: classificationId.optional(),
  institutionId: uuid.optional(),
  departmentId: uuid.optional(),
  vendorId: uuid.optional(),
  contractId: uuid.optional(),
  locationId: uuid.optional(),
  condition: z.enum(CONDITIONS).optional(),
  lifecycleState: z.enum(LIFECYCLE_STATES).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const idParams = z.object({ id: uuid });

/**
 * A manually supplied inventory code component — `CR-007`.
 *
 * Bounded by the column rather than by the token's budget: the budget depends on
 * the institution's format, so `buildPrefix` enforces it where that format is in
 * hand and can say how much room it actually leaves.
 */
const numberComposition = z.string().trim().min(1, 'is required').max(32);

/**
 * `numberComposition` is accepted here but not required here — `CR-007`.
 *
 * Whether it is required, and how long it may be, depends on the owning
 * institution's configured format, which this schema cannot see. So the shape is
 * checked here and the service decides: required when the format uses the token,
 * refused when it does not. `06-api.md` §5.2.
 */
const createUnit = z
  .object({
    description: z.string().trim().max(5000).nullish(),
    contractItemId: uuid.nullish(),
    departmentId: uuid.nullish(),
    numberComposition: numberComposition.nullish(),
  })
  .strict();

const listUnits = listQuerySchema({
  status: z.enum(['active', 'inactive']).optional(),
  departmentId: uuid.optional(),
  lifecycleState: z.enum(LIFECYCLE_STATES).optional(),
  condition: z.enum(CONDITIONS).optional(),
  locationId: uuid.optional(),
});

/** `values` maps attribute definition id to the submitted value. */
const replaceAttributeValues = z
  .object({ values: z.record(z.string().uuid(), z.unknown()) })
  .strict();

const uploadAttachment = z.object({ assetUnitId: uuid.optional() }).strict();

function assetsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('asset:read'),
    validate({ query: listAssets }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('asset:create'),
    validate({ body: createAsset }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('asset:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('asset:update'),
    validate({ params: idParams, body: updateAsset }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/deactivate',
    requirePermission('asset:deactivate'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('asset:deactivate'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id, req.principal));
    })
  );

  // --- Units ----------------------------------------------------------------

  router.get(
    '/:id/units',
    requirePermission('asset-unit:read'),
    validate({ params: idParams, query: listUnits }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await unitService.listForAsset(
        req.params.id,
        req.query,
        req.principal
      );
      sendList(res, rows, pagination);
    })
  );

  // Before `POST /:id/units` only for readability; the methods differ so order
  // does not matter here the way it does for `by-code`.
  router.get(
    '/:id/units/labels',
    requirePermission('asset-unit:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      // A complete collection (`06-api.md` §1.5): the caller is printing a
      // sheet, and a sheet missing page two is not a smaller sheet.
      sendCollection(res, await unitService.labelsForAsset(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/units',
    requirePermission('asset-unit:create'),
    validate({ params: idParams, body: createUnit }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await unitService.create(req.params.id, req.body, req.principal));
    })
  );

  // --- Attribute values -----------------------------------------------------

  router.get(
    '/:id/attribute-values',
    requirePermission('asset-attribute-value:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await attributeValueService.list('asset', req.params.id, req.principal));
    })
  );

  router.put(
    '/:id/attribute-values',
    requirePermission('asset-attribute-value:update'),
    validate({ params: idParams, body: replaceAttributeValues }),
    asyncHandler(async (req, res) => {
      sendItem(
        res,
        await attributeValueService.replace('asset', req.params.id, req.body.values, req.principal)
      );
    })
  );

  // --- Attachments ----------------------------------------------------------

  router.get(
    '/:id/attachments',
    requirePermission('attachment:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await attachmentService.listForAsset(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/attachments',
    requirePermission('attachment:create'),
    validate({ params: idParams }),
    singleUpload(),
    requireFile(),
    validate({ body: uploadAttachment }),
    asyncHandler(async (req, res) => {
      sendCreated(
        res,
        await attachmentService.create(req.params.id, req.file, req.body, req.principal)
      );
    })
  );

  return router;
}

module.exports = { assetsRouter };
