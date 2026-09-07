'use strict';

/**
 * Audit endpoints — `06-api.md` §10, `IMPLEMENTATION_PLAN.md` §21.0.
 *
 * Two `GET`s and nothing else. No `POST`, no `PATCH`, no `DELETE` is mounted
 * here, and none may be added: REQ-AUDIT-003 requires audit records not to be
 * editable, and the surest guarantee is that no route exists to do it with.
 * Phase 8 writes the trail through model hooks; this reads it.
 *
 * `06-api.md` §10 also notes that asset-level history (REQ-AUDIT-004) is served
 * by `GET /asset-units/:id/history` from Phase 5 and is deliberately NOT
 * duplicated here.
 */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendList } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function auditLogsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('audit-log:read'),
    validate({ query: schemas.listAuditLogs }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query);
      sendList(res, rows, pagination);
    })
  );

  router.get(
    '/:id',
    requirePermission('audit-log:read'),
    validate({ params: schemas.auditLogParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id));
    })
  );

  return router;
}

module.exports = { auditLogsRouter };
