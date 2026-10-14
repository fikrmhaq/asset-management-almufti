'use strict';

/**
 * One version of the process for (institution, category, requester context) —
 * Phase 36 (`CR-014` §6.3), `03-domain.md` §4.37, `04-data-model.md` §5.7.2.
 *
 * Audited through model hooks, and so are its steps (Phase 36 decision D3):
 * unlike the temporal assignment tables, a DRAFT is edited in place, so the
 * rows are not their own history.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'WorkflowDefinition',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      institutionId: { type: DataTypes.UUID, allowNull: false },
      category: { type: DataTypes.STRING(10), allowNull: false },
      requesterPositionCode: { type: DataTypes.STRING(32), allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false },
      status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'DRAFT' },
      publishedAt: { type: DataTypes.DATE, allowNull: true },
      publishedBy: { type: DataTypes.UUID, allowNull: true },
      retiredAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'workflow_definitions' }
  );
