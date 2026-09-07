'use strict';

/** Contract item endpoints — `06-api.md` §6.3. */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList, sendNoContent } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function contractItemsRouter() {
  const router = Router();

  router.get(
    '/:id',
    requirePermission('contract-item:read'),
    validate({ params: schemas.contractItemParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('contract-item:update'),
    validate({ params: schemas.contractItemParams, body: schemas.updateContractItem }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  router.delete(
    '/:id',
    requirePermission('contract-item:delete'),
    validate({ params: schemas.contractItemParams }),
    asyncHandler(async (req, res) => {
      await service.remove(req.params.id, req.principal);
      sendNoContent(res);
    })
  );

  // Asset units are the resource being read (§1.3).
  router.get(
    '/:id/asset-units',
    requirePermission('asset-unit:read'),
    validate({ params: schemas.contractItemParams, query: listQuerySchema({}) }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.assetUnits(
        req.params.id,
        req.query,
        req.principal
      );
      sendList(res, rows, pagination);
    })
  );

  // Creates an Asset AND its units in one call, so it demands both permissions.
  // Holding only one of them authorizes half the operation, which is not a
  // meaningful half — the guards are chained rather than reduced to one code.
  router.post(
    '/:id/assets',
    requirePermission('asset:create'),
    requirePermission('asset-unit:create'),
    validate({ params: schemas.contractItemParams, body: schemas.createAssetFromItem }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.createAsset(req.params.id, req.body, req.principal));
    })
  );

  return router;
}

module.exports = { contractItemsRouter };
