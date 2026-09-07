'use strict';

const { AUDIT_ACTIONS } = require('../enums');

/**
 * `audit.audit_logs` — 04-data-model.md §5.6.1. Domain: AuditRecord.
 *
 * APPEND-ONLY (REQ-AUDIT-003). No update or delete path may be built on this
 * model, and the audit UI is read-only throughout (`07-ui.md` §5.8).
 *
 * `actorId` has no foreign key by design: an audit trail that a user deletion
 * could block or cascade would defeat its purpose. `entityId` is a string, not a
 * UUID, because the entities audited include natural-key tables.
 *
 * Written only by `src/services/audit.js`, which the model hooks in
 * `src/db/auditHooks.js` drive. Nothing else may insert here, and nothing at all
 * may update or delete.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AuditLog',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      actorId: { type: DataTypes.UUID, allowNull: true },
      action: { type: DataTypes.ENUM(...AUDIT_ACTIONS), allowNull: false },
      entityType: { type: DataTypes.STRING(100), allowNull: false },
      entityId: { type: DataTypes.STRING(255), allowNull: false },
      timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      oldValues: { type: DataTypes.JSONB, allowNull: true },
      newValues: { type: DataTypes.JSONB, allowNull: true },
      ipAddress: { type: DataTypes.INET, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: true },
    },
    { schema: 'audit', tableName: 'audit_logs', timestamps: false }
  );
