'use strict';

/**
 * School position endpoints — `06-api.md` §12.1, Phase 35 (`CR-014`).
 *
 * Guarded by `school-position:*` and `position-assignment:*`, never by `user:*`
 * or `department-pic:*`: deciding who holds a school post is its own authority
 * (`BR-028`). None of these codes is in the `CR-004` PIC ceiling.
 *
 * The user- and department-scoped paths are mounted by `usersRouter` and
 * `departmentsRouter` through `userPositionRoutes` / `departmentPositionRoutes`,
 * so each URL lives under the resource it names.
 */

const { Router } = require('express');

const service = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendCollection } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

/** `GET /school-positions` — the fixed list, like `/reference/conditions`. */
function schoolPositionsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('school-position:read'),
    asyncHandler(async (req, res) => {
      sendCollection(res, service.listPositions());
    })
  );

  return router;
}

/** `POST /position-assignments/:id/end`. */
function positionAssignmentsRouter() {
  const router = Router();

  router.post(
    '/:id/end',
    requirePermission('position-assignment:end'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.end(req.params.id, req.principal));
    })
  );

  return router;
}

/** Adds `/:id/position-assignments` to the users router. */
function userPositionRoutes(router) {
  router.get(
    '/:id/position-assignments',
    requirePermission('position-assignment:read'),
    validate({ params: schemas.idParams, query: schemas.listAssignments }),
    asyncHandler(async (req, res) => {
      sendCollection(res, await service.listForUser(req.params.id, req.query, req.principal));
    })
  );

  router.post(
    '/:id/position-assignments',
    requirePermission('position-assignment:create'),
    validate({ params: schemas.idParams, body: schemas.assignPosition }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.assignToUser(req.params.id, req.body, req.principal));
    })
  );
}

/** Adds `/:id/position-assignments` to the departments router. */
function departmentPositionRoutes(router) {
  router.get(
    '/:id/position-assignments',
    requirePermission('position-assignment:read'),
    validate({ params: schemas.idParams, query: schemas.listAssignments }),
    asyncHandler(async (req, res) => {
      sendCollection(res, await service.listForDepartment(req.params.id, req.query, req.principal));
    })
  );
}

module.exports = {
  schoolPositionsRouter,
  positionAssignmentsRouter,
  userPositionRoutes,
  departmentPositionRoutes,
};
