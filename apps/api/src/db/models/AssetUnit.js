'use strict';

const { LIFECYCLE_STATES, CONDITIONS } = require('../enums');

/**
 * `public.asset_units` — 04-data-model.md §5.3.2. Domain: AssetUnit.
 *
 * The individually tracked physical item (REQ-UNIT-001).
 *
 * `currentCondition` and `currentLocationId` are denormalized from
 * `longitudinal_history` for query performance and MUST be updated in the same
 * transaction that writes a new history row (§5.3.2 note). Nothing in the
 * database keeps them honest — that is the history service's responsibility in
 * Phase 5.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AssetUnit',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      assetId: { type: DataTypes.UUID, allowNull: false },
      // The printable identity (REQ-UNIT-007). Nullable because a unit whose
      // asset has no institution has nothing to build a code from, and
      // immutable once written (`BR-020`) — never recomputed on read.
      // Widened to 64 by Phase 25 (`CR-006`): a configurable format can render
      // more than the one shape Phase 18 produced.
      inventoryCode: { type: DataTypes.STRING(64), allowNull: true },
      /**
       * The manually supplied component of the inventory code — Phase 26
       * (`CR-007`), REQ-ORG-007.
       *
       * Required only where the owning institution's format contains
       * `{NUMBER_COMPOSITION}`, and set once: like `inventoryCode` it is
       * refused on update, because editing it would repair nothing — the code
       * it produced is already permanent and already on a printed label.
       *
       * `STRING(32)` above the validated maximum of 16, so raising that budget
       * is a registry change with no migration.
       */
      numberComposition: { type: DataTypes.STRING(32), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      contractItemId: { type: DataTypes.UUID, allowNull: true },
      /**
       * UUID since Phase 20 (`CR-003`, migration 040), which replaced the
       * department's `VARCHAR(8)` natural key with a surrogate one and retyped
       * this column to match.
       *
       * The declaration said `STRING(8)` until Phase 31 (`CR-012`). Sequelize
       * passed the value through either way, so nothing broke — but the model
       * asserted a type the column has not had for eight migrations, and
       * `CR-012`'s coverage reports group by it throughout.
       */
      departmentId: { type: DataTypes.UUID, allowNull: true },
      lifecycleState: {
        type: DataTypes.ENUM(...LIFECYCLE_STATES),
        allowNull: false,
        defaultValue: 'REGISTERED',
      },
      currentCondition: { type: DataTypes.ENUM(...CONDITIONS), allowNull: true },
      currentLocationId: { type: DataTypes.UUID, allowNull: true },
      /**
       * Acquisition facts — `CR-014` (`DEC-S`), REQ-UNIT-012, migration 056.
       * Each optional and independent of any Contract. The unit's own funding
       * source takes precedence over its Contract's, and is what
       * `FUNDING_SOURCE_CODE` renders when present. Nothing is back-filled.
       * `acquisitionDate` is stored as specified and has no reader yet.
       */
      fundingSourceId: { type: DataTypes.INTEGER, allowNull: true },
      acquisitionDate: { type: DataTypes.DATEONLY, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'asset_units' }
  );
