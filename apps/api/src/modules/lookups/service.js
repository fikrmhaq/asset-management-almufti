'use strict';

/**
 * Simple reference lookups — `IMPLEMENTATION_PLAN.md` §10.8, `06-api.md` §4.4,
 * §4.5.
 *
 * Measurement units, contract types, funding sources, transaction types and
 * account codes share one shape: an identifier and a name, plain CRUD, no status
 * column. `06-api.md` §4.4 says so explicitly and `07-ui.md` §5.2 builds one
 * generic screen from it, so this is one parameterized implementation rather
 * than five near-identical ones.
 *
 * Categories reuse the read half only: they are read-only (`06-api.md` §4.2).
 */

const { getModels } = require('../../db/models');
const { NotFoundError, ConflictError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { contains } = require('../../query/filtering');

/**
 * @typedef {object} LookupSpec
 * @property {string} model       model name in the registry
 * @property {string} key         primary key attribute
 * @property {'uuid'|'integer'|'char12'} keyType
 *   The key's storage type, which decides how the path parameter is validated.
 *   These tables genuinely differ: measurement units and categories use
 *   `gen_random_uuid()`, contract/funding/transaction types use
 *   `GENERATED ALWAYS AS IDENTITY`, and account codes a `CHAR(12)` natural key
 *   (`04-data-model.md` §5.1).
 * @property {string} label       singular human name, for error messages
 * @property {string} permission  permission resource prefix
 * @property {boolean} [readOnly]
 * @property {{model: string, column: string, label: string}[]} references
 *   Relations that block a delete. `DELETE` fails with `CONFLICT` if the row is
 *   referenced elsewhere (§4.4) — a lookup silently vanishing from under a
 *   contract would corrupt records that are already historical.
 */

/** @type {Record<string, LookupSpec>} */
const LOOKUPS = {
  'measurement-units': {
    model: 'MeasurementUnit',
    key: 'id',
    keyType: 'uuid',
    label: 'Measurement unit',
    permission: 'measurement-unit',
    references: [
      { model: 'AttributeDefinition', column: 'measurementUnitId', label: 'attribute definitions' },
    ],
  },
  'contract-types': {
    model: 'ContractType',
    key: 'id',
    keyType: 'integer',
    label: 'Contract type',
    permission: 'contract-type',
    references: [{ model: 'Contract', column: 'contractTypeId', label: 'contracts' }],
  },
  'funding-sources': {
    model: 'FundingSource',
    key: 'id',
    keyType: 'integer',
    label: 'Funding source',
    permission: 'funding-source',
    /**
     * The business abbreviation — Phase 26 (`CR-007`), REQ-REF-007. It may be
     * carried into an inventory code, which is why it is unique and why the
     * server never derives it from the name: an institution recording
     * "Dana Bos" calls it `BOS` (`BR-027`).
     */
    fields: ['code'],
    unique: ['name', 'code'],
    // Units record their own funding source since migration 056 (REQ-UNIT-012).
    references: [
      { model: 'Contract', column: 'fundingSourceId', label: 'contracts' },
      { model: 'AssetUnit', column: 'fundingSourceId', label: 'asset units' },
    ],
  },
  'transaction-types': {
    model: 'TransactionType',
    key: 'id',
    keyType: 'integer',
    label: 'Transaction type',
    permission: 'transaction-type',
    references: [{ model: 'Transaction', column: 'transactionTypeId', label: 'transactions' }],
  },
  'account-codes': {
    model: 'AccountCode',
    key: 'code',
    keyType: 'char12',
    label: 'Account code',
    permission: 'account-code',
    references: [{ model: 'Contract', column: 'accountCode', label: 'contracts' }],
  },
  categories: {
    model: 'Category',
    key: 'id',
    keyType: 'uuid',
    label: 'Category',
    permission: 'category',
    readOnly: true,
    references: [],
  },
};

/**
 * `spec.fields` — extra columns a lookup carries beyond `{key, name}`.
 *
 * Funding sources gained a business code in Phase 26 (`CR-007`), and the whole
 * point of this module is that five near-identical resources share one
 * implementation. Breaking one out into its own module for a single column would
 * be the wrong trade; parameterizing it is the same move the spec already makes
 * for `keyType` and `references`.
 */
function serializerFor(spec) {
  return (row) => {
    const extra = Object.fromEntries((spec.fields ?? []).map((field) => [field, row[field] ?? null]));
    return { [spec.key]: row[spec.key]?.trim?.() ?? row[spec.key], name: row.name, ...extra };
  };
}

function buildService(spec) {
  const serialize = serializerFor(spec);
  const SORTABLE = [spec.key, 'name'];

  async function list(params, { models = getModels() } = {}) {
    const options = toFindOptions(params, {
      filters: { q: (value) => contains('name', value) },
      sortable: SORTABLE,
      defaultSort: [['name', 'ASC']],
    });

    const { rows, pagination } = await paginate(models[spec.model], options);

    return { rows: rows.map(serialize), pagination };
  }

  async function getByKey(key, { models = getModels() } = {}) {
    const row = await models[spec.model].findByPk(key);
    if (!row) throw new NotFoundError(`${spec.label} not found`);
    return row;
  }

  const detail = async (key, options) => serialize(await getByKey(key, options));

  /**
   * The fields a duplicate would violate. Checking first turns a driver error
   * into a message naming the field (REQ-VAL-004); the constraint is still what
   * guarantees it.
   */
  const uniqueFields = spec.unique ?? [spec.key === 'code' ? 'code' : 'name'];

  async function assertUnique(body, { models, current = null }) {
    for (const field of uniqueFields) {
      const value = body[field];
      if (value === undefined || value === null) continue;
      if (current && value === current[field]) continue;

      const clash = await models[spec.model].findOne({ where: { [field]: value } });
      if (clash && (!current || clash[spec.key] !== current[spec.key])) {
        throw new ConflictError(`A ${spec.label.toLowerCase()} with this ${field} already exists`, [
          { field, issue: 'must be unique' },
        ]);
      }
    }
  }

  async function create(body, { models = getModels() } = {}) {
    await assertUnique(body, { models });

    return serialize(await models[spec.model].create(body));
  }

  async function update(key, body, options = {}) {
    const models = options.models ?? getModels();
    const row = await getByKey(key, { models });

    await assertUnique(body, { models, current: row });

    return serialize(await row.update(body));
  }

  async function remove(key, options = {}) {
    const models = options.models ?? getModels();
    const row = await getByKey(key, { models });

    // Sequential on purpose: the first referencing relation found is enough to
    // refuse the delete, so there is nothing to gain from checking them all.
    for (const reference of spec.references) {
      const count = await models[reference.model].count({ where: { [reference.column]: key } });
      if (count > 0) {
        throw new ConflictError(
          `${spec.label} is referenced by ${count} ${reference.label} and cannot be deleted`
        );
      }
    }

    await row.destroy();
  }

  return { list, detail, create, update, remove, serialize, SORTABLE, spec };
}

/** Memoized per resource so the schemas and services are built once. */
const services = new Map();

function lookupService(resource) {
  if (!LOOKUPS[resource]) throw new Error(`Unknown lookup resource "${resource}"`);
  if (!services.has(resource)) services.set(resource, buildService(LOOKUPS[resource]));
  return services.get(resource);
}

module.exports = { LOOKUPS, lookupService };
