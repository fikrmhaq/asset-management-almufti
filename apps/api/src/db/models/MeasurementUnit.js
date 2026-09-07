'use strict';

/** `ref.measurement_units` — 04-data-model.md §5.1.4. Domain: MeasurementUnit. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'MeasurementUnit',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(100), allowNull: false },
    },
    { schema: 'ref', tableName: 'measurement_units', timestamps: false }
  );
