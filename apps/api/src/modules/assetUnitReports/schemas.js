'use strict';

const { z } = require('zod');

const { CONDITIONS } = require('../../db/enums');
const { listQuerySchema } = require('../../query/listQuery');
const { REPORT_KINDS, REPORT_STATUSES } = require('./service');

const uuid = z.string().uuid('must be a UUID');

/**
 * Filing a report — REQ-REQUEST-025. A CONDITION report names a condition and
 * no destination; a MOVEMENT report names a destination and no condition; an
 * OBSERVATION names neither. Who may report on which unit is the service's.
 */
const createReport = z
  .object({
    assetUnitId: uuid,
    kind: z.enum(REPORT_KINDS),
    narrative: z.string().trim().min(1, 'is required').max(5000),
    reportedCondition: z.enum(CONDITIONS).optional(),
    destinationLocationId: uuid.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const need = (field, wanted) => {
      const given = body[field] !== undefined;
      if (given === wanted) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: wanted
          ? `is required for a ${body.kind} report`
          : `is not part of a ${body.kind} report`,
      });
    };
    need('reportedCondition', body.kind === 'CONDITION');
    need('destinationLocationId', body.kind === 'MOVEMENT');
  });

/**
 * `seenHistoryId` — REQUIRED: the unit's open history row as the report showed
 * it (`currentHistoryId`), null if it had none. A confirmation applies only to
 * the state the reviewer saw; `acknowledgeStale` never stands in for it.
 */
const confirmReport = z
  .object({
    seenHistoryId: uuid.nullable(),
    acknowledgeStale: z.boolean().optional(),
    note: z.string().trim().max(5000).optional(),
  })
  .strict();

const rejectReport = z.object({ note: z.string().trim().min(1, 'is required').max(5000) }).strict();

const listReports = listQuerySchema({
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  status: z.enum(REPORT_STATUSES).optional(),
});

const reportParams = z.object({ id: uuid });

module.exports = { createReport, confirmReport, rejectReport, listReports, reportParams };
