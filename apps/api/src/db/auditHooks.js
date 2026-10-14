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
  // Requests — Phase 36 (`CR-014`). The steps are audited in their own right
  // (Phase 36 decision D3): a DRAFT's steps are replaced in place, so neither
  // table is its own history.
  'WorkflowDefinition',
  'WorkflowDefinitionStep',
  // Phase 37: requests and their items (`04-data-model.md` §5.7.3).
  'Request',
  'RequestItem',
  // Phase 38: each step state change has a before / after record.
  'RequestStep',
  // Migration 059: revision item notes — the create, and the detach when the
  // requester deletes the item during the revision.
  'RequestStepItemNote',
  // Phase 39: request documents — create and delete (`storageReference` redacted).
  'RequestDocument',
  // Phase 40: registration links — each link and each unlink.
  'RequestItemUnit',
  // Phase 41: receipts (the create and the reversal) and close events.
  'RequestItemUnitReceipt',
  'RequestCloseEvent',
  // Migration 057: receipt confirmations (create only — never updated).
  'RequestReceiptConfirmation',
  // Migration 066 (REQ-REQUEST-025): unit reports — the report, and its review.
  'AssetUnitReport',
  // Migration 067 (§73): consumables, and every stock movement — receipt,
  // issue, adjustment (create only; a movement is never changed).
  'Consumable',
  'ConsumableStockMovement',
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
