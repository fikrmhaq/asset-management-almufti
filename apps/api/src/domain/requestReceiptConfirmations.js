'use strict';

/**
 * Receipt confirmations, as the request detail shows them (migration 057;
 * `IMPLEMENTATION_PLAN.md` §63). Written only by `requestFulfilment.receive`.
 *
 * Each carries its units (every receipt it was given with, reversed or not),
 * its photos' metadata — the bytes stay behind `GET /request-documents/:id`
 * and its `request-document:read` — and its derived state: ACTIVE while any of
 * its receipts stands, SUPERSEDED once all are reversed. The destination is the
 * snapshot taken at confirmation, never the Request's current one.
 *
 * Read-only, and never PIC-scoped here: the caller has already passed the
 * request's own visibility.
 *
 * REQ-REQUEST-022: each photo says which received unit it shows — `receiptId`
 * and `assetUnitId` (and the unit's inventory code) — or null for a photo of the
 * whole confirmation. The receipt is always one of this confirmation's.
 */

const { serializeUser } = require('./picAssignments');
const { confirmationState } = require('./requestFulfilmentRules');
const { needsPlacementUnitIds } = require('./receiptPlacement');

const PERSON = ['id', 'username', 'firstName', 'lastName'];

function serialize(confirmation, { unplaced = new Set() } = {}) {
  const receipts = [...(confirmation.receipts ?? [])].sort(
    (a, b) =>
      String(a.link?.assetUnit?.inventoryCode ?? '').localeCompare(
        String(b.link?.assetUnit?.inventoryCode ?? '')
      ) || String(a.id).localeCompare(String(b.id))
  );
  const photos = [...(confirmation.photos ?? [])].sort(
    (a, b) =>
      new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id))
  );

  return {
    id: confirmation.id,
    placement: confirmation.placement ?? null,
    description: confirmation.description,
    destination: confirmation.destinationLocationId
      ? { id: confirmation.destinationLocationId, name: confirmation.destinationName }
      : null,
    // One date per Record Receipt action; every receipt carries the same.
    receivedOn: receipts[0]?.receivedOn ?? null,
    confirmedBy: serializeUser(confirmation.confirmer),
    confirmedAt: confirmation.confirmedAt,
    state: confirmationState(receipts),
    units: receipts.map((receipt) => ({
      assetUnitId: receipt.link?.assetUnitId ?? null,
      inventoryCode: receipt.link?.assetUnit?.inventoryCode ?? null,
      receiptId: receipt.id,
      reversed: Boolean(receipt.reversedAt),
      // REQ-REQUEST-024: where the unit is now, and whether it still needs
      // placement — the one derived definition (`receiptPlacement.js`).
      currentLocation: receipt.link?.assetUnit?.currentLocation
        ? {
            id: receipt.link.assetUnit.currentLocation.id,
            name: receipt.link.assetUnit.currentLocation.name,
          }
        : null,
      needsPlacement: unplaced.has(receipt.link?.assetUnitId),
    })),
    photos: photos.map((photo) => {
      const receipt = photo.requestItemUnitReceiptId
        ? receipts.find((entry) => entry.id === photo.requestItemUnitReceiptId)
        : null;
      return {
        id: photo.id,
        fileName: photo.fileName,
        fileType: photo.fileType,
        fileSize: Number(photo.fileSize),
        receiptId: photo.requestItemUnitReceiptId ?? null,
        assetUnitId: receipt?.link?.assetUnitId ?? null,
        inventoryCode: receipt?.link?.assetUnit?.inventoryCode ?? null,
      };
    }),
  };
}

/** Every confirmation of a Request, oldest first. */
async function listForRequest(requestId, { models, transaction } = {}) {
  const rows = await models.RequestReceiptConfirmation.findAll({
    where: { requestId },
    include: [
      { association: 'confirmer', attributes: PERSON },
      {
        association: 'receipts',
        attributes: ['id', 'receivedOn', 'reversedAt', 'requestItemUnitId'],
        include: [
          {
            association: 'link',
            attributes: ['id', 'assetUnitId'],
            include: [
              {
                association: 'assetUnit',
                attributes: ['id', 'inventoryCode'],
                include: [{ association: 'currentLocation', attributes: ['id', 'name'] }],
              },
            ],
          },
        ],
      },
      {
        association: 'photos',
        attributes: [
          'id',
          'fileName',
          'fileType',
          'fileSize',
          'createdAt',
          'requestItemUnitReceiptId',
        ],
      },
    ],
    order: [
      ['confirmedAt', 'ASC'],
      ['id', 'ASC'],
    ],
    transaction,
  });
  const unitIds = [
    ...new Set(
      rows.flatMap((row) => (row.receipts ?? []).map((receipt) => receipt.link?.assetUnitId))
    ),
  ].filter(Boolean);
  const unplaced = await needsPlacementUnitIds(unitIds, { models, transaction });
  return rows.map((row) => serialize(row, { unplaced }));
}

module.exports = { listForRequest, serialize };
