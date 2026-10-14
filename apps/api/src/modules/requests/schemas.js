'use strict';

/**
 * Request schemas — `06-api.md` §12.3, Phase 37 (`CR-014`).
 *
 * `.strict()` everywhere a body is accepted: the requester context cannot be
 * changed after creation, and `quantityCancelled` / `status` / the workflow
 * are not writable in Phase 37 — sending them is an explicit `400`, not a
 * silently ignored field.
 *
 * Quantity is a whole number of Asset Units (`CR-014` Q1, working assumption).
 */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');
const { REQUEST_CATEGORIES } = require('../../domain/requestCategories');
const { REQUEST_STATUSES } = require('../../domain/requestStatuses');
const { REQUEST_DOCUMENT_TYPES } = require('../../domain/requestDocumentTypes');
const {
  RECEIPT_PLACEMENTS,
  CONFIRMATION_PHOTO_LIMITS,
} = require('../../domain/requestFulfilmentRules');
const { REFERENCE_URL_MESSAGES, normalizeReferenceUrl } = require('../../domain/referenceUrl');

const uuid = z.string().uuid('must be a UUID');

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  // A round trip, not `Date.parse`: V8 accepts 2026-02-30 and rolls it into
  // March, which PostgreSQL then refuses as a server error.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'must be a real calendar date');

const idParams = z.object({ id: uuid });

const title = z.string().trim().min(1, 'is required').max(255);
const justification = z.string().trim().max(5000).nullish();

const createRequest = z
  .object({
    requesterAssignmentId: uuid,
    category: z.enum(REQUEST_CATEGORIES),
    title,
    justification,
    departmentId: uuid.nullish(),
    destinationLocationId: uuid.nullish(),
    neededBy: isoDate.nullish(),
  })
  .strict();

const updateRequest = z
  .object({
    category: z.enum(REQUEST_CATEGORIES),
    title,
    justification,
    departmentId: uuid.nullable(),
    destinationLocationId: uuid.nullable(),
    neededBy: isoDate.nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const listRequests = listQuerySchema({
  status: z.enum(REQUEST_STATUSES).optional(),
  category: z.enum(REQUEST_CATEGORIES).optional(),
  departmentId: uuid.optional(),
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  // Phase 38 (decision F6).
  awaiting: z.enum(['me']).optional(),
  // P6 (§64.6): involved requests with an unseen update.
  updated: z.enum(['me']).optional(),
});

// --- Phase 38: workflow actions ---------------------------------------------

const cancelRequest = z
  .object({ reason: z.string().trim().min(1, 'is required').max(2000) })
  .strict();

const decideStep = z
  .object({
    // REQUEST_REVISION — REQ-REQUEST-018.
    decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_REVISION']),
    // Required to reject, and to request a revision (its reason) — checked in
    // the domain so the error names the rule.
    comment: z.string().trim().max(5000).nullish(),
    // REQUEST_REVISION only, optional: at most one note per item of the request.
    itemNotes: z
      .array(
        z
          .object({
            requestItemId: uuid,
            note: z.string().trim().min(1, 'is required').max(5000),
          })
          .strict()
      )
      .max(200)
      .optional(),
  })
  .strict();

const completeStep = z.object({ note: z.string().trim().max(5000).nullish() }).strict();

const classificationId = z
  .string()
  .trim()
  .regex(/^\d{12}$/, 'must be a 12-digit classification code');

/**
 * REQ-REQUEST-019: one optional product link, normalized — blank is none, and
 * an unsent field stays unsent so `PATCH` leaves it alone. The rules live in
 * `domain/referenceUrl.js`.
 */
const referenceUrl = z
  .string({ invalid_type_error: REFERENCE_URL_MESSAGES.type })
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    const result = normalizeReferenceUrl(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: REFERENCE_URL_MESSAGES[result.reason] });
      return z.NEVER;
    }
    return result.value;
  });

const itemFields = {
  description: z.string().trim().min(1, 'is required').max(255),
  specification: z.string().trim().max(5000).nullish(),
  referenceUrl,
  quantityRequested: z
    .number()
    .int('must be a whole number of asset units')
    .positive('must be greater than zero')
    .max(100000),
  measurementUnitId: uuid.nullish(),
  estimatedUnitPrice: z
    .number()
    .nonnegative('must not be negative')
    .max(9999999999999.99)
    .nullish(),
  classificationId: classificationId.nullish(),
  // §73: a consumable line — its description and unit follow the consumable,
  // and its quantity is in that unit.
  consumableId: uuid.nullish(),
};

/** An asset line needs a description; a consumable line takes its name. */
const createItem = z
  .object({ ...itemFields, description: itemFields.description.optional() })
  .strict()
  .superRefine((body, ctx) => {
    if (body.consumableId || body.description) return;
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'is required' });
  });

const updateItem = z
  .object(itemFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * Phase 39 — the text fields of a multipart upload (`06-api.md` §12.4). The
 * file itself is checked by the upload middleware and the storage service. A
 * blank title is stored as none.
 */
const uploadDocument = z
  .object({
    documentType: z.enum(REQUEST_DOCUMENT_TYPES, {
      errorMap: () => ({ message: `must be one of: ${REQUEST_DOCUMENT_TYPES.join(', ')}` }),
    }),
    title: z.string().trim().max(255).optional(),
  })
  .strict();

const downloadQuery = z.object({ download: z.enum(['true', 'false']).optional() }).strict();

/**
 * Phase 40 — `POST /request-items/:id/register` (`06-api.md` §12.5).
 *
 * Either an existing asset (`assetId`) or a new one (`name` +
 * `classificationId`, optional `vendorId`) — never both. No location field of
 * any kind (decision D1). The number composition rules depend on the
 * institution's format, which only the service knows; the same shapes as
 * `POST /contract-items/:id/assets`.
 */
const numberComposition = z.string().trim().min(1, 'is required').max(32);

const registerUnits = z
  .object({
    assetId: uuid.optional(),
    name: z.string().trim().min(1, 'is required').max(255).optional(),
    classificationId: z.string().trim().length(12, 'must be a 12-character code').optional(),
    vendorId: uuid.optional(),
    unitCount: z
      .number()
      .int('must be a whole number')
      .min(1, 'must be at least 1')
      .max(500, 'must not exceed 500'),
    departmentId: uuid.nullable().optional(),
    contractItemId: uuid.optional(),
    description: z.string().trim().max(5000).optional(),
    numberComposition: numberComposition.optional(),
    numberCompositions: z.array(numberComposition).min(1).max(500).optional(),
    // REQ-UNIT-012 (migration 056): the units' own funding source. Optional;
    // required only when the institution's inventory code carries it and the
    // asset has no contract that names one — the service decides.
    fundingSourceId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.assetId) {
      for (const field of ['name', 'classificationId', 'vendorId']) {
        if (body[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: 'must not be given together with assetId',
          });
        }
      }
      return;
    }
    for (const field of ['name', 'classificationId']) {
      if (!body[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'is required when no assetId is given',
        });
      }
    }
  });

/** Phase 40 — `POST /request-items/:id/units`: link one existing unit (D3, D11). */
const linkUnit = z.object({ assetUnitId: uuid }).strict();

/**
 * Phase 41 — `POST /requests/:id/receive` (`IMPLEMENTATION_PLAN.md` §60).
 * Named units OR `all: true`, never both. `receivedOn` is the requester's
 * date; its business-date bounds are checked by the domain.
 */
/*
 * Migration 057: multipart/form-data, with the photos (`photos`, 1–5, checked
 * by the domain) in the same request. A form carries only strings, so a single
 * `assetUnitIds` arrives as a string and `all` as "true". `description` is the
 * receipt's one description — `note` is no longer accepted; it stays on Phase
 * 41 receipts only. `placement` is required exactly when the Request has an
 * intended place, which only the domain knows.
 */
const receiveUnits = z
  .object({
    assetUnitIds: z
      .preprocess(
        (value) => (typeof value === 'string' ? [value] : value),
        z.array(uuid).min(1, 'name at least one unit').max(500)
      )
      .optional(),
    all: z.preprocess((value) => (value === 'true' ? true : value), z.literal(true)).optional(),
    receivedOn: isoDate,
    placement: z
      .enum(RECEIPT_PLACEMENTS, {
        errorMap: () => ({ message: `must be one of: ${RECEIPT_PLACEMENTS.join(', ')}` }),
      })
      .optional(),
    description: z.string().trim().min(1, 'is required').max(5000),
    // REQ-REQUEST-022: the unit each `unitPhotos` file shows, in the same order.
    // Units only — the server finds their receipts; a client never names one.
    unitPhotoUnitIds: z
      .preprocess(
        (value) => (typeof value === 'string' ? [value] : value),
        z.array(uuid).max(CONFIRMATION_PHOTO_LIMITS.max)
      )
      .optional(),
  })
  .strict()
  .refine((body) => Boolean(body.assetUnitIds) !== Boolean(body.all), {
    message: 'give either assetUnitIds or all: true',
    path: ['assetUnitIds'],
  });

/**
 * §73 — issuing consumables against the request's consumable lines: what is
 * actually handed over now, per line. Never more than a line still needs;
 * never more than stock holds (the service, under lock).
 */
const issueConsumables = z
  .object({
    items: z
      .array(
        z
          .object({
            requestItemId: uuid,
            quantity: z
              .number()
              .int('must be a whole number')
              .positive('must be greater than zero')
              .max(1000000),
          })
          .strict()
      )
      .min(1, 'name at least one line')
      .max(200)
      .refine(
        (lines) => new Set(lines.map((line) => line.requestItemId)).size === lines.length,
        'name each line once'
      ),
    note: z.string().trim().max(5000).nullish(),
  })
  .strict();

/** Phase 41 — closing the remainder, and reversing a receipt: a reason each. */
const reasonBody = z.object({ reason: z.string().trim().min(1, 'is required').max(5000) }).strict();

module.exports = {
  idParams,
  createRequest,
  updateRequest,
  listRequests,
  createItem,
  updateItem,
  cancelRequest,
  decideStep,
  completeStep,
  uploadDocument,
  downloadQuery,
  registerUnits,
  linkUnit,
  receiveUnits,
  issueConsumables,
  reasonBody,
};
