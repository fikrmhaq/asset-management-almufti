'use strict';

/**
 * Borrowing endpoints — `06-api.md` §7.2.
 *
 * Every status change is its own action endpoint with its own permission:
 * authorizing "may create a borrowing" is not the same as "may return one"
 * (§1.3).
 */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList, sendNoContent } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function borrowingsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('borrowing:read'),
    validate({ query: schemas.listBorrowings }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('borrowing:create'),
    validate({ body: schemas.createBorrowing }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('borrowing:read'),
    validate({ params: schemas.borrowingParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('borrowing:update'),
    validate({ params: schemas.borrowingParams, body: schemas.updateBorrowing }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  // --- Items ----------------------------------------------------------------

  router.get(
    '/:id/items',
    requirePermission('borrowing-item:read'),
    validate({ params: schemas.borrowingParams, query: listQuerySchema({}) }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.items(req.params.id, req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/:id/items',
    requirePermission('borrowing-item:create'),
    validate({ params: schemas.borrowingParams, body: schemas.addItem }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.addItem(req.params.id, req.body, req.principal));
    })
  );

  router.delete(
    '/:id/items/:itemId',
    requirePermission('borrowing-item:delete'),
    validate({ params: schemas.borrowingItemParams }),
    asyncHandler(async (req, res) => {
      await service.removeItem(req.params.id, req.params.itemId, req.principal);
      sendNoContent(res);
    })
  );

  // --- State transitions ----------------------------------------------------

  router.post(
    '/:id/activate',
    requirePermission('borrowing:activate'),
    validate({ params: schemas.borrowingParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.activate(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/cancel',
    requirePermission('borrowing:cancel'),
    validate({ params: schemas.borrowingParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.cancel(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/return',
    requirePermission('borrowing:return'),
    validate({ params: schemas.borrowingParams, body: schemas.returnBorrowing }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.returnBorrowing(req.params.id, req.body, req.principal));
    })
  );

  // Returns the current record AND opens a new DRAFT over the same units
  // (REQ-BORROW-014), so the response carries both.
  router.post(
    '/:id/extend',
    requirePermission('borrowing:extend'),
    validate({ params: schemas.borrowingParams, body: schemas.extendBorrowing }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.extend(req.params.id, req.body, req.principal));
    })
  );

  return router;
}

module.exports = { borrowingsRouter };
