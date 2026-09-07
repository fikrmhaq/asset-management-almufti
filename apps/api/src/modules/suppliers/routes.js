'use strict';

/** Supplier endpoints — `06-api.md` §6.1. */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function suppliersRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('supplier:read'),
    validate({ query: schemas.listSuppliers }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('supplier:create'),
    validate({ body: schemas.createSupplier }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body));
    })
  );

  router.get(
    '/:id',
    requirePermission('supplier:read'),
    validate({ params: schemas.supplierParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id));
    })
  );

  router.patch(
    '/:id',
    requirePermission('supplier:update'),
    validate({ params: schemas.supplierParams, body: schemas.updateSupplier }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body));
    })
  );

  // Status is a guarded transition, not a plain field edit (§1.7).
  router.post(
    '/:id/deactivate',
    requirePermission('supplier:deactivate'),
    validate({ params: schemas.supplierParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('supplier:deactivate'),
    validate({ params: schemas.supplierParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id));
    })
  );

  return router;
}

module.exports = { suppliersRouter };
