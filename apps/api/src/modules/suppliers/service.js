'use strict';

/**
 * Supplier use cases — `IMPLEMENTATION_PLAN.md` §12.1, `06-api.md` §6.1;
 * REQ-SUPPLIER-001–003.
 *
 * A Supplier is the party a procurement Contract is executed with. It is a
 * global list, NOT organization-scoped: `public.suppliers`
 * (`04-data-model.md` §5.4.2) has no `institution_id`, and the same supplier is
 * expected to appear on contracts belonging to different institutions. Access is
 * bounded by permission alone (`DEC-007`, `IMPLEMENTATION_PLAN.md` §39).
 */

const { getModels } = require('../../db/models');
const { NotFoundError, ConflictError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, contains } = require('../../query/filtering');

const SORTABLE = ['name', 'createdAt', 'updatedAt'];

/** Filters — `06-api.md` §6.1. */
const FILTERS = {
  status: activeStatus(),
  q: (value) => contains('name', value),
};

function serialize(supplier) {
  return {
    id: supplier.id,
    name: supplier.name,
    address: supplier.address ?? null,
    contactInfo: supplier.contactInfo ?? null,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

async function list(params, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['name', 'ASC']],
  });

  const { rows, pagination } = await paginate(models.Supplier, options);

  return { rows: rows.map(serialize), pagination };
}

/** @throws {NotFoundError} */
async function getById(id, { models = getModels() } = {}) {
  const supplier = await models.Supplier.findByPk(id);
  if (!supplier) throw new NotFoundError('Supplier not found');
  return supplier;
}

const detail = async (id, options) => serialize(await getById(id, options));

async function create(body, { models = getModels() } = {}) {
  return serialize(await models.Supplier.create(body));
}

async function update(id, body, options = {}) {
  return serialize(await (await getById(id, options)).update(body));
}

/**
 * Soft delete — `06-api.md` §1.7, REQ-SYS-005. The row survives so the
 * contracts referencing it keep their procurement record intact (`BR-005`).
 */
async function setActive(id, isActive, options = {}) {
  const supplier = await getById(id, options);

  if (supplier.isActive === isActive) {
    throw new ConflictError(`Supplier is already ${isActive ? 'active' : 'inactive'}`);
  }

  return serialize(await supplier.update({ isActive }));
}

module.exports = {
  list,
  detail,
  create,
  update,
  deactivate: (id, options) => setActive(id, false, options),
  reactivate: (id, options) => setActive(id, true, options),
  getById,
  serialize,
  SORTABLE,
};
