'use strict';

/**
 * A receipt confirmation — the requester's evidence with one Record Receipt
 * action (migration 057; `IMPLEMENTATION_PLAN.md` §63).
 *
 * The receipts of that action point here; its photos are `RequestDocument`s of
 * type `CONFIRMATION_PHOTO`. `destinationLocationId` / `destinationName` are a
 * snapshot of the Request's intended place, and `placement` is asked only
 * against it — all three set, or none. Immutable: never updated or deleted.
 * Superseded (every receipt reversed) is derived, never stored. Audited.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RequestReceiptConfirmation',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      requestId: { type: DataTypes.UUID, allowNull: false },
      placement: { type: DataTypes.STRING(24), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: false },
      destinationLocationId: { type: DataTypes.UUID, allowNull: true },
      destinationName: { type: DataTypes.STRING(255), allowNull: true },
      confirmedBy: { type: DataTypes.UUID, allowNull: false },
      confirmedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { schema: 'public', tableName: 'request_receipt_confirmations', timestamps: false }
  );
