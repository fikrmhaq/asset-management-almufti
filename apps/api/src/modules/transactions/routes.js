'use strict';

/**
 * Transaction endpoints — `06-api.md` §7.3.
 *
 * Create and read only. No PATCH and no DELETE exist here: REQ-TXN-007 requires
 * transaction records never to be silently modified, and the surest way to
 * guarantee that is to expose no way to do it.
 */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function transactionsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('transaction:read'),
    validate({ query: schemas.listTransactions }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('transaction:create'),
    validate({ body: schemas.createTransaction }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('transaction:read'),
    validate({ params: schemas.transactionParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.get(
    '/:id/items',
    requirePermission('transaction:read'),
    validate({ params: schemas.transactionParams, query: listQuerySchema({}) }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.items(req.params.id, req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  return router;
}

module.exports = { transactionsRouter };
