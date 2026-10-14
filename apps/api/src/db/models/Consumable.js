'use strict';

/**
 * A consumable — migration 067 (`IMPLEMENTATION_PLAN.md` §73). A quantity-based
 * stock item of one institution, counted in one measurement unit. Not an Asset:
 * no units, no inventory code, no lifecycle.
 *
 * `quantityOnHand` is written only with a stock movement, in one transaction,
 * under this row's lock (`domain/consumableStock.js`). Audited.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Consumable',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      institutionId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      measurementUnitId: { type: DataTypes.UUID, allowNull: false },
      quantityOnHand: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'consumables' }
  );
