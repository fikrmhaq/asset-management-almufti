'use strict';

/**
 * A file attached to a request — Phase 39 (`CR-014` §9), `03-domain.md` §4.42,
 * `04-data-model.md` §5.7.5.
 *
 * Owned by its request, never by an asset: `Attachment` is unchanged
 * (`CR-014` `DEC-O`). Immutable once written. Audited; `storageReference` is
 * redacted from the audit record like every other one.
 *
 * `receiptConfirmationId` is set exactly on a `CONFIRMATION_PHOTO` (migration
 * 057): the requester's receipt evidence, never deleted.
 *
 * `requestItemUnitReceiptId` (migration 062, REQ-REQUEST-022): on a confirmation
 * photo that shows one received unit, that unit's receipt — always one of the
 * same confirmation (composite key). NULL for a photo of the whole confirmation.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RequestDocument',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      requestId: { type: DataTypes.UUID, allowNull: false },
      documentType: { type: DataTypes.STRING(20), allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: true },
      fileName: { type: DataTypes.STRING(255), allowNull: false },
      fileType: { type: DataTypes.STRING(100), allowNull: false },
      fileSize: { type: DataTypes.BIGINT, allowNull: false },
      storageReference: { type: DataTypes.TEXT, allowNull: false },
      uploadedBy: { type: DataTypes.UUID, allowNull: false },
      receiptConfirmationId: { type: DataTypes.UUID, allowNull: true },
      requestItemUnitReceiptId: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'request_documents', updatedAt: false }
  );
