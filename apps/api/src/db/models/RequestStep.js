'use strict';

/**
 * One step of a request's workflow, copied from the definition at submission,
 * with its execution state — Phase 38 (`CR-014` §6.4), `03-domain.md` §4.40,
 * `04-data-model.md` §5.7.4.
 *
 * `actorPositionCode` is a position code; who holds it is resolved live
 * (`domain/actorResolution.js`). `actedByUserId` / `actedAsAssignmentId` record
 * who actually acted and in which capacity. Audited.
 *
 * `cycle` (migration 059, REQ-REQUEST-018): which run of the approval chain the
 * row belongs to. A resubmission after revision copies the newest cycle into the
 * next; the current cycle is the highest, derived, never stored. Read the
 * current workflow only through `domain/requestCycles.js`.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RequestStep',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      requestId: { type: DataTypes.UUID, allowNull: false },
      cycle: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 1 },
      sequence: { type: DataTypes.SMALLINT, allowNull: false },
      stepType: { type: DataTypes.STRING(10), allowNull: false },
      actorPositionCode: { type: DataTypes.STRING(32), allowNull: false },
      procurementMode: { type: DataTypes.STRING(10), allowNull: true },
      skipIfRequesterIsActor: { type: DataTypes.BOOLEAN, allowNull: false },
      state: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'PENDING' },
      skipReason: { type: DataTypes.STRING(10), allowNull: true },
      actedByUserId: { type: DataTypes.UUID, allowNull: true },
      actedAsAssignmentId: { type: DataTypes.UUID, allowNull: true },
      comment: { type: DataTypes.TEXT, allowNull: true },
      activatedAt: { type: DataTypes.DATE, allowNull: true },
      completedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { schema: 'public', tableName: 'request_steps', updatedAt: false }
  );
