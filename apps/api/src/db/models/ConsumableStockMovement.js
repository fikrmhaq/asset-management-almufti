'use strict';

/**
 * One change of a consumable's stock — migration 067 (`IMPLEMENTATION_PLAN.md`
 * §73). Append-only: RECEIPT (+), ISSUE (−, naming the request item it
 * fulfils), ADJUSTMENT (±, with a reason), each with the balance it left.
 * Never updated or deleted. Audited.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ConsumableStockMovement',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      consumableId: { type: DataTypes.UUID, allowNull: false },
      movementType: { type: DataTypes.STRING(20), allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false },
      balanceAfter: { type: DataTypes.INTEGER, allowNull: false },
      requestItemId: { type: DataTypes.UUID, allowNull: true },
      note: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: false },
    },
    {
      schema: 'public',
      tableName: 'consumable_stock_movements',
      // Append-only: a movement is never updated.
      updatedAt: false,
    }
  );
