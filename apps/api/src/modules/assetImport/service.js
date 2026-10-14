'use strict';

/**
 * Asset import — registering assets and their units from an Excel or CSV file.
 *
 * AN ADDITION, NOT A REPLACEMENT. The manual path (`POST /assets`, then
 * `POST /assets/:id/units`, then `POST /asset-units/:id/history`) is unchanged.
 * Import does exactly what a registrar could do by hand through those three
 * calls, through the same rules, and needs the same permissions — nothing a
 * file can do is out of reach by hand, and nothing is in reach only by file.
 *
 * THE FILE. One row is a group of units: `Jumlah unit` units of one asset, at
 * one location, in one condition, of one department and funding source. Rows
 * naming the same asset name and classification become ONE asset, so 36 chairs
 * in X-1 and 36 in X-2 are two rows of one asset with 72 units — and a format
 * that needs a number composition per unit is satisfied by one row per unit.
 * Import always creates NEW assets; it never adds units to an existing one
 * (that stays the asset page's job), and says so when a name already exists.
 *
 * ALL OR NOTHING. Every row is checked first, and nothing is written unless
 * every row is valid. The writes then run in ONE transaction, so a failure on
 * row 900 leaves no trace of rows 1–899.
 *
 * THE PREVIEW IS THE IMPORT, ROLLED BACK. Rather than a second, approximate
 * validator, the preview runs the very same writes and rolls them back — so the
 * inventory codes it shows are the ones the import will issue (unless someone
 * registers units in between, which the import then simply reflects).
 */

const { Op, fn, col, where: whereClause } = require('sequelize');

const { getModels, normalizeCharKey } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { CONDITIONS } = require('../../db/enums');
const { ConflictError, ValidationError } = require('../../errors');
const { hasPermission } = require('../../auth/principal');
const {
  defaultInstitutionFor,
  assertCanAssignInstitution,
  assertCanCreateStandaloneAsset,
  assertCanAssignDepartment,
} = require('../../domain/scope');
const { assertDepartmentAssignable } = require('../../domain/departmentRules');
const { assertLeafClassification } = require('../../domain/classificationRules');
const { registrationHint } = require('../../domain/inventoryCodeFormat');
const unitService = require('../assetUnits/service');
const { parseImportFile, ImportFileError, LABELS } = require('./parse');

const LIMITS = Object.freeze({ rows: 1000, unitsPerRow: 500, units: 2000 });

/** Accepted spellings of each condition: the code, and the label the app shows. */
const CONDITION_WORDS = Object.freeze({
  GOOD: 'GOOD',
  BAIK: 'GOOD',
  FAIR: 'FAIR',
  CUKUP: 'FAIR',
  POOR: 'POOR',
  'KURANG BAIK': 'POOR',
  DAMAGED: 'DAMAGED',
  RUSAK: 'DAMAGED',
  UNSERVICEABLE: 'UNSERVICEABLE',
  'RUSAK BERAT': 'UNSERVICEABLE',
});

/** Which import column a shared rule's `field` belongs to. */
const FIELD_COLUMNS = Object.freeze({
  numberComposition: 'numberComposition',
  numberCompositions: 'numberComposition',
  fundingSourceId: 'fundingSource',
  departmentId: 'department',
  locationId: 'location',
  condition: 'condition',
  classificationId: 'classification',
});

const fold = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Several composition values in one cell, one per unit. */
const splitCompositions = (value) =>
  String(value)
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);

function issue(row, column, code, message, params = {}) {
  return { row, column: column ? LABELS[column] : null, code, message, params };
}

/** A shared rule's refusal, attributed to the row and column it concerns. */
function fromValidationError(row, error, fallbackColumn) {
  const details = error.details?.length ? error.details : [{ issue: error.message }];
  return details.map((detail) =>
    issue(
      row,
      FIELD_COLUMNS[detail.field] ?? fallbackColumn ?? null,
      'RULE',
      detail.issue ? `${error.message}: ${detail.issue}` : error.message
    )
  );
}

class RowFailure extends Error {
  constructor(row, error) {
    super(error.message);
    this.row = row;
    this.cause = error;
  }
}

const ROLLBACK = Symbol('asset import preview rollback');

/**
 * Everything the rows refer to, loaded once per import and looked up by folded
 * text — a 1,000-row file names the same handful of rooms over and over.
 */
async function loadReferences(institutionId, models) {
  const [departments, fundingSources, locations] = await Promise.all([
    models.Department.findAll({ where: { institutionId } }),
    models.FundingSource.findAll(),
    models.Location.findAll({ where: { institutionId, isActive: true } }),
  ]);

  const index = (records, keys) => {
    const map = new Map();
    for (const record of records) {
      for (const key of keys(record)) {
        if (!key) continue;
        const folded = fold(key);
        const list = map.get(folded) ?? [];
        if (!list.includes(record)) list.push(record);
        map.set(folded, list);
      }
    }
    return map;
  };

  return {
    departments: index(departments, (d) => [d.code, d.name]),
    fundingSources: index(fundingSources, (f) => [f.code, f.name]),
    locations: index(locations, (l) => [l.name]),
    classifications: new Map(),
  };
}

/**
 * A classification by its 12-digit code, or by the exact name of a most
 * specific one. A name shared by several leaves is refused rather than guessed.
 */
async function resolveClassification(value, { institutionId, models, cache }) {
  const key = fold(value);
  if (cache.has(key)) return cache.get(key);

  let result;
  const code = value.replace(/\s+/g, '');
  if (/^\d{12}$/.test(code)) {
    try {
      await assertLeafClassification(code, { models, institutionId });
      const found = await models.AssetClassification.findByPk(code);
      result = { id: normalizeCharKey(found.id), name: found.name };
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      result = { error };
    }
  } else {
    const candidates = await models.AssetClassification.findAll({
      where: {
        [Op.and]: [
          whereClause(fn('lower', col('name')), key),
          { [Op.or]: [{ institutionId: null }, { institutionId }] },
        ],
      },
      limit: 20,
    });
    const leaves = [];
    for (const candidate of candidates) {
      const children = await models.AssetClassification.count({
        where: { parentId: candidate.id },
      });
      if (children === 0) leaves.push(candidate);
    }
    if (leaves.length === 1) {
      result = { id: normalizeCharKey(leaves[0].id), name: leaves[0].name };
    } else {
      result = {
        missing: leaves.length === 0,
        ambiguous: leaves.length > 1 ? leaves.map((leaf) => normalizeCharKey(leaf.id)) : null,
      };
    }
  }

  cache.set(key, result);
  return result;
}

function pickOne(map, value) {
  const found = map.get(fold(value)) ?? [];
  return { record: found.length === 1 ? found[0] : null, count: found.length };
}

/**
 * Checks one row against everything that can be decided before writing.
 * Returns the resolved row, and the problems found (all of them, not the first).
 */
async function resolveRow(raw, context) {
  const { institution, principal, models, references, hint } = context;
  const problems = [];
  const at = (column, code, message, params) =>
    problems.push(issue(raw.row, column, code, message, params));

  const resolved = { row: raw.row, name: raw.name.replace(/\s+/g, ' ').trim() };

  if (!resolved.name) at('name', 'REQUIRED', 'is required');
  else if (resolved.name.length > 255)
    at('name', 'TOO_LONG', 'must be at most 255 characters', { max: 255 });

  if (!raw.classification) {
    at('classification', 'REQUIRED', 'is required');
  } else {
    const found = await resolveClassification(raw.classification, {
      institutionId: institution.id,
      models,
      cache: references.classifications,
    });
    if (found.error) problems.push(...fromValidationError(raw.row, found.error, 'classification'));
    else if (found.missing) {
      at(
        'classification',
        'CLASSIFICATION_NOT_FOUND',
        `no most specific classification is called "${raw.classification}"`,
        { value: raw.classification }
      );
    } else if (found.ambiguous) {
      at(
        'classification',
        'CLASSIFICATION_AMBIGUOUS',
        `several classifications are called "${raw.classification}"; use the 12-digit code (${found.ambiguous.join(', ')})`,
        { value: raw.classification, codes: found.ambiguous.join(', ') }
      );
    } else {
      resolved.classification = found;
    }
  }

  // Blank means one unit; a whole number otherwise ("10.0" is how Excel may say 10).
  const quantityText = raw.quantity || '1';
  const quantity = /^\d+(\.0+)?$/.test(quantityText) ? Number.parseInt(quantityText, 10) : NaN;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > LIMITS.unitsPerRow) {
    at('quantity', 'QUANTITY_INVALID', `must be a whole number from 1 to ${LIMITS.unitsPerRow}`, {
      max: LIMITS.unitsPerRow,
    });
  } else {
    resolved.quantity = quantity;
  }

  resolved.departmentId = null;
  if (raw.department) {
    const { record, count } = pickOne(references.departments, raw.department);
    if (!record) {
      at(
        'department',
        count > 1 ? 'DEPARTMENT_AMBIGUOUS' : 'DEPARTMENT_NOT_FOUND',
        count > 1
          ? `"${raw.department}" matches several departments; use the code`
          : `no department of this institution is "${raw.department}"`,
        { value: raw.department }
      );
    } else {
      try {
        assertCanAssignDepartment(principal, record.id);
        await assertDepartmentAssignable(record.id, { institutionId: institution.id }, { models });
        resolved.departmentId = record.id;
        resolved.department = { id: record.id, code: record.code, name: record.name };
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        problems.push(...fromValidationError(raw.row, error, 'department'));
      }
    }
  }

  resolved.fundingSource = null;
  if (raw.fundingSource) {
    const { record, count } = pickOne(references.fundingSources, raw.fundingSource);
    if (!record) {
      at(
        'fundingSource',
        count > 1 ? 'FUNDING_SOURCE_AMBIGUOUS' : 'FUNDING_SOURCE_NOT_FOUND',
        count > 1
          ? `"${raw.fundingSource}" matches several funding sources; use the code`
          : `no funding source is "${raw.fundingSource}"`,
        { value: raw.fundingSource }
      );
    } else if (hint.fundingSource.inCode && !record.code) {
      at(
        'fundingSource',
        'FUNDING_SOURCE_NO_CODE',
        `"${record.name}" has no code, and this institution's inventory codes include the funding source code`,
        { value: record.name }
      );
    } else {
      resolved.fundingSource = { id: record.id, code: record.code ?? null, name: record.name };
    }
  } else if (hint.fundingSource.inCode) {
    // Import creates contractless assets, so the units must say it themselves.
    at(
      'fundingSource',
      'FUNDING_SOURCE_REQUIRED',
      "is required: this institution's inventory codes include the funding source"
    );
  }

  resolved.numberCompositions = [];
  if (resolved.quantity) {
    const values = raw.numberComposition ? splitCompositions(raw.numberComposition) : [];
    try {
      resolved.numberCompositions = unitService.resolveCompositions(institution, {
        single: values.length === 1 ? values[0] : undefined,
        list: values.length > 1 ? values : undefined,
        count: resolved.quantity,
      });
      const tooLong = resolved.numberCompositions.find((value) => value.length > 32);
      if (tooLong)
        at('numberComposition', 'TOO_LONG', `"${tooLong}" is longer than 32 characters`, {
          max: 32,
        });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      problems.push(...fromValidationError(raw.row, error, 'numberComposition'));
    }
  }

  resolved.location = null;
  if (raw.location) {
    const { record, count } = pickOne(references.locations, raw.location);
    if (!record) {
      at(
        'location',
        count > 1 ? 'LOCATION_AMBIGUOUS' : 'LOCATION_NOT_FOUND',
        count > 1
          ? `several active locations are called "${raw.location}"`
          : `no active location of this institution is called "${raw.location}"`,
        { value: raw.location }
      );
    } else {
      resolved.location = { id: record.id, name: record.name };
    }
  }

  resolved.condition = null;
  if (raw.condition) {
    const condition =
      CONDITION_WORDS[
        raw.condition
          .replace(/[_\s]+/g, ' ')
          .trim()
          .toUpperCase()
      ];
    if (!condition) {
      at(
        'condition',
        'CONDITION_INVALID',
        `must be one of ${CONDITIONS.join(', ')} (or Baik, Cukup, Kurang baik, Rusak, Rusak berat)`,
        { value: raw.condition }
      );
    } else {
      resolved.condition = condition;
    }
  }

  // The first history entry records both or neither (REQ-LOC-003, REQ-COND-003).
  if (raw.location && !raw.condition)
    at('condition', 'CONDITION_REQUIRED', 'is required when a location is given');
  if (raw.condition && !raw.location)
    at('location', 'LOCATION_REQUIRED', 'is required when a condition is given');

  resolved.description = raw.description || null;
  if (resolved.description && resolved.description.length > 5000) {
    at('description', 'TOO_LONG', 'must be at most 5000 characters', { max: 5000 });
  }

  return { resolved, problems };
}

/** Rows naming the same asset (name and classification) become one asset. */
function groupIntoAssets(rows) {
  const assets = new Map();
  for (const row of rows) {
    const key = `${fold(row.name)}|${row.classification.id}`;
    if (!assets.has(key)) {
      assets.set(key, {
        key,
        name: row.name,
        classificationId: row.classification.id,
        classificationName: row.classification.name,
        rows: [],
      });
    }
    assets.get(key).rows.push(row);
  }
  return [...assets.values()];
}

/** A warning, not a refusal: the registrar may well mean a second asset. */
async function existingAssetWarnings(assets, institutionId, models) {
  if (assets.length === 0) return [];
  const existing = await models.Asset.findAll({
    where: {
      institutionId,
      isActive: true,
      classificationId: [...new Set(assets.map((asset) => asset.classificationId))],
    },
    attributes: ['name', 'classificationId'],
  });
  const keys = new Set(
    existing.map((asset) => `${fold(asset.name)}|${normalizeCharKey(asset.classificationId)}`)
  );

  return assets
    .filter((asset) => keys.has(asset.key))
    .map((asset) => {
      asset.existing = true;
      return issue(
        asset.rows[0].row,
        'name',
        'ASSET_EXISTS',
        `an asset called "${asset.name}" with this classification already exists; import creates a new one`,
        { value: asset.name }
      );
    });
}

/** Writes every asset, unit and first history entry, inside `transaction`. */
async function write(assets, { institution, principal, models, transaction, fileName }) {
  for (const asset of assets) {
    const created = await models.Asset.create(
      {
        name: asset.name,
        classificationId: asset.classificationId,
        institutionId: institution.id,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      },
      { transaction }
    );
    asset.id = created.id;

    for (const row of asset.rows) {
      try {
        const codes = await unitService.allocateCodesForAsset(created, row.quantity, {
          models,
          transaction,
          departmentId: row.departmentId,
          numberCompositions: row.numberCompositions,
          fundingSource: row.fundingSource
            ? { code: row.fundingSource.code, name: row.fundingSource.name }
            : null,
        });

        row.inventoryCodes = [];
        for (let index = 0; index < row.quantity; index += 1) {
          const unit = await models.AssetUnit.create(
            {
              assetId: created.id,
              inventoryCode: codes[index],
              numberComposition: row.numberCompositions[index] ?? null,
              departmentId: row.departmentId,
              fundingSourceId: row.fundingSource?.id ?? null,
              description: row.description,
              createdBy: principal.userId,
              updatedBy: principal.userId,
            },
            { transaction }
          );
          row.inventoryCodes.push(codes[index]);

          if (row.location) {
            await unitService.applyStateChange(
              unit,
              {
                locationId: row.location.id,
                condition: row.condition,
                description: `Recorded on import (row ${row.row} of ${fileName})`,
              },
              principal,
              // The same writer as a person recording a unit's state by hand.
              { models, transaction, entryType: 'MANUAL' }
            );
          }
        }
      } catch (error) {
        // A composition repeated against an existing unit, named on its column.
        throw new RowFailure(
          row.row,
          unitService.asDuplicateCodeError(error, row.numberCompositions)
        );
      }
    }
  }
}

function report({
  dryRun,
  imported = false,
  fileIssues = [],
  issues = [],
  warnings = [],
  assets = [],
  rowCount = 0,
}) {
  const units = assets.reduce(
    (sum, asset) => sum + asset.rows.reduce((total, row) => total + row.quantity, 0),
    0
  );
  return {
    dryRun,
    imported,
    valid: fileIssues.length === 0 && issues.length === 0,
    fileIssues,
    issues,
    warnings,
    summary: { rows: rowCount, assets: assets.length, units },
    assets: assets.map((asset) => ({
      id: asset.id ?? null,
      name: asset.name,
      classificationId: asset.classificationId,
      classificationName: asset.classificationName,
      existing: Boolean(asset.existing),
      unitCount: asset.rows.reduce((total, row) => total + row.quantity, 0),
      rows: asset.rows.map((row) => ({
        row: row.row,
        quantity: row.quantity,
        department: row.department ? row.department.code : null,
        fundingSource: row.fundingSource
          ? (row.fundingSource.code ?? row.fundingSource.name)
          : null,
        location: row.location?.name ?? null,
        condition: row.condition,
        inventoryCodes: row.inventoryCodes ?? [],
      })),
    })),
  };
}

const fileIssue = (code, message, params = {}) => ({ code, message, params });

/**
 * Checks the file and, when every row is valid, runs the import — committed,
 * or rolled back when `dryRun`. Always answers a report; the route decides how
 * an invalid one is answered.
 */
async function run(
  file,
  body,
  principal,
  { dryRun, models = getModels(), sequelize = getSequelize() }
) {
  // Before the file is even read: a Kajur or Toolman never creates a standalone
  // asset (P3, §64.3), and importing is creating them.
  assertCanCreateStandaloneAsset(principal);
  const institutionId = defaultInstitutionFor(principal, body.institutionId || undefined);
  if (!institutionId) {
    return report({
      dryRun,
      fileIssues: [
        fileIssue('NO_INSTITUTION', 'Choose the institution the assets are registered to'),
      ],
    });
  }
  assertCanAssignInstitution(principal, institutionId);
  const institution = await models.Institution.findByPk(institutionId);
  if (!institution) {
    throw new ValidationError('The institution does not exist', [
      { field: 'institutionId', issue: 'must reference an existing institution' },
    ]);
  }

  let parsed;
  try {
    parsed = await parseImportFile(file);
  } catch (error) {
    if (!(error instanceof ImportFileError)) throw error;
    return report({ dryRun, fileIssues: [fileIssue(error.code, error.message, error.params)] });
  }

  const { rows } = parsed;
  const warnings = parsed.ignoredColumns.map((title) =>
    issue(1, null, 'UNKNOWN_COLUMN', `the column "${title}" is not recognised and is ignored`, {
      value: title,
    })
  );

  if (rows.length === 0) {
    return report({
      dryRun,
      warnings,
      fileIssues: [fileIssue('NO_ROWS', 'The file has no rows to import')],
    });
  }
  if (rows.length > LIMITS.rows) {
    return report({
      dryRun,
      warnings,
      rowCount: rows.length,
      fileIssues: [
        fileIssue('TOO_MANY_ROWS', `At most ${LIMITS.rows} rows can be imported at once`, {
          max: LIMITS.rows,
        }),
      ],
    });
  }

  const context = {
    institution,
    principal,
    models,
    references: await loadReferences(institution.id, models),
    hint: registrationHint(institution),
  };

  const resolvedRows = [];
  const issues = [];
  for (const raw of rows) {
    const { resolved, problems } = await resolveRow(raw, context);
    if (problems.length > 0) issues.push(...problems);
    else resolvedRows.push(resolved);
  }

  const fileIssues = [];
  const totalUnits = resolvedRows.reduce((sum, row) => sum + row.quantity, 0);
  if (totalUnits > LIMITS.units) {
    fileIssues.push(
      fileIssue(
        'TOO_MANY_UNITS',
        `At most ${LIMITS.units} units can be imported at once; this file has ${totalUnits}`,
        { max: LIMITS.units, count: totalUnits }
      )
    );
  }
  // Placing a unit is recording its history — the same permission as by hand.
  if (
    resolvedRows.some((row) => row.location) &&
    !hasPermission(principal, 'asset-unit:record-history')
  ) {
    fileIssues.push(
      fileIssue(
        'NO_HISTORY_PERMISSION',
        'Recording a location and condition needs the asset-unit:record-history permission; leave Lokasi and Kondisi empty, or ask for it'
      )
    );
  }

  const assets = groupIntoAssets(resolvedRows);
  warnings.push(...(await existingAssetWarnings(assets, institution.id, models)));

  if (issues.length > 0 || fileIssues.length > 0) {
    return report({ dryRun, fileIssues, issues, warnings, assets, rowCount: rows.length });
  }

  try {
    await sequelize.transaction(async (transaction) => {
      await write(assets, {
        institution,
        principal,
        models,
        transaction,
        fileName: String(file.originalname ?? 'file').slice(0, 120),
      });
      if (dryRun) throw ROLLBACK;
    });
  } catch (error) {
    if (error === ROLLBACK) {
      return report({ dryRun, warnings, assets, rowCount: rows.length });
    }
    if (error instanceof RowFailure) {
      const cause = error.cause;
      if (!(cause instanceof ValidationError || cause instanceof ConflictError)) throw cause;
      return report({
        dryRun,
        warnings,
        rowCount: rows.length,
        assets: [],
        issues: fromValidationError(error.row, cause, null),
      });
    }
    throw error;
  }

  return report({ dryRun, imported: true, warnings, assets, rowCount: rows.length });
}

const preview = (file, body, principal, options = {}) =>
  run(file, body, principal, { ...options, dryRun: true });

/**
 * The import itself. A file that is no longer valid — someone deactivated a
 * room since the preview — is refused as a `400` naming each row, and nothing
 * is written.
 */
async function importAssets(file, body, principal, options = {}) {
  const result = await run(file, body, principal, { ...options, dryRun: false });
  if (!result.valid) {
    throw new ValidationError('The file has problems, so nothing was imported', [
      ...result.fileIssues.map((problem) => ({ field: 'file', issue: problem.message })),
      ...result.issues.map((problem) => ({
        field: problem.column ? `row ${problem.row} · ${problem.column}` : `row ${problem.row}`,
        issue: problem.message,
      })),
    ]);
  }
  return result;
}

module.exports = { preview, importAssets, LIMITS, CONDITION_WORDS };
