'use strict';

/**
 * `public.contracts` — 04-data-model.md §5.4.3. Domain: Contract.
 *
 * DATE columns are declared `DATEONLY` and handled as `YYYY-MM-DD` strings. A
 * contract date has no time or zone, and converting it to a JS `Date` shifts the
 * day for anyone east or west of UTC.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Contract',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      contractNumber: { type: DataTypes.STRING(150), allowNull: false },
      supplierId: { type: DataTypes.UUID, allowNull: true },
      contractTypeId: { type: DataTypes.INTEGER, allowNull: true },
      contractDate: { type: DataTypes.DATEONLY, allowNull: false },
      fundingSourceId: { type: DataTypes.INTEGER, allowNull: true },
      contractValue: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
      receivingDocument: { type: DataTypes.STRING(255), allowNull: true },
      receivingDate: { type: DataTypes.DATEONLY, allowNull: true },
      institutionId: { type: DataTypes.UUID, allowNull: true },
      accountCode: { type: DataTypes.CHAR(12), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { schema: 'public', tableName: 'contracts' }
  );
