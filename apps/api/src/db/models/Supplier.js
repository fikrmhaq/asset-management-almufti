'use strict';

/** `public.suppliers` — 04-data-model.md §5.4.2. Domain: Supplier. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Supplier',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(255), allowNull: false },
      address: { type: DataTypes.TEXT, allowNull: true },
      contactInfo: { type: DataTypes.TEXT, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { schema: 'public', tableName: 'suppliers' }
  );
