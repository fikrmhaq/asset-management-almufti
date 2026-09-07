'use strict';

/** `ref.transaction_types` — 04-data-model.md §5.1.9. Domain: TransactionType. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'TransactionType',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
    },
    { schema: 'ref', tableName: 'transaction_types', timestamps: false }
  );
