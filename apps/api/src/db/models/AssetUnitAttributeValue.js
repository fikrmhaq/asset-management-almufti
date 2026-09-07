'use strict';

/**
 * `public.asset_unit_attribute_values` — 04-data-model.md §5.3.6.
 * Domain: AssetUnitAttributeValue.
 *
 * Same polymorphic pattern as `AssetAttributeValue`, but the definition must
 * have `scope = 'ASSET_UNIT'` and belong to the classification of the unit's
 * parent Asset (BR-009, BR-010, REQ-ATTR-007).
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AssetUnitAttributeValue',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      assetUnitId: { type: DataTypes.UUID, allowNull: false },
      attributeDefinitionId: { type: DataTypes.UUID, allowNull: false },
      valueText: { type: DataTypes.TEXT, allowNull: true },
      valueNumeric: { type: DataTypes.DECIMAL(20, 4), allowNull: true },
      valueBoolean: { type: DataTypes.BOOLEAN, allowNull: true },
      valueDate: { type: DataTypes.DATEONLY, allowNull: true },
      valueReference: { type: DataTypes.STRING(255), allowNull: true },
    },
    { schema: 'public', tableName: 'asset_unit_attribute_values' }
  );
