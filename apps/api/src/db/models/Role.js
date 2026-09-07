'use strict';

/** `ref.roles` — 04-data-model.md §5.1.1. Domain: Role. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Role',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(50), allowNull: false },
      // BR-015: a role granted any Institution/Role/Permission-management
      // permission must be system-wide. That crosses tables and is enforced in
      // the application layer, not here.
      isSystemWide: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // REQ-ROLE-009: whether a scoped administrator may hand this role out.
      // Never both this and `isSystemWide` — `chk_roles_system_wide_not_assignable`
      // enforces that in the database, not here (BR-022).
      isInstitutionAssignable: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // REQ-ROLE-011: the third scope tier. Holders reach only the asset units
      // of departments they are currently PIC of. Never both this and
      // `isSystemWide` — `chk_roles_system_wide_not_pic_scoped` (BR-023).
      isPicScoped: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { schema: 'ref', tableName: 'roles' }
  );
