'use strict';

/**
 * `public.asset_unit_locations` — 04-data-model.md §5.3.3. Domain: AssetStorage.
 *
 * One row per location assignment, preserving location history (REQ-LOC-004).
 * `isCurrent` and a null `unassignedAt` both mark the live assignment; keeping
 * them consistent is the location service's job in Phase 5.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AssetUnitLocation',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      assetUnitId: { type: DataTypes.UUID, allowNull: false },
      locationId: { type: DataTypes.UUID, allowNull: false },
      isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      unassignedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { schema: 'public', tableName: 'asset_unit_locations', updatedAt: false }
  );
