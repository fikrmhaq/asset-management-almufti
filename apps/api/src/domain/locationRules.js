'use strict';

/**
 * Location hierarchy rules — `BR-012`, `BR-014`, REQ-LOC-007, REQ-LOC-012.
 *
 * The `chk_locations_no_self_ref` CHECK only stops a location pointing directly
 * at itself. A longer cycle (A → B → A) satisfies that constraint and still
 * makes the tree unwalkable, so the real rule lives here.
 */

const { getModels } = require('../db/models');
const { ValidationError, ConflictError } = require('../errors');

/**
 * Walks up from `startId` and returns every ancestor id, nearest first.
 *
 * A recursive CTE rather than a loop of queries: the depth is unbounded, and a
 * corrupted parent chain would otherwise loop forever. `UNION` (not `UNION ALL`)
 * terminates on a revisited row, so a pre-existing cycle cannot hang the query.
 */
async function ancestorIds(startId, { models = getModels() } = {}) {
  const sequelize = models.Location.sequelize;

  const rows = await sequelize.query(
    `
    WITH RECURSIVE chain AS (
      SELECT id, parent_location_id
        FROM public.locations
       WHERE id = $1
      UNION
      SELECT parent.id, parent.parent_location_id
        FROM public.locations parent
        JOIN chain ON parent.id = chain.parent_location_id
    )
    SELECT id FROM chain WHERE id <> $1
    `,
    { bind: [startId], type: sequelize.QueryTypes.SELECT }
  );

  return rows.map((row) => row.id);
}

/**
 * The chain from `startId` up to its root, NEAREST FIRST and including
 * `startId` itself.
 *
 * `ancestorIds` answers "which locations are above this one" as an unordered
 * set, which is all a cycle check needs. Displaying a location's position, and
 * walking outwards from it to find the nearest floor plan, both need the ORDER
 * as well — and the walk must stop at the first match rather than reaching the
 * root, so the order has to be the real one.
 *
 * `depth` is returned for ordering only. Nothing may branch on its value: the
 * hierarchy is arbitrary — `Building → Floor → Wing → Room → Sub-room` is as
 * valid as two levels — and no caller may assume a fixed number of them.
 */
async function ancestorChain(startId, { models = getModels() } = {}) {
  const sequelize = models.Location.sequelize;

  return sequelize.query(
    `
    WITH RECURSIVE chain AS (
      SELECT id, name, parent_location_id, institution_id, is_active, 0 AS depth
        FROM public.locations
       WHERE id = $1
      UNION
      SELECT parent.id, parent.name, parent.parent_location_id, parent.institution_id,
             parent.is_active, chain.depth + 1
        FROM public.locations parent
        JOIN chain ON parent.id = chain.parent_location_id
    )
    SELECT id, name, parent_location_id AS "parentLocationId",
           institution_id AS "institutionId", is_active AS "isActive", depth
      FROM chain
     ORDER BY depth ASC
    `,
    { bind: [startId], type: sequelize.QueryTypes.SELECT }
  );
}

/** Every descendant id of `rootId`, at any depth. */
async function descendantIds(rootId, { models = getModels() } = {}) {
  const sequelize = models.Location.sequelize;

  const rows = await sequelize.query(
    `
    WITH RECURSIVE subtree AS (
      SELECT id
        FROM public.locations
       WHERE id = $1
      UNION
      SELECT child.id
        FROM public.locations child
        JOIN subtree ON child.parent_location_id = subtree.id
    )
    SELECT id FROM subtree WHERE id <> $1
    `,
    { bind: [rootId], type: sequelize.QueryTypes.SELECT }
  );

  return rows.map((row) => row.id);
}

/**
 * `BR-012` — a location must not be its own ancestor.
 *
 * Rejects both the direct self-reference and the longer cycle that the CHECK
 * constraint cannot see: assigning a parent that is already a descendant of the
 * location being moved.
 *
 * @param {string} locationId the location being created or moved (`null` on create)
 * @param {string|null} parentLocationId the proposed parent
 */
async function assertNoLocationCycle(locationId, parentLocationId, options = {}) {
  if (!parentLocationId) return;

  const models = options.models ?? getModels();

  const parent = await models.Location.findByPk(parentLocationId);
  if (!parent) {
    throw new ValidationError('The parent location does not exist', [
      { field: 'parentLocationId', issue: 'must reference an existing location' },
    ]);
  }

  if (!locationId) return;

  if (parentLocationId === locationId) {
    throw new ValidationError('A location cannot be its own parent', [
      { field: 'parentLocationId', issue: 'must not be the location itself (BR-012)' },
    ]);
  }

  const descendants = await descendantIds(locationId, { models });
  if (descendants.includes(parentLocationId)) {
    throw new ValidationError('A location cannot be moved beneath one of its own descendants', [
      { field: 'parentLocationId', issue: 'would create a cycle in the hierarchy (BR-012)' },
    ]);
  }
}

/**
 * `BR-014`, REQ-LOC-012 — a floor plan area's location must be a descendant of
 * the floor plan's own location.
 *
 * An area on a building's floor plan may only point at somewhere inside that
 * building. `CONFLICT` rather than `VALIDATION_ERROR` per `06-api.md` §5.3.
 */
async function assertDescendantLocation(floorPlanLocationId, areaLocationId, options = {}) {
  const models = options.models ?? getModels();

  const target = await models.Location.findByPk(areaLocationId);
  if (!target) {
    throw new ValidationError('The location does not exist', [
      { field: 'locationId', issue: 'must reference an existing location' },
    ]);
  }

  const descendants = await descendantIds(floorPlanLocationId, { models });

  if (!descendants.includes(areaLocationId)) {
    throw new ConflictError(
      'A floor plan area must represent a location inside the location the plan depicts',
      [{ field: 'locationId', issue: 'must be a descendant of the floor plan location (BR-014)' }]
    );
  }
}

module.exports = {
  ancestorIds,
  ancestorChain,
  descendantIds,
  assertNoLocationCycle,
  assertDescendantLocation,
};
