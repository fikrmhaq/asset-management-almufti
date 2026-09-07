'use strict';

const { ATTRIBUTE_TYPES, ATTRIBUTE_SCOPES } = require('../enums');

/**
 * `ref.attribute_definitions` — 04-data-model.md §5.1.5.
 * Domain: AttributeDefinition.
 *
 * `scope` decides whether values live on the Asset or the Asset Unit
 * (REQ-ATTR-001, BR-009); `attributeType` decides which `value_*` column an
 * attribute value populates (BR-010). Both rules are enforced in the
 * application layer.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AttributeDefinition',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      classificationId: { type: DataTypes.CHAR(12), allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      attributeType: {
        type: DataTypes.ENUM(...ATTRIBUTE_TYPES),
        allowNull: false,
        defaultValue: 'TEXT',
      },
      scope: {
        type: DataTypes.ENUM(...ATTRIBUTE_SCOPES),
        allowNull: false,
        defaultValue: 'ASSET',
      },
      isRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      usesMeasurementUnit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      measurementUnitId: { type: DataTypes.UUID, allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { schema: 'ref', tableName: 'attribute_definitions' }
  );
