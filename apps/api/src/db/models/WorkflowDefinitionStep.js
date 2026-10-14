'use strict';

/**
 * One step of a workflow definition — Phase 36 (`CR-014` §6.1, §6.2),
 * `04-data-model.md` §5.7.2.
 *
 * `actorPositionCode` is a position CODE, never a person: resolving it to a
 * holder is execution (Phase 38). It may be null only while the definition is a
 * DRAFT (Phase 36 decision D1).
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'WorkflowDefinitionStep',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      definitionId: { type: DataTypes.UUID, allowNull: false },
      sequence: { type: DataTypes.SMALLINT, allowNull: false },
      stepType: { type: DataTypes.STRING(10), allowNull: false },
      actorPositionCode: { type: DataTypes.STRING(32), allowNull: true },
      procurementMode: { type: DataTypes.STRING(10), allowNull: true },
      skipIfRequesterIsActor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { schema: 'public', tableName: 'workflow_definition_steps', timestamps: false }
  );
