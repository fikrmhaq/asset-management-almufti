'use strict';

/**
 * Location use cases — `IMPLEMENTATION_PLAN.md` §11.1, `06-api.md` §5.3,
 * REQ-LOC-001–008.
 *
 * Locations are institution-scoped (`BR-007`) and classified against a leaf node
 * of `ref.asset_classifications` (`BR-011`, REQ-LOC-008). They nest to represent
 * physical containment (REQ-LOC-007) without ever forming a cycle (`BR-012`).
 */

const { getModels, normalizeCharKey } = require('../../db/models');
const { withTransaction } = require('../../db/withTransaction');
const { ConflictError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, contains, equals } = require('../../query/filtering');
const { assertLeafClassification } = require('../../domain/classificationRules');
const {
  assertNoLocationCycle,
  ancestorChain,
  descendantIds,
} = require('../../domain/locationRules');
const {
  scopeFilter,
  assertCanAccess,
  assertCanAssignInstitution,
  canAccessInstitution,
  defaultInstitutionFor,
} = require('../../domain/scope');
const { unitScopeFilter } = require('../../domain/scope');
const pic = require('../../domain/picAssignments');

const SORTABLE = ['name', 'createdAt', 'updatedAt'];

const FILTERS = {
  status: activeStatus(),
  institutionId: (value) => equals('institutionId', value),
  parentLocationId: (value) => equals('parentLocationId', value),
  /**
   * The top of the hierarchy — locations with no parent.
   *
   * A separate flag rather than an overloaded `parentLocationId=`: an empty
   * query param is indistinguishable from an omitted one once it has been
   * through a URL, a form and Zod, so "give me the roots" and "I have no
   * parent filter" would collapse into each other and the caller would
   * silently receive every location instead of the handful at the top.
   *
   * `false` contributes NO filter, exactly as if the param were absent, so
   * `?rootsOnly=false` cannot accidentally mean `parent IS NOT NULL`.
   */
  rootsOnly: (value) => (value ? { parentLocationId: null } : undefined),
  classificationId: (value) => equals('classificationId', value),
  q: (value) => contains('name', value),
};

/**
 * The parent, resolved to something a person can read.
 *
 * `parentLocationId` alone forces every client to either show a UUID or issue a
 * request per row to turn it into a name — and a list page has no sensible way
 * to do the latter. The same shape is already used for a unit's
 * `currentLocation` (see `units` below), so this is the existing convention
 * rather than a new one.
 */
const parentInclude = (principal) => ({
  association: 'parent',
  attributes: ['id', 'name'],
  // SCOPED like every other read (`BR-007`). An include is not filtered by the
  // caller's scope automatically, so without this a user in one institution
  // could read the NAME of a parent belonging to another — which is exactly
  // what the scope rule exists to prevent. `create` already refuses to attach a
  // location to an unreachable parent, but an institution can be reassigned
  // afterwards, so the read has to defend itself rather than trust that.
  where: scopeFilter(principal),
  // LEFT JOIN: an out-of-scope parent yields `null` rather than dropping the
  // row itself, so the location stays listed and only its parent's name is
  // withheld. `parentLocationId` still tells the client a parent exists.
  required: false,
});

function serialize(location) {
  return {
    id: location.id,
    name: location.name,
    classificationId: normalizeCharKey(location.classificationId),
    parentLocationId: location.parentLocationId ?? null,
    // `null` for a top-level location, and also whenever the association was
    // not loaded — callers must treat it as a convenience, never as the
    // authority on whether a parent exists. `parentLocationId` is that.
    parentLocation: location.parent ? { id: location.parent.id, name: location.parent.name } : null,
    institutionId: location.institutionId ?? null,
    // Phase 21 (`CR-003`) — responsibility, not access.
    currentPicUserId: location.currentPicUserId ?? null,
    currentPic: location.currentPic ? pic.serializeUser(location.currentPic) : undefined,
    isActive: location.isActive,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  };
}

async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['name', 'ASC']],
  });

  // Scope is applied on top of the caller's filters, never instead of them.
  options.where = { ...options.where, ...scopeFilter(principal) };

  /**
   * `descendantsOf` cannot be a plain column filter — containment is transitive
   * and the depth is unbounded, so it is resolved by the same recursive CTE the
   * hierarchy rules use. Walking `/children` level by level from the client is
   * the alternative, and that costs one request per node and has to stop
   * somewhere arbitrary.
   */
  if (params.descendantsOf) {
    await getById(params.descendantsOf, principal, { models });
    options.where = {
      ...options.where,
      id: await descendantIds(params.descendantsOf, { models }),
    };
  }

  // A `belongsTo` cannot multiply the row count, so no `distinct` is needed.
  const { rows, pagination } = await paginate(models.Location, options, {
    include: [parentInclude(principal)],
  });

  return { rows: rows.map(serialize), pagination };
}

/** Loads a location the caller is allowed to see, or throws NotFound. */
async function getById(id, principal, { models = getModels() } = {}) {
  const location = await models.Location.findByPk(id, {
    include: [
      parentInclude(principal),
      // Phase 21 (`CR-003`): the person responsible for this place. NOT scoped
      // like the parent is — a PIC is always a user of the location's own
      // institution (`assertPicAssignable`), so there is no cross-institution
      // name to withhold.
      { association: 'currentPic', attributes: ['id', 'username', 'firstName', 'lastName'] },
    ],
  });
  return assertCanAccess(principal, location, { label: 'Location' });
}

const detail = async (id, principal, options) => serialize(await getById(id, principal, options));

// --- Person in charge — Phase 21 (`CR-003`), REQ-LOC-014 ---------------------

/**
 * Responsibility and history ONLY.
 *
 * A Location PIC grants no record access, in this phase or Phase 22 (`CR-003`
 * §5.4): locations nest, so a building's PIC would reach every unit in every
 * room beneath it; and a unit's location changes as it is borrowed and returned,
 * so an access grant derived from it would appear and disappear as items are
 * physically moved. `resolvePrincipal` never reads `location_pic_assignments`.
 */
async function setPic(id, userId, principal, options = {}) {
  const models = options.models ?? getModels();
  const location = await getById(id, principal, { models });

  await pic.assign('location', location, userId, principal, { ...options, models });

  return detail(id, principal, { models });
}

async function clearPic(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const location = await getById(id, principal, { models });

  await pic.clear('location', location, principal, { ...options, models });

  return detail(id, principal, { models });
}

async function picHistory(id, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  return pic.history('location', id, { models });
}

async function create(body, principal, { models = getModels() } = {}) {
  const institutionId = defaultInstitutionFor(principal, body.institutionId);
  assertCanAssignInstitution(principal, institutionId);

  await assertLeafClassification(body.classificationId, { models, institutionId });
  await assertNoLocationCycle(null, body.parentLocationId, { models });

  if (body.parentLocationId) {
    // The parent must be reachable by the caller too, or a scoped user could
    // attach their location under someone else's tree.
    await getById(body.parentLocationId, principal, { models });
  }

  const created = await models.Location.create({ ...body, institutionId });
  // Re-read so the response carries the resolved parent like every other read.
  return detail(created.id, principal, { models });
}

async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const location = await getById(id, principal, { models });

  if (body.institutionId !== undefined) {
    assertCanAssignInstitution(principal, body.institutionId);
  }

  if (
    body.classificationId &&
    normalizeCharKey(body.classificationId) !== normalizeCharKey(location.classificationId)
  ) {
    const institutionId =
      body.institutionId === undefined ? location.institutionId : body.institutionId;
    await assertLeafClassification(body.classificationId, { models, institutionId });
  }

  if (body.parentLocationId !== undefined) {
    await assertNoLocationCycle(id, body.parentLocationId, { models });
    if (body.parentLocationId) await getById(body.parentLocationId, principal, { models });
  }

  /**
   * Moving a location to another institution ends its PIC assignment — Phase 21
   * (`CR-003` I7), `BR-007`.
   *
   * The holder is a user of the institution the location is LEAVING, so keeping
   * them would create exactly the cross-institution assignment
   * `assertPicAssignable` refuses to create directly. Ended rather than
   * remapped: there is no way to know who the equivalent person is in the new
   * institution, and inventing one is worse than recording that the post fell
   * vacant on the day of the move.
   *
   * The history survives — the closed row still says who held it and until when.
   */
  const movingInstitution =
    body.institutionId !== undefined && body.institutionId !== location.institutionId;

  await withTransaction(async (transaction) => {
    await location.update(body, { transaction });

    if (movingInstitution) {
      await pic.closeCurrent('location', id, principal, { models, transaction });
    }
  });

  // The parent may have changed; re-read rather than serialize a stale association.
  return detail(id, principal, { models });
}

/**
 * Soft delete. Deactivating a location does not deactivate what it contains:
 * REQ-LOC-004 requires location history to survive, and a unit's recorded
 * location must keep resolving.
 */
async function setActive(id, isActive, principal, options = {}) {
  const location = await getById(id, principal, options);

  if (location.isActive === isActive) {
    throw new ConflictError(`Location is already ${isActive ? 'active' : 'inactive'}`);
  }

  await location.update({ isActive });
  return detail(id, principal, options);
}

/** Direct children — REQ-LOC-007. */
async function children(id, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  const rows = await models.Location.findAll({
    where: { parentLocationId: id, ...scopeFilter(principal) },
    include: [parentInclude(principal)],
    order: [['name', 'ASC']],
  });

  return rows.map(serialize);
}

/**
 * Asset units currently at this location — REQ-LOC-005, REQ-REPORT-005.
 *
 * Includes units in descendant locations by default: asking what is in a
 * building means everything in its rooms, not only what is filed against the
 * building itself.
 *
 * `scope=direct` narrows that to units whose current location is EXACTLY this
 * one. The default stays `all`, which is the behaviour every existing caller
 * already relies on (`DEC-004`).
 *
 * Each row carries the location it is ACTUALLY at, and the asset it belongs to.
 * A unit listed under a building may be three rooms down, and a list that shows
 * only the building it was found under would misreport where the item is —
 * exactly what `REQ-LOC-005` exists to answer. Resolving those names client-side
 * is not an option: the page cap is 100 (`06-api.md` §1.5) and a site has more
 * rooms than that.
 */
async function units(id, params, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  const locationIds =
    params.scope === 'direct' ? [id] : [id, ...(await descendantIds(id, { models }))];

  const findOptions = toFindOptions(params, {
    filters: {},
    sortable: ['createdAt'],
    defaultSort: [['createdAt', 'DESC']],
  });

  const { rows, pagination } = await paginate(
    models.AssetUnit,
    { ...findOptions, where: { currentLocationId: locationIds, ...unitScopeFilter(principal) } },
    {
      include: [
        { association: 'asset', attributes: ['id', 'name'] },
        { association: 'currentLocation', attributes: ['id', 'name'] },
        // Phase 20 (`CR-003`): this list reuses `unitService.serialize`, which
        // reports a resolved department. Without the join every row would say
        // "unassigned" regardless of what it actually carries.
        { association: 'department', attributes: ['id', 'code', 'name'] },
      ],
    }
  );

  const { serialize: serializeUnit } = require('../assetUnits/service');
  return { rows: rows.map(serializeUnit), pagination };
}

/**
 * Where a location sits, and which floor plan shows it — REQ-LOC-005/007/011.
 *
 * One endpoint answers both because they are one question asked from one place:
 * a unit's detail page needs the readable path AND a way into the plan, and
 * resolving them separately would mean the two could disagree about which
 * ancestor mattered.
 *
 * `path` runs root → self, so it renders directly as a trail. Its LENGTH IS
 * DATA — two levels or seven, the caller renders what it is given and must not
 * assume a number.
 *
 * Ancestors outside the caller's scope truncate the path rather than fail the
 * request: they may hold a location under an institution the caller cannot see,
 * and their own location is still theirs to view (`BR-007`).
 */
async function context(id, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  const chain = await ancestorChain(id, { models });

  // Nearest-first for the walk; the response wants root-first for display.
  const visible = [];
  for (const node of chain) {
    if (!canAccessInstitution(principal, node.institutionId)) break;
    visible.push(node);
  }

  const path = [...visible].reverse().map((node) => ({
    id: node.id,
    name: node.name,
    parentLocationId: node.parentLocationId ?? null,
    isActive: node.isActive,
  }));

  return { path, chain: visible };
}

module.exports = {
  list,
  detail,
  create,
  update,
  deactivate: (id, principal, options) => setActive(id, false, principal, options),
  reactivate: (id, principal, options) => setActive(id, true, principal, options),
  children,
  units,
  context,
  setPic,
  clearPic,
  picHistory,
  getById,
  serialize,
  SORTABLE,
};
