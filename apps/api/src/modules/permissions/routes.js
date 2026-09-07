'use strict';

/**
 * Permission catalog — `06-api.md` §3.5, REQ-ROLE-006, BR-013.
 *
 * Read-only by design: no POST, PATCH or DELETE exists for this resource. The
 * catalog is generated from enforced route metadata, so an administrator adding
 * a permission here would create a code nothing checks.
 *
 * Served from the database rather than the generator so the response reflects
 * what is actually seeded — if the two ever diverge, this surfaces it instead of
 * hiding it. Each row is enriched with the grouping and BR-015 flag the
 * role-permission checklist needs (`07-ui.md` §5.1).
 */

const { Router } = require('express');

const { getModels } = require('../../db/models');
const { getCatalog } = require('../../auth/permissionCatalog');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem } = require('../../http/respond');
const { requirePermission } = require('../../middleware/authorize');

function permissionsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('permission:read'),
    asyncHandler(async (req, res) => {
      const models = getModels();
      const rows = await models.Permission.findAll({ order: [['code', 'ASC']] });

      const metadata = new Map(getCatalog().map((entry) => [entry.code, entry]));

      sendItem(
        res,
        rows.map((row) => {
          const entry = metadata.get(row.code);
          return {
            code: row.code,
            description: row.description,
            resource: entry?.resource ?? null,
            action: entry?.action ?? null,
            group: entry?.group ?? null,
            systemWideOnly: entry?.systemWideOnly ?? false,
          };
        })
      );
    })
  );

  return router;
}

module.exports = { permissionsRouter };
