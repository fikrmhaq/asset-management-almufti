'use strict';

/**
 * Floor plans and their areas — `IMPLEMENTATION_PLAN.md` §11.2,
 * `06-api.md` §5.3, REQ-LOC-009–013.
 *
 * At most one plan per Location (`uq_location_floor_plans_location`), so upload
 * and replace are the same operation — hence `PUT`.
 *
 * Polygon points are normalized 0–1 relative to the image, never pixels. That is
 * what lets the SVG overlay scale to whatever size the image is rendered at
 * (`07-ui.md` §5.4); storing pixels would silently break at any other zoom.
 */

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { assertDescendantLocation } = require('../../domain/locationRules');
const storage = require('../../services/storage');
const locationService = require('../locations/service');

/**
 * Which floor plan depicts a given location — REQ-LOC-011, `BR-014`.
 *
 * A location need not have a plan of its own; the plan that shows where
 * something is may belong to any location above it, at any distance. The chain
 * is walked outwards and the FIRST answer wins, so a room's own plan beats its
 * floor's, and its floor's beats the building's.
 *
 * The rule, in order:
 *
 *   1. The location's OWN plan, if it has one. It depicts the inside of exactly
 *      that location, so nothing is clearer.
 *   2. The plan carrying an AREA for this location. `uq_floor_plan_areas_location`
 *      makes that area unique across the whole system, so there is at most one
 *      candidate and "nearest" never needs deciding. `BR-014` guarantees the
 *      plan's location is an ancestor — but see the containment check below.
 *   3. Failing both, the nearest ancestor that has a plan at all. The location
 *      is inside it but not drawn on it, which the caller is told.
 *   4. Nothing. No ancestor anywhere has a plan.
 *
 * NO STEP MAY ASSUME A DEPTH. The chain is however long the data says it is.
 *
 * @param {{id: string}[]} chain nearest-first, from `ancestorChain`
 * @returns {Promise<{locationId: string, floorPlanId: string, areaId: string|null}|null>}
 */
async function resolveForChain(chain, { models = getModels() } = {}) {
  if (chain.length === 0) return null;

  const [self] = chain;
  const chainIds = chain.map((node) => node.id);

  const plans = await models.LocationFloorPlan.findAll({
    where: { locationId: chainIds },
    attributes: ['id', 'locationId'],
  });

  const planByLocation = new Map(plans.map((plan) => [plan.locationId, plan]));

  const own = planByLocation.get(self.id);
  if (own) return { locationId: self.id, floorPlanId: own.id, areaId: null };

  const area = await models.FloorPlanArea.findOne({
    where: { locationId: self.id },
    include: [{ association: 'floorPlan', attributes: ['id', 'locationId'] }],
  });

  // The containment check is not redundant. `BR-014` is enforced when an area is
  // DRAWN, and `PATCH /locations/:id` can re-parent a location afterwards
  // without revalidating anything. An area orphaned that way points at a plan
  // that no longer contains this location, and showing it would put the unit in
  // an unrelated building. Fall through to the ancestor search instead.
  if (area?.floorPlan && chainIds.includes(area.floorPlan.locationId)) {
    return {
      locationId: area.floorPlan.locationId,
      floorPlanId: area.floorPlan.id,
      areaId: area.id,
    };
  }

  const nearest = chain.find((node) => planByLocation.has(node.id));
  if (!nearest) return null;

  return {
    locationId: nearest.id,
    floorPlanId: planByLocation.get(nearest.id).id,
    areaId: null,
  };
}

/**
 * EVERY plan along the chain, each marking the next step down — REQ-LOC-011.
 *
 * `resolveForChain` above answers "which single plan shows this location". That
 * is the right answer to that question and it stays. But it is not the question
 * someone tracking a unit down a building actually asks: given
 * `Site → Building → Floor → Room`, they want to open the Site plan and see
 * which Building, then the Building plan and see which Floor, and so on until
 * the plans run out. The single-answer walk stops at the first hit, so every
 * plan above it was unreachable, and the one link the UI offered carried the
 * unit's own location as the highlight — an id that is not drawn on any of the
 * higher plans, so those levels reported "not marked out" even when they did
 * mark out the way down.
 *
 * So each entry's `areaId` means something DIFFERENT from `resolveForChain`'s:
 * there it is "the area representing this exact location"; here it is "the area
 * on this plan representing the next step down towards it", which is usually an
 * ancestor of the location, not the location itself. `areaLocationId` names it,
 * because that is what the viewer has to highlight.
 *
 * DEEPEST WINS PER PLAN. A plan may draw more than one node of the chain — an
 * area may represent any descendant, not only a direct child (REQ-LOC-012) — so
 * a Building plan could carry areas for both the Floor and the Room. The deepest
 * one is the most precise thing that plan can say, so it is the one chosen.
 *
 * CONTAINMENT IS RE-CHECKED, for the same reason `resolveForChain` re-checks it:
 * `PATCH /locations/:id` can re-parent a location and orphan an area, leaving a
 * plan pointing at somewhere it no longer contains. Here the check falls out of
 * the chain's own order — an area may only be used when the node it represents
 * sits BELOW the plan's owner on this chain. A plan of the location itself
 * therefore highlights nothing, which is correct: there is nothing further down
 * to point at.
 *
 * NO STEP MAY ASSUME A DEPTH.
 *
 * @param {{id: string}[]} chain nearest-first, from `ancestorChain`
 * @returns {Promise<{locationId: string, floorPlanId: string, areaId: string|null,
 *   areaLocationId: string|null}[]>} root-first, so it reads top-down
 */
async function resolveChainPlans(chain, { models = getModels() } = {}) {
  if (chain.length === 0) return [];

  const chainIds = chain.map((node) => node.id);
  /** Position on the chain; 0 is the location itself, larger is further up. */
  const rank = new Map(chainIds.map((id, index) => [id, index]));

  const plans = await models.LocationFloorPlan.findAll({
    where: { locationId: chainIds },
    attributes: ['id', 'locationId'],
  });

  if (plans.length === 0) return [];

  // Only the areas that could ever be an answer: drawn on one of these plans,
  // and representing something on this chain.
  const areas = await models.FloorPlanArea.findAll({
    where: { floorPlanId: plans.map((plan) => plan.id), locationId: chainIds },
    attributes: ['id', 'floorPlanId', 'locationId'],
  });

  const deepestAreaFor = (plan) =>
    areas
      .filter(
        (area) =>
          area.floorPlanId === plan.id && rank.get(area.locationId) < rank.get(plan.locationId)
      )
      .sort((a, b) => rank.get(a.locationId) - rank.get(b.locationId))
      .at(0) ?? null;

  return (
    plans
      .map((plan) => {
        const area = deepestAreaFor(plan);

        return {
          locationId: plan.locationId,
          floorPlanId: plan.id,
          areaId: area?.id ?? null,
          areaLocationId: area?.locationId ?? null,
        };
      })
      // Root first: the trail reads outside-in, the way someone walks the building.
      .sort((a, b) => rank.get(b.locationId) - rank.get(a.locationId))
  );
}

/** A polygon needs at least three points to enclose anything. */
const MIN_POLYGON_POINTS = 3;
const MAX_POLYGON_POINTS = 200;

function serializePlan(plan) {
  return {
    id: plan.id,
    locationId: plan.locationId,
    fileName: plan.fileName,
    fileType: plan.fileType,
    fileSize: Number(plan.fileSize),
    uploadedBy: plan.uploadedBy,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function serializeArea(area) {
  return {
    id: area.id,
    floorPlanId: area.floorPlanId,
    locationId: area.locationId,
    polygon: area.polygon,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
    // `06-api.md` §5.3 specifies areas "resolved to the child Location it
    // represents". Without the name the client had to walk the hierarchy itself
    // to label a shape, and could only do so to a fixed depth.
    location: area.location ? { id: area.location.id, name: area.location.name } : undefined,
  };
}

/**
 * Validates polygon structure and coordinate range.
 *
 * @throws {ValidationError}
 */
function assertValidPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < MIN_POLYGON_POINTS) {
    throw new ValidationError('The polygon is not a closed shape', [
      { field: 'polygon', issue: `must have at least ${MIN_POLYGON_POINTS} points` },
    ]);
  }

  if (polygon.length > MAX_POLYGON_POINTS) {
    throw new ValidationError('The polygon has too many points', [
      { field: 'polygon', issue: `must have at most ${MAX_POLYGON_POINTS} points` },
    ]);
  }

  polygon.forEach((point, index) => {
    const invalid =
      !point ||
      typeof point !== 'object' ||
      typeof point.x !== 'number' ||
      typeof point.y !== 'number' ||
      Number.isNaN(point.x) ||
      Number.isNaN(point.y);

    if (invalid) {
      throw new ValidationError('The polygon contains an invalid point', [
        { field: `polygon[${index}]`, issue: 'must be an object with numeric x and y' },
      ]);
    }

    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      throw new ValidationError('Polygon coordinates must be normalized', [
        {
          field: `polygon[${index}]`,
          issue: 'x and y must be between 0 and 1, relative to the image',
        },
      ]);
    }
  });
}

/** The plan for a location, with its areas — REQ-LOC-011. */
async function get(locationId, principal, { models = getModels() } = {}) {
  await locationService.getById(locationId, principal, { models });

  const plan = await models.LocationFloorPlan.findOne({
    where: { locationId },
    include: [
      { association: 'areas', include: [{ association: 'location', attributes: ['id', 'name'] }] },
    ],
  });

  if (!plan) throw new NotFoundError('This location has no floor plan');

  return {
    ...serializePlan(plan),
    areas: (plan.areas ?? []).map(serializeArea),
  };
}

async function getPlanOrThrow(locationId, principal, models) {
  await locationService.getById(locationId, principal, { models });

  const plan = await models.LocationFloorPlan.findOne({ where: { locationId } });
  if (!plan) throw new NotFoundError('This location has no floor plan');

  return plan;
}

/**
 * Uploads or replaces the plan — REQ-LOC-009, REQ-LOC-013.
 *
 * Replacing removes the existing areas: they were drawn against the old image's
 * geometry and would land in the wrong places on a new one. The database
 * cascades that delete (`04-data-model.md` §5.3.9), and the underlying Locations
 * are untouched.
 */
async function upload(locationId, file, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  await locationService.getById(locationId, principal, { models });
  storage.assertAllowedType(file, {
    mimeTypes: storage.FLOOR_PLAN_MIME_TYPES,
    label: 'floor plan',
  });

  const existing = await models.LocationFloorPlan.findOne({ where: { locationId } });
  const stored = await storage.store(file, { shard: `floor-plans/${locationId}` });

  try {
    const plan = await withTransaction(
      async (transaction) => {
        if (existing) await existing.destroy({ transaction });

        return models.LocationFloorPlan.create(
          {
            locationId,
            fileName: stored.fileName,
            fileType: file.mimetype,
            fileSize: stored.fileSize,
            storageReference: stored.storageReference,
            uploadedBy: principal.userId,
          },
          { transaction }
        );
      },
      { sequelize }
    );

    if (existing) await storage.remove(existing.storageReference).catch(() => {});

    return { ...serializePlan(plan), areas: [] };
  } catch (error) {
    await storage.remove(stored.storageReference).catch(() => {});
    throw error;
  }
}

/** The image bytes, for rendering — REQ-LOC-011. */
async function download(locationId, principal, options = {}) {
  const models = options.models ?? getModels();
  const plan = await getPlanOrThrow(locationId, principal, models);

  return { buffer: await storage.read(plan.storageReference), plan: serializePlan(plan) };
}

/** Removes the plan and its areas, leaving the Locations alone — REQ-LOC-013. */
async function remove(locationId, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const plan = await getPlanOrThrow(locationId, principal, models);
  const { storageReference } = plan;

  await withTransaction(async (transaction) => plan.destroy({ transaction }), { sequelize });

  await storage.remove(storageReference);
}

async function listAreas(locationId, principal, options = {}) {
  const models = options.models ?? getModels();
  const plan = await getPlanOrThrow(locationId, principal, models);

  const rows = await models.FloorPlanArea.findAll({
    where: { floorPlanId: plan.id },
    include: [{ association: 'location', attributes: ['id', 'name'] }],
    order: [['createdAt', 'ASC']],
  });

  return rows.map(serializeArea);
}

/** Draws an area — REQ-LOC-010, REQ-LOC-012, `BR-014`. */
async function createArea(locationId, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const plan = await getPlanOrThrow(locationId, principal, models);

  assertValidPolygon(body.polygon);
  await assertDescendantLocation(locationId, body.locationId, { models });

  // uq_floor_plan_areas_location: a location is represented by at most one area.
  const existing = await models.FloorPlanArea.findOne({
    where: { locationId: body.locationId },
  });
  if (existing) {
    throw new ConflictError('That location is already represented by an area on a floor plan');
  }

  const area = await models.FloorPlanArea.create({
    floorPlanId: plan.id,
    locationId: body.locationId,
    polygon: body.polygon,
  });

  return serializeArea(area);
}

async function getArea(locationId, areaId, principal, models) {
  const plan = await getPlanOrThrow(locationId, principal, models);

  const area = await models.FloorPlanArea.findOne({
    where: { id: areaId, floorPlanId: plan.id },
  });
  if (!area) throw new NotFoundError('Floor plan area not found');

  return area;
}

/** Redraws an area's polygon — REQ-LOC-010. */
async function updateArea(locationId, areaId, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const area = await getArea(locationId, areaId, principal, models);

  assertValidPolygon(body.polygon);

  return serializeArea(await area.update({ polygon: body.polygon }));
}

/** Removes one area, leaving the plan and the represented Location intact. */
async function removeArea(locationId, areaId, principal, options = {}) {
  const models = options.models ?? getModels();
  const area = await getArea(locationId, areaId, principal, models);

  await area.destroy();
}

module.exports = {
  MIN_POLYGON_POINTS,
  MAX_POLYGON_POINTS,
  assertValidPolygon,
  resolveForChain,
  resolveChainPlans,
  get,
  upload,
  download,
  remove,
  listAreas,
  createArea,
  updateArea,
  removeArea,
  serializePlan,
  serializeArea,
};
