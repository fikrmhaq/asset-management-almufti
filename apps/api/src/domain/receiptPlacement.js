'use strict';

/**
 * Receipt places the unit at its intended location — REQ-REQUEST-024
 * (`IMPLEMENTATION_PLAN.md` §71, migration 064).
 *
 * A unit received with the confirmation `AT_INTENDED_PLACE` is placed at the
 * confirmation's SNAPSHOT of the intended location — what the receiver
 * confirmed against, not the request's destination today — through the one
 * authoritative writer (`applyStateChange`) as a `SYSTEM` history row: location
 * only, no condition, lifecycle unchanged (REGISTERED stays REGISTERED), dated
 * when the receipt was recorded (never the typed `receivedOn`).
 *
 * Only when ALL hold — otherwise the unit is simply not placed, and the receipt
 * still succeeds:
 *   1. the confirmation says `AT_INTENDED_PLACE`;
 *   2. the snapshot location is still active;
 *   3. it belongs to the request's institution;
 *   4. the unit, locked, has no current location (one never moves).
 *
 * NEEDS PLACEMENT is derived, never stored: an active unit with at least one
 * unreversed receipt and no current location. ONE definition, written twice —
 * as SQL for queries and as a predicate for rows already loaded — and kept here
 * side by side so they cannot drift (a test holds them to the same answer).
 * Placing such a unit is the existing Record History (`asset-unit:record-history`).
 */

const { Op, literal } = require('sequelize');

const AT_INTENDED_PLACE = 'AT_INTENDED_PLACE';

/** The SQL predicate over `public.asset_units` aliased `alias`. */
function needsPlacementSql(alias = 'u') {
  return `(${alias}.is_active = true
       AND ${alias}.current_location_id IS NULL
       AND EXISTS (SELECT 1
                     FROM public.request_item_unit_receipts np_r
                     JOIN public.request_item_units np_l ON np_l.id = np_r.request_item_unit_id
                    WHERE np_l.asset_unit_id = ${alias}.id
                      AND np_r.reversed_at IS NULL))`;
}

/** The same definition, for a unit whose receipts are already loaded. */
function needsPlacement({ isActive, currentLocationId, hasUnreversedReceipt }) {
  return Boolean(isActive) && !currentLocationId && Boolean(hasUnreversedReceipt);
}

/** A `where` on the AssetUnit model: units that do (or, `false`, do not) need placement. */
function needsPlacementWhere(value = true) {
  const ids = literal(`(SELECT u.id FROM public.asset_units u WHERE ${needsPlacementSql('u')})`);
  return { id: { [value ? Op.in : Op.notIn]: ids } };
}

/** Which of `unitIds` need placement — the SQL definition, for a known set. */
async function needsPlacementUnitIds(unitIds, { models, transaction } = {}) {
  if (unitIds.length === 0) return new Set();
  const rows = await models.AssetUnit.findAll({
    where: { [Op.and]: [{ id: unitIds }, needsPlacementWhere(true)] },
    attributes: ['id'],
    transaction,
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * Places the units of one Record Receipt, inside its transaction. Returns the
 * ids placed. Never throws for an ineligible unit or location — those are left
 * to need placement.
 *
 * @param {{ placement: string|null, destination: {id: string}|null, request: object,
 *   unitIds: string[], recordedAt: Date }} receipt
 */
async function placeReceivedUnits(
  { placement, destination, request, unitIds, recordedAt },
  principal,
  { models, transaction }
) {
  if (placement !== AT_INTENDED_PLACE || !destination || unitIds.length === 0) return [];

  // The snapshot is a copy: the location itself is re-read, and held, here.
  const location = await models.Location.findByPk(destination.id, {
    transaction,
    lock: transaction.LOCK.SHARE,
  });
  if (!location || !location.isActive || location.institutionId !== request.institutionId) {
    return [];
  }

  // Lazy: the unit service reaches back into the request domain.
  const { applyStateChange } = require('../modules/assetUnits/service');

  const placed = [];
  // A stable order, so two receipts never lock the same units in opposite order.
  for (const unitId of [...unitIds].sort()) {
    const unit = await models.AssetUnit.findByPk(unitId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!unit || !unit.isActive || unit.currentLocationId) continue;

    await applyStateChange(
      unit,
      {
        locationId: location.id,
        effectiveFrom: recordedAt,
        description: `Placed at the intended location on receipt (${request.requestNumber})`,
      },
      principal,
      { models, transaction, entryType: 'SYSTEM' }
    );
    placed.push(unitId);
  }
  return placed;
}

module.exports = {
  AT_INTENDED_PLACE,
  needsPlacementSql,
  needsPlacement,
  needsPlacementWhere,
  needsPlacementUnitIds,
  placeReceivedUnits,
};
