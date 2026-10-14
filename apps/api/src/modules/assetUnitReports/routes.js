'use strict';

/**
 * Unit reports — REQ-REQUEST-025 (`IMPLEMENTATION_PLAN.md` §72).
 *
 * `asset-unit-report:create` — the reporter's side: their rooms' units, the
 * destinations a move may name, filing a report, their own reports.
 * `asset-unit-report:review` — the reviewer's side: the queue, confirm, reject.
 * Which unit a reporter may report on, and which report a reviewer may see, is
 * decided in the service; out of scope is `404`.
 */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList, sendCollection } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');

function assetUnitReportsRouter() {
  const router = Router();

  router.get(
    '/my-units',
    requirePermission('asset-unit-report:create'),
    asyncHandler(async (req, res) => {
      sendCollection(res, await service.myUnits(req.principal));
    })
  );

  router.get(
    '/destinations',
    requirePermission('asset-unit-report:create'),
    asyncHandler(async (req, res) => {
      sendCollection(res, await service.destinations(req.principal));
    })
  );

  router.get(
    '/',
    requireAnyPermission('asset-unit-report:create', 'asset-unit-report:review'),
    validate({ query: schemas.listReports }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('asset-unit-report:create'),
    validate({ body: schemas.createReport }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requireAnyPermission('asset-unit-report:create', 'asset-unit-report:review'),
    validate({ params: schemas.reportParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/confirm',
    requirePermission('asset-unit-report:review'),
    validate({ params: schemas.reportParams, body: schemas.confirmReport }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.confirm(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/reject',
    requirePermission('asset-unit-report:review'),
    validate({ params: schemas.reportParams, body: schemas.rejectReport }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reject(req.params.id, req.body, req.principal));
    })
  );

  return router;
}

module.exports = { assetUnitReportsRouter };
