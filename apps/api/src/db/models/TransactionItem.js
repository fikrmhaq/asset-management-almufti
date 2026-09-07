'use strict';

/**
 * `public.transaction_items` — 04-data-model.md §5.5.4.
 * Domain: TransactionDetail.
 *
 * References an Asset Unit, not the asset master, so transaction history stays
 * attached to the specific physical item throughout its life (REQ-TXN-010).
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'TransactionItem',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      transactionId: { type: DataTypes.UUID, allowNull: false },
      assetUnitId: { type: DataTypes.UUID, allowNull: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    { schema: 'public', tableName: 'transaction_items', updatedAt: false }
  );
