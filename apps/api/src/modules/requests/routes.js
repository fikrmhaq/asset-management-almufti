'use strict';

/**
 * Request endpoints — `06-api.md` §12.3: drafting (Phase 37), and submission,
 * cancellation and step actions (Phase 38), documents (Phase 39, `06-api.md`
 * §12.4), registration against items (Phase 40, §12.5), receipt, reversal and
 * closing the remainder (Phase 41, §12.6). None of these codes is in the `CR-004` PIC ceiling. The rules are in
 * `domain/requests.js`, `domain/requestWorkflow.js` and
 * `domain/requestDocuments.js`.
 */

const { Router } = require('express');

const service = require('../../domain/requests');
const workflow = require('../../domain/requestWorkflow');
const documents = require('../../domain/requestDocuments');
const registration = require('../../domain/requestRegistration');
const fulfilment = require('../../domain/requestFulfilment');
const schemas = require('./schemas');
const { asyncHandler } = require('../../http/asyncHandler');
const {
  sendItem,
  sendCreated,
  sendList,
  sendCollection,
  sendNoContent,
} = require('../../http/respond');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { singleUpload, fieldsUpload, requireFile } = require('../../middleware/upload');
const { CONFIRMATION_PHOTO_LIMITS } = require('../../domain/requestFulfilmentRules');

function requestsRouter() {
  const router = Router();

  router.get(
    '/',
    requirePermission('request:read'),
    validate({ query: schemas.listRequests }),
    asyncHandler(async (req, res) => {
      const { rows, pagination } = await service.list(req.query, req.principal);
      sendList(res, rows, pagination);
    })
  );

  // Before `/:id`. P5 + P6 (§64.5, §64.6): the two navigation counts, each
  // derived on its own — needs my action, and updated since I last looked.
  router.get(
    '/attention',
    requirePermission('request:read'),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.attention(req.principal));
    })
  );

  // Before `/:id`. Informational only: nothing is refused because of it.
  router.get(
    '/guidance',
    requirePermission('request:create'),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.guidance(req.principal));
    })
  );

  router.post(
    '/',
    requirePermission('request:create'),
    validate({ body: schemas.createRequest }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.create(req.body, req.principal));
    })
  );

  router.get(
    '/:id',
    requirePermission('request:read'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.detail(req.params.id, req.principal));
    })
  );

  // P6 (§64.6): the caller has seen this request now — read state only, not
  // audited, and for this one request and this one user.
  router.post(
    '/:id/view',
    requirePermission('request:read'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      await service.markViewed(req.params.id, req.principal);
      res.status(204).end();
    })
  );

  router.patch(
    '/:id',
    requirePermission('request:update'),
    validate({ params: schemas.idParams, body: schemas.updateRequest }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.update(req.params.id, req.body, req.principal));
    })
  );

  // --- Phase 38 -------------------------------------------------------------

  router.post(
    '/:id/submit',
    requirePermission('request:submit'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      sendItem(res, await workflow.submit(req.params.id, req.principal));
    })
  );

  // Also discards the requester's own DRAFT (decision F3).
  router.post(
    '/:id/cancel',
    requirePermission('request:cancel'),
    validate({ params: schemas.idParams, body: schemas.cancelRequest }),
    asyncHandler(async (req, res) => {
      sendItem(res, await workflow.cancel(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/items',
    requirePermission('request-item:create'),
    validate({ params: schemas.idParams, body: schemas.createItem }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await service.addItem(req.params.id, req.body, req.principal));
    })
  );

  // --- Phase 41: receipt and closing the remainder (§12.6) --------------------
  //
  // Receipt: the requester only — the domain refuses anyone else, oversight
  // included (Q2a). Close: the code and visibility, no actor rule (D41-2).

  // Migration 057: multipart — the receipt confirmation and its 1–5 photos
  // arrive in the same request, and land together or not at all. REQ-REQUEST-022:
  // general photos under `photos`, unit photos under `unitPhotos` (each naming
  // its unit in `unitPhotoUnitIds`, same order) — 1–5 in total.
  router.post(
    '/:id/receive',
    requirePermission('request:receive'),
    validate({ params: schemas.idParams }),
    fieldsUpload({ fields: ['photos', 'unitPhotos'], maxCount: CONFIRMATION_PHOTO_LIMITS.max }),
    validate({ body: schemas.receiveUnits }),
    asyncHandler(async (req, res) => {
      const files = {
        general: req.files?.photos ?? [],
        unit: req.files?.unitPhotos ?? [],
      };
      sendItem(res, await fulfilment.receive(req.params.id, req.body, files, req.principal));
    })
  );

  // §73: consumables handed over against the request's consumable lines — one
  // ISSUE movement per line, stock checked under lock, all or nothing.
  router.post(
    '/:id/issue',
    requirePermission('consumable:manage-stock'),
    validate({ params: schemas.idParams, body: schemas.issueConsumables }),
    asyncHandler(async (req, res) => {
      sendItem(res, await fulfilment.issue(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/close',
    requirePermission('request:close'),
    validate({ params: schemas.idParams, body: schemas.reasonBody }),
    asyncHandler(async (req, res) => {
      sendItem(res, await fulfilment.close(req.params.id, req.body, req.principal));
    })
  );

  // --- Phase 39: documents ----------------------------------------------------

  router.get(
    '/:id/documents',
    requirePermission('request-document:read'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      sendCollection(res, await documents.list(req.params.id, req.principal));
    })
  );

  router.post(
    '/:id/documents',
    requirePermission('request-document:create'),
    validate({ params: schemas.idParams }),
    singleUpload(),
    requireFile(),
    validate({ body: schemas.uploadDocument }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await documents.create(req.params.id, req.file, req.body, req.principal));
    })
  );

  return router;
}

function requestItemsRouter() {
  const router = Router();

  router.patch(
    '/:id',
    requirePermission('request-item:update'),
    validate({ params: schemas.idParams, body: schemas.updateItem }),
    asyncHandler(async (req, res) => {
      sendItem(res, await service.updateItem(req.params.id, req.body, req.principal));
    })
  );

  router.delete(
    '/:id',
    requirePermission('request-item:delete'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      await service.deleteItem(req.params.id, req.principal);
      sendNoContent(res);
    })
  );

  // --- Phase 40: registration (`06-api.md` §12.5) ----------------------------
  //
  // Registering and linking also require being the REGISTER step's current
  // actor (the domain, `DEC-J`). `asset:create` is required only for a new
  // asset, which only the domain can tell (D2).

  router.post(
    '/:id/register',
    requirePermission('request-item:register'),
    requirePermission('asset-unit:create'),
    validate({ params: schemas.idParams, body: schemas.registerUnits }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await registration.register(req.params.id, req.body, req.principal));
    })
  );

  router.get(
    '/:id/units',
    requirePermission('request-item-unit:read'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      sendCollection(res, await registration.listUnits(req.params.id, req.principal));
    })
  );

  // `asset-unit:read` too: the link never bypasses the unit's own read
  // authorization (D11) — and it never authorizes the link on its own.
  router.post(
    '/:id/units',
    requirePermission('request-item-unit:create'),
    requirePermission('asset-unit:read'),
    validate({ params: schemas.idParams, body: schemas.linkUnit }),
    asyncHandler(async (req, res) => {
      sendCreated(res, await registration.link(req.params.id, req.body, req.principal));
    })
  );

  return router;
}

/** `/request-item-units` — Phase 40: unlink while REGISTER is ACTIVE (D5). */
function requestItemUnitsRouter() {
  const router = Router();

  router.delete(
    '/:id',
    requirePermission('request-item-unit:delete'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      await registration.unlink(req.params.id, req.principal);
      sendNoContent(res);
    })
  );

  return router;
}

/**
 * `/request-steps` — Phase 38. Both actions require the permission (here) AND
 * being the step's resolved actor (in the domain, `DEC-J`).
 */
function requestStepsRouter() {
  const router = Router();

  router.post(
    '/:id/decide',
    requirePermission('request-step:decide'),
    validate({ params: schemas.idParams, body: schemas.decideStep }),
    asyncHandler(async (req, res) => {
      sendItem(res, await workflow.decide(req.params.id, req.body, req.principal));
    })
  );

  router.post(
    '/:id/complete',
    requirePermission('request-step:complete'),
    validate({ params: schemas.idParams, body: schemas.completeStep }),
    asyncHandler(async (req, res) => {
      sendItem(res, await workflow.complete(req.params.id, req.body, req.principal));
    })
  );

  return router;
}

/**
 * `/request-documents` — Phase 39. Metadata by default; the bytes with
 * `?download=true`, streamed through the API so the request's visibility
 * applies (the attachment convention, `06-api.md` §5.4).
 */
function requestDocumentsRouter() {
  const router = Router();

  router.get(
    '/:id',
    requirePermission('request-document:read'),
    validate({ params: schemas.idParams, query: schemas.downloadQuery }),
    asyncHandler(async (req, res) => {
      if (req.query.download !== 'true') {
        return sendItem(res, await documents.detail(req.params.id, req.principal));
      }

      const { document, buffer, fileType } = await documents.download(req.params.id, req.principal);
      res.type(fileType);
      // `attachment`, never `inline`: an uploaded file must not render in the
      // application's origin.
      res.set('Content-Disposition', `attachment; filename="${document.fileName}"`);
      return res.send(buffer);
    })
  );

  router.delete(
    '/:id',
    requirePermission('request-document:delete'),
    validate({ params: schemas.idParams }),
    asyncHandler(async (req, res) => {
      await documents.remove(req.params.id, req.principal);
      sendNoContent(res);
    })
  );

  return router;
}

/**
 * `/request-receipts` — Phase 41: reversing a receipt (Q2c). The domain also
 * requires `request:oversee`, refuses the receipt's own recorder, and refuses
 * once the Request has ended. The receipt is kept, marked reversed.
 */
function requestReceiptsRouter() {
  const router = Router();

  router.post(
    '/:id/reverse',
    requirePermission('request-receipt:reverse'),
    validate({ params: schemas.idParams, body: schemas.reasonBody }),
    asyncHandler(async (req, res) => {
      sendItem(res, await fulfilment.reverse(req.params.id, req.body, req.principal));
    })
  );

  return router;
}

module.exports = {
  requestsRouter,
  requestItemsRouter,
  requestStepsRouter,
  requestDocumentsRouter,
  requestItemUnitsRouter,
  requestReceiptsRouter,
};
