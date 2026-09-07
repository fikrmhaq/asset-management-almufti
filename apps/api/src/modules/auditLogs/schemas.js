'use strict';

/** Request schemas for the audit read API — `06-api.md` §10, REQ-AUDIT-001/002. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');
const { AUDIT_ACTIONS } = require('../../db/enums');

const uuid = z.string().uuid('must be a UUID');

/**
 * `timestamp` is `TIMESTAMPTZ`, not a `DATE` like every other date this API
 * exchanges, so the range bounds are calendar days applied to an instant: the
 * service widens `dateTo` to the end of that day rather than midnight, or a
 * one-day range would match almost nothing.
 */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    'must be a real calendar date'
  );

/**
 * Filters — exactly the six `06-api.md` §10 documents.
 *
 * `entityType` is free text matched exactly (`DEC-054`): its valid values are
 * Phase 8's `AUDITED_MODELS` allowlist, which is an implementation constant that
 * appears in no specification document (`GAP-013`). Publishing it through a new
 * endpoint would expand the API to expose an internal detail, and hard-coding it
 * in a client would drift the first time the allowlist changes.
 *
 * `entityId` is a string, not a UUID: `04-data-model.md` §5.6.1 types the column
 * `VARCHAR(255)` because it holds keys from 25 tables, including natural keys
 * (`CHAR(12)` account codes) and composite keys joined with `:`.
 */
const listAuditLogs = listQuerySchema({
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(255).optional(),
  actorId: uuid.optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

const auditLogParams = z.object({ id: uuid });

module.exports = { listAuditLogs, auditLogParams };
