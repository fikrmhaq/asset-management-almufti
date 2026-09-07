'use strict';

/**
 * Classification endpoints — `06-api.md` §4.1.
 *
 * Reads are open to anyone holding `classification:read`. Writes exist only for
 * application-defined nodes (`origin = 3`); the service refuses anything else
 * (`BR-016`), so the permission gate here answers "may this user manage
 * classifications at all", not "may this row be touched".
 */

const { Router } = require('express');
const { z } = require('zod');

const service = require('./service');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendList, sendCollection, sendCreated, sendNoContent } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

const classificationId = z.string().trim().length(12, 'must be a 12-character code');

/**
 * The two scoping parameters (`06-api.md` §4.1). `institutionId` chooses whose
 * private nodes are in view; `owner` narrows within that view. They are accepted
 * on every read so the picker and the management screen share one endpoint.
 */
const scopeQuery = {
  institutionId: z.string().uuid('must be a UUID').optional(),
  owner: z.enum(['global', 'mine', 'all']).optional(),
};

const listQuery = listQuerySchema({
  q: z.string().trim().min(1).optional(),
  categoryId: z.string().uuid('must be a UUID').optional(),
  parentId: classificationId.optional(),
  ...scopeQuery,
});

const idParams = z.object({ id: classificationId });
const scopeOnlyQuery = z.object(scopeQuery);
const leafQuery = z.object({ q: z.string().trim().min(1, 'is required'), ...scopeQuery });

const name = z.string().trim().min(1, 'is required').max(255);

const createBody = z.object({
  parentId: classificationId,
  name,
  // `null` means global and `undefined` means "my institution", so the field is
  // nullable-optional rather than optional. The service tells them apart.
  institutionId: z.string().uuid('must be a UUID').nullable().optional(),
});

const renameBody = z.object({ name });

function classificationsRouter() {
  const router = Router();

  // Declared before `/:id` so "leaf" is not captured as an id.
  router.get(
    '/leaf',
    requirePermission('classification:read'),
    validate({ query: leafQuery }),
    asyncHandler(async (req, res) => {
      const { q, ...scope } = req.query;
      sendItem(res, await service.searchLeaves(q, req.principal, scope));
    })
  );

  router.get(
    '/',
    requirePermission('classification:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('classification:create'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('classification:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('classification:update'),
    validate({ params: idParams, body: renameBody }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.rename(req.params.id, req.body, req.principal));
    })
  );

  router.delete(
    '/:id',
    requirePermission('classification:delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await service.remove(req.params.id, req.principal);
      sendNoContent(res);
    })
  );

  router.post(
    '/:id/promote',
    requirePermission('classification:promote'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.promote(req.params.id, req.principal));
    })
  );

  router.get(
    '/:id/children',
    requirePermission('classification:read'),
    validate({ params: idParams, query: scopeOnlyQuery }),
    asyncHandler(async (req, res) => {
      // A collection, in the collection envelope — the same shape the location
      // drill-down answers in, so one client helper reads both.
      sendCollection(res, await service.children(req.params.id, req.principal, req.query));
    })
  );

  router.get(
    '/:id/path',
    requirePermission('classification:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.ancestorPath(req.params.id));
    })
  );

  router.get(
    '/:id/attribute-definitions',
    requirePermission('attribute-definition:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.attributeDefinitions(req.params.id, req.principal));
    })
  );

  return router;
}

module.exports = { classificationsRouter };
