'use strict';

/**
 * Vendor use cases — `IMPLEMENTATION_PLAN.md` §12.2, `06-api.md` §7.1;
 * REQ-VENDOR-001–004.
 *
 * A Vendor is the manufacturer/brand behind an Asset (`03-domain.md` §4.14) —
 * distinct from a Supplier, which is the party a Contract is executed with.
 * `06-api.md` files this section under Operations; the entity belongs to the
 * procurement work all the same, which is why it is built here
 * (`IMPLEMENTATION_PLAN.md` §12.2, `DEC-008`).
 *
 * Like Supplier, this is a global list with no `institution_id`
 * (`04-data-model.md` §5.4.1), so it is permission-gated but not
 * organization-scoped (`DEC-007`). `GET /vendors/:id/assets` is the exception
 * that proves the rule: Assets DO carry an institution, so that list is scoped.
 */

const { getModels } = require('../../db/models');
const { NotFoundError, ConflictError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, contains } = require('../../query/filtering');
const assetService = require('../assets/service');

const SORTABLE = ['name', 'createdAt', 'updatedAt'];

/** Filters — `06-api.md` §7.1. */
const FILTERS = {
  status: activeStatus(),
  q: (value) => contains('name', value),
};

function serialize(vendor) {
  return {
    id: vendor.id,
    name: vendor.name,
    contactInfo: vendor.contactInfo ?? null,
    address: vendor.address ?? null,
    isActive: vendor.isActive,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
  };
}

async function list(params, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['name', 'ASC']],
  });

  const { rows, pagination } = await paginate(models.Vendor, options);

  return { rows: rows.map(serialize), pagination };
}

/** @throws {NotFoundError} */
async function getById(id, { models = getModels() } = {}) {
  const vendor = await models.Vendor.findByPk(id);
  if (!vendor) throw new NotFoundError('Vendor not found');
  return vendor;
}

const detail = async (id, options) => serialize(await getById(id, options));

async function create(body, { models = getModels() } = {}) {
  return serialize(await models.Vendor.create(body));
}

async function update(id, body, options = {}) {
  return serialize(await (await getById(id, options)).update(body));
}

/** Soft delete — `06-api.md` §1.7, `BR-005`: assets keep their vendor reference. */
async function setActive(id, isActive, options = {}) {
  const vendor = await getById(id, options);

  if (vendor.isActive === isActive) {
    throw new ConflictError(`Vendor is already ${isActive ? 'active' : 'inactive'}`);
  }

  return serialize(await vendor.update({ isActive }));
}

/**
 * Assets supplied by this vendor — REQ-VENDOR-004.
 *
 * Delegated to the asset service rather than queried here, so this list obeys
 * exactly the same organization scope, filters and serialization as
 * `GET /assets?vendorId=` (`BR-007`). A caller therefore cannot use a vendor to
 * see assets belonging to an institution they cannot reach.
 */
async function assets(id, params, principal, options = {}) {
  await getById(id, options);
  return assetService.list({ ...params, vendorId: id }, principal, options);
}

module.exports = {
  list,
  detail,
  create,
  update,
  deactivate: (id, options) => setActive(id, false, options),
  reactivate: (id, options) => setActive(id, true, options),
  assets,
  getById,
  serialize,
  SORTABLE,
};
