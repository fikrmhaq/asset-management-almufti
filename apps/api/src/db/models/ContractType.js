'use strict';

/**
 * `ref.contract_types` — 04-data-model.md §5.1.6. Domain: ContractType.
 *
 * `id` is `GENERATED ALWAYS AS IDENTITY`, so it is marked `autoIncrement` and
 * must never be supplied on insert — PostgreSQL rejects an explicit value.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ContractType',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(50), allowNull: false },
    },
    { schema: 'ref', tableName: 'contract_types', timestamps: false }
  );
