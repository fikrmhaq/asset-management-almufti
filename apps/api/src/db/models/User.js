'use strict';

/**
 * `public.users` — 04-data-model.md §5.2.3. Domain: User.
 *
 * `passwordHash` carries a `defaultScope` exclusion so it cannot leave the
 * database by accident. Authentication (Phase 3) reads it explicitly through
 * the `withPassword` scope; nothing else should ever select it.
 *
 * A user's `institutionId` grants no authorization by itself — only a
 * system-wide role lifts organization scope (REQ-AUTHZ-005).
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'User',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      username: { type: DataTypes.STRING(25), allowNull: false },
      passwordHash: { type: DataTypes.CHAR(60), allowNull: false },
      firstName: { type: DataTypes.STRING(150), allowNull: false },
      lastName: { type: DataTypes.STRING(150), allowNull: false },
      contactInfo: { type: DataTypes.TEXT, allowNull: true },
      institutionId: { type: DataTypes.UUID, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      schema: 'public',
      tableName: 'users',
      defaultScope: { attributes: { exclude: ['passwordHash'] } },
      scopes: { withPassword: {} },
    }
  );
