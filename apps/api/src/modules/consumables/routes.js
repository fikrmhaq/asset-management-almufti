'use strict';

/**
 * Consumables — `IMPLEMENTATION_PLAN.md` §73. Quantity-based stock, not Assets.
 *
 * The master (`consumable:read / create / update / deactivate`), its stock
 * (`consumable:manage-stock`: receive, adjust) and its history. Issuing happens
 * only against an approved request line: `POST /requests/:id/issue`.
 */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList, sendCollection } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function consumablesRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('consumable:read'),
    validate({ query: schemas.listConsumables }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  // Before `/:id`: what a requester may name on a request line — no stock.
  router.get(
    '/options',
    requirePermission('request:create'),
    validate({ query: schemas.optionsQuery }),
    asyncHandler(async (req, res) => {
      sendCollection(res, await service.options(req.query, req.principal));
    })
  );

  router.post(
    '/',
    requirePermission('consumable:create'),
    validate({ body: schemas.createConsumable }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('consumable:read'),
    validate({ params: schemas.consumableParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('consumable:update'),
    validate({ params: schemas.consumableParams, body: schemas.updateConsumable }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/deactivate',
    requirePermission('consumable:deactivate'),
    validate({ params: schemas.consumableParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('consumable:deactivate'),
    validate({ params: schemas.consumableParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id, req.principal));
    })
  );

  router.get(
    '/:id/movements',
    requirePermission('consumable:read'),
    validate({ params: schemas.consumableParams, query: schemas.listMovements }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.movements(req.params.id, req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/:id/receipts',
    requirePermission('consumable:manage-stock'),
    validate({ params: schemas.consumableParams, body: schemas.receiveStock }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.receive(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/adjustments',
    requirePermission('consumable:manage-stock'),
    validate({ params: schemas.consumableParams, body: schemas.adjustStock }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.adjust(req.params.id, req.body, req.principal));
    })
  );

  return router;
}

module.exports = { consumablesRouter };
