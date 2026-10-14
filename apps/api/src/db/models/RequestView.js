'use strict';

/**
 * When a user last viewed a Request — P6 (`IMPLEMENTATION_PLAN.md` §64.6),
 * migration 058. Read state only: written by `POST /requests/:id/view`, never
 * audited, never a business fact.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RequestView',
    {
      userId: { type: DataTypes.UUID, primaryKey: true },
      requestId: { type: DataTypes.UUID, primaryKey: true },
      lastSeenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { schema: 'public', tableName: 'request_views', timestamps: false }
  );
