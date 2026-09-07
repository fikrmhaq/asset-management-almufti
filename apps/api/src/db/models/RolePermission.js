'use strict';

/**
 * `public.role_permissions` — 04-data-model.md §5.2.5.
 * Domain: RolePermission (association).
 *
 * The admin-editable half of the authorization model (REQ-ROLE-007);
 * `ref.permissions` itself is fixed.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RolePermission',
    {
      roleId: { type: DataTypes.UUID, primaryKey: true },
      permissionCode: { type: DataTypes.STRING(100), primaryKey: true },
      assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { schema: 'public', tableName: 'role_permissions', timestamps: false }
  );
