'use strict';

/** Attribute definition endpoints — `06-api.md` §4.3. */

const { Router } = require('express');
const { z } = require('zod');

const service = require('./service');
const { ATTRIBUTE_TYPES, ATTRIBUTE_SCOPES } = require('../../db/enums');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

const definitionFields = {
  classificationId: z.string().trim().length(12, 'must be a 12-character code'),
  name: z.string().trim().min(1, 'is required').max(100),
  attributeType: z.enum(ATTRIBUTE_TYPES),
  scope: z.enum(ATTRIBUTE_SCOPES),
  isRequired: z.boolean(),
  usesMeasurementUnit: z.boolean(),
  measurementUnitId: z.string().uuid('must be a UUID').nullish(),
  description: z.string().trim().max(2000).nullish(),
  sortOrder: z.number().int().min(0),
};

const createDefinition = z
  .object({
    ...definitionFields,
    attributeType: definitionFields.attributeType.default('TEXT'),
    scope: definitionFields.scope.default('ASSET'),
    isRequired: definitionFields.isRequired.default(false),
    usesMeasurementUnit: definitionFields.usesMeasurementUnit.default(false),
    sortOrder: definitionFields.sortOrder.default(0),
  })
  .strict();

/**
 * `classificationId` and `scope` are not updatable. Both decide which values are
 * valid, and changing either would silently invalidate every value already
 * stored against the definition (BR-009, BR-010).
 */
const updateDefinition = z
  .object({
    name: definitionFields.name,
    attributeType: definitionFields.attributeType,
    isRequired: definitionFields.isRequired,
    usesMeasurementUnit: definitionFields.usesMeasurementUnit,
    measurementUnitId: z.string().uuid('must be a UUID').nullable(),
    description: z.string().trim().max(2000).nullable(),
    sortOrder: definitionFields.sortOrder,
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const listDefinitions = listQuerySchema({
  classificationId: z.string().trim().length(12).optional(),
  scope: z.enum(ATTRIBUTE_SCOPES).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),
});

const idParams = z.object({ id: z.string().uuid('must be a UUID') });

function attributeDefinitionsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('attribute-definition:read'),
    validate({ query: listDefinitions }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('attribute-definition:create'),
    validate({ body: createDefinition }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body));
    })
  );

  router.get(
    '/:id',
    requirePermission('attribute-definition:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id));
    })
  );

  router.patch(
    '/:id',
    requirePermission('attribute-definition:update'),
    validate({ params: idParams, body: updateDefinition }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body));
    })
  );

  router.post(
    '/:id/deactivate',
    requirePermission('attribute-definition:deactivate'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('attribute-definition:deactivate'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id));
    })
  );

  return router;
}

module.exports = { attributeDefinitionsRouter };
