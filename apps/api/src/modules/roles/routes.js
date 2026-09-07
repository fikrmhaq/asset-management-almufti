'use strict';

/** Role endpoints — `06-api.md` §3.4. */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList, sendNoContent } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function rolesRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('role:read'),
    validate({ query: schemas.listRoles }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('role:create'),
    validate({ body: schemas.createRole }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('role:read'),
    validate({ params: schemas.roleParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id));
    })
  );

  router.patch(
    '/:id',
    requirePermission('role:update'),
    validate({ params: schemas.roleParams, body: schemas.updateRole }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  // Hard delete: ref.roles has no is_active column (§3.4).
  router.delete(
    '/:id',
    requirePermission('role:delete'),
    validate({ params: schemas.roleParams }),
    asyncHandler(async (req, res) => {
      await service.remove(req.params.id);
      sendNoContent(res);
    })
  );

  router.get(
    '/:id/permissions',
    requirePermission('role-permission:read'),
    validate({ params: schemas.roleParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.listPermissions(req.params.id));
    })
  );

  router.put(
    '/:id/permissions',
    requirePermission('role-permission:update'),
    validate({ params: schemas.roleParams, body: schemas.replacePermissions }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.replacePermissions(req.params.id, req.body.permissionCodes));
    })
  );

  return router;
}

module.exports = { rolesRouter };
