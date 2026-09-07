'use strict';

/** Vendor endpoints — `06-api.md` §7.1. */

const { Router } = require('express');
const { z } = require('zod');

const service = require('./service');
const schemas = require('./schemas');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

/** The sub-list is an asset list, so it takes the asset list's own filters. */
const listVendorAssets = listQuerySchema({
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),
});

function vendorsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('vendor:read'),
    validate({ query: schemas.listVendors }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('vendor:create'),
    validate({ body: schemas.createVendor }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body));
    })
  );

  router.get(
    '/:id',
    requirePermission('vendor:read'),
    validate({ params: schemas.vendorParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id));
    })
  );

  router.patch(
    '/:id',
    requirePermission('vendor:update'),
    validate({ params: schemas.vendorParams, body: schemas.updateVendor }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body));
    })
  );

  router.post(
    '/:id/deactivate',
    requirePermission('vendor:deactivate'),
    validate({ params: schemas.vendorParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('vendor:deactivate'),
    validate({ params: schemas.vendorParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id));
    })
  );

  // Assets are the resource being read, so the guard is `asset:read`, not
  // `vendor:read` (§1.3).
  router.get(
    '/:id/assets',
    requirePermission('asset:read'),
    validate({ params: schemas.vendorParams, query: listVendorAssets }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.assets(req.params.id, req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  return router;
}

module.exports = { vendorsRouter };
