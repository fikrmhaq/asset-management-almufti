'use strict';

/**
 * `public.asset_attribute_values` — 04-data-model.md §5.3.5.
 * Domain: AssetAttributeValue.
 *
 * Polymorphic value pattern: exactly one `value_*` column is populated, chosen
 * by the definition's `attributeType`. The definition must also have
 * `scope = 'ASSET'` and belong to the asset's classification (BR-009, BR-010).
 * All three rules are enforced in the application layer.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AssetAttributeValue',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      assetId: { type: DataTypes.UUID, allowNull: false },
      attributeDefinitionId: { type: DataTypes.UUID, allowNull: false },
      valueText: { type: DataTypes.TEXT, allowNull: true },
      valueNumeric: { type: DataTypes.DECIMAL(20, 4), allowNull: true },
      valueBoolean: { type: DataTypes.BOOLEAN, allowNull: true },
      valueDate: { type: DataTypes.DATEONLY, allowNull: true },
      valueReference: { type: DataTypes.STRING(255), allowNull: true },
    },
    { schema: 'public', tableName: 'asset_attribute_values' }
  );
