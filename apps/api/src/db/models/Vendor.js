'use strict';

/** `public.vendors` — 04-data-model.md §5.4.1. Domain: Vendor. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Vendor',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(255), allowNull: false },
      contactInfo: { type: DataTypes.TEXT, allowNull: true },
      address: { type: DataTypes.TEXT, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { schema: 'public', tableName: 'vendors' }
  );
