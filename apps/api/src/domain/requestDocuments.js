'use strict';

/**
 * Request documents — Phase 39 (`CR-014` §9), REQ-REQUEST-014, `06-api.md` §12.4.
 *
 * A file attached to a request: proposal, supporting document, invoice, payment
 * receipt ("kuitansi"), BAST or other. None is mandatory. The rules of who may
 * upload and delete are in `requestDocumentRules.js`; reading follows the
 * request's own visibility (REQ-REQUEST-015), so an invisible request's
 * documents are `404` like the request itself.
 *
 * ── What a document never does (H9) ──────────────────────────────────────
 *
 * It changes nothing but its own row and file. Uploading or deleting takes a
 * row lock on the request — so it cannot race a submission, a cancellation or a
 * decision — and writes nothing to the request, its steps, its items, any asset,
 * unit or attachment. A BAST is a document, not a receipt (`BR-031`); an invoice
 * attached during the acquisition declaration is a document, not a procurement
 * record (`CR-014` §8).
 *
 * ── Storage ──────────────────────────────────────────────────────────────
 *
 * The existing storage service, sharded `requests/{requestId}`, with the
 * existing type allow-list and size limit. The file is written before the row,
 * and removed again if the row does not land (DEC-020); a deleted row's file is
 * removed after the row is gone.
 */

const { Op } = require('sequelize');

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { NotFoundError } = require('../errors');
const storage = require('../services/storage');
const { serializeUser } = require('./picAssignments');
const { activeActorSql } = require('./actorResolution');
const { uploadRefusal, deleteRefusal, mayDelete } = require('./requestDocumentRules');
const requests = require('./requests');
const { CONFIRMATION_PHOTO } = require('./requestDocumentTypes');

const PERSON = ['id', 'username', 'firstName', 'lastName'];
const UPLOADER_INCLUDE = [{ association: 'uploader', attributes: PERSON }];

function serialize(document, request, principal) {
  return {
    id: document.id,
    requestId: document.requestId,
    documentType: document.documentType,
    title: document.title ?? null,
    fileName: document.fileName,
    fileType: document.fileType,
    // BIGINT arrives as a string from the driver; a file size fits a Number.
    fileSize: Number(document.fileSize),
    uploadedBy: serializeUser(document.uploader),
    createdAt: document.createdAt,
    canDelete: mayDelete(principal, request, document),
  };
}

/** Whether the caller resolves, now, as the actor of any ACTIVE step (H1). */
async function isActiveActor(principal, request, { models, transaction }) {
  const sequelize = models.Request.sequelize;
  const me = sequelize.escape(principal.userId);
  const [row] = await sequelize.query(
    `SELECT ${activeActorSql('r', me, undefined, sequelize)} AS actor
       FROM public.requests r WHERE r.id = $1`,
    { bind: [request.id], transaction, type: sequelize.QueryTypes.SELECT }
  );
  return Boolean(row?.actor);
}

async function assertCanUpload(principal, request, { models, transaction }) {
  const activeActor = await isActiveActor(principal, request, { models, transaction });
  const refusal = uploadRefusal(principal, request, { activeActor });
  if (refusal) throw refusal;
}

/**
 * A document the caller may reach, with its request. A document on a request
 * the caller cannot see is indistinguishable from one that does not exist.
 */
async function getVisibleDocument(id, principal, { models, transaction, lock } = {}) {
  const document = await models.RequestDocument.findByPk(id, {
    include: UPLOADER_INCLUDE,
    transaction,
  });
  if (!document) throw new NotFoundError('Request document not found');

  try {
    const request = await requests.getVisible(document.requestId, principal, {
      models,
      transaction,
      lock,
    });
    return { document, request };
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError('Request document not found');
    throw error;
  }
}

// --- Read ---------------------------------------------------------------------

/** `GET /requests/:id/documents`, newest first. */
async function list(requestId, principal, { models = getModels() } = {}) {
  requests.assertNotPicScoped(principal);
  const request = await requests.getVisible(requestId, principal, { models });

  const rows = await models.RequestDocument.findAll({
    // Receipt-confirmation photos are shown with their confirmation, not here
    // (migration 057); they stay readable by id.
    where: { requestId, documentType: { [Op.ne]: CONFIRMATION_PHOTO } },
    include: UPLOADER_INCLUDE,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
  });
  return rows.map((row) => serialize(row, request, principal));
}

/** `GET /request-documents/:id` — metadata. */
async function detail(id, principal, { models = getModels() } = {}) {
  requests.assertNotPicScoped(principal);
  const { document, request } = await getVisibleDocument(id, principal, { models });
  return serialize(document, request, principal);
}

/** `GET /request-documents/:id?download=true` — metadata plus the bytes. */
async function download(id, principal, { models = getModels() } = {}) {
  requests.assertNotPicScoped(principal);
  const { document, request } = await getVisibleDocument(id, principal, { models });
  const buffer = await storage.read(document.storageReference);
  return { document: serialize(document, request, principal), buffer, fileType: document.fileType };
}

// --- Write --------------------------------------------------------------------

/**
 * `POST /requests/:id/documents` — H1.
 *
 * Checked once before the file is written, so a caller who would be refused
 * never puts a file on disk, and again under the request's row lock, because
 * the status or the active actor may have changed in between.
 */
async function create(requestId, file, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  const request = await requests.getVisible(requestId, principal, { models });
  await assertCanUpload(principal, request, { models });
  storage.assertAllowedType(file, { label: 'file' });

  const stored = await storage.store(file, { shard: `requests/${requestId}` });

  let documentId;
  try {
    documentId = await withTransaction(
      async (transaction) => {
        const locked = await requests.getVisible(requestId, principal, {
          models,
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        await assertCanUpload(principal, locked, { models, transaction });

        const created = await models.RequestDocument.create(
          {
            requestId,
            documentType: body.documentType,
            title: body.title?.trim() || null,
            fileName: stored.fileName,
            fileType: file.mimetype,
            fileSize: stored.fileSize,
            storageReference: stored.storageReference,
            uploadedBy: principal.userId,
          },
          { transaction }
        );
        return created.id;
      },
      { sequelize }
    );
  } catch (error) {
    // The row is the record of truth; without it the file is an orphan.
    await storage.remove(stored.storageReference).catch(() => {});
    throw error;
  }

  return detail(documentId, principal, { models });
}

/** `DELETE /request-documents/:id` — H3. */
async function remove(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);

  const storageReference = await withTransaction(
    async (transaction) => {
      const { document, request } = await getVisibleDocument(id, principal, {
        models,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const refusal = deleteRefusal(principal, request, document);
      if (refusal) throw refusal;

      const reference = document.storageReference;
      await document.destroy({ transaction });
      return reference;
    },
    { sequelize }
  );

  // After the row is gone, so a failed delete cannot strand a row pointing at a
  // file that no longer exists.
  await storage.remove(storageReference);
}

module.exports = { list, detail, download, create, remove, serialize };
