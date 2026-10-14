'use strict';

/**
 * Asset import endpoints, mounted at `/assets/import` ahead of `/assets`.
 *
 *   GET  /assets/import/template   the .xlsx to fill in
 *   POST /assets/import/preview    checks a file and shows what it would do;
 *                                  writes nothing (always 200, with a report)
 *   POST /assets/import            imports it, all or nothing (201, or 400
 *                                  naming each row)
 *
 * Guarded by the permissions the manual path needs: `asset:create` and
 * `asset-unit:create`, plus `asset-unit:record-history` when the file places
 * units (checked by the service, since only the file says so).
 */

const { Router } = require('express');
const { z } = require('zod');

const service = require('./service');
const { buildTemplate } = require('./template');
const { getModels } = require('../../db/models');
const { defaultInstitutionFor, assertCanAssignInstitution } = require('../../domain/scope');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendCreated, sendSpreadsheet } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { singleUpload, requireFile } = require('../../middleware/upload');

const institutionChoice = z
  .object({ institutionId: z.string().uuid('must be a UUID').optional().or(z.literal('')) })
  .strict();

function assetImportRouter() {
  const router = Router();
  const guards = [requirePermission('asset:create'), requirePermission('asset-unit:create')];

  router.get(
    '/template',
    ...guards,
    validate({ query: institutionChoice }),
    asyncHandler(async (req, res) => {
      const institutionId = defaultInstitutionFor(
        req.principal,
        req.query.institutionId || undefined
      );
      if (institutionId) assertCanAssignInstitution(req.principal, institutionId);
      const institution = institutionId
        ? await getModels().Institution.findByPk(institutionId)
        : null;

      const suffix = institution?.code ? `-${institution.code.replace(/[^A-Za-z0-9]+/g, '')}` : '';
      sendSpreadsheet(res, await buildTemplate(institution), `templat-impor-aset${suffix}.xlsx`);
    })
  );

  router.post(
    '/preview',
    ...guards,
    singleUpload(),
    requireFile(),
    validate({ body: institutionChoice }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.preview(req.file, req.body, req.principal));
    })
  );

  router.post(
    '/',
    ...guards,
    singleUpload(),
    requireFile(),
    validate({ body: institutionChoice }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.importAssets(req.file, req.body, req.principal));
    })
  );

  return router;
}

module.exports = { assetImportRouter };
