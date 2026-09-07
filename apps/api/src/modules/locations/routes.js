'use strict';

/** Location and floor plan endpoints — `06-api.md` §5.3. */

const { Router } = require('express');
const { z } = require('zod');

const service = require('./service');
const floorPlanService = require('../floorPlans/service');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const {
  sendItem,
  sendCreated,
  sendList,
  sendCollection,
  sendNoContent,
} = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { hasPermission } = require('../../auth/principal');
const { singleUpload, requireFile } = require('../../middleware/upload');

const uuid = z.string().uuid('must be a UUID');
const classificationId = z.string().trim().length(12, 'must be a 12-character code');
const idParams = z.object({ id: uuid });
const areaParams = z.object({ id: uuid, areaId: uuid });

const createLocation = z
  .object({
    name: z.string().trim().min(1, 'is required').max(255),
    classificationId,
    parentLocationId: uuid.nullish(),
    institutionId: uuid.nullish(),
  })
  .strict();

const updateLocation = z
  .object({
    name: z.string().trim().min(1).max(255),
    classificationId,
    parentLocationId: uuid.nullable(),
    institutionId: uuid.nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * A boolean query param.
 *
 * NOT `z.coerce.boolean()`: that is `Boolean(value)`, and `Boolean('false')` is
 * `true`, so `?rootsOnly=false` would mean the opposite of what it says. Only
 * the two literal spellings are accepted, and anything else is a 400 rather
 * than a silent guess.
 */
const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const listLocations = listQuerySchema({
  institutionId: uuid.optional(),
  parentLocationId: uuid.optional(),
  /**
   * The top of the hierarchy — locations with no parent (REQ-LOC-007).
   *
   * Needed because the hierarchy has no fixed depth and therefore no fixed
   * entry point: a client drilling down has to start somewhere, and without
   * this it can only guess by fetching a page of everything and filtering
   * client-side, which silently misses roots beyond the page cap.
   */
  rootsOnly: booleanFlag,
  /** Everything beneath a location, at any depth — REQ-LOC-007, REQ-LOC-012. */
  descendantsOf: uuid.optional(),
  classificationId: classificationId.optional(),
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),
}).refine((query) => !(query.rootsOnly && query.parentLocationId), {
  // Filters AND together (`06-api.md` §1.6), so this pair can only ever match
  // nothing. Saying so beats returning an empty page and leaving the caller to
  // work out which of their two filters was wrong.
  message: 'rootsOnly cannot be combined with parentLocationId',
  path: ['rootsOnly'],
});

/**
 * `direct` = units whose current location is exactly this one.
 * `all` (the default) = those plus everything in locations beneath it.
 */
const listUnits = listQuerySchema({ scope: z.enum(['direct', 'all']).default('all') });

/** Person in charge — Phase 21 (`CR-003`). At most one holder, hence PUT. */
const setPic = z.object({ userId: uuid }).strict();

/** Normalized 0–1 coordinates relative to the image (`07-ui.md` §5.4). */
const polygonSchema = z.array(z.object({ x: z.number(), y: z.number() }).strict());

const createArea = z.object({ locationId: uuid, polygon: polygonSchema }).strict();
const updateArea = z.object({ polygon: polygonSchema }).strict();

function locationsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('location:read'),
    validate({ query: listLocations }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/',
    requirePermission('location:create'),
    validate({ body: createLocation }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('location:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('location:update'),
    validate({ params: idParams, body: updateLocation }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/deactivate',
    requirePermission('location:deactivate'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('location:deactivate'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id, req.principal));
    })
  );

  /**
   * Direct children — REQ-LOC-007.
   *
   * A collection, and answered in the collection envelope. It returns the whole
   * set rather than a page: this is what a drill-down asks for one level at a
   * time, and a node's children are bounded by the hierarchy itself.
   */
  router.get(
    '/:id/children',
    requirePermission('location:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendCollection(res, await service.children(req.params.id, req.principal));
    })
  );

  router.get(
    '/:id/units',
    requirePermission('asset-unit:read'),
    validate({ params: idParams, query: listUnits }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.units(req.params.id, req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  // --- Person in charge — Phase 21 (`CR-003`), REQ-LOC-014 -------------------

  /**
   * Guarded by `location-pic:*` rather than `location:update`: who is
   * responsible for a room is a different question from who may rename it.
   * Unlike `department-pic`, this grants no record access in any phase (§5.4).
   */
  router.get(
    '/:id/pic-assignments',
    requirePermission('location-pic:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendCollection(res, await service.picHistory(req.params.id, req.principal));
    })
  );

  router.put(
    '/:id/pic',
    requirePermission('location-pic:create'),
    validate({ params: idParams, body: setPic }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.setPic(req.params.id, req.body.userId, req.principal));
    })
  );

  router.delete(
    '/:id/pic',
    requirePermission('location-pic:delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.clearPic(req.params.id, req.principal));
    })
  );

  /**
   * Where this location sits and which floor plan shows it — REQ-LOC-007/011.
   *
   * `location:read` is the gate. The floor plan half is added only for a caller
   * who also holds `floor-plan:read`, rather than the whole endpoint requiring
   * both: the ancestor path is useful on its own, and demanding a permission for
   * a field the caller did not ask about would hide it needlessly.
   */
  router.get(
    '/:id/context',
    requirePermission('location:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { path, chain } = await service.context(req.params.id, req.principal);

      const readsPlans = hasPermission(req.principal, 'floor-plan:read');

      /**
       * `floorPlan` is the single plan that shows THIS location; `floorPlans` is
       * every plan along the chain, each marking the next step down towards it.
       * They answer different questions and their `areaId`s mean different
       * things (see `resolveChainPlans`), so the singular is not simply the last
       * entry of the plural and neither is derivable from the other.
       */
      const [floorPlan, floorPlans] = readsPlans
        ? await Promise.all([
            floorPlanService.resolveForChain(chain),
            floorPlanService.resolveChainPlans(chain),
          ])
        : [null, []];

      sendItem(res, { path, floorPlan, floorPlans });
    })
  );

  // --- Floor plan -----------------------------------------------------------

  router.get(
    '/:id/floor-plan',
    requirePermission('floor-plan:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await floorPlanService.get(req.params.id, req.principal));
    })
  );

  router.get(
    '/:id/floor-plan/image',
    requirePermission('floor-plan:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const { buffer, plan } = await floorPlanService.download(req.params.id, req.principal);
      res.type(plan.fileType);
      res.set('Content-Disposition', `inline; filename="${plan.fileName}"`);
      res.send(buffer);
    })
  );

  // PUT, not POST: at most one plan per location, so upload and replace are the
  // same operation (REQ-LOC-009, REQ-LOC-013).
  router.put(
    '/:id/floor-plan',
    requirePermission('floor-plan:update'),
    validate({ params: idParams }),
    singleUpload(),
    requireFile(),
    asyncHandler(async (req, res) => {
      sendItem(res, await floorPlanService.upload(req.params.id, req.file, req.principal));
    })
  );

  router.delete(
    '/:id/floor-plan',
    requirePermission('floor-plan:delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await floorPlanService.remove(req.params.id, req.principal);
      sendNoContent(res);
    })
  );

  // --- Floor plan areas -----------------------------------------------------

  router.get(
    '/:id/floor-plan/areas',
    requirePermission('floor-plan-area:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await floorPlanService.listAreas(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/floor-plan/areas',
    requirePermission('floor-plan-area:create'),
    validate({ params: idParams, body: createArea }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await floorPlanService.createArea(req.params.id, req.body, req.principal));
    })
  );

  router.patch(
    '/:id/floor-plan/areas/:areaId',
    requirePermission('floor-plan-area:update'),
    validate({ params: areaParams, body: updateArea }),
    asyncHandler(async (req, res) => {
      sendItem(
        res,
        await floorPlanService.updateArea(req.params.id, req.params.areaId, req.body, req.principal)
      );
    })
  );

  router.delete(
    '/:id/floor-plan/areas/:areaId',
    requirePermission('floor-plan-area:delete'),
    validate({ params: areaParams }),
    asyncHandler(async (req, res) => {
      await floorPlanService.removeArea(req.params.id, req.params.areaId, req.principal);
      sendNoContent(res);
    })
  );

  return router;
}

module.exports = { locationsRouter };
