'use strict';

/**
 * Receipt, reversal and closing the remainder — Phase 41 (`CR-014` §5.5, §7.4;
 * `IMPLEMENTATION_PLAN.md` §60), REQ-REQUEST-011 – REQ-REQUEST-013.
 *
 * ── The three facts ──────────────────────────────────────────────────────
 *
 * Registration (Phase 40) links a unit to an item. RECEIPT — here — records
 * that the requester actually received a registered unit, on a date they give.
 * FULFILMENT is the received quantity and the status that follows. A receipt
 * is never inferred from registration, procurement, location or lifecycle, and
 * recording one never moves a unit or changes its lifecycle (`BR-031`).
 *
 * ── Who ─────────────────────────────────────────────────────────────────
 *
 *   receive  the requester, with `request:receive` — oversight never substitutes (Q2a)
 *   reverse  `request-receipt:reverse` + `request:oversee`, never the user who
 *            recorded the receipt, only before the Request ends (Q2c)
 *   close    `request:close` + visibility, no actor rule (D41-2)
 *
 * ── The arithmetic ──────────────────────────────────────────────────────
 *
 * In `requestFulfilmentRules.js`. Every write here ends with `settle`, which
 * recomputes the status in the same transaction: a Request reaching FULFILLED,
 * CLOSED or CANCELLED gets `closed_at`, and its unfinished steps become CLOSED
 * (D41-4). Every operation takes the Request's row lock first.
 */

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { ValidationError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');
const { hasPermission } = require('../auth/principal');
const {
  OPEN_FULFILMENT_STATUSES,
  UNRECEIVABLE_STATES,
  isReceivableUnit,
  itemFigures,
  closedCancellation,
  statusFor,
  receivedOnRefusal,
  placementRefusal,
  photoCountRefusal,
} = require('./requestFulfilmentRules');
const { CONFIRMATION_PHOTO } = require('./requestDocumentTypes');
const storage = require('../services/storage');
const { TERMINAL_REQUEST_STATUSES } = require('./requestStepStates');
const { closeOpenSteps } = require('./requestWorkflow');
const { currentStep, currentSteps } = require('./requestCycles');
const requests = require('./requests');
const { placeReceivedUnits } = require('./receiptPlacement');
const { lockConsumable, applyMovement } = require('./consumableStock');

// --- Shared -------------------------------------------------------------------

function assertOpen(request, action) {
  if (OPEN_FULFILMENT_STATUSES.includes(request.status)) return;
  throw new ConflictError(`This request cannot ${action} now`, [
    {
      field: 'status',
      issue: `this request is ${request.status}; it must be APPROVED or PARTIALLY_FULFILLED`,
    },
  ]);
}

async function lockRequest(id, principal, { models, transaction }) {
  return requests.getVisible(id, principal, { models, transaction, lock: transaction.LOCK.UPDATE });
}

/**
 * The status the figures now call for, applied in the caller's transaction
 * (§60.3). A terminal status sets `closed_at` and closes every unfinished step.
 */
async function settle(request, principal, { models, transaction, now = new Date() }) {
  const items = await models.RequestItem.findAll({
    where: { requestId: request.id },
    transaction,
  });
  const counts = await requests.fulfilmentCounts(
    items.map((item) => item.id),
    { models, transaction }
  );
  const figures = items.map((item) => itemFigures(item, counts[item.id]));
  const totalCancelled = items.reduce((sum, item) => sum + item.quantityCancelled, 0);
  const next = statusFor(figures, totalCancelled);
  if (next === request.status) return;

  const terminal = TERMINAL_REQUEST_STATUSES.includes(next);
  await request.update(
    { status: next, updatedBy: principal.userId, ...(terminal ? { closedAt: now } : {}) },
    { transaction }
  );
  if (terminal) {
    // Only the current cycle can hold an unfinished step (REQ-REQUEST-018).
    const steps = await currentSteps(request.id, {
      models,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    await closeOpenSteps(steps, { transaction, now });
  }
}

/** The request's links, each with its unit and its active receipt (if any). */
async function linksOf(requestId, { models, transaction }) {
  return models.RequestItemUnit.findAll({
    include: [
      {
        association: 'item',
        attributes: ['id', 'requestId'],
        where: { requestId },
        required: true,
      },
      {
        association: 'assetUnit',
        attributes: ['id', 'inventoryCode', 'isActive', 'lifecycleState'],
      },
      {
        association: 'receipts',
        where: { reversedAt: null },
        required: false,
      },
    ],
    transaction,
  });
}

const unitLabel = (link) => link.assetUnit?.inventoryCode ?? link.assetUnitId;

// --- Receive ------------------------------------------------------------------

/** The Request's intended place, as the confirmation snapshots it. */
async function destinationSnapshot(request, { models, transaction }) {
  if (!request.destinationLocationId) return null;
  const location = await models.Location.findByPk(request.destinationLocationId, {
    attributes: ['id', 'name'],
    transaction,
  });
  return { id: request.destinationLocationId, name: location?.name ?? '' };
}

function assertPlacement(placement, request) {
  const refusal = placementRefusal(placement, {
    hasDestination: Boolean(request.destinationLocationId),
  });
  if (refusal) {
    throw new ValidationError('The placement is not acceptable', [
      { field: 'placement', issue: refusal },
    ]);
  }
}

/**
 * 1–5 photos IN TOTAL — general and unit photos together (REQ-REQUEST-022) —
 * each a JPG or PNG by type and extension.
 */
function assertPhotos(general, unit) {
  const refusal = photoCountRefusal(general.length + unit.length);
  if (refusal) {
    throw new ValidationError('The photos are not acceptable', [
      { field: 'photos', issue: refusal },
    ]);
  }
  for (const [files, field] of [
    [general, 'photos'],
    [unit, 'unitPhotos'],
  ]) {
    for (const photo of files) {
      storage.assertAllowedType(photo, {
        mimeTypes: storage.PHOTO_MIME_TYPES,
        extensions: storage.PHOTO_EXTENSIONS,
        label: 'photo',
        field,
      });
    }
  }
}

/** Refuses a unit photo whose unit is not one this receive operation receives. */
function unitPhotoRefusal(unitIds) {
  return new ValidationError(
    'A unit photo names a unit this receipt does not receive',
    [...new Set(unitIds)].map((unitId) => ({
      field: 'unitPhotoUnitIds',
      issue: `${unitId}: not among the units received in this receipt`,
    }))
  );
}

/**
 * `POST /requests/:id/receive` — REQ-REQUEST-011, with its receipt
 * confirmation (migration 057).
 *
 * `{assetUnitIds}` names units; `{all: true}` takes every pending unit and
 * skips blocked ones (O8). All or nothing: any named unit that is not linked to
 * this Request, already received, or no longer receivable fails the whole call,
 * each named, and nothing is written.
 *
 * Every call is ONE confirmation: the requester's description, the placement
 * against the Request's intended place (snapshot), and 1–5 photos. The
 * confirmation, every receipt and every photo land in one transaction, or none
 * does. The photos are stored first and removed again if the rows do not land
 * (DEC-020). It never touches a unit's lifecycle, condition or PIC; the one
 * move is REQ-REQUEST-024's placement (`receiptPlacement.js`): with
 * `AT_INTENDED_PLACE`, an unplaced unit goes to the snapshot location, in the
 * same transaction.
 *
 * REQ-REQUEST-022: `files` is `{general, unit}`. A general photo evidences the
 * whole confirmation; a unit photo names, in `body.unitPhotoUnitIds` (same
 * order), the ONE unit it shows. The client names units, never receipts: the
 * server creates the receipts here and links each unit photo to its unit's NEW
 * receipt. A named unit that this operation does not receive — another
 * request's, one not named or (with `all`) not pending, already received or
 * unreceivable — refuses the whole call. A plain array is all general photos.
 */
async function receive(id, body, files, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  const visible = await requests.getVisible(id, principal, { models });
  // Q2a: the requester, and only the requester. `request:oversee` never
  // substitutes — not even for a caller who could see and oversee it.
  if (visible.requesterUserId !== principal.userId) {
    throw new ForbiddenError('Only the requester can record receipt', [
      { issue: 'receipt is recorded by the requester, on their own request (CR-014 Q2a)' },
    ]);
  }
  assertOpen(visible, 'record receipt');

  const refusal = receivedOnRefusal(body.receivedOn, { requestCreatedAt: visible.createdAt });
  if (refusal) {
    throw new ValidationError('The date received is not acceptable', [
      { field: 'receivedOn', issue: refusal },
    ]);
  }

  const ids = body.all ? null : body.assetUnitIds;
  if (ids && new Set(ids).size !== ids.length) {
    throw new ValidationError('A unit is named more than once', [
      { field: 'assetUnitIds', issue: 'each asset unit may be named once' },
    ]);
  }
  assertPlacement(body.placement, visible);

  const general = Array.isArray(files) ? files : (files?.general ?? []);
  const unitFiles = Array.isArray(files) ? [] : (files?.unit ?? []);
  const unitTargets = body.unitPhotoUnitIds ?? [];
  if (unitTargets.length !== unitFiles.length) {
    throw new ValidationError('Each unit photo names one unit', [
      {
        field: 'unitPhotoUnitIds',
        issue: `${unitFiles.length} unit photo(s) but ${unitTargets.length} unit(s) named; name one unit for each, in order`,
      },
    ]);
  }
  assertPhotos(general, unitFiles);
  // Named units: refused before anything is stored. With `all`, the pending set
  // is known only under the lock, below.
  if (ids) {
    const outside = unitTargets.filter((unitId) => !ids.includes(unitId));
    if (outside.length > 0) throw unitPhotoRefusal(outside);
  }

  const photos = [
    ...general.map((photo) => ({ photo, assetUnitId: null })),
    ...unitFiles.map((photo, index) => ({ photo, assetUnitId: unitTargets[index] })),
  ];

  // Before the transaction, so a failed write never holds the row lock; each
  // is removed again below if the rows do not land.
  const stored = [];
  try {
    for (const { photo, assetUnitId } of photos) {
      stored.push({
        photo,
        assetUnitId,
        ...(await storage.store(photo, { shard: `requests/${id}` })),
      });
    }
  } catch (error) {
    await Promise.all(stored.map((s) => storage.remove(s.storageReference).catch(() => {})));
    throw error;
  }

  await withTransaction(
    async (transaction) => {
      const request = await lockRequest(id, principal, { models, transaction });
      assertOpen(request, 'record receipt');
      // The destination may have changed since (oversight, after submission).
      assertPlacement(body.placement, request);

      const links = await linksOf(request.id, { models, transaction });
      const pending = (link) => link.receipts.length === 0 && isReceivableUnit(link.assetUnit);

      let targets;
      if (!ids) {
        targets = links.filter(pending);
        if (targets.length === 0) {
          throw new ConflictError('No registered unit can be received now', [
            {
              field: 'all',
              issue: 'every registered unit is received or can no longer be received',
            },
          ]);
        }
      } else {
        const byUnit = new Map(links.map((link) => [link.assetUnitId, link]));
        const offenders = [];
        targets = [];
        for (const unitId of ids) {
          const link = byUnit.get(unitId);
          if (!link)
            offenders.push({
              field: 'assetUnitIds',
              issue: `${unitId}: not registered against this request`,
            });
          else if (link.receipts.length > 0)
            offenders.push({
              field: 'assetUnitIds',
              issue: `${unitLabel(link)}: receipt already recorded`,
            });
          else if (!link.assetUnit.isActive)
            offenders.push({
              field: 'assetUnitIds',
              issue: `${unitLabel(link)}: the unit is inactive and cannot be received`,
            });
          else if (UNRECEIVABLE_STATES.includes(link.assetUnit.lifecycleState))
            offenders.push({
              field: 'assetUnitIds',
              issue: `${unitLabel(link)}: the unit is ${link.assetUnit.lifecycleState} and cannot be received`,
            });
          else targets.push(link);
        }
        if (offenders.length > 0) {
          throw new ConflictError('Receipt was not recorded for any unit', offenders);
        }
      }

      // REQ-REQUEST-022: every unit photo shows a unit received HERE.
      const received = new Set(targets.map((link) => link.assetUnitId));
      const outside = unitTargets.filter((unitId) => !received.has(unitId));
      if (outside.length > 0) throw unitPhotoRefusal(outside);

      const now = new Date();
      const destination = await destinationSnapshot(request, { models, transaction });
      const confirmation = await models.RequestReceiptConfirmation.create(
        {
          requestId: request.id,
          placement: destination ? body.placement : null,
          description: body.description.trim(),
          destinationLocationId: destination?.id ?? null,
          destinationName: destination?.name ?? null,
          confirmedBy: principal.userId,
          confirmedAt: now,
        },
        { transaction }
      );

      const receiptByUnit = new Map();
      for (const link of targets) {
        // One row at a time, so every receipt is audited. `note` is left
        // empty: the confirmation's description is the one description.
        const receipt = await models.RequestItemUnitReceipt.create(
          {
            requestItemUnitId: link.id,
            receivedOn: body.receivedOn,
            recordedAt: now,
            recordedBy: principal.userId,
            receiptConfirmationId: confirmation.id,
          },
          { transaction }
        );
        receiptByUnit.set(link.assetUnitId, receipt.id);
      }

      // REQ-REQUEST-024: `AT_INTENDED_PLACE` places each eligible unit at the
      // snapshot, as a `SYSTEM` history row dated `now`. An ineligible unit is
      // left to need placement; the receipt never fails for it.
      await placeReceivedUnits(
        {
          placement: confirmation.placement,
          destination,
          request,
          unitIds: targets.map((link) => link.assetUnitId),
          recordedAt: now,
        },
        principal,
        { models, transaction }
      );

      for (const { photo, assetUnitId, storageReference, fileName, fileSize } of stored) {
        await models.RequestDocument.create(
          {
            requestId: request.id,
            documentType: CONFIRMATION_PHOTO,
            title: null,
            fileName,
            fileType: photo.mimetype,
            fileSize,
            storageReference,
            uploadedBy: principal.userId,
            receiptConfirmationId: confirmation.id,
            // REQ-REQUEST-022: the unit's NEW receipt, or none for the whole.
            requestItemUnitReceiptId: assetUnitId ? receiptByUnit.get(assetUnitId) : null,
          },
          { transaction }
        );
      }

      await settle(request, principal, { models, transaction, now });
    },
    { sequelize }
  ).catch(async (error) => {
    // The rows are the record of truth; without them the photos are orphans.
    await Promise.all(stored.map((s) => storage.remove(s.storageReference).catch(() => {})));
    // Two receipts racing for one link meet `uq_riu_receipts_active`.
    const constraint = error?.parent?.constraint ?? error?.original?.constraint;
    if (constraint !== 'uq_riu_receipts_active') throw error;
    throw new ConflictError('Receipt was not recorded for any unit', [
      { field: 'assetUnitIds', issue: 'a named unit had its receipt recorded meanwhile' },
    ]);
  });

  return requests.detail(id, principal, { models });
}

// --- Reverse ------------------------------------------------------------------

/**
 * `POST /request-receipts/:id/reverse` — Q2c. The receipt row is kept and
 * marked reversed; the unit may be received again. Never reopens a step.
 */
async function reverse(receiptId, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  const reason = body.reason?.trim();
  if (!reason) {
    throw new ValidationError('A reason is required', [
      { field: 'reason', issue: 'is required to reverse a receipt' },
    ]);
  }

  const requestId = await withTransaction(
    async (transaction) => {
      const receipt = await models.RequestItemUnitReceipt.findByPk(receiptId, {
        include: [
          {
            association: 'link',
            include: [{ association: 'item', attributes: ['id', 'requestId'] }],
          },
        ],
        transaction,
      });
      if (!receipt) throw new NotFoundError('Receipt not found');

      let request;
      try {
        request = await lockRequest(receipt.link.item.requestId, principal, {
          models,
          transaction,
        });
      } catch (error) {
        if (error instanceof NotFoundError) throw new NotFoundError('Receipt not found');
        throw error;
      }

      if (!hasPermission(principal, 'request:oversee')) {
        throw new ForbiddenError('Reversing a receipt needs oversight', [
          { issue: 'request-receipt:reverse together with request:oversee is required' },
        ]);
      }
      // Separation of duties: whoever recorded a receipt never reverses it.
      if (receipt.recordedBy === principal.userId) {
        throw new ForbiddenError('You cannot reverse a receipt you recorded', [
          { issue: 'a receipt is reversed by another user with oversight, never by its recorder' },
        ]);
      }
      assertOpen(request, 'have a receipt reversed');
      if (receipt.reversedAt) {
        throw new ConflictError('This receipt is already reversed', [
          { field: 'reversedAt', issue: 'a reversed receipt stays reversed' },
        ]);
      }

      const now = new Date();
      await receipt.update(
        { reversedAt: now, reversedBy: principal.userId, reversalReason: reason },
        { transaction }
      );
      await settle(request, principal, { models, transaction, now });
      return request.id;
    },
    { sequelize }
  );

  return requests.detail(requestId, principal, { models });
}

// --- Close the remainder ------------------------------------------------------

/**
 * `POST /requests/:id/close` — REQ-REQUEST-013, `CR-014` §5.5, §60.3.
 *
 * Each item's cancelled quantity becomes requested − received − pending: the
 * never-registered requirement and every blocked unit are cancelled; pending
 * units are kept. Refused (`409`) when that cancels nothing (D41-8). An
 * unfinished REGISTER becomes CLOSED (D41-3). One close event per successful
 * close, in this transaction; `requests.close_reason` keeps the first reason.
 */
async function close(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  const reason = body.reason?.trim();
  if (!reason) {
    throw new ValidationError('A reason is required', [
      { field: 'reason', issue: 'is required to close the remainder' },
    ]);
  }
  assertOpen(await requests.getVisible(id, principal, { models }), 'be closed');

  await withTransaction(
    async (transaction) => {
      const request = await lockRequest(id, principal, { models, transaction });
      assertOpen(request, 'be closed');

      const items = await models.RequestItem.findAll({
        where: { requestId: request.id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const counts = await requests.fulfilmentCounts(
        items.map((item) => item.id),
        { models, transaction }
      );

      const changes = items
        .map((item) => ({ item, cancelled: closedCancellation(item, counts[item.id]) }))
        .filter(({ item, cancelled }) => cancelled !== item.quantityCancelled);
      if (changes.length === 0) {
        throw new ConflictError('There is nothing left to close', [
          {
            field: 'status',
            issue: 'every remaining unit is registered and can still be received',
          },
        ]);
      }

      const now = new Date();
      for (const { item, cancelled } of changes) {
        await item.update({ quantityCancelled: cancelled }, { transaction });
      }

      const register = await currentStep(request.id, 'REGISTER', {
        models,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (register && !['DONE', 'CLOSED', 'SKIPPED'].includes(register.state)) {
        // Nothing remains to register — CLOSED, never DONE (D41-3).
        await register.update({ state: 'CLOSED', completedAt: now }, { transaction });
      }

      await models.RequestCloseEvent.create(
        { requestId: request.id, reason, closedAt: now, closedBy: principal.userId },
        { transaction }
      );
      await request.update(
        {
          // The first close's reason stays; every close is a close event.
          ...(request.closeReason ? {} : { closeReason: reason }),
          updatedBy: principal.userId,
        },
        { transaction }
      );

      await settle(request, principal, { models, transaction, now });
    },
    { sequelize }
  );

  return requests.detail(id, principal, { models });
}

// --- Issue (§73) --------------------------------------------------------------

/**
 * `POST /requests/:id/issue` — consumables handed over against the request's
 * consumable lines. `consumable:manage-stock` (the route) and visibility of the
 * request; never on a request that is not APPROVED or PARTIALLY_FULFILLED, so
 * never on submission or approval alone, and never after a revision could
 * change the line.
 *
 * Under the request's row lock, for each named line: a consumable line of THIS
 * request, at most what it still needs (required − issued). Then, consumable by
 * consumable under its row lock (in id order, so two issues never deadlock):
 * enough stock, one ISSUE movement, the new balance. Then the status, as for a
 * receipt. Anything refused writes nothing — no movement, no balance, no status.
 *
 * What was requested stays on the line; what was issued is the movements. A
 * line issued short stays open until issued in full or its remainder closed.
 */
async function issue(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  assertOpen(await requests.getVisible(id, principal, { models }), 'be issued');

  await withTransaction(
    async (transaction) => {
      const request = await lockRequest(id, principal, { models, transaction });
      assertOpen(request, 'be issued');

      const items = await models.RequestItem.findAll({
        where: { requestId: request.id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const byId = new Map(items.map((item) => [item.id, item]));
      const counts = await requests.fulfilmentCounts(
        items.map((item) => item.id),
        { models, transaction }
      );

      const lines = body.items.map((line, index) => {
        const item = byId.get(line.requestItemId);
        if (!item || !item.consumableId) {
          throw new ValidationError('Only a consumable line of this request can be issued', [
            {
              field: `items.${index}.requestItemId`,
              issue: item
                ? 'this line is registered as asset units, not issued from stock'
                : 'is not a line of this request',
            },
          ]);
        }
        const { notYetReceived: remaining } = itemFigures(item, counts[item.id]);
        if (line.quantity > remaining) {
          throw new ConflictError('More than the line still needs', [
            {
              field: `items.${index}.quantity`,
              issue: `line ${item.lineNo} needs ${remaining} more; ${line.quantity} cannot be issued`,
            },
          ]);
        }
        return { item, quantity: line.quantity };
      });

      lines.sort((a, b) => a.item.consumableId.localeCompare(b.item.consumableId));
      for (const { item, quantity } of lines) {
        const consumable = await lockConsumable(item.consumableId, { models, transaction });
        if (!consumable || consumable.institutionId !== request.institutionId) {
          throw new ConflictError('The consumable is not of this request’s institution', [
            { field: 'requestItemId', issue: `line ${item.lineNo} cannot be issued` },
          ]);
        }
        await applyMovement(
          consumable,
          { type: 'ISSUE', quantity: -quantity, requestItemId: item.id, note: body.note },
          principal,
          { models, transaction }
        );
      }

      await request.update({ updatedBy: principal.userId }, { transaction });
      await settle(request, principal, { models, transaction });
    },
    { sequelize }
  );

  return requests.detail(id, principal, { models });
}

module.exports = { receive, reverse, close, settle, issue };
