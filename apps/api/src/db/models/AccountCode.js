'use strict';

/**
 * `ref.account_codes` — 04-data-model.md §5.1.8. Domain: AccountCode.
 *
 * Natural key. `CHAR(12)` is blank-padded by PostgreSQL, so comparisons against
 * shorter input need trimming — see `normalizeCharKey` in the models index.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AccountCode',
    {
      code: { type: DataTypes.CHAR(12), primaryKey: true },
      name: { type: DataTypes.STRING(250), allowNull: false },
    },
    { schema: 'ref', tableName: 'account_codes', timestamps: false }
  );
