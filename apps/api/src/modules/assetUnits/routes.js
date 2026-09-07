'use strict';

/** Asset unit endpoints — `06-api.md` §5.2. */

const { Router } = require('express');
const { z } = require('zod');

const service = require('./service');
const attributeValueService = require('../attributeValues/service');
const borrowingService = require('../borrowings/service');
const transactionService = require('../transactions/service');
const { CONDITIONS, LIFECYCLE_STATES } = require('../../db/enums');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendList } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { MAX_LENGTH, INVENTORY_CODE } = require('../../domain/inventoryCode');

const uuid = z.string().uuid('must be a UUID');
const idParams = z.object({ id: uuid });

/**
 * A scanned inventory code (REQ-UNIT-011). Validated against the same character
 * class the code is minted from, so a mis-scan is a `400` naming the field
 * rather than a database lookup for something that could never exist.
 */
const inventoryCode = z.string().trim().min(1, 'is required').max(MAX_LENGTH);

/**
 * The QUERY form — `CR-008`. This is where a code minted today is looked up,
 * because a code may now contain a slash and a slash cannot cross a path
 * segment. `INVENTORY_CODE` is the full alphabet including it.
 */
const codeQuery = z.object({
  code: inventoryCode.regex(INVENTORY_CODE, 'is not a valid inventory code'),
});

/**
 * The PATH form, kept permanently for the labels already printed onto it.
 *
 * Its alphabet is deliberately the NARROWER one — a slashed code could never
 * have reached this route, so accepting the character here would only accept a
 * code this route can never actually receive intact.
 */
const codeParams = z.object({
  inventoryCode: inventoryCode.regex(/^[A-Za-z0-9._-]+$/, 'is not a valid inventory code'),
});

/**
 * `contractItemId` is nullable so a wrong procurement line can be cleared, not
 * only corrected — REQ-PROC-006. The service checks it against the asset's own
 * contract (REQ-ASSET-011) before it is stored.
 */
const updateUnit = z
  .object({
    description: z.string().trim().max(5000).nullable(),
    departmentId: uuid.nullable(),
    contractItemId: uuid.nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * One endpoint records a state snapshot — condition, location and lifecycle
 * state together (`06-api.md` §5.2). Every field but `description` is optional:
 * omitted values carry forward from the current snapshot.
 */
const recordHistory = z
  .object({
    description: z.string().trim().min(1, 'is required').max(5000),
    condition: z.enum(CONDITIONS).optional(),
    locationId: uuid.optional(),
    lifecycleState: z.enum(LIFECYCLE_STATES).optional(),
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const listHistory = listQuerySchema({});

const replaceAttributeValues = z
  .object({ values: z.record(z.string().uuid(), z.unknown()) })
  .strict();

/**
 * Filters for the collection — `06-api.md` §5.2, `CR-005`.
 *
 * All optional, and all NARROWING ONLY. Scope is applied in the service and is
 * not expressible here: a PIC-scoped caller who omits `departmentId`, or supplies
 * another department's id, still receives only their own units.
 */
const listUnits = listQuerySchema({
  status: z.enum(['active', 'inactive']).optional(),
  departmentId: uuid.optional(),
  lifecycleState: z.enum(LIFECYCLE_STATES).optional(),
  condition: z.enum(CONDITIONS).optional(),
  locationId: uuid.optional(),
  q: z.string().trim().min(1).optional(),
});

function assetUnitsRouter() {
  const router = Router();

  /**
   * The Asset Unit collection — `CR-005`.
   *
   * `asset-unit:read`, NOT `asset:read`. That is the whole point: a unit is an
   * operational resource that may be scoped to a Department PIC, while its Asset
   * is a master resource they do not administer. This is the only list that
   * answers "which units am I responsible for?" without going through a parent
   * the caller may not be able to open.
   */
  router.get(
    '/',
    requirePermission('asset-unit:read'),
    validate({ query: listUnits }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  /**
   * Lookup by inventory code — REQ-UNIT-011, two shapes.
   *
   * The QUERY form is what a label minted since `CR-008` resolves to: a code may
   * contain a slash, and no amount of encoding makes a slash safe inside a path
   * segment across every proxy that will sit in front of this.
   *
   * Both are declared before `/:id` so neither is captured as an id, and this
   * one before `/by-code/:inventoryCode` so `/by-code?code=…` is not read as a
   * path form with an empty parameter.
   */
  router.get(
    '/by-code',
    requirePermission('asset-unit:read'),
    validate({ query: codeQuery }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detailByCode(req.query.code, req.principal));
    })
  );

  /**
   * The path form. NOT deprecated and not removed: every label printed before
   * `CR-008` carries this address, and those labels outlive the change by years.
   */
  router.get(
    '/by-code/:inventoryCode',
    requirePermission('asset-unit:read'),
    validate({ params: codeParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detailByCode(req.params.inventoryCode, req.principal));
    })
  );

  router.get(
    '/:id/label',
    requirePermission('asset-unit:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.label(req.params.id, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('asset-unit:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  router.patch(
    '/:id',
    requirePermission('asset-unit:update'),
    validate({ params: idParams, body: updateUnit }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/deactivate',
    requirePermission('asset-unit:deactivate'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.deactivate(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/reactivate',
    requirePermission('asset-unit:deactivate'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.reactivate(req.params.id, req.principal));
    })
  );

  // --- History --------------------------------------------------------------

  router.get(
    '/:id/history',
    requirePermission('asset-unit:read'),
    validate({ params: idParams, query: listHistory }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.history(req.params.id, req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  router.post(
    '/:id/history',
    requirePermission('asset-unit:record-history'),
    validate({ params: idParams, body: recordHistory }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.recordHistory(req.params.id, req.body, req.principal));
    })
  );

  // Location assignment history (§11.5). Distinct from the longitudinal
  // history above, which records condition and lifecycle state alongside it.
  router.get(
    '/:id/locations',
    requirePermission('asset-unit:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.locationHistory(req.params.id, req.principal));
    })
  );

  // --- Attribute values -----------------------------------------------------

  router.get(
    '/:id/attribute-values',
    requirePermission('asset-attribute-value:read'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await attributeValueService.list('assetUnit', req.params.id, req.principal));
    })
  );

  router.put(
    '/:id/attribute-values',
    requirePermission('asset-attribute-value:update'),
    validate({ params: idParams, body: replaceAttributeValues }),
    asyncHandler(async (req, res) => {
      sendItem(
        res,
        await attributeValueService.replace(
          'assetUnit',
          req.params.id,
          req.body.values,
          req.principal
        )
      );
    })
  );

  // --- Operational history --------------------------------------------------
  // Guarded by the resource actually being read (§1.3): these return borrowings
  // and transactions, not asset units.

  router.get(
    '/:id/borrowings',
    requirePermission('borrowing:read'),
    validate({ params: idParams, query: listQuerySchema({}) }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await borrowingService.forUnit(
        req.params.id,
        req.query,
        req.principal
      );
      sendList(res, rows, pagination);
    })
  );

  router.get(
    '/:id/transactions',
    requirePermission('transaction:read'),
    validate({ params: idParams, query: listQuerySchema({}) }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await transactionService.forUnit(
        req.params.id,
        req.query,
        req.principal
      );
      sendList(res, rows, pagination);
    })
  );

  return router;
}

module.exports = { assetUnitsRouter };
