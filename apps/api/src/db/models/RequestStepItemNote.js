'use strict';

/**
 * A per-item note of a revision decision — REQ-REQUEST-018, migration 059.
 *
 * Belongs to the RETURNED DECIDE step whose actor wrote it. Optional, at most
 * one per item per decision, immutable. `lineNo` and `itemDescription` are
 * snapshots taken when the note was written; `requestItemId` is the live link,
 * detached (set null) when the requester deletes that item during the revision.
 * Audited.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RequestStepItemNote',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      requestStepId: { type: DataTypes.UUID, allowNull: false },
      requestItemId: { type: DataTypes.UUID, allowNull: true },
      lineNo: { type: DataTypes.SMALLINT, allowNull: false },
      itemDescription: { type: DataTypes.STRING(255), allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: false },
    },
    { schema: 'public', tableName: 'request_step_item_notes', updatedAt: false }
  );
