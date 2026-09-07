'use strict';

/**
 * `public.borrowing_items` — 04-data-model.md §5.5.2. Domain: BorrowingDetail.
 *
 * Deliberately carries no status of its own: a borrowing is returned as a whole
 * event (REQ-BORROW-011), so per-item lifecycle state would be a second source
 * of truth for something the header already owns.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'BorrowingItem',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      borrowingId: { type: DataTypes.UUID, allowNull: false },
      assetUnitId: { type: DataTypes.UUID, allowNull: false },
    },
    { schema: 'public', tableName: 'borrowing_items', updatedAt: false }
  );
