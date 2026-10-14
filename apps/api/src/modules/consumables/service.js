'use strict';

/**
 * Consumables — quantity-based stock (`IMPLEMENTATION_PLAN.md` §73, migration
 * 067).
 *
 * A consumable is a master record of ONE institution, counted in one existing
 * measurement unit (`ref.measurement_units`), with a running stock balance.
 * It is not an Asset: no units, inventory code, lifecycle, condition, location
 * history or QR.
 *
 *   master      `consumable:read / create / update / deactivate`
 *   stock       `consumable:manage-stock` — receive (RECEIPT) and adjust
 *               (ADJUSTMENT, with a reason) here; issue (ISSUE) only against an
 *               approved request line (`domain/requestFulfilment.js`)
 *   options     `request:create` — the active consumables a requester may name
 *               on a request line, without stock figures
 *
 * Institution scope as everywhere (`domain/scope.js`): another institution's
 * consumable is `404`. Every stock change goes through `domain/consumableStock`
 * — one movement and one balance update, in one transaction, under a row lock.
 */

const { Op } = require('sequelize');

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { ConflictError, ValidationError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { activeStatus, contains, equals } = require('../../query/filtering');
const {
  scopeFilter,
  assertCanAccess,
  assertCanAssignInstitution,
  defaultInstitutionFor,
} = require('../../domain/scope');
const { serializeUser } = require('../../domain/picAssignments');
const { lockConsumable, applyMovement } = require('../../domain/consumableStock');

const LABEL = 'Consumable';
const PERSON = ['id', 'username', 'firstName', 'lastName'];

const FILTERS = {
  status: activeStatus(),
  institutionId: (value) => equals('institutionId', value),
  q: (value) => contains('name', value),
};
const SORTABLE = ['name', 'quantityOnHand', 'createdAt', 'updatedAt'];

const INCLUDE = [{ association: 'measurementUnit', attributes: ['id', 'name'] }];

function serialize(consumable) {
  return {
    id: consumable.id,
    institutionId: consumable.institutionId,
    name: consumable.name,
    description: consumable.description ?? null,
    measurementUnitId: consumable.measurementUnitId,
    measurementUnit: consumable.measurementUnit
      ? { id: consumable.measurementUnit.id, name: consumable.measurementUnit.name }
      : null,
    quantityOnHand: consumable.quantityOnHand,
    isActive: consumable.isActive,
    createdAt: consumable.createdAt,
    updatedAt: consumable.updatedAt,
  };
}

function serializeMovement(movement) {
  const item = movement.requestItem;
  return {
    id: movement.id,
    consumableId: movement.consumableId,
    movementType: movement.movementType,
    quantity: movement.quantity,
    balanceAfter: movement.balanceAfter,
    requestItemId: movement.requestItemId ?? null,
    // The request an issue fulfilled — its number, for the stock history.
    request: item?.request
      ? {
          id: item.request.id,
          requestNumber: item.request.requestNumber,
          lineNo: item.lineNo,
        }
      : null,
    note: movement.note ?? null,
    createdBy: serializeUser(movement.actor),
    createdAt: movement.createdAt,
  };
}

/** A consumable the caller can reach, or `404`. */
async function load(id, principal, { models, transaction, lock } = {}) {
  const consumable = await models.Consumable.findByPk(id, {
    include: lock ? undefined : INCLUDE,
    transaction,
    lock,
  });
  return assertCanAccess(principal, consumable, { label: LABEL });
}

async function assertMeasurementUnit(measurementUnitId, { models }) {
  if (await models.MeasurementUnit.findByPk(measurementUnitId)) return;
  throw new ValidationError('The measurement unit does not exist', [
    { field: 'measurementUnitId', issue: 'must reference an existing measurement unit' },
  ]);
}

/** `uq_consumables_institution_name` → a `409` naming the field. */
function asDuplicateName(error) {
  const constraint = error?.parent?.constraint ?? error?.original?.constraint;
  if (constraint !== 'uq_consumables_institution_name') return error;
  return new ConflictError('A consumable with this name already exists', [
    { field: 'name', issue: 'must be unique within the institution' },
  ]);
}

// --- Master -------------------------------------------------------------------

async function list(params, principal, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['name', 'ASC']],
  });
  options.where = { ...options.where, ...scopeFilter(principal) };
  const { rows, pagination } = await paginate(models.Consumable, options, { include: INCLUDE });
  return { rows: rows.map(serialize), pagination };
}

async function detail(id, principal, { models = getModels() } = {}) {
  return serialize(await load(id, principal, { models }));
}

async function create(body, principal, { models = getModels() } = {}) {
  const institutionId = defaultInstitutionFor(principal, body.institutionId);
  if (!institutionId) {
    throw new ValidationError('An institution is required', [
      { field: 'institutionId', issue: 'a consumable belongs to one institution' },
    ]);
  }
  assertCanAssignInstitution(principal, institutionId);
  if (!(await models.Institution.findByPk(institutionId))) {
    throw new ValidationError('The institution does not exist', [
      { field: 'institutionId', issue: 'must reference an existing institution' },
    ]);
  }
  await assertMeasurementUnit(body.measurementUnitId, { models });

  let created;
  try {
    created = await models.Consumable.create({
      institutionId,
      name: body.name,
      description: body.description ?? null,
      measurementUnitId: body.measurementUnitId,
      createdBy: principal.userId,
      updatedBy: principal.userId,
    });
  } catch (error) {
    throw asDuplicateName(error);
  }
  return detail(created.id, principal, { models });
}

/**
 * Name, description and measurement unit. The unit is fixed once stock has
 * moved: changing it would re-read every recorded quantity in another unit.
 */
async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  await load(id, principal, { models });
  if (body.measurementUnitId) await assertMeasurementUnit(body.measurementUnitId, { models });

  await withTransaction(
    async (transaction) => {
      const consumable = await load(id, principal, {
        models,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (
        body.measurementUnitId &&
        body.measurementUnitId !== consumable.measurementUnitId &&
        (await models.ConsumableStockMovement.count({
          where: { consumableId: id },
          transaction,
        })) > 0
      ) {
        throw new ConflictError('The measurement unit cannot change once stock has moved', [
          {
            field: 'measurementUnitId',
            issue: 'recorded quantities are in the current unit; create a new consumable instead',
          },
        ]);
      }
      const changes = { updatedBy: principal.userId };
      for (const field of ['name', 'description', 'measurementUnitId']) {
        if (body[field] !== undefined) changes[field] = body[field];
      }
      try {
        await consumable.update(changes, { transaction });
      } catch (error) {
        throw asDuplicateName(error);
      }
    },
    { sequelize }
  );
  return detail(id, principal, { models });
}

async function setActive(id, isActive, principal, { models = getModels() } = {}) {
  const consumable = await load(id, principal, { models });
  if (consumable.isActive !== isActive) {
    await consumable.update({ isActive, updatedBy: principal.userId });
  }
  return detail(id, principal, { models });
}

const deactivate = (id, principal, options) => setActive(id, false, principal, options);
const reactivate = (id, principal, options) => setActive(id, true, principal, options);

/**
 * `GET /consumables/options` — the active consumables a requester may name on a
 * request line: id, name and unit only, never stock. `request:create`, scoped
 * to the caller's institution (or `institutionId`, which scope still bounds).
 */
async function options(params, principal, { models = getModels() } = {}) {
  const rows = await models.Consumable.findAll({
    where: {
      isActive: true,
      ...(params.institutionId ? { institutionId: params.institutionId } : {}),
      ...scopeFilter(principal),
    },
    include: INCLUDE,
    order: [['name', 'ASC']],
  });
  return rows.map((row) => ({
    id: row.id,
    institutionId: row.institutionId,
    name: row.name,
    measurementUnit: row.measurementUnit
      ? { id: row.measurementUnit.id, name: row.measurementUnit.name }
      : null,
  }));
}

// --- Stock --------------------------------------------------------------------

/** One stock change in its own transaction, under the consumable's row lock. */
async function move(id, movement, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  await load(id, principal, { models });
  await withTransaction(
    async (transaction) => {
      const consumable = await lockConsumable(id, { models, transaction });
      assertCanAccess(principal, consumable, { label: LABEL });
      await applyMovement(consumable, movement, principal, { models, transaction });
    },
    { sequelize }
  );
  return detail(id, principal, { models });
}

/** `POST /consumables/:id/receipts` — stock received: one RECEIPT (+quantity). */
const receive = (id, body, principal, options) =>
  move(id, { type: 'RECEIPT', quantity: body.quantity, note: body.note }, principal, options);

/**
 * `POST /consumables/:id/adjustments` — a correction, e.g. after a physical
 * count: one ADJUSTMENT (±quantity) with its reason. Never below zero.
 */
const adjust = (id, body, principal, options) =>
  move(id, { type: 'ADJUSTMENT', quantity: body.quantity, note: body.reason }, principal, options);

/** `GET /consumables/:id/movements` — the stock history, newest first. */
async function movements(id, params, principal, { models = getModels() } = {}) {
  await load(id, principal, { models });
  const options = toFindOptions(params, {
    filters: { movementType: (value) => equals('movementType', value) },
    sortable: ['createdAt'],
    defaultSort: [['createdAt', 'DESC']],
  });
  options.where = { [Op.and]: [options.where ?? {}, { consumableId: id }] };
  const { rows, pagination } = await paginate(models.ConsumableStockMovement, options, {
    include: [
      { association: 'actor', attributes: PERSON },
      {
        association: 'requestItem',
        attributes: ['id', 'lineNo'],
        include: [{ association: 'request', attributes: ['id', 'requestNumber'] }],
      },
    ],
  });
  return { rows: rows.map(serializeMovement), pagination };
}

module.exports = {
  list,
  detail,
  create,
  update,
  deactivate,
  reactivate,
  options,
  receive,
  adjust,
  movements,
  serialize,
};
