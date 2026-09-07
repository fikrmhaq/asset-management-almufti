'use strict';

/**
 * Reference lookup endpoints — `06-api.md` §4.2, §4.4, §4.5, §4.6.
 *
 * One router factory, parameterized by resource. Categories are mounted
 * read-only.
 */

const { Router } = require('express');
const { z } = require('zod');

const { LOOKUPS, lookupService } = require('./service');
const { CONDITIONS } = require('../../db/enums');
const { URL_SAFE_CODE } = require('../../domain/inventoryCode');
const { listQuerySchema } = require('../../query/listQuery');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendList, sendNoContent } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

const listQuery = listQuerySchema({ q: z.string().trim().min(1).optional() });

/** Name column widths, from `04-data-model.md` §5.1. */
const NAME_MAX = {
  'measurement-units': 100,
  'contract-types': 50,
  'funding-sources': 100,
  'transaction-types': 100,
  'account-codes': 250,
  categories: 100,
};

/**
 * The path-parameter schema for a lookup's key.
 *
 * These tables genuinely differ, so validating them all as integers would 400 on
 * a perfectly valid measurement-unit UUID.
 */
const KEY_SCHEMA = {
  uuid: () => z.object({ id: z.string().uuid('must be a UUID') }),
  integer: () => z.object({ id: z.coerce.number().int().positive('must be a positive integer') }),
  char12: () => z.object({ code: z.string().trim().length(12, 'must be 12 characters') }),
};

function schemasFor(resource, spec) {
  const name = z
    .string()
    .trim()
    .min(1, 'is required')
    .max(NAME_MAX[resource] ?? 100);

  /**
   * Extra fields a lookup declares — Phase 26 (`CR-007`).
   *
   * Today only the funding source's business code. Constrained to the identifier
   * alphabet because it may be carried into an inventory code, and that code
   * travels in the address a scanned label resolves to (REQ-UNIT-011) — the
   * same class `institutions.code` is held to, mirroring
   * `chk_funding_sources_code_url_safe`.
   */
  const extraFields = Object.fromEntries(
    (spec.fields ?? []).map((field) => [
      field,
      z
        .string()
        .trim()
        .min(1, 'is required')
        .max(8)
        .regex(URL_SAFE_CODE, 'must use only letters, digits, hyphen, underscore or dot'),
    ])
  );

  // Generated keys — UUID or identity — are never supplied by the caller. The
  // account code is a natural key and must be.
  const create =
    spec.keyType === 'char12'
      ? z.object({ code: z.string().trim().length(12, 'must be 12 characters'), name }).strict()
      : z.object({ name, ...extraFields }).strict();

  // Required on create, optional on update: a lookup predating the column may be
  // given its code without restating the name.
  const update = z
    .object({
      name: name.optional(),
      ...Object.fromEntries(
        Object.entries(extraFields).map(([field, schema]) => [field, schema.optional()])
      ),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided',
    });

  return { create, update, params: KEY_SCHEMA[spec.keyType]() };
}

function lookupRouter(resource) {
  const service = lookupService(resource);
  const { spec } = service;
  const { create, update, params } = schemasFor(resource, spec);
  const keyParam = spec.key;

  const router = Router();

  router.get(
    '/',
    requirePermission(`${spec.permission}:read`),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query);
      sendList(res, rows, pagination);
    })
  );

  router.get(
    `/:${keyParam}`,
    requirePermission(`${spec.permission}:read`),
    validate({ params }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params[keyParam]));
    })
  );

  if (spec.readOnly) return router;

  router.post(
    '/',
    requirePermission(`${spec.permission}:create`),
    validate({ body: create }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body));
    })
  );

  router.patch(
    `/:${keyParam}`,
    requirePermission(`${spec.permission}:update`),
    validate({ params, body: update }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params[keyParam], req.body));
    })
  );

  router.delete(
    `/:${keyParam}`,
    requirePermission(`${spec.permission}:delete`),
    validate({ params }),
    asyncHandler(async (req, res) => {
      await service.remove(req.params[keyParam]);
      sendNoContent(res);
    })
  );

  return router;
}

/**
 * `GET /reference/conditions` — `06-api.md` §4.6, REQ-REF-006.
 *
 * ConditionEnum is a fixed enum, not a table (`04-data-model.md` §4), so it is
 * exposed as a static list rather than a CRUD resource.
 */
function referenceRouter() {
  const router = Router();

  router.get('/conditions', requirePermission('condition:read'), (req, res) =>
    sendItem(
      res,
      CONDITIONS.map((value) => ({ value }))
    )
  );

  return router;
}

module.exports = { lookupRouter, referenceRouter, LOOKUP_RESOURCES: Object.keys(LOOKUPS) };
