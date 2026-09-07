'use strict';

/**
 * `ref.permissions` — 04-data-model.md §5.1.10. Domain: Permission.
 *
 * Fixed, system-defined catalog: not user-editable (REQ-ROLE-006, BR-013). The
 * rows are generated from enforced route metadata (`06-api.md` §1.3) and seeded
 * in Phase 3; the table is empty until then.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Permission',
    {
      code: { type: DataTypes.STRING(100), primaryKey: true },
      description: { type: DataTypes.TEXT, allowNull: false },
    },
    { schema: 'ref', tableName: 'permissions', timestamps: false }
  );
