'use strict';

/**
 * A registration link — Phase 40 (`CR-014` §7.1), `03-domain.md` §4.41,
 * `04-data-model.md` §5.7.6.
 *
 * This Asset Unit was registered against that Request Item, by `linkedBy`, at
 * `linkedAt`. Registration only: never receipt, never fulfilment (`BR-031`).
 * Audited — the create and the delete (unlink) each leave a record.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RequestItemUnit',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      requestItemId: { type: DataTypes.UUID, allowNull: false },
      assetUnitId: { type: DataTypes.UUID, allowNull: false },
      linkedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      linkedBy: { type: DataTypes.UUID, allowNull: false },
    },
    { schema: 'public', tableName: 'request_item_units', timestamps: false }
  );
