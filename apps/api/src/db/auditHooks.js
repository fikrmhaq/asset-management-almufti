'use strict';

/**
 * Audit hooks — `IMPLEMENTATION_PLAN.md` §14.4, REQ-AUDIT-001.
 *
 * Audit rows are written by Sequelize model hooks rather than by calls sprinkled
 * through the service layer. Two reasons, both about correctness:
 *
 *   1. The hook is the only place that reliably has BOTH the previous and the
 *      new values (REQ-AUDIT-002). A service knows what it intended to write,
 *      not what was actually there before.
 *   2. A service can forget. A hook cannot: any write to an audited model is
 *      recorded, including one added in a later phase by someone who never read
 *      this file.
 *
 * The audit row joins the caller's transaction, so a rolled-back operation
 * leaves no audit entry — nothing happened, and claiming otherwise would be a
 * false record.
 *
 * Actor and IP come from the ambient request context (`http/auditContext.js`).
 */

const audit = require('../services/audit');

/**
 * Models whose changes are audited — "important changes to critical business
 * records" (REQ-AUDIT-001).
 *
 * Deliberately EXCLUDED, with reasons:
 *
 *   AuditLog                  auditing the audit trail is circular.
 *   LongitudinalHistory       already the asset's own append-only history
 *   AssetUnitLocation         (REQ-LIFE-003/REQ-LOC-004); a second copy would
 *                             add nothing and double every write.
 *   DepartmentPicAssignment   append-only responsibility history (Phase 21,
 *   LocationPicAssignment     `CR-003`). Same reasoning: closed rows are never
 *                             touched again, and each row already records who
 *                             assigned and who ended it, so the table IS the
 *                             audit trail rather than a thing needing one.
 *   Permission                fixed catalog, not application-editable (BR-013).
 *   Transaction               historical records that are never modified after
 *   TransactionItem           creation (REQ-TXN-007) — creation is already the
 *                             whole story, and the record itself is the audit.
 *
 * Everything else that an authorized user can change is here, including the
 * authorization model itself: a role gaining a permission is exactly the kind of
 * change an audit trail exists for.
 */
const AUDITED_MODELS = Object.freeze([
  // Organization
  'Institution',
  'Department',
  'User',
  'UserRole',
  'Role',
  'RolePermission',
  // Reference
  'AssetClassification',
  'AttributeDefinition',
  'Category',
  'MeasurementUnit',
  'ContractType',
  'FundingSource',
  'AccountCode',
  // Asset core
  'Asset',
  'AssetUnit',
  'AssetAttributeValue',
  'AssetUnitAttributeValue',
  'Location',
  'LocationFloorPlan',
  'FloorPlanArea',
  'Attachment',
  // Procurement
  'Vendor',
  'Supplier',
  'Contract',
  'ContractItem',
  // Operations
  'Borrowing',
  'BorrowingItem',
]);

/**
 * The entity's identifier as a string — `audit_logs.entity_id` is
 * `VARCHAR(255)`, not a UUID, precisely because natural and composite keys
 * exist (`Department.id`, `UserRole(userId, roleId)`).
 */
function entityIdOf(instance, model) {
  const keys = model.primaryKeyAttributes;
  return keys.map((key) => String(instance.get(key))).join(':');
}

/**
 * Attaches create/update/destroy hooks to one model.
 *
 * `options.audit === false` skips the record. That exists for the one legitimate
 * case — a writer that records its own audit entries with better context, such
 * as the overdue sweep — not as a general escape hatch.
 */
function attachTo(model) {
  model.addHook('afterCreate', async (instance, options) => {
    if (options?.audit === false) return;

    await audit.record({
      action: audit.ACTIONS.CREATE,
      entityType: model.name,
      entityId: entityIdOf(instance, model),
      newValues: instance.get({ plain: true }),
      transaction: options?.transaction,
    });
  });

  model.addHook('afterUpdate', async (instance, options) => {
    if (options?.audit === false) return;

    const changed = instance.changed() || [];
    if (changed.length === 0) return;

    const oldValues = {};
    const newValues = {};
    for (const field of changed) {
      oldValues[field] = instance.previous(field);
      newValues[field] = instance.get(field);
    }

    await audit.record({
      action: audit.classifyUpdate(changed),
      entityType: model.name,
      entityId: entityIdOf(instance, model),
      oldValues,
      newValues,
      transaction: options?.transaction,
    });
  });

  model.addHook('afterDestroy', async (instance, options) => {
    if (options?.audit === false) return;

    await audit.record({
      action: audit.ACTIONS.DELETE,
      entityType: model.name,
      entityId: entityIdOf(instance, model),
      oldValues: instance.get({ plain: true }),
      transaction: options?.transaction,
    });
  });
}

/**
 * Applies the hooks across the registry.
 *
 * @throws {Error} when the allowlist names a model that does not exist, so a
 *   rename cannot silently switch auditing off for an entity.
 */
function applyAuditHooks(models) {
  for (const name of AUDITED_MODELS) {
    const model = models[name];
    if (!model) {
      throw new Error(
        `Audit hooks reference unknown model "${name}". Update AUDITED_MODELS in ` +
          'src/db/auditHooks.js — an audited entity must never disappear by accident.'
      );
    }

    attachTo(model);
  }

  return models;
}

module.exports = { AUDITED_MODELS, applyAuditHooks, entityIdOf };
