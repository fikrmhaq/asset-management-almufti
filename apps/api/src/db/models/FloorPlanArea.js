'use strict';

/**
 * `public.floor_plan_areas` — 04-data-model.md §5.3.10. Domain: FloorPlanArea.
 *
 * `polygon` holds `{x, y}` points normalized to 0–1 relative to the image, so
 * the overlay scales to whatever size the image is rendered at
 * (`07-ui.md` §5.4). The area's Location must be a descendant of the floor
 * plan's Location (BR-014, REQ-LOC-012) — an application-layer rule.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'FloorPlanArea',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      floorPlanId: { type: DataTypes.UUID, allowNull: false },
      locationId: { type: DataTypes.UUID, allowNull: false },
      polygon: { type: DataTypes.JSONB, allowNull: false },
    },
    { schema: 'public', tableName: 'floor_plan_areas' }
  );
