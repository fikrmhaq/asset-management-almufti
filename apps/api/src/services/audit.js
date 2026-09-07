'use strict';

/**
 * Audit logging — `IMPLEMENTATION_PLAN.md` §14.4; REQ-AUDIT-001/002/003,
 * `DR-015`.
 *
 * APPEND-ONLY. This module exposes `record` and nothing else: there is no
 * update, no delete, and no bulk rewrite, because REQ-AUDIT-003 requires audit
 * records not to be editable. `04-data-model.md` §5.6.1 makes the same point in
 * a CAUTION block.
 *
 * Distinct from the winston logs (`05-infrastructure.md` §8.1): those are
 * operational and disposable, this is the business record.
 *
 * An audit failure must never fail the business operation that triggered it —
 * refusing to deactivate a user because the audit insert hit a constraint would
 * be worse than the missing row. Failures are logged loudly instead.
 */

const { getLogger } = require('../logger');
const { getAuditContext } = require('../http/auditContext');

/**
 * The model registry, resolved at call time rather than at import.
 *
 * The dependency is a cycle by nature: the registry installs the audit hooks
 * (`db/auditHooks.js`), and those hooks call this module. Requiring the registry
 * at the top of this file would read its exports before it had finished
 * building them, and `getModels` would be `undefined`. Deferring the lookup to
 * the moment a record is actually written breaks the cycle without either side
 * having to know about it.
 */
function defaultModels() {
  return require('../db/models').getModels();
}

/** `audit.audit_action` — `04-data-model.md` §4. */
const ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  STATUS_CHANGE: 'STATUS_CHANGE',
});

/**
 * Never written to `old_values`/`new_values`.
 *
 * The audit trail is read by administrators; a password hash copied into it
 * would survive every rotation and defeat REQ-NFR-SEC-001. `storageReference`
 * is excluded as a filesystem path rather than a business fact.
 */
const REDACTED_FIELDS = Object.freeze(['passwordHash', 'password', 'storageReference']);

/**
 * Columns whose change is a guarded status transition rather than an edit —
 * `06-api.md` §1.7. A change confined to these is recorded as `STATUS_CHANGE`,
 * which is why the enum has that value at all.
 */
const STATUS_FIELDS = Object.freeze(['isActive', 'status', 'lifecycleState']);

/** Never audited: timestamps the database maintains, and the key itself. */
const IGNORED_FIELDS = Object.freeze(['createdAt', 'updatedAt', 'id']);

function redact(values) {
  if (!values) return null;

  const output = {};
  for (const [key, value] of Object.entries(values)) {
    if (IGNORED_FIELDS.includes(key)) continue;
    output[key] = REDACTED_FIELDS.includes(key) ? '[REDACTED]' : value;
  }

  return Object.keys(output).length > 0 ? output : null;
}

/** `UPDATE`, or `STATUS_CHANGE` when every changed field is a status field. */
function classifyUpdate(changedFields) {
  const meaningful = changedFields.filter((field) => !IGNORED_FIELDS.includes(field));

  if (meaningful.length > 0 && meaningful.every((field) => STATUS_FIELDS.includes(field))) {
    return ACTIONS.STATUS_CHANGE;
  }

  return ACTIONS.UPDATE;
}

/**
 * Appends one audit record — REQ-AUDIT-002.
 *
 * Actor and IP come from the ambient request context when there is one; a
 * seeder, CLI or background job leaves `actorId` NULL, which `04-data-model.md`
 * §5.6.1 defines as "system".
 *
 * @param {{action: string, entityType: string, entityId: string,
 *          oldValues?: object|null, newValues?: object|null,
 *          metadata?: object|null,
 *          transaction?: import('sequelize').Transaction}} entry
 */
async function record(entry, { models = defaultModels(), logger = getLogger() } = {}) {
  const context = getAuditContext();

  try {
    return await models.AuditLog.create(
      {
        actorId: context.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: String(entry.entityId),
        oldValues: redact(entry.oldValues),
        newValues: redact(entry.newValues),
        ipAddress: context.ipAddress ?? null,
        metadata: context.requestId
          ? { ...entry.metadata, requestId: context.requestId }
          : (entry.metadata ?? null),
      },
      { transaction: entry.transaction }
    );
  } catch (error) {
    // Deliberately swallowed — see the module note. Logged at `error` so a
    // silently un-auditable system is visible in the operational logs.
    logger.error('failed to write an audit record', {
      error: error.message,
      entityType: entry.entityType,
      entityId: String(entry.entityId),
      action: entry.action,
    });
    return null;
  }
}

module.exports = {
  ACTIONS,
  STATUS_FIELDS,
  REDACTED_FIELDS,
  IGNORED_FIELDS,
  redact,
  classifyUpdate,
  record,
};
