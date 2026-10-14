'use strict';

/**
 * A receipt — Phase 41 (`CR-014` §7.4; `IMPLEMENTATION_PLAN.md` §60).
 *
 * The requester received the Asset Unit of one registration link, on
 * `receivedOn` (their date), recorded by `recordedBy` at `recordedAt` (the
 * server's). Never deleted: a reversal fills the three `reversed*` fields and
 * the row stays as history. At most one active (unreversed) receipt per link.
 * Audited — the create and the reversal.
 *
 * `receiptConfirmationId` (migration 057): the confirmation the requester gave
 * with it. Null on a Phase 41 receipt, which keeps its `note` instead.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RequestItemUnitReceipt',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      requestItemUnitId: { type: DataTypes.UUID, allowNull: false },
      receivedOn: { type: DataTypes.DATEONLY, allowNull: false },
      recordedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      recordedBy: { type: DataTypes.UUID, allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: true },
      reversedAt: { type: DataTypes.DATE, allowNull: true },
      reversedBy: { type: DataTypes.UUID, allowNull: true },
      reversalReason: { type: DataTypes.TEXT, allowNull: true },
      receiptConfirmationId: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'request_item_unit_receipts', timestamps: false }
  );
