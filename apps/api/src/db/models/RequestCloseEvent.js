'use strict';

/**
 * One successful close of a Request's remainder — Phase 41
 * (`IMPLEMENTATION_PLAN.md` §60.2). Append-only: never updated or deleted.
 * `closedAt` and `closedBy` are the server's. Audited.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RequestCloseEvent',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      requestId: { type: DataTypes.UUID, allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      closedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      closedBy: { type: DataTypes.UUID, allowNull: false },
    },
    { schema: 'public', tableName: 'request_close_events', timestamps: false }
  );
