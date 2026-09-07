'use strict';

/** Institution endpoints — `06-api.md` §3.1. */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function institutionsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('institution:read'),
    validate({ query: schemas.listInstitutions }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('institution:create'),
    validate({ body: schemas.createInstitution }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body));
    })
  );

  router.get(
    '/:id',
    requirePermission('institution:read'),
    validate({ params: schemas.institutionParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id));
    })
  );

  router.patch(
    '/:id',
    requirePermission('institution:update'),
    validate({ params: schemas.institutionParams, body: schemas.updateInstitution }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body));
    })
  );

  /**
   * The inventory code format — Phase 25 (`CR-006`), REQ-ORG-007.
   *
   * `inventory-code-format:*`, NOT `institution:update`. That is the whole
   * point: `institution:*` is system-wide-only (`BR-015`), so an institution
   * administrator could never hold it, and designing your own institution's
   * inventory codes is exactly the kind of act that IS meaningful scoped to one.
   * Splitting the sub-resource follows `user-role`, `role-permission` and
   * `department-pic`.
   *
   * Cross-institution access is refused inside the service by the ordinary
   * scope check, not by anything special here — `404`, indistinguishable from an
   * institution that does not exist (§1.4).
   */
  router.get(
    '/:id/inventory-code-format',
    requirePermission('inventory-code-format:read'),
    validate({ params: schemas.institutionParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.getFormat(req.params.id, req.principal));
    })
  );

  // PUT, not PATCH: the format is one value, stated whole. `{ format: null }`
  // clears it and returns the institution to the application default.
  router.put(
    '/:id/inventory-code-format',
    requirePermission('inventory-code-format:update'),
    validate({ params: schemas.institutionParams, body: schemas.inventoryCodeFormat }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.setFormat(req.params.id, req.body, req.principal));
    })
  );

  // Status is a guarded transition, not a plain field edit (§1.7), which is why
  // it has its own endpoint and its own permission.
  router.post(
    '/:id/deactivate',
    requirePermission('institution:deactivate'),
    validate({ params: schemas.institutionParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('institution:deactivate'),
    validate({ params: schemas.institutionParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id));
    })
  );

  return router;
}

module.exports = { institutionsRouter };
