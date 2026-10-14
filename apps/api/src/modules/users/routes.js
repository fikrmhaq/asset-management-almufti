'use strict';

/** User endpoints — `06-api.md` §3.3. */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { userPositionRoutes } = require('../positionAssignments/routes');

function usersRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('user:read'),
    validate({ query: schemas.listUsers }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('user:create'),
    validate({ body: schemas.createUser }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('user:read'),
    validate({ params: schemas.userParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('user:update'),
    validate({ params: schemas.userParams, body: schemas.updateUser }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/deactivate',
    requirePermission('user:deactivate'),
    validate({ params: schemas.userParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('user:deactivate'),
    validate({ params: schemas.userParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id, req.principal));
    })
  );

  // Role assignment. The entity acted on is the User<->Role assignment
  // (03-domain.md §4.5), so the permission is `user-role:*` rather than `user:*`
  // — granting someone the ability to edit a profile is not the same as letting
  // them grant themselves a role.
  router.get(
    '/:id/roles',
    requirePermission('user-role:read'),
    validate({ params: schemas.userParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.listRoles(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/roles',
    requirePermission('user-role:create'),
    validate({ params: schemas.userParams, body: schemas.assignRole }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.addRole(req.params.id, req.body.roleId, req.principal));
    })
  );

  router.delete(
    '/:id/roles/:roleId',
    requirePermission('user-role:delete'),
    validate({ params: schemas.userRoleParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.removeRole(req.params.id, req.params.roleId, req.principal));
    })
  );

  // School positions — Phase 35 (`CR-014`), `06-api.md` §12.1.
  userPositionRoutes(router);

  return router;
}

module.exports = { usersRouter };
