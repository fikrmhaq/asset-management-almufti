'use strict';

/**
 * One period during which a User held a school position — Phase 35 (`CR-014`),
 * `03-domain.md` §4.36, `04-data-model.md` §5.7.1.
 *
 * Grants nothing (`BR-028`). Not audited through model hooks: closed rows are
 * never updated, and `assignedBy` / `endedBy` record who made each change, so the
 * table is its own history — the same reasoning that excludes the PIC tables.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'PositionAssignment',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      institutionId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      positionCode: { type: DataTypes.STRING(32), allowNull: false },
      departmentId: { type: DataTypes.UUID, allowNull: true },
      isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      endedAt: { type: DataTypes.DATE, allowNull: true },
      assignedBy: { type: DataTypes.UUID, allowNull: true },
      endedBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'position_assignments', updatedAt: false }
  );
