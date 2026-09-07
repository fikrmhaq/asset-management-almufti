'use strict';

/**
 * `ref.asset_classifications` — 04-data-model.md §5.1.3.
 * Domain: AssetClassification.
 *
 * Partially writable (REQ-CLASS-003 as amended by `CR-001`). `origin` decides
 * which (BR-016):
 *
 *   1  government-issued reference data      read-only
 *   2  local additions inherited from legacy read-only
 *   3  created through this application      renameable, deletable when unused
 *
 * `origin` itself is immutable, so a read-only row can never be talked into
 * becoming a writable one.
 *
 * Assets and Locations must reference a leaf node (REQ-CLASS-009, BR-011). That
 * depends on the absence of child rows and is enforced in the application layer.
 *
 * `timestamps: false` even though `created_at`/`updated_at` now exist: they are
 * nullable and only meaningful for `origin = 3`, so they are written explicitly
 * by the service rather than by Sequelize, which would stamp every row it
 * touches — including ones it must not modify.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AssetClassification',
    {
      id: { type: DataTypes.CHAR(12), primaryKey: true },
      parentId: { type: DataTypes.CHAR(12), allowNull: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      origin: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      categoryId: { type: DataTypes.UUID, allowNull: true },
      institutionId: { type: DataTypes.UUID, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: true },
      updatedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { schema: 'ref', tableName: 'asset_classifications', timestamps: false }
  );
