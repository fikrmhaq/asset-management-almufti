'use strict';

/**
 * One line of a Request — Phase 37 (`CR-014` §5.2), `03-domain.md` §4.39.
 *
 * `quantityRequested` is a whole number of Asset Units (`CR-014` Q1, working
 * assumption). `quantityCancelled` is written only by closing the remainder
 * (Phase 41); nothing in Phase 37 sets it. Audited.
 *
 * `referenceUrl` (migration 060, REQ-REQUEST-019): one optional product link,
 * stored normalized; live state like every other field, its changes audited.
 *
 * `consumableId` (migration 067, §73): a line naming a consumable is issued from
 * stock, never registered as Asset Units; its quantity is in the consumable's
 * measurement unit. NULL — every earlier line — is an asset line.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RequestItem',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      requestId: { type: DataTypes.UUID, allowNull: false },
      lineNo: { type: DataTypes.SMALLINT, allowNull: false },
      description: { type: DataTypes.STRING(255), allowNull: false },
      specification: { type: DataTypes.TEXT, allowNull: true },
      referenceUrl: { type: DataTypes.STRING(2048), allowNull: true },
      quantityRequested: { type: DataTypes.INTEGER, allowNull: false },
      quantityCancelled: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      measurementUnitId: { type: DataTypes.UUID, allowNull: true },
      estimatedUnitPrice: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
      classificationId: { type: DataTypes.CHAR(12), allowNull: true },
      consumableId: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'request_items' }
  );
