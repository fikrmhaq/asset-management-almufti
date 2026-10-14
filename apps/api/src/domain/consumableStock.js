'use strict';

/**
 * Consumable stock — the one writer of `consumables.quantity_on_hand`
 * (`IMPLEMENTATION_PLAN.md` §73, migration 067).
 *
 * Every change of stock is ONE movement row and ONE balance update, written
 * together in the caller's transaction under the consumable's row lock:
 *
 *   RECEIPT     + quantity                   stock received
 *   ISSUE       − quantity, a request item   handed out against a request line
 *   ADJUSTMENT  ± quantity, a reason         a correction (e.g. a physical count)
 *
 * The lock serialises concurrent writers: the second one reads the balance the
 * first one left, so two issues can never both take the same stock. A balance
 * that would go below zero is refused (`409`) and nothing is written; the
 * schema refuses it too (`chk_consumables_on_hand`, `chk_csm_balance`).
 *
 * The balance a client sends is never read — the server computes it.
 */

const { ConflictError } = require('../errors');

const MOVEMENT_TYPES = Object.freeze(['RECEIPT', 'ISSUE', 'ADJUSTMENT']);

/** The consumable, locked FOR UPDATE in the caller's transaction, or `null`. */
async function lockConsumable(id, { models, transaction }) {
  return models.Consumable.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
}

/**
 * Applies one signed movement to a LOCKED, accessible consumable.
 *
 * @param {object} consumable a row locked by `lockConsumable` in `transaction`
 * @param {{type: string, quantity: number, requestItemId?: string, note?: string}} movement
 * @returns {Promise<object>} the movement row
 * @throws {ConflictError} inactive consumable, or not enough stock
 */
async function applyMovement(
  consumable,
  { type, quantity, requestItemId = null, note = null },
  principal,
  { models, transaction }
) {
  if (!consumable.isActive) {
    throw new ConflictError('This consumable is inactive', [
      { field: 'consumableId', issue: `${consumable.name} is inactive; reactivate it first` },
    ]);
  }

  const balance = consumable.quantityOnHand + quantity;
  if (balance < 0) {
    throw new ConflictError('Not enough stock', [
      {
        field: 'quantity',
        issue: `${consumable.name} has ${consumable.quantityOnHand} on hand; ${-quantity} cannot be taken`,
      },
    ]);
  }

  const row = await models.ConsumableStockMovement.create(
    {
      consumableId: consumable.id,
      movementType: type,
      quantity,
      balanceAfter: balance,
      requestItemId,
      note: note?.trim() || null,
      createdBy: principal.userId,
    },
    { transaction }
  );
  await consumable.update(
    { quantityOnHand: balance, updatedBy: principal.userId },
    { transaction }
  );
  return row;
}

/**
 * Issued quantity per request item: the issues against it, as a positive number.
 *
 * @returns {Promise<Record<string, number>>} item id → issued (absent = 0)
 */
async function issuedByItem(itemIds, { models, transaction } = {}) {
  if (itemIds.length === 0) return {};
  const sequelize = models.ConsumableStockMovement.sequelize;
  const rows = await sequelize.query(
    `SELECT request_item_id AS item_id, -SUM(quantity)::int AS issued
       FROM public.consumable_stock_movements
      WHERE movement_type = 'ISSUE' AND request_item_id = ANY($1::uuid[])
      GROUP BY request_item_id`,
    { bind: [itemIds], transaction, type: sequelize.QueryTypes.SELECT }
  );
  return Object.fromEntries(rows.map((row) => [row.item_id, Number(row.issued)]));
}

module.exports = { MOVEMENT_TYPES, lockConsumable, applyMovement, issuedByItem };
