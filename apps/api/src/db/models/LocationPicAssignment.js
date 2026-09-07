'use strict';

/**
 * `public.location_pic_assignments` — 04-data-model.md §5.3.9.
 * Domain: LocationPicAssignment. Phase 21 (`CR-003`).
 *
 * Identical in shape to `DepartmentPicAssignment`, and identical in every rule
 * except one: a Location PIC grants NO authorization, now or in Phase 22
 * (`CR-003` §5.4). Locations nest, so a building's PIC would reach every unit in
 * every room beneath it; and a unit's location changes as it is borrowed and
 * returned, so a location-derived grant would appear and disappear as items are
 * physically moved. Responsibility and history only.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'LocationPicAssignment',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      locationId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      endedAt: { type: DataTypes.DATE, allowNull: true },
      assignedBy: { type: DataTypes.UUID, allowNull: true },
      endedBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'location_pic_assignments', updatedAt: false }
  );
