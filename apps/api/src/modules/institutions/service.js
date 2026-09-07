'use strict';

/**
 * Institution use cases — `IMPLEMENTATION_PLAN.md` §10.1, REQ-ORG-001/002.
 *
 * Institutions are the organization scope itself, so this resource is NOT
 * scoped by `institutionId` — its permissions are system-wide-only (BR-015),
 * which is what bounds access instead.
 */

const { Op } = require('sequelize');

const { getModels } = require('../../db/models');
const { NotFoundError, ConflictError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, containsAny } = require('../../query/filtering');
const { assertCanAccess } = require('../../domain/scope');
const { MAX_LENGTH } = require('../../domain/inventoryCode');
const {
  formatFor,
  isDefaultFormat,
  validateFormat,
  renderPreview,
  catalog,
  parseFormat,
} = require('../../domain/inventoryCodeFormat');
const { coverageAt } = require('../../domain/classificationCoverage');

const SORTABLE = ['name', 'code', 'createdAt', 'updatedAt'];

const FILTERS = {
  status: activeStatus(),
  q: (value) => containsAny(['name', 'code'], value),
};

/** The API representation. Defined once so list and detail cannot diverge. */
function serialize(institution) {
  return {
    id: institution.id,
    name: institution.name,
    code: institution.code,
    address: institution.address,
    isActive: institution.isActive,
    createdAt: institution.createdAt,
    updatedAt: institution.updatedAt,
  };
}

async function list(params, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['name', 'ASC']],
  });

  const { rows, pagination } = await paginate(models.Institution, options);

  return { rows: rows.map(serialize), pagination };
}

/** @throws {NotFoundError} */
async function getById(id, { models = getModels() } = {}) {
  const institution = await models.Institution.findByPk(id);
  if (!institution) throw new NotFoundError('Institution not found');
  return institution;
}

const detail = async (id, options) => serialize(await getById(id, options));

async function create(body, { models = getModels() } = {}) {
  // `uq_institutions_code` also enforces this; checking first turns a driver
  // error into a message naming the field (REQ-VAL-004).
  const existing = await models.Institution.findOne({ where: { code: body.code } });
  if (existing) {
    throw new ConflictError(`An institution with code "${body.code}" already exists`, [
      { field: 'code', issue: 'must be unique' },
    ]);
  }

  return serialize(await models.Institution.create(body));
}

async function update(id, body, options = {}) {
  const institution = await getById(id, options);
  const models = options.models ?? getModels();

  if (body.code && body.code !== institution.code) {
    const clash = await models.Institution.findOne({ where: { code: body.code } });
    if (clash) {
      throw new ConflictError(`An institution with code "${body.code}" already exists`, [
        { field: 'code', issue: 'must be unique' },
      ]);
    }
  }

  return serialize(await institution.update(body));
}

/**
 * Soft delete — `06-api.md` §1.7, REQ-SYS-005. Records are preserved so the
 * assets, contracts and users referencing this institution keep their history.
 */
async function setActive(id, isActive, options = {}) {
  const institution = await getById(id, options);

  if (institution.isActive === isActive) {
    throw new ConflictError(`Institution is already ${isActive ? 'active' : 'inactive'}`);
  }

  return serialize(await institution.update({ isActive }));
}

// --- Inventory code format — Phase 25 (`CR-006`), REQ-ORG-007 ---------------

/**
 * The same institution, but reached under organization scope.
 *
 * The CRUD above is deliberately unscoped: `institution:*` is system-wide-only
 * (`BR-015`), so the permission is what bounds it. The format endpoints are the
 * exception — they are institution-scoped by design, so an administrator of one
 * institution can configure their own and no other. `column: 'id'` because an
 * institution IS its own organization scope; there is no `institutionId` column
 * to compare.
 *
 * `NotFoundError`, never `ForbiddenError` (`06-api.md` §1.4): naming another
 * institution must be indistinguishable from naming one that does not exist.
 */
async function getScoped(id, principal, { models = getModels() } = {}) {
  const institution = await models.Institution.findByPk(id);
  return assertCanAccess(principal, institution, { label: 'Institution', column: 'id' });
}

/**
 * The format in force, the registry it is built from, and what it would produce.
 *
 * The preview and the token samples are INSTITUTION-AWARE: this is the one place
 * the server knows which institution is being configured, so it shows that
 * institution's real code and a real department code rather than invented ones.
 * A preview built from plausible inventions teaches the wrong thing about what
 * will actually be printed (REQ-ORG-007).
 *
 * Nothing here allocates. No transaction, no advisory lock, no sequence
 * consumed — a preview that burned a number would leave a gap for every
 * keystroke in the builder.
 */
async function serializeFormat(institution, { models = getModels() } = {}) {
  /**
   * One real department, for the `DEPARTMENT_CODE` sample. Ordered by code so
   * the preview is stable between requests rather than shifting with whatever
   * the planner returned first. Inactive departments are excluded: they cannot
   * be assigned to a unit (`domain/departmentRules.js`), so one would be a
   * sample of something that can never appear in a code.
   */
  const department = await models.Department.findOne({
    where: { institutionId: institution.id, isActive: true },
    order: [['code', 'ASC']],
  });

  /**
   * A real funding source code for the sample, on the same principle as the
   * department: the server knows this institution, so it can show a value the
   * reader recognises rather than an invented one. Any code will do — the token
   * renders whichever contract the asset happens to carry.
   */
  const fundingSource = await models.FundingSource.findOne({
    where: { code: { [Op.ne]: null } },
    order: [['code', 'ASC']],
  });

  const format = formatFor(institution);
  const segments = parseFormat(format);
  const { preview, unresolved } = renderPreview(format, {
    institution,
    department,
    fundingSourceCode: fundingSource?.code ?? null,
  });

  const tokens = catalog({
    institution,
    department,
    fundingSourceCode: fundingSource?.code ?? null,
    segments,
  });

  /**
   * How much of the classification catalog this format can actually encode —
   * REQ-ORG-007. Attached only to the token it constrains, and only when the
   * format uses it, so no other screen pays for the count.
   */
  const label = tokens.find((token) => token.id === 'CLASSIFICATION_LEAF_LABEL');
  if (label && segments.some((s) => s.type === 'token' && s.value === label.id)) {
    label.coverage = await coverageAt(label.maxLength, { models });
  }

  return {
    // Always the format IN FORCE — the configured one, or the default when none
    // is configured. `isDefault` is what distinguishes the two, so a client can
    // show "not configured" without having to know the default itself.
    format,
    isDefault: isDefaultFormat(institution),
    preview,
    unresolved,
    maxLength: MAX_LENGTH,
    tokens,
  };
}

async function getFormat(id, principal, options = {}) {
  const models = options.models ?? getModels();
  return serializeFormat(await getScoped(id, principal, { models }), { models });
}

/**
 * Replaces the format. `null` clears it, returning the institution to the
 * default rather than leaving it with no way to generate codes at all.
 *
 * Validated here against the token registry — `BR-026` requires it on the server
 * whatever the client checked, and the client cannot be the only thing standing
 * between a stored format and a registration that cannot complete.
 *
 * Existing codes are untouched, and nothing regenerates them (REQ-UNIT-008).
 * That is not enforced by anything written here: it follows from the code being
 * stored on the unit and never recomputed on read (`BR-020`).
 */
async function setFormat(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const institution = await getScoped(id, principal, { models });

  const format = body.format === null ? null : body.format.trim();
  if (format !== null) validateFormat(format);

  await institution.update({ inventoryCodeFormat: format });

  return serializeFormat(institution, { models });
}

module.exports = {
  list,
  detail,
  create,
  update,
  getFormat,
  setFormat,
  deactivate: (id, options) => setActive(id, false, options),
  reactivate: (id, options) => setActive(id, true, options),
  serialize,
  SORTABLE,
};
