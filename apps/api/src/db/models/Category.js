'use strict';

/** `ref.categories` — 04-data-model.md §5.1.2. Domain: Category. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Category',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(100), allowNull: false },
    },
    { schema: 'ref', tableName: 'categories', timestamps: false }
  );
