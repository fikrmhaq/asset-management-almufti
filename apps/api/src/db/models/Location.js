'use strict';

/**
 * `public.locations` — 04-data-model.md §5.3.8. Domain: Location.
 *
 * Self-referencing to represent physical containment (building → floor → room),
 * REQ-LOC-007. `classificationId` must be a leaf node (REQ-LOC-008, BR-011) and
 * a location must not be its own ancestor (BR-012); both are application-layer
 * rules, since each depends on rows other than the one being written.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Location',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(255), allowNull: false },
      classificationId: { type: DataTypes.CHAR(12), allowNull: false },
      parentLocationId: { type: DataTypes.UUID, allowNull: true },
      institutionId: { type: DataTypes.UUID, allowNull: true },
      // Denormalized cache of the live `location_pic_assignments` row (Phase 21).
      // Responsibility only — it grants no access (`CR-003` §5.4).
      currentPicUserId: { type: DataTypes.UUID, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { schema: 'public', tableName: 'locations' }
  );
