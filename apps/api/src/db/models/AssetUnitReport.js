'use strict';

const { CONDITIONS } = require('../enums');

/**
 * A Room PIC's report about one unit — REQ-REQUEST-025, migration 066
 * (`IMPLEMENTATION_PLAN.md` §72; `domain/assetUnitReports.js`).
 *
 * A CLAIM, never state. The original observation — kind, narrative, the reported
 * condition or destination (with its name as reported), the unit's state when
 * reported, reporter and time — is written once and never changed. Only the
 * review fields are written afterwards, once: `PENDING` → `CONFIRMED` |
 * `REJECTED`. A confirmed CONDITION / MOVEMENT report links the one `REPORT`
 * history row it produced (`historyId`). Audited.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AssetUnitReport',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      institutionId: { type: DataTypes.UUID, allowNull: false },
      assetUnitId: { type: DataTypes.UUID, allowNull: false },
      kind: { type: DataTypes.STRING(20), allowNull: false },
      narrative: { type: DataTypes.TEXT, allowNull: false },
      reportedCondition: { type: DataTypes.ENUM(...CONDITIONS), allowNull: true },
      destinationLocationId: { type: DataTypes.UUID, allowNull: true },
      destinationName: { type: DataTypes.STRING(255), allowNull: true },
      snapshotLocationId: { type: DataTypes.UUID, allowNull: false },
      snapshotLocationName: { type: DataTypes.STRING(255), allowNull: false },
      snapshotCondition: { type: DataTypes.ENUM(...CONDITIONS), allowNull: true },
      snapshotHistoryId: { type: DataTypes.UUID, allowNull: true },
      reporterId: { type: DataTypes.UUID, allowNull: false },
      reportedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING' },
      reviewedBy: { type: DataTypes.UUID, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      reviewNote: { type: DataTypes.TEXT, allowNull: true },
      staleAcknowledged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      historyId: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'asset_unit_reports' }
  );
