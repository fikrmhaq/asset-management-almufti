'use strict';

/**
 * `public.departments` — 04-data-model.md §5.2.2. Domain: Department.
 *
 * Institution-scoped since Phase 20 (`CR-003`). The key is a surrogate UUID and
 * `code` is an institution-local label, so two institutions may each run a `TKJ`
 * — `uq_departments_institution_code` is what makes that legal and what stops
 * one institution having two.
 *
 * `institutionId` is nullable and NULL means UNASSIGNED, never shared: a
 * department with no institution is inert for asset-unit assignment
 * (`domain/departmentRules.js`). Organizational responsibility for a physical
 * item is still expressed on `asset_units.department_id`, one unit at a time.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Department',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      institutionId: { type: DataTypes.UUID, allowNull: true },
      code: { type: DataTypes.STRING(8), allowNull: false },
      name: { type: DataTypes.STRING(75), allowNull: false },
      // Denormalized cache of the live `department_pic_assignments` row
      // (Phase 21). The assignment table stays authoritative; this exists so
      // reading "who is responsible" costs no join.
      currentPicUserId: { type: DataTypes.UUID, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { schema: 'public', tableName: 'departments' }
  );
