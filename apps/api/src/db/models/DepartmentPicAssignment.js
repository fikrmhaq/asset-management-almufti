'use strict';

/**
 * `public.department_pic_assignments` — 04-data-model.md §5.2.5.
 * Domain: DepartmentPicAssignment. Phase 21 (`CR-003`).
 *
 * One row per period a user was the department's person in charge. Closed rows
 * are never updated again, so the table IS the history — which is why it is
 * absent from `AUDITED_MODELS`, on the same reasoning that excludes
 * `AssetUnitLocation`.
 *
 * `isCurrent` and a null `endedAt` both mark the live assignment;
 * `chk_dept_pic_current` makes them incapable of disagreeing, and
 * `uq_dept_pic_current` allows only one live row per department. Keeping
 * `departments.current_pic_user_id` in step is the service's job
 * (`domain/picAssignments.js`).
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'DepartmentPicAssignment',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      departmentId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      endedAt: { type: DataTypes.DATE, allowNull: true },
      assignedBy: { type: DataTypes.UUID, allowNull: true },
      endedBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'department_pic_assignments', updatedAt: false }
  );
