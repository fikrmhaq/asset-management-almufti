'use strict';

/**
 * `ref.funding_sources` — 04-data-model.md §5.1.7. Domain: FundingSource.
 *
 * `code` is the short business abbreviation — Phase 26 (`CR-007`), REQ-REF-007.
 * It exists because an inventory code format may include the funding source, and
 * a `VARCHAR(100)` display name is neither short enough nor stable enough to
 * carry inside a permanent identifier.
 *
 * It is NOT derived from `name`, ever: an institution recording "Dana Bos" calls
 * it `BOS`, which no normalization of the name discovers (`BR-027`).
 *
 * Nullable until every historical row has been given one — see migration 046.
 * The API requires it on create, so only rows predating the column can be NULL,
 * and such a row simply cannot satisfy `{FUNDING_SOURCE_CODE}`.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'FundingSource',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      code: { type: DataTypes.STRING(8), allowNull: true },
    },
    { schema: 'ref', tableName: 'funding_sources', timestamps: false }
  );
