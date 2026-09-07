'use strict';

/**
 * Attribute values — `IMPLEMENTATION_PLAN.md` §11.7, `06-api.md` §5.1/§5.2,
 * REQ-ATTR-006/007/008.
 *
 * Assets and Asset Units store values in separate tables against separate
 * scopes, but the rules are identical, so both go through one implementation
 * parameterized by scope. The rules themselves live in
 * `src/domain/attributeRules.js`.
 */

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { buildAttributeValues, serializeValue } = require('../../domain/attributeRules');
const { ForbiddenError } = require('../../errors');
const { organizationScope } = require('../../auth/principal');
const assetService = require('../assets/service');
const assetUnitService = require('../assetUnits/service');

/** The two scopes, and everything that differs between them. */
const TARGETS = Object.freeze({
  asset: {
    scope: 'ASSET',
    model: 'AssetAttributeValue',
    ownerKey: 'assetId',
  },
  assetUnit: {
    scope: 'ASSET_UNIT',
    model: 'AssetUnitAttributeValue',
    ownerKey: 'assetUnitId',
  },
});

/**
 * Loads the owner, checks the caller may reach it, and returns the
 * classification its values must belong to.
 */
async function resolveOwner(target, ownerId, principal, models) {
  if (target.scope === 'ASSET') {
    /**
     * The ASSET target is closed to PIC-scoped callers — `CR-004` §6.4.
     *
     * `asset-attribute-value:read` / `:update` guard BOTH targets, so the
     * permission ceiling cannot separate them: a PIC needs those codes for their
     * own units, and the same codes reach `GET/PUT /assets/:id/attribute-values`,
     * where `assetService.getById` is institution containment only. Without this
     * a PIC could read — and overwrite — the attribute values of every asset in
     * their institution.
     *
     * `ForbiddenError`, not `NotFoundError`: the asset is legitimately visible to
     * their institution and it is the OPERATION that is unavailable, which is the
     * distinction `CR-004` §12 draws.
     */
    if (organizationScope(principal).picScoped) {
      throw new ForbiddenError(
        'Attribute values on an Asset are managed at institution scope; ' +
          "a PIC-scoped role may edit only its own units' values (CR-004)"
      );
    }

    const asset = await assetService.getById(ownerId, principal, { models });
    return { owner: asset, classificationId: String(asset.classificationId).trim() };
  }

  const unit = await assetUnitService.getById(ownerId, principal, { models });
  return {
    owner: unit,
    classificationId: await assetUnitService.classificationFor(unit, { models }),
  };
}

/**
 * Current values, joined to their definitions so the response carries the name,
 * type and unit the UI needs to render an input (`07-ui.md` §18.7).
 */
async function list(targetName, ownerId, principal, { models = getModels() } = {}) {
  const target = TARGETS[targetName];
  const { classificationId } = await resolveOwner(target, ownerId, principal, models);

  // Active definitions only, matching exactly what `replace` will accept. A
  // form rendered from a wider set would offer inputs the server then refuses.
  // Values whose definition has since been deactivated are not deleted — they
  // are simply not shown, and reappear if the definition is reactivated.
  const [rows, definitions] = await Promise.all([
    models[target.model].findAll({ where: { [target.ownerKey]: ownerId } }),
    models.AttributeDefinition.findAll({
      where: { classificationId, scope: target.scope, isActive: true },
      order: [
        ['sortOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    }),
  ]);

  const valuesByDefinition = new Map(rows.map((row) => [row.attributeDefinitionId, row]));

  // Every applicable definition is returned, valued or not, so the form can be
  // rendered from this one response without a second call for the schema.
  return definitions.map((definition) => {
    const row = valuesByDefinition.get(definition.id);
    return row
      ? serializeValue(row, definition)
      : {
          attributeDefinitionId: definition.id,
          name: definition.name,
          attributeType: definition.attributeType,
          scope: definition.scope,
          measurementUnitId: definition.measurementUnitId ?? null,
          value: null,
        };
  });
}

/**
 * Replaces the entire value set — `06-api.md` §5.1/§5.2 use PUT, not PATCH.
 *
 * Replacement is what makes "this attribute was cleared" expressible, and it is
 * also the only shape that can enforce required attributes: a partial update
 * cannot tell an omitted field from a deliberately empty one.
 */
async function replace(targetName, ownerId, values, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const target = TARGETS[targetName];

  const { classificationId } = await resolveOwner(target, ownerId, principal, models);

  const rows = await buildAttributeValues(
    { classificationId, scope: target.scope, values },
    { models }
  );

  const editableIds = (
    await models.AttributeDefinition.findAll({
      attributes: ['id'],
      where: { classificationId, scope: target.scope, isActive: true },
    })
  ).map((definition) => definition.id);

  await withTransaction(
    async (transaction) => {
      // Only the editable set is replaced. A value whose definition was
      // deactivated after it was recorded is left alone rather than destroyed —
      // deactivation is not deletion (REQ-SYS-005, BR-005).
      await models[target.model].destroy({
        where: { [target.ownerKey]: ownerId, attributeDefinitionId: editableIds },
        transaction,
      });

      if (rows.length > 0) {
        await models[target.model].bulkCreate(
          rows.map((row) => ({ ...row, [target.ownerKey]: ownerId })),
          { transaction }
        );
      }
    },
    { sequelize }
  );

  return list(targetName, ownerId, principal, { models });
}

module.exports = { TARGETS, list, replace };
