'use strict';

/**
 * Attribute definitions — `IMPLEMENTATION_PLAN.md` §10.7, `06-api.md` §4.3,
 * REQ-ATTR-001–005.
 *
 * A definition belongs to exactly one classification (REQ-ATTR-002) and declares
 * whether it applies to the Asset or to an Asset Unit (REQ-ATTR-001). That scope
 * is what later decides which table an attribute value may live in (BR-009), so
 * it is validated here rather than at value-write time.
 *
 * KNOWN GAP (`GAP-001`, IMPLEMENTATION_PLAN.md §39): `REQ-ATTR-003` includes a
 * SELECTION type, but `04-data-model.md` §5.1.5 provides nowhere to store its
 * option list. A SELECTION attribute is therefore accepted and stored but is
 * indistinguishable from TEXT at validation time. Do not invent a column here —
 * this needs a specification decision before the Phase 5 attribute-value
 * endpoints can validate against an option list.
 */

const { getModels } = require('../../db/models');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, contains, equals } = require('../../query/filtering');

const SORTABLE = ['name', 'sortOrder', 'createdAt', 'updatedAt'];

const FILTERS = {
  status: activeStatus(),
  classificationId: (value) => equals('classificationId', value),
  scope: (value) => equals('scope', value),
  q: (value) => contains('name', value),
};

function serialize(definition) {
  return {
    id: definition.id,
    classificationId: definition.classificationId?.trim() ?? null,
    name: definition.name,
    attributeType: definition.attributeType,
    scope: definition.scope,
    isRequired: definition.isRequired,
    usesMeasurementUnit: definition.usesMeasurementUnit,
    measurementUnitId: definition.measurementUnitId ?? null,
    description: definition.description ?? null,
    sortOrder: definition.sortOrder,
    isActive: definition.isActive,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

async function list(params, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [
      ['sortOrder', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  const { rows, pagination } = await paginate(models.AttributeDefinition, options);

  return { rows: rows.map(serialize), pagination };
}

async function getById(id, { models = getModels() } = {}) {
  const definition = await models.AttributeDefinition.findByPk(id);
  if (!definition) throw new NotFoundError('Attribute definition not found');
  return definition;
}

const detail = async (id, options) => serialize(await getById(id, options));

/**
 * Cross-field rules the schema cannot express on its own.
 *
 * A measurement unit only makes sense on a numeric attribute, and only when the
 * definition says it uses one — otherwise the UI would render a unit selector
 * for a checkbox (REQ-ATTR-004).
 */
async function assertReferencesValid(body, models) {
  if (body.classificationId !== undefined) {
    const classification = await models.AssetClassification.findByPk(body.classificationId);
    if (!classification) {
      throw new ValidationError('The classification does not exist', [
        { field: 'classificationId', issue: 'must reference an existing classification' },
      ]);
    }
  }

  if (body.measurementUnitId) {
    const unit = await models.MeasurementUnit.findByPk(body.measurementUnitId);
    if (!unit) {
      throw new ValidationError('The measurement unit does not exist', [
        { field: 'measurementUnitId', issue: 'must reference an existing measurement unit' },
      ]);
    }
  }
}

function assertUnitConsistency({ usesMeasurementUnit, measurementUnitId, attributeType }) {
  if (measurementUnitId && usesMeasurementUnit === false) {
    throw new ValidationError('A measurement unit was given for an attribute that uses none', [
      { field: 'measurementUnitId', issue: 'requires usesMeasurementUnit to be true' },
    ]);
  }

  if (usesMeasurementUnit && attributeType && attributeType !== 'NUMBER') {
    throw new ValidationError('Only NUMBER attributes can carry a measurement unit', [
      { field: 'usesMeasurementUnit', issue: `not applicable to a ${attributeType} attribute` },
    ]);
  }
}

async function create(body, { models = getModels() } = {}) {
  await assertReferencesValid(body, models);
  assertUnitConsistency(body);

  const duplicate = await models.AttributeDefinition.findOne({
    where: { classificationId: body.classificationId, name: body.name, scope: body.scope },
  });
  if (duplicate) {
    throw new ConflictError(
      `An attribute named "${body.name}" already exists for this classification and scope`,
      [{ field: 'name', issue: 'must be unique within its classification and scope' }]
    );
  }

  return serialize(await models.AttributeDefinition.create(body));
}

async function update(id, body, options = {}) {
  const models = options.models ?? getModels();
  const definition = await getById(id, { models });

  await assertReferencesValid(body, models);
  assertUnitConsistency({
    usesMeasurementUnit: body.usesMeasurementUnit ?? definition.usesMeasurementUnit,
    measurementUnitId:
      body.measurementUnitId === undefined ? definition.measurementUnitId : body.measurementUnitId,
    attributeType: body.attributeType ?? definition.attributeType,
  });

  return serialize(await definition.update(body));
}

/**
 * Deactivation rather than deletion: stored attribute values reference the
 * definition, and removing it would strip meaning from historical records
 * (REQ-SYS-005, BR-005).
 */
async function setActive(id, isActive, options = {}) {
  const definition = await getById(id, options);

  if (definition.isActive === isActive) {
    throw new ConflictError(`Attribute definition is already ${isActive ? 'active' : 'inactive'}`);
  }

  return serialize(await definition.update({ isActive }));
}

module.exports = {
  list,
  detail,
  create,
  update,
  deactivate: (id, options) => setActive(id, false, options),
  reactivate: (id, options) => setActive(id, true, options),
  serialize,
  SORTABLE,
};
