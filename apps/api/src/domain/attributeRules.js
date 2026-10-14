'use strict';

/**
 * Attribute value rules — `BR-009`, `BR-010`, REQ-ATTR-006/007/008.
 *
 * `04-data-model.md` §5.3.5/§5.3.6 leave three rules to the application, because
 * each spans tables the value row cannot see:
 *
 *   1. Scope (`BR-009`) — an Asset value needs an `ASSET` definition; an Asset
 *      Unit value needs an `ASSET_UNIT` one.
 *   2. Classification applicability (`BR-010`) — the definition must belong to
 *      the owning asset's classification (for a unit, its parent asset's).
 *   3. Type (REQ-ATTR-008) — exactly one `value_*` column is populated, the one
 *      the definition's `attributeType` names.
 *
 * KNOWN GAP (`GAP-001`, IMPLEMENTATION_PLAN.md §39): a `SELECTION` attribute has
 * nowhere to store its option list, so its value is validated as text only. Do
 * not invent an option list here.
 */

const { getModels } = require('../db/models');
const { ValidationError } = require('../errors');

/** Which `value_*` column each attribute type writes to. */
const VALUE_COLUMN = Object.freeze({
  TEXT: 'valueText',
  NUMBER: 'valueNumeric',
  BOOLEAN: 'valueBoolean',
  DATE: 'valueDate',
  // A selection stores the chosen option, and a reference the referenced key;
  // both are short identifiers rather than free text.
  SELECTION: 'valueReference',
  REFERENCE: 'valueReference',
});

const ALL_VALUE_COLUMNS = Object.freeze([
  'valueText',
  'valueNumeric',
  'valueBoolean',
  'valueDate',
  'valueReference',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerces and checks one supplied value against its definition's type.
 *
 * @returns {object} the `value_*` columns to persist, with the unused ones null
 * @throws {ValidationError}
 */
function coerceValue(definition, value, field) {
  const column = VALUE_COLUMN[definition.attributeType];
  const blank = Object.fromEntries(ALL_VALUE_COLUMNS.map((name) => [name, null]));

  if (value === null || value === undefined || value === '') {
    if (definition.isRequired) {
      throw new ValidationError(`"${definition.name}" is required`, [
        { field, issue: 'is required for this classification (REQ-ATTR-005)' },
      ]);
    }
    return blank;
  }

  const reject = (issue) => {
    throw new ValidationError(`"${definition.name}" has the wrong type`, [{ field, issue }]);
  };

  switch (definition.attributeType) {
    case 'NUMBER': {
      const numeric = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(numeric)) reject('must be a number');
      return { ...blank, valueNumeric: numeric };
    }

    case 'BOOLEAN': {
      if (typeof value === 'boolean') return { ...blank, valueBoolean: value };
      if (value === 'true' || value === 'false') {
        return { ...blank, valueBoolean: value === 'true' };
      }
      return reject('must be true or false');
    }

    case 'DATE': {
      const text = String(value).trim();
      // Stored as DATE, so it is a calendar day with no time or zone.
      if (!ISO_DATE.test(text) || Number.isNaN(Date.parse(text))) {
        reject('must be a date in YYYY-MM-DD format');
      }
      return { ...blank, valueDate: text };
    }

    case 'SELECTION':
    case 'REFERENCE': {
      const text = String(value).trim();
      if (text.length > 255) reject('must be at most 255 characters');
      return { ...blank, [column]: text };
    }

    case 'TEXT':
    default:
      return { ...blank, valueText: String(value) };
  }
}

/**
 * Validates a full set of submitted attribute values against the definitions
 * that apply to a classification, and returns the rows to persist.
 *
 * `PUT` replaces the whole set (`06-api.md` §5.1), so this also enforces that
 * every required definition is present — a partial update could not.
 *
 * @param {{classificationId: string, scope: 'ASSET'|'ASSET_UNIT',
 *          values: Record<string, unknown>}} input
 *   `values` maps attribute definition id → submitted value.
 * @returns {Promise<{attributeDefinitionId: string}[]>} rows minus the owner key
 */
async function buildAttributeValues(
  { classificationId, scope, values },
  { models = getModels() } = {}
) {
  const definitions = await models.AttributeDefinition.findAll({
    where: { classificationId, scope, isActive: true },
  });

  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  // BR-009 and BR-010 together: any id not in this classification-and-scope set
  // is either the wrong scope or the wrong classification, and both are refused.
  const unknown = Object.keys(values).filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new ValidationError(
      'One or more attributes do not apply to this record',
      unknown.map((id) => ({
        field: `values.${id}`,
        issue:
          'must be an active attribute definition for this classification and ' +
          `${scope} scope (BR-009, BR-010)`,
      }))
    );
  }

  const rows = [];
  const problems = [];

  for (const definition of definitions) {
    const field = `values.${definition.id}`;
    try {
      const columns = coerceValue(definition, values[definition.id], field);
      const isEmpty = ALL_VALUE_COLUMNS.every((name) => columns[name] === null);
      if (!isEmpty) rows.push({ attributeDefinitionId: definition.id, ...columns });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      problems.push(...error.details);
    }
  }

  // Report every bad value at once rather than one per round-trip — the form
  // maps `details[].field` straight onto its inputs (`07-ui.md` §4.3).
  if (problems.length > 0) {
    throw new ValidationError('One or more attribute values are invalid', problems);
  }

  return rows;
}

/**
 * Turns a definition and its stored row (or none) into the response entry.
 *
 * `isRequired` and `measurementUnitName` (REQ-REQUEST-021) are additions: the
 * form marks required inputs and shows the unit beside a number. The unit name
 * needs the definition loaded with its `measurementUnit` association; without
 * it the name is null, never guessed.
 */
function serializeValue(row, definition) {
  const column = VALUE_COLUMN[definition?.attributeType ?? 'TEXT'];

  return {
    attributeDefinitionId: row?.attributeDefinitionId ?? definition?.id ?? null,
    name: definition?.name ?? null,
    attributeType: definition?.attributeType ?? null,
    scope: definition?.scope ?? null,
    isRequired: Boolean(definition?.isRequired),
    measurementUnitId: definition?.measurementUnitId ?? null,
    measurementUnitName: definition?.measurementUnit?.name ?? null,
    // NUMERIC arrives from the driver as a string to preserve precision.
    value: row ? (row[column] ?? null) : null,
  };
}

module.exports = {
  VALUE_COLUMN,
  ALL_VALUE_COLUMNS,
  coerceValue,
  buildAttributeValues,
  serializeValue,
};
