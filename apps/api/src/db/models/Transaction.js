'use strict';

/**
 * `public.transactions` — 04-data-model.md §5.5.3. Domain: Transaction.
 *
 * A historical record: create and read only, never updated (REQ-TXN-007). The
 * API exposes no PATCH for this resource by design (`06-api.md` §7.3).
 *
 * `supplierId` and `contractId` are both nullable so a transaction can represent
 * an operation with no procurement origin (REQ-TXN-008, REQ-TXN-009).
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Transaction',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      transactionDate: { type: DataTypes.DATEONLY, allowNull: false },
      transactionTypeId: { type: DataTypes.INTEGER, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      supplierId: { type: DataTypes.UUID, allowNull: true },
      contractId: { type: DataTypes.UUID, allowNull: true },
      institutionId: { type: DataTypes.UUID, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: false },
    },
    { schema: 'public', tableName: 'transactions' }
  );
