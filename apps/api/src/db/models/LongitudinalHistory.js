'use strict';

const { CONDITIONS, LIFECYCLE_STATES, HISTORY_ENTRY_TYPES } = require('../enums');

/**
 * `public.longitudinal_history` — 04-data-model.md §5.3.4.
 * Domain: LongitudinalHistory.
 *
 * The unified historical record: condition, location and lifecycle state in one
 * row, because a unit moving and its condition changing are the same event
 * (`06-api.md` §5.2). Do not build separate condition/location history tables.
 *
 * APPEND-ONLY (REQ-TXN-007, REQ-LIFE-004). Existing rows must never be updated
 * to reflect current state; a change closes the prior row's `effectiveTo` and
 * inserts a new one.
 *
 * TWO COLUMNS DATE A ROW, AND THEY ANSWER DIFFERENT QUESTIONS (`CR-012`).
 * `effectiveFrom` is when the recorded state began to apply and MAY be
 * backdated by the recorder. `createdAt` is when the row was written and is
 * never caller-supplied. Monthly assessment coverage is measured on
 * `createdAt` (`DEC-D`) so a closed month cannot be edited afterwards; the
 * `PERAWATAN` month-end snapshot is measured on `effectiveFrom` (`CR-011`
 * `DEC-A`) because that asks when a state applied. The divergence is
 * deliberate — do not reconcile one to the other.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'LongitudinalHistory',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      assetUnitId: { type: DataTypes.UUID, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      condition: { type: DataTypes.ENUM(...CONDITIONS), allowNull: false },
      locationId: { type: DataTypes.UUID, allowNull: false },
      lifecycleState: { type: DataTypes.ENUM(...LIFECYCLE_STATES), allowNull: true },
      /**
       * What produced this row — `CR-012` `DEC-A`/`DEC-B`, REQ-COND-006.
       *
       * NO `defaultValue`, deliberately, matching the column's absent DEFAULT
       * in migration 048. A default of `MANUAL` would let a writer that forgets
       * the field silently satisfy the monthly assessment requirement, on a row
       * indistinguishable from a real assessment. `applyStateChange` requires
       * it explicitly so a new writer fails loudly instead.
       */
      entryType: { type: DataTypes.ENUM(...HISTORY_ENTRY_TYPES), allowNull: false },
      effectiveFrom: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      effectiveTo: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'longitudinal_history', updatedAt: false }
  );
