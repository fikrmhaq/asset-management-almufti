'use strict';

const { BORROWING_STATUSES } = require('../enums');

/**
 * `public.borrowings` — 04-data-model.md §5.5.1. Domain: Borrowing.
 *
 * `OVERDUE` is a real stored value, written by the scheduled sweep in Phase 8
 * (`05-infrastructure.md` §7.2) — it is not derived at read time.
 *
 * Completed records must preserve their original dates (REQ-BORROW-015), so an
 * extension creates a new DRAFT borrowing rather than editing this one
 * (REQ-BORROW-014).
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Borrowing',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      borrowerName: { type: DataTypes.STRING(255), allowNull: false },
      borrowerContact: { type: DataTypes.TEXT, allowNull: false },
      borrowDate: { type: DataTypes.DATEONLY, allowNull: false },
      expectedReturnDate: { type: DataTypes.DATEONLY, allowNull: false },
      actualReturnDate: { type: DataTypes.DATEONLY, allowNull: true },
      responsiblePersonId: { type: DataTypes.UUID, allowNull: true },
      institutionId: { type: DataTypes.UUID, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: {
        type: DataTypes.ENUM(...BORROWING_STATUSES),
        allowNull: false,
        defaultValue: 'DRAFT',
      },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'borrowings' }
  );
