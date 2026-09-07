'use strict';

/** Contract endpoints — `06-api.md` §6.2. */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const itemService = require('../contractItems/service');
const itemSchemas = require('../contractItems/schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function contractsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('contract:read'),
    validate({ query: schemas.listContracts }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('contract:create'),
    validate({ body: schemas.createContract }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('contract:read'),
    validate({ params: schemas.contractParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('contract:update'),
    validate({ params: schemas.contractParams, body: schemas.updateContract }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/deactivate',
    requirePermission('contract:deactivate'),
    validate({ params: schemas.contractParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('contract:deactivate'),
    validate({ params: schemas.contractParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id, req.principal));
    })
  );

  // --- Line items -----------------------------------------------------------
  // The contract item is the resource being acted on, so these are guarded by
  // `contract-item:*` rather than `contract:*` (§1.3).

  router.get(
    '/:id/items',
    requirePermission('contract-item:read'),
    validate({ params: schemas.contractParams, query: itemSchemas.listContractItems }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await itemService.listForContract(
        req.params.id,
        req.query,
        req.principal
      );
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/:id/items',
    requirePermission('contract-item:create'),
    validate({ params: schemas.contractParams, body: itemSchemas.createContractItem }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await itemService.createForContract(req.params.id, req.body, req.principal));
    })
  );

  return router;
}

module.exports = { contractsRouter };
