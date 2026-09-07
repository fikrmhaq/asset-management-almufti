'use strict';

/**
 * `public.assets` — 04-data-model.md §5.3.1. Domain: Asset.
 *
 * The master record. Physical items are its Asset Units; department assignment
 * lives there, not here (§5.3.2).
 *
 * `contractId` is the procurement link (REQ-ASSET-011) and is nullable by
 * design — donated, self-constructed and migrated historical assets have no
 * contract to reference.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Asset',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(255), allowNull: false },
      classificationId: { type: DataTypes.CHAR(12), allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      contractId: { type: DataTypes.UUID, allowNull: true },
      institutionId: { type: DataTypes.UUID, allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'assets' }
  );
