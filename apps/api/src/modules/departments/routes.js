'use strict';

/**
 * Department endpoints — `06-api.md` §3.2.
 *
 * `:id` is a UUID since Phase 20 (`CR-003`); `code` is an institution-local
 * label carried in the body. Every handler passes `req.principal` — these
 * endpoints were unscoped until the table had an `institution_id` to scope by.
 */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList, sendCollection } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { departmentPositionRoutes } = require('../positionAssignments/routes');

function departmentsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('department:read'),
    validate({ query: schemas.listDepartments }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('department:create'),
    validate({ body: schemas.createDepartment }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('department:read'),
    validate({ params: schemas.departmentParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('department:update'),
    validate({ params: schemas.departmentParams, body: schemas.updateDepartment }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/deactivate',
    requirePermission('department:deactivate'),
    validate({ params: schemas.departmentParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('department:deactivate'),
    validate({ params: schemas.departmentParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id, req.principal));
    })
  );

  // --- Person in charge — Phase 21 (`CR-003`), REQ-ORG-006 -------------------

  /**
   * Guarded by `department-pic:*`, NOT by `department:update`. Renaming a
   * department and deciding who is responsible for it are different authorities,
   * and Phase 22 will make the second one determine what its holder may touch.
   */
  router.get(
    '/:id/pic-assignments',
    requirePermission('department-pic:read'),
    validate({ params: schemas.departmentParams }),
    asyncHandler(async (req, res) => {
      // A complete collection (§1.5): a succession list is read whole.
      sendCollection(res, await service.picHistory(req.params.id, req.principal));
    })
  );

  router.put(
    '/:id/pic',
    requirePermission('department-pic:create'),
    validate({ params: schemas.departmentParams, body: schemas.setPic }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.setPic(req.params.id, req.body.userId, req.principal));
    })
  );

  router.delete(
    '/:id/pic',
    requirePermission('department-pic:delete'),
    validate({ params: schemas.departmentParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.clearPic(req.params.id, req.principal));
    })
  );

  // School positions held for this department — Phase 35 (`CR-014`). A separate
  // concept from the person in charge above; never merged with it (`BR-028`).
  departmentPositionRoutes(router);

  return router;
}

module.exports = { departmentsRouter };
