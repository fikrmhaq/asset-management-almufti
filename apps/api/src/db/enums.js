'use strict';

/**
 * Enumerated types — 04-data-model.md §4.
 *
 * Declared once here so models, validation schemas and any future reference
 * endpoint all read the same list. Order matches the DDL, which is also the
 * order PostgreSQL sorts by.
 */

/** `public.status_enum`. Defined in the schema but unused: tables use `is_active`. */
const STATUS_VALUES = Object.freeze(['ACTIVE', 'INACTIVE']);

/** `public.borrowing_status` — REQ-BORROW-007. */
const BORROWING_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'RETURNED', 'OVERDUE', 'CANCELLED']);

/** `public.lifecycle_state` — REQ-LIFE-001. */
const LIFECYCLE_STATES = Object.freeze([
  'REGISTERED',
  'ACTIVE',
  'IN_STORAGE',
  'BORROWED',
  'UNDER_MAINTENANCE',
  'DISPOSED',
  'DEACTIVATED',
]);

/** `public.condition_enum` — REQ-COND-001, REQ-REF-006. */
const CONDITIONS = Object.freeze(['GOOD', 'FAIR', 'POOR', 'DAMAGED', 'UNSERVICEABLE']);

/** `ref.attribute_type` — REQ-ATTR-003. */
const ATTRIBUTE_TYPES = Object.freeze([
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'SELECTION',
  'REFERENCE',
]);

/** `ref.attribute_scope` — REQ-ATTR-001. */
const ATTRIBUTE_SCOPES = Object.freeze(['ASSET', 'ASSET_UNIT']);

/**
 * `public.history_entry_type` — REQ-COND-006, `CR-012` `DEC-A`.
 *
 * What produced a `longitudinal_history` row. `MANUAL` is the ONLY value that
 * satisfies the monthly assessment obligation: a unit whose only entry this
 * month came from a borrowing has not been assessed.
 *
 * `SYSTEM` — written by the application as a consequence of a business
 * event, never an assessment. Its one writer is receipt placement
 * (REQ-REQUEST-024, migration 064): a unit received `AT_INTENDED_PLACE` is
 * placed at its intended location with NO condition, which only a `SYSTEM` row
 * may omit (`chk_longitudinal_history_condition`). See migration 048 for why it
 * was declared before it had a writer.
 *
 * `REPORT` — a Room PIC's CONDITION or MOVEMENT report, confirmed by a reviewer
 * (REQ-REQUEST-025, migration 065). Never an assessment: the reviewer, not the
 * department's PIC, writes it, and a confirmed move is no inspection. Its
 * condition is the reported one, else carried forward, else none.
 */
const HISTORY_ENTRY_TYPES = Object.freeze(['MANUAL', 'BORROWING', 'SYSTEM', 'REPORT']);

/** `audit.audit_action` — REQ-AUDIT-002. */
const AUDIT_ACTIONS = Object.freeze(['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE']);

module.exports = {
  STATUS_VALUES,
  BORROWING_STATUSES,
  LIFECYCLE_STATES,
  CONDITIONS,
  ATTRIBUTE_TYPES,
  ATTRIBUTE_SCOPES,
  HISTORY_ENTRY_TYPES,
  AUDIT_ACTIONS,
};
