'use strict';

/**
 * Attachment endpoints — `06-api.md` §5.4.
 *
 * Upload lives under the owning asset (§5.1); these are the two operations that
 * address an attachment directly.
 */

const { Router } = require('express');
const { z } = require('zod');

const service = require('./service');
const { asyncHandler } = require('../../http/asyncHandler');
const { sendItem, sendNoContent } = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');

const idParams = z.object({ id: z.string().uuid('must be a UUID') });
const downloadQuery = z.object({ download: z.enum(['true', 'false']).optional() });

function attachmentsRouter() {
  const router = Router();

  /**
   * Metadata by default; the bytes when `?download=true`.
   *
   * The file is streamed through the API rather than exposed by path, so
   * REQ-FILE-005's authorization actually applies — a public storage URL would
   * bypass it entirely.
   */
  router.get(
    '/:id',
    requirePermission('attachment:read'),
    validate({ params: idParams, query: downloadQuery }),
    asyncHandler(async (req, res) => {
      if (req.query.download !== 'true') {
        return sendItem(res, await service.detail(req.params.id, req.principal));
      }

      const { attachment, buffer, fileType } = await service.download(req.params.id, req.principal);

      res.type(fileType);
      // `attachment` disposition, not `inline`: these are arbitrary uploaded
      // files, and rendering one in the browser's origin is how a stored HTML
      // or SVG payload would execute.
      res.set('Content-Disposition', `attachment; filename="${attachment.fileName}"`);
      return res.send(buffer);
    })
  );

  router.delete(
    '/:id',
    requirePermission('attachment:delete'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      await service.remove(req.params.id, req.principal);
      sendNoContent(res);
    })
  );

  return router;
}

module.exports = { attachmentsRouter };
