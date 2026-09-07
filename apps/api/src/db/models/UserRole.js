'use strict';

/** `public.user_roles` — 04-data-model.md §5.2.4. Domain: UserRole (association). */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'UserRole',
    {
      userId: { type: DataTypes.UUID, primaryKey: true },
      roleId: { type: DataTypes.UUID, primaryKey: true },
      assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { schema: 'public', tableName: 'user_roles', timestamps: false }
  );
