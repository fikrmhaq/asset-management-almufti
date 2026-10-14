'use strict';

/**
 * A need raised by a person acting in one of their school positions — Phase 37
 * (`CR-014` §5.1), `03-domain.md` §4.38, `04-data-model.md` §5.7.3.
 *
 * Optional, always (`BR-032`). The requester context is snapshotted
 * (`requesterPositionCode`, `requesterDepartmentId`) so it survives the
 * assignment ending (`DEC-D`). Audited.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Request',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      institutionId: { type: DataTypes.UUID, allowNull: false },
      requestNumber: { type: DataTypes.STRING(32), allowNull: false },
      category: { type: DataTypes.STRING(10), allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
      justification: { type: DataTypes.TEXT, allowNull: true },
      requesterUserId: { type: DataTypes.UUID, allowNull: false },
      requesterAssignmentId: { type: DataTypes.UUID, allowNull: false },
      requesterPositionCode: { type: DataTypes.STRING(32), allowNull: false },
      requesterDepartmentId: { type: DataTypes.UUID, allowNull: true },
      departmentId: { type: DataTypes.UUID, allowNull: true },
      destinationLocationId: { type: DataTypes.UUID, allowNull: true },
      neededBy: { type: DataTypes.DATEONLY, allowNull: true },
      workflowDefinitionId: { type: DataTypes.UUID, allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'DRAFT' },
      submittedAt: { type: DataTypes.DATE, allowNull: true },
      approvedAt: { type: DataTypes.DATE, allowNull: true },
      closedAt: { type: DataTypes.DATE, allowNull: true },
      closeReason: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
    },
    { schema: 'public', tableName: 'requests' }
  );
