'use strict';

/**
 * `public.location_floor_plans` — 04-data-model.md §5.3.9. Domain: FloorPlan.
 *
 * Strictly one per Location (REQ-LOC-009), which is why it carries its own file
 * metadata rather than reusing `attachments`.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'LocationFloorPlan',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      locationId: { type: DataTypes.UUID, allowNull: false },
      fileName: { type: DataTypes.STRING(255), allowNull: false },
      fileType: { type: DataTypes.STRING(100), allowNull: false },
      fileSize: { type: DataTypes.BIGINT, allowNull: false },
      storageReference: { type: DataTypes.TEXT, allowNull: false },
      uploadedBy: { type: DataTypes.UUID, allowNull: false },
    },
    { schema: 'public', tableName: 'location_floor_plans' }
  );
