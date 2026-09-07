'use strict';

/**
 * `public.attachments` — 04-data-model.md §5.3.7. Domain: Attachment.
 *
 * `storageReference` is a plain path string, which is what lets storage move
 * from local disk to object storage later without a data model change — only a
 * storage-adapter swap (`05-infrastructure.md` §5.1).
 *
 * Attaches to an Asset always, and optionally narrows to one of its Units.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Attachment',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      assetId: { type: DataTypes.UUID, allowNull: false },
      assetUnitId: { type: DataTypes.UUID, allowNull: true },
      fileName: { type: DataTypes.STRING(255), allowNull: false },
      fileType: { type: DataTypes.STRING(100), allowNull: false },
      fileSize: { type: DataTypes.BIGINT, allowNull: false },
      storageReference: { type: DataTypes.TEXT, allowNull: false },
      uploadedBy: { type: DataTypes.UUID, allowNull: false },
    },
    { schema: 'public', tableName: 'attachments', updatedAt: false }
  );
