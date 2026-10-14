'use strict';

/**
 * Workflow definition endpoints — `06-api.md` §12.2, Phase 36 (`CR-014`).
 *
 * Guarded by `workflow-definition:*`, none of which is in the `CR-004` PIC
 * ceiling. The rules are in `domain/workflowDefinitions.js`.
 *
 * `PATCH /workflow-definitions/:id` is deliberately NOT mounted: a definition
 * has no editable header field — its key is what it is for — so a DRAFT is
 * edited only through its steps (Phase 36 decision, `IMPLEMENTATION_PLAN.md`
 * §55).
 */

const { Router } = require('express');

const service = require('../../domain/workflowDefinitions');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList, sendCollection } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

function workflowDefinitionsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('workflow-definition:read'),
    validate({ query: schemas.listDefinitions }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  // Before `/:id`, which would otherwise take "templates" as an id.
  router.get(
    '/templates',
    requirePermission('workflow-definition:read'),
    asyncHandler(async (req, res) => {
      sendCollection(res, service.listTemplates());
    })
  );

  // Before `/:id` too. P2 (§64.2): the categories each position may request.
  router.get(
    '/eligibility',
    requirePermission('workflow-definition:read'),
    asyncHandler(async (req, res) => {
      sendItem(res, service.eligibility());
    })
  );

  router.post(
    '/',
    requirePermission('workflow-definition:create'),
    validate({ body: schemas.createDefinition }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('workflow-definition:read'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.put(
    '/:id/steps',
    requirePermission('workflow-definition:update'),
    validate({ params: schemas.idParams, body: schemas.replaceSteps }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.replaceSteps(req.params.id, req.body.steps, req.principal));
    })
  );

  router.post(
    '/:id/publish',
    requirePermission('workflow-definition:publish'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.publish(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/versions',
    requirePermission('workflow-definition:create'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.createVersion(req.params.id, req.principal));
    })
  );

  return router;
}

module.exports = { workflowDefinitionsRouter };
