'use strict';

/**
 * `public.contract_items` — 04-data-model.md §5.4.4. Domain: ContractItem.
 *
 * `totalValue` is derived, not stored (§5.4.4 note, `03-domain.md` §4.17). It is
 * exposed as a virtual attribute so callers get it without any table growing a
 * column that can drift from `quantity * unitPrice`.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ContractItem',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      contractId: { type: DataTypes.UUID, allowNull: false },
      assetName: { type: DataTypes.STRING(150), allowNull: false },
      specification: { type: DataTypes.TEXT, allowNull: true },
      quantity: { type: DataTypes.INTEGER, allowNull: true },
      unitPrice: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
      unitType: { type: DataTypes.STRING(50), allowNull: true },
      totalValue: {
        type: DataTypes.VIRTUAL(DataTypes.DECIMAL(15, 2), ['quantity', 'unitPrice']),
        get() {
          const quantity = this.getDataValue('quantity');
          const unitPrice = this.getDataValue('unitPrice');
          if (quantity === null || quantity === undefined) return null;
          if (unitPrice === null || unitPrice === undefined) return null;
          return (Number(quantity) * Number(unitPrice)).toFixed(2);
        },
      },
    },
    { schema: 'public', tableName: 'contract_items' }
  );
