'use strict';

/**
 * Asset classifications — `IMPLEMENTATION_PLAN.md` §10.6, `06-api.md` §4.1.
 *
 * The hierarchy is government-sourced reference data and the bulk of it is
 * read-only (REQ-CLASS-003, REQ-REF-003). Phase 17 (`CR-001`) opened one seam in
 * that: institutions may register leaf classifications the catalogue does not
 * cover. Those rows carry `origin = 3` and are the only ones any write here can
 * touch — `assertAppDefined` is what guards every one of them (`BR-016`).
 *
 * `id` and `parent_id` are `CHAR(12)`, which PostgreSQL blank-pads on read, so
 * every value crossing the API boundary is trimmed.
 */

const { Op } = require('sequelize');

const { getModels, normalizeCharKey } = require('../../db/models');
const { NotFoundError, ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { contains, equals } = require('../../query/filtering');
const { escapeLike } = require('../../query/filtering');
const { organizationScope } = require('../../auth/principal');
const { invalidate: invalidateCoverage } = require('../../domain/classificationCoverage');
const {
  ORIGIN,
  isSecondToLastLevel,
  assertAppDefined,
  assertAttachableParent,
  assertUnreferenced,
  allocateChildCode,
  lockParentForAllocation,
} = require('../../domain/classificationRules');

const SORTABLE = ['id', 'name'];

/** Leaf-only search caps its own result set — this is a type-ahead, not a list. */
const LEAF_SEARCH_LIMIT = 50;

function serialize(classification, { isLeaf } = {}) {
  return {
    id: normalizeCharKey(classification.id),
    parentId: normalizeCharKey(classification.parentId),
    name: classification.name,
    origin: classification.origin,
    categoryId: classification.categoryId ?? null,
    // Phase 17. `isAppDefined` is derived rather than left to the client to
    // infer from `origin`, so the rule for "may this be edited" lives in one
    // place (`BR-016`) instead of being re-implemented in the UI.
    institutionId: classification.institutionId ?? null,
    isAppDefined: classification.origin === ORIGIN.APP_DEFINED,
    // Whether a new leaf may attach here (REQ-CLASS-012). Derived server-side so
    // the UI shows or hides its Add control without re-implementing the code
    // scheme, and so the two can never disagree about where additions belong.
    acceptsChildren: isSecondToLastLevel(classification.id),
    createdBy: classification.createdBy ?? null,
    createdAt: classification.createdAt ?? null,
    updatedAt: classification.updatedAt ?? null,
    ...(isLeaf === undefined ? {} : { isLeaf }),
  };
}

/* -------------------------------------------------------------------------- */
/* Visibility — BR-019                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The institution whose private nodes are in view.
 *
 * Defaults to the caller's own. A system-wide caller may name any institution; a
 * scoped one may only name theirs, and naming another is a `422` rather than an
 * empty result, because silently returning nothing would look like the
 * institution has no classifications.
 */
function resolveViewInstitution(principal, requested) {
  const scope = organizationScope(principal);

  if (requested === undefined) return scope.institutionId;
  if (scope.unrestricted) return requested;

  if (requested !== scope.institutionId) {
    throw new ValidationError('You cannot view another institution’s classifications', [
      { field: 'institutionId', issue: 'is outside your organization scope (BR-007)' },
    ]);
  }

  return requested;
}

/**
 * A `where` fragment applying `BR-019`.
 *
 * Deliberately not `scope.scopeFilter`: every other scoped table matches its
 * institution column alone, but a classification with no institution is visible
 * to everyone, so the default is a two-branch OR rather than an equality. Using
 * the shared helper here would hide global nodes from every scoped caller.
 */
function visibilityWhere(principal, { institutionId, owner } = {}) {
  const scope = organizationScope(principal);
  const view = resolveViewInstitution(principal, institutionId);

  if (owner === 'all') {
    if (!scope.unrestricted) {
      throw new ValidationError('You cannot list every institution’s classifications', [
        { field: 'owner', issue: '"all" requires a system-wide role (REQ-CLASS-014)' },
      ]);
    }
    return {};
  }

  if (owner === 'global') return { institutionId: { [Op.is]: null } };
  if (owner === 'mine') {
    return view === null ? { institutionId: { [Op.is]: null } } : { institutionId: view };
  }

  // Default: global, plus the institution in view.
  if (view === null) return { institutionId: { [Op.is]: null } };
  return { [Op.or]: [{ institutionId: { [Op.is]: null } }, { institutionId: view }] };
}

/**
 * The same rule as SQL, for the two hand-written queries.
 *
 * Returns a fragment plus its bind values. Kept beside `visibilityWhere` so the
 * two cannot drift — if one gains a branch the other has to as well.
 */
function visibilitySql(principal, { institutionId, owner } = {}, alias = 'c', nextBind = 1) {
  const scope = organizationScope(principal);
  const view = resolveViewInstitution(principal, institutionId);

  if (owner === 'all') {
    if (!scope.unrestricted) {
      throw new ValidationError('You cannot list every institution’s classifications', [
        { field: 'owner', issue: '"all" requires a system-wide role (REQ-CLASS-014)' },
      ]);
    }
    return { sql: 'TRUE', binds: [] };
  }

  if (owner === 'global') return { sql: `${alias}.institution_id IS NULL`, binds: [] };

  if (owner === 'mine') {
    return view === null
      ? { sql: `${alias}.institution_id IS NULL`, binds: [] }
      : { sql: `${alias}.institution_id = $${nextBind}`, binds: [view] };
  }

  if (view === null) return { sql: `${alias}.institution_id IS NULL`, binds: [] };

  return {
    sql: `(${alias}.institution_id IS NULL OR ${alias}.institution_id = $${nextBind})`,
    binds: [view],
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Filters. `parentId` is special: omitting it means "root-level nodes", which is
 * how the picker starts its drill-down (`06-api.md` §4.1). An explicit
 * `parentId` narrows to that node's children.
 */
const FILTERS = {
  q: (value) => contains('name', value),
  categoryId: (value) => equals('categoryId', value),
  parentId: (value) => equals('parentId', value),
};

async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['id', 'ASC']],
  });

  // Root-level nodes when neither a parent nor a search term is given. Without
  // this the picker's first call would return all 14,738 rows a page at a time.
  if (params.parentId === undefined && params.q === undefined) {
    options.where = { ...options.where, parentId: { [Op.is]: null } };
  }

  options.where = {
    [Op.and]: [options.where ?? {}, visibilityWhere(principal, params)],
  };

  const { rows, pagination } = await paginate(models.AssetClassification, options);

  return { rows: rows.map((row) => serialize(row)), pagination };
}

/**
 * Loads one node, enforcing visibility.
 *
 * `NotFoundError` for an invisible node, never `ForbiddenError`: confirming that
 * another institution's classification exists is itself a disclosure, and
 * `06-api.md` §1.4 already folds out-of-scope into NOT_FOUND.
 */
async function getById(id, principal, { models = getModels() } = {}) {
  const classification = await models.AssetClassification.findByPk(id);
  if (!classification) throw new NotFoundError('Classification not found');

  if (!isVisibleTo(principal, classification)) {
    throw new NotFoundError('Classification not found');
  }

  return classification;
}

/** Whether one already-loaded node is visible to the caller — `BR-019`. */
function isVisibleTo(principal, classification) {
  const owner = classification.institutionId ?? null;
  if (owner === null) return true;

  const scope = organizationScope(principal);
  if (scope.unrestricted) return true;
  return owner === scope.institutionId;
}

/** True when the node has no children — the rule assets and locations must satisfy. */
async function isLeaf(id, { models = getModels() } = {}) {
  return (await models.AssetClassification.count({ where: { parentId: id } })) === 0;
}

async function detail(id, principal, options = {}) {
  const classification = await getById(id, principal, options);

  return serialize(classification, {
    isLeaf: await isLeaf(normalizeCharKey(classification.id), options),
  });
}

/** Direct children — the picker's drill-down step (REQ-CLASS-007/010). */
async function children(id, principal, params = {}, { models = getModels() } = {}) {
  await getById(id, principal, { models });

  const rows = await models.AssetClassification.findAll({
    where: { [Op.and]: [{ parentId: id }, visibilityWhere(principal, params)] },
    order: [['id', 'ASC']],
  });

  // One count query for all children rather than one per child.
  const childIds = rows.map((row) => normalizeCharKey(row.id));
  const parents = new Set(
    (
      await models.AssetClassification.findAll({
        attributes: ['parentId'],
        where: { parentId: childIds.length ? childIds : [''] },
        group: ['parent_id'],
      })
    ).map((row) => normalizeCharKey(row.parentId))
  );

  return rows.map((row) => serialize(row, { isLeaf: !parents.has(normalizeCharKey(row.id)) }));
}

/**
 * Leaf-only search — REQ-CLASS-009, `06-api.md` §4.1.
 *
 * The picker's type-ahead shortcut. A match resolves through its full ancestor
 * path, because "Komputer" on its own is meaningless without knowing where it
 * sits (`07-ui.md` §4.5).
 */
async function searchLeaves(q, principal, params = {}, { models = getModels() } = {}) {
  const sequelize = models.AssetClassification.sequelize;

  // $1 and $2 are the search term and the limit; visibility binds follow.
  const visibility = visibilitySql(principal, params, 'c', 3);

  const rows = await sequelize.query(
    `
    SELECT c.id, c.parent_id, c.name, c.origin, c.category_id, c.institution_id,
           c.created_by, c.created_at, c.updated_at
      FROM ref.asset_classifications c
     WHERE c.name ILIKE $1 ESCAPE '\\'
       AND ${visibility.sql}
       AND NOT EXISTS (
             SELECT 1 FROM ref.asset_classifications child
              WHERE child.parent_id = c.id
           )
     ORDER BY c.name ASC
     LIMIT $2
    `,
    {
      bind: [`%${escapeLike(q)}%`, LEAF_SEARCH_LIMIT, ...visibility.binds],
      type: sequelize.QueryTypes.SELECT,
    }
  );

  return Promise.all(
    rows.map(async (row) => ({
      id: normalizeCharKey(row.id),
      parentId: normalizeCharKey(row.parent_id),
      name: row.name,
      origin: row.origin,
      categoryId: row.category_id ?? null,
      institutionId: row.institution_id ?? null,
      isAppDefined: row.origin === ORIGIN.APP_DEFINED,
      acceptsChildren: false,
      createdBy: row.created_by ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
      isLeaf: true,
      path: await ancestorPath(normalizeCharKey(row.id), { models }),
    }))
  );
}

/**
 * The chain from the root down to and including this node.
 *
 * A recursive CTE rather than a loop of queries: the hierarchy runs 5+ levels
 * deep and the picker resolves a path per search hit.
 *
 * Not visibility-filtered: every ancestor of a visible node is a government node
 * by construction (an application-defined node is always a leaf), and truncating
 * the path would leave the picker unable to say where a match sits.
 */
async function ancestorPath(id, { models = getModels() } = {}) {
  const sequelize = models.AssetClassification.sequelize;

  const rows = await sequelize.query(
    `
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, name, 0 AS depth
        FROM ref.asset_classifications
       WHERE id = $1
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.name, chain.depth + 1
        FROM ref.asset_classifications parent
        JOIN chain ON parent.id = chain.parent_id
    )
    SELECT id, name FROM chain ORDER BY depth DESC
    `,
    { bind: [id], type: sequelize.QueryTypes.SELECT }
  );

  return rows.map((row) => ({ id: normalizeCharKey(row.id), name: row.name }));
}

/** Attribute definitions configured for this classification — REQ-ATTR-002. */
async function attributeDefinitions(id, principal, options = {}) {
  const models = options.models ?? getModels();
  await getById(id, principal, { models });

  const rows = await models.AttributeDefinition.findAll({
    where: { classificationId: id },
    order: [
      ['sortOrder', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  const { serialize: serializeDefinition } = require('../attributeDefinitions/service');
  return rows.map(serializeDefinition);
}

/* -------------------------------------------------------------------------- */
/* Writes — application-defined nodes only (BR-016)                           */
/* -------------------------------------------------------------------------- */

/**
 * Creates an application-defined leaf — REQ-CLASS-011 through REQ-CLASS-014.
 *
 * Everything happens in one transaction holding an advisory lock on the parent,
 * because the identifier is allocated by reading the parent's existing children
 * (REQ-CLASS-013). Two concurrent creates without the lock read the same set and
 * mint the same id.
 */
async function create(body, principal, { models = getModels() } = {}) {
  const sequelize = models.AssetClassification.sequelize;
  const scope = organizationScope(principal);
  const parentId = normalizeCharKey(body.parentId);

  // `null` is meaningful here and `undefined` is not, so the two are separated
  // before the default is applied: omitting the field means "mine", passing
  // null means "global".
  const institutionId =
    body.institutionId === undefined ? scope.institutionId : body.institutionId;

  if (institutionId === null && !scope.unrestricted) {
    throw new ValidationError('You cannot create a classification for every institution', [
      {
        field: 'institutionId',
        issue: 'a global classification requires a system-wide role (REQ-CLASS-014)',
      },
    ]);
  }

  if (institutionId !== null && !scope.unrestricted && institutionId !== scope.institutionId) {
    throw new ValidationError('You cannot create a classification for another institution', [
      { field: 'institutionId', issue: 'is outside your organization scope (BR-007)' },
    ]);
  }

  if (institutionId !== null) {
    const institution = await models.Institution.findByPk(institutionId);
    if (!institution) {
      throw new ValidationError('The institution does not exist', [
        { field: 'institutionId', issue: 'must reference an existing institution' },
      ]);
    }
  }

  const created = await sequelize.transaction(async (transaction) => {
    await lockParentForAllocation(parentId, { models, transaction });
    await assertAttachableParent(parentId, { models });

    const id = await allocateChildCode(parentId, { models, transaction });
    const now = new Date();

    return models.AssetClassification.create(
      {
        id,
        parentId,
        name: body.name,
        origin: ORIGIN.APP_DEFINED,
        categoryId: null,
        institutionId,
        createdBy: principal.userId,
        createdAt: now,
        updatedAt: now,
      },
      { transaction }
    );
  });

  return serialize(created, { isLeaf: true });
}

/**
 * Renames — REQ-CLASS-016.
 *
 * Only the name changes. The identifier stays put so that every Asset and
 * Location already referencing it remains valid, which is the whole reason
 * renaming is safe to allow at all.
 */
async function rename(id, body, principal, { models = getModels() } = {}) {
  const classification = await getById(id, principal, { models });

  assertAppDefined(classification, 'renamed');
  assertCanManage(principal, classification);

  await classification.update(
    { name: body.name, updatedAt: new Date() }
  );

  return serialize(classification, { isLeaf: await isLeaf(normalizeCharKey(id), { models }) });
}

/**
 * Promotes an institution-owned node to global — REQ-CLASS-015.
 *
 * One-way, and the API offers no inverse: once global, assets in other
 * institutions may reference it, and demoting would strand them against a
 * classification their users can no longer see.
 */
async function promote(id, principal, { models = getModels() } = {}) {
  const scope = organizationScope(principal);

  if (!scope.unrestricted) {
    throw new ValidationError('You cannot make a classification global', [
      { field: 'id', issue: 'promotion requires a system-wide role (REQ-CLASS-015)' },
    ]);
  }

  const classification = await getById(id, principal, { models });
  assertAppDefined(classification, 'promoted');

  if (classification.institutionId === null) {
    throw new ValidationError('The classification is already available to every institution', [
      { field: 'id', issue: 'is already global' },
    ]);
  }

  await classification.update(
    { institutionId: null, updatedAt: new Date() }
  );

  return serialize(classification, { isLeaf: await isLeaf(normalizeCharKey(id), { models }) });
}

/**
 * Deletes — REQ-CLASS-017, `BR-018`.
 *
 * A hard delete, not a deactivation: this table has no active flag, and one was
 * deliberately not added. A classification nothing references leaves nothing
 * behind worth preserving, and an `is_active` column would have to be honoured
 * by every read in the picker, the search and the reports.
 */
async function remove(id, principal, { models = getModels() } = {}) {
  const classification = await getById(id, principal, { models });

  assertAppDefined(classification, 'deleted');
  assertCanManage(principal, classification);
  await assertUnreferenced(normalizeCharKey(id), { models });

  await classification.destroy();
}

/**
 * Whether the caller may rename or delete this node — REQ-CLASS-017.
 *
 * A system-wide role may manage any application-defined node, including global
 * ones. A scoped caller may manage only their own institution's. A global node
 * therefore cannot be managed by a scoped caller even though they can see it —
 * which is the point of promotion being one-way.
 */
function assertCanManage(principal, classification) {
  const scope = organizationScope(principal);
  if (scope.unrestricted) return;

  const owner = classification.institutionId ?? null;

  if (owner === null) {
    throw new ValidationError('You cannot change a classification shared by every institution', [
      { field: 'id', issue: 'a global classification requires a system-wide role' },
    ]);
  }

  if (owner !== scope.institutionId) {
    throw new ValidationError('You cannot change another institution’s classification', [
      { field: 'id', issue: 'is outside your organization scope (BR-007)' },
    ]);
  }
}

/**
 * Keeps the label-coverage figures honest — Phase 26 (`CR-007`), REQ-ORG-007.
 *
 * The inventory code builder reports how many classification labels a format can
 * encode, counted from a memoized pass over the catalog. Adding, renaming or
 * deleting a leaf changes that answer, so the three write paths drop the cache.
 *
 * Wrapped here rather than called inside each function: it is a cache concern
 * rather than a classification rule, and one place to look is one place to
 * forget. `promote` is absent deliberately — it changes ownership, not the name.
 */
const invalidatingCoverage =
  (operation) =>
  async (...args) => {
    const result = await operation(...args);
    invalidateCoverage();
    return result;
  };

module.exports = {
  list,
  detail,
  children,
  searchLeaves,
  ancestorPath,
  attributeDefinitions,
  create: invalidatingCoverage(create),
  rename: invalidatingCoverage(rename),
  promote,
  remove: invalidatingCoverage(remove),
  isLeaf,
  isVisibleTo,
  getById,
  serialize,
  visibilityWhere,
  visibilitySql,
  SORTABLE,
  LEAF_SEARCH_LIMIT,
};
