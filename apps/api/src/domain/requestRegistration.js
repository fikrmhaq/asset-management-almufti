'use strict';

/**
 * Registration against request items — Phase 40 (`CR-014` §7.1 – §7.3, §10.1,
 * §10.2), REQ-REQUEST-010, `06-api.md` §12.5; `IMPLEMENTATION_PLAN.md` §59.
 *
 * ── What registration is ─────────────────────────────────────────────────
 *
 * A registration LINK says: this Asset Unit was registered against that Request
 * Item, by this user, at this time. It is NOT receipt and NOT fulfilment
 * (`BR-031`): nothing here records, derives or implies that the requester
 * received anything. Receipt and fulfilment are Phase 41.
 *
 * ── The three operations ─────────────────────────────────────────────────
 *
 *   register   create units (under an existing asset, or a new one) and link
 *              them, in one transaction — `POST /request-items/:id/register`
 *   link       link one existing, eligible unit — `POST /request-items/:id/units`
 *   unlink     remove a link while REGISTER is ACTIVE — `DELETE /request-item-units/:id`
 *
 * Registering and linking need the CODE (the route) AND being the REGISTER
 * step's CURRENT actor (here, live, under the request's row lock — `DEC-J`).
 * `request:oversee` never substitutes for the actor; it may only unlink.
 *
 * ── The rules (Phase 40 decisions D1 – D11) ──────────────────────────────
 *
 *   D1  nothing moves: no location, no condition, no history entry.
 *   D2  a new asset needs `asset:create` as well as `asset-unit:create`.
 *   D3  an existing unit is linkable whenever it was created, if reachable,
 *       in the Request's institution, active, not DISPOSED / DEACTIVATED, and
 *       not linked anywhere.
 *   D4  registered = the number of links, never filtered by a unit's current
 *       state. REGISTER becomes DONE, in the same transaction, when every item
 *       has links = required; a DONE step never reopens.
 *   D5  unlink only while REGISTER is ACTIVE.
 *
 * The Request stays APPROVED throughout, and PROCURE is never read or written
 * (`DEC-L`): registration may happen before, during or after the acquisition
 * declaration.
 *
 * ── Reuse ───────────────────────────────────────────────────────────────
 *
 * Units are created with the existing code allocation (`allocateCodesForAsset`,
 * `resolveCompositions`) and validated by the existing department, contract-item
 * and classification rules — called, never changed. Units and links are created
 * one row at a time so every one of them is audited.
 */

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { ValidationError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');
const { hasPermission } = require('../auth/principal');
const { assertLeafClassification } = require('./classificationRules');
const { assertDepartmentAssignable } = require('./departmentRules');
const { actorAssignmentFor } = require('./actorResolution');
const { currentStep } = require('./requestCycles');
const { serializeUser } = require('./picAssignments');
const assetService = require('../modules/assets/service');
const unitService = require('../modules/assetUnits/service');
const requests = require('./requests');
const { OPEN_FULFILMENT_STATUSES, isReceivableUnit } = require('./requestFulfilmentRules');
const { requiresDepartment } = require('./schoolPositions');
const { unitDepartmentScope } = require('./scope');

/** Statuses in which units may be registered (`CR-014` §7.3). */
const REGISTRABLE_STATUSES = Object.freeze(['APPROVED', 'PARTIALLY_FULFILLED']);

/** End-of-life lifecycle states: such a unit cannot be linked (D3). */
const UNLINKABLE_STATES = Object.freeze(['DISPOSED', 'DEACTIVATED']);

const PERSON = ['id', 'username', 'firstName', 'lastName'];

// --- Shared -------------------------------------------------------------------

/** A request item whose request the caller can see; anything else is `404`. */
async function visibleItem(itemId, principal, { models, transaction, lock } = {}) {
  const item = await models.RequestItem.findByPk(itemId, { transaction });
  if (!item) throw new NotFoundError('Request item not found');
  try {
    const request = await requests.getVisible(item.requestId, principal, {
      models,
      transaction,
      lock,
    });
    return { item, request };
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError('Request item not found');
    throw error;
  }
}

/**
 * Under the request's row lock: the request is registrable, REGISTER is ACTIVE,
 * and the caller is its current actor. Returns the step and the caller's
 * assignment (recorded on the step if this call completes it).
 */
async function lockRegistration(requestId, principal, { models, transaction }) {
  const request = await requests.getVisible(requestId, principal, {
    models,
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!REGISTRABLE_STATUSES.includes(request.status)) {
    throw new ConflictError('Units can be registered only once the request is approved', [
      { field: 'status', issue: `this request is ${request.status}` },
    ]);
  }

  const step = await currentStep(requestId, 'REGISTER', {
    models,
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!step || step.state !== 'ACTIVE') {
    throw new ConflictError('The registration step is not open', [
      { field: 'state', issue: `the REGISTER step is ${step?.state ?? 'missing'}` },
    ]);
  }

  const assignment = await actorAssignmentFor(principal.userId, step, request, {
    models,
    transaction,
  });
  if (!assignment) {
    throw new ForbiddenError('You are not the actor of this step', [
      {
        issue: `not the actor of this step: it belongs to the current holder of ${step.actorPositionCode} for this request (CR-014 DEC-J)`,
      },
    ]);
  }

  return { request, step, assignment };
}

/**
 * §73: a consumable line is issued from stock, never registered as Asset Units.
 * @throws {ValidationError}
 */
function assertAssetLine(item) {
  if (!item.consumableId) return;
  throw new ValidationError('A consumable line is issued from stock, not registered', [
    { field: 'requestItemId', issue: 'only an asset line takes asset units' },
  ]);
}

/** Links still possible on `item`: required − links (D4). */
async function remainingFor(item, { models, transaction }) {
  const counts = await requests.registeredCounts([item.id], { models, transaction });
  return item.quantityRequested - item.quantityCancelled - (counts[item.id] ?? 0);
}

/**
 * REGISTER becomes DONE when every item has links = required (`CR-014` §6.1,
 * D4) — in the caller's transaction, recording who completed it and as which
 * assignment. Never reopened afterwards.
 */
async function completeIfRegistered(request, step, assignment, principal, { models, transaction }) {
  // §73: asset lines only — a consumable line is issued, never registered.
  const items = await models.RequestItem.findAll({
    where: { requestId: request.id, consumableId: null },
    transaction,
  });
  const counts = await requests.registeredCounts(
    items.map((item) => item.id),
    { models, transaction }
  );
  const complete = items.every(
    (item) => (counts[item.id] ?? 0) >= item.quantityRequested - item.quantityCancelled
  );
  if (!complete) return;

  await step.update(
    {
      state: 'DONE',
      actedByUserId: principal.userId,
      actedAsAssignmentId: assignment.id,
      completedAt: new Date(),
    },
    { transaction }
  );
}

/** A second link to one unit is refused by `uq_request_item_units_unit`. */
function asAlreadyLinked(error) {
  const constraint = error?.parent?.constraint ?? error?.original?.constraint;
  if (constraint !== 'uq_request_item_units_unit') return error;
  return new ConflictError('That asset unit is already registered against a request item', [
    { field: 'assetUnitId', issue: 'a unit fulfils at most one request item' },
  ]);
}

// --- Register -----------------------------------------------------------------

/**
 * `POST /request-items/:id/register` — REQ-REQUEST-010, `CR-014` §7.3.
 *
 * Validated before the transaction (so a bad request costs no lock), then, under
 * the request's row lock: the status, the step, the actor and the remaining
 * quantity are checked again, and the asset (if new), its units and their links
 * are written together.
 */
async function register(itemId, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  const { item: line, request } = await visibleItem(itemId, principal, { models });
  assertAssetLine(line);
  // P3 (§64.3): the REGISTER step's position is the acting context.
  const forDepartment = await registersForDepartment(request, { models });

  const newAsset = !body.assetId;
  // D2 — the capability model of `POST /contract-items/:id/assets`.
  if (newAsset && !hasPermission(principal, 'asset:create')) {
    throw new ForbiddenError('Creating a new asset needs asset:create', [
      {
        issue:
          'registering units under a new asset needs asset:create as well as asset-unit:create',
      },
    ]);
  }

  let asset = null;
  if (!newAsset) {
    asset = await assetService.getById(body.assetId, principal, { models });
    if (asset.institutionId !== request.institutionId) {
      throw new ValidationError('The asset belongs to a different institution', [
        { field: 'assetId', issue: "must belong to the request's institution" },
      ]);
    }
    // P3 (§64.3): an existing asset the department already has units of — the
    // one a department-bound registrar can see. Otherwise, a new asset.
    if (
      forDepartment &&
      (await models.AssetUnit.count({
        where: { assetId: asset.id, departmentId: request.departmentId },
      })) === 0
    ) {
      throw new ValidationError("The asset has no unit of the request's department", [
        {
          field: 'assetId',
          issue: departmentOnlyIssue('choose an asset it already has units of, or a new asset'),
        },
      ]);
    }
  } else {
    await assertLeafClassification(body.classificationId, {
      models,
      institutionId: request.institutionId,
    });
    if (body.vendorId && !(await models.Vendor.findByPk(body.vendorId))) {
      throw new ValidationError('The vendor does not exist', [
        { field: 'vendorId', issue: 'must reference an existing vendor' },
      ]);
    }
  }

  // The request's department unless the registrar names another (`CR-014` §17.2)
  // — never another, for a department-bound registrar (P3, §64.3).
  if (
    forDepartment &&
    (!request.departmentId ||
      (body.departmentId !== undefined && body.departmentId !== request.departmentId))
  ) {
    throw new ValidationError("New units belong to the request's department", [
      {
        field: 'departmentId',
        issue: departmentOnlyIssue('its units belong to that department, and no other or none'),
      },
    ]);
  }
  const departmentId = forDepartment
    ? request.departmentId
    : body.departmentId !== undefined
      ? body.departmentId
      : (request.departmentId ?? null);
  await assertDepartmentAssignable(
    departmentId,
    { institutionId: request.institutionId },
    { models }
  );

  const contractItem = body.contractItemId
    ? await models.ContractItem.findByPk(body.contractItemId)
    : null;
  if (asset) {
    await unitService.assertContractItem(body.contractItemId, asset, models);
  } else if (body.contractItemId && !contractItem) {
    throw new ValidationError('The contract item does not exist', [
      { field: 'contractItemId', issue: 'must reference an existing contract item' },
    ]);
  }

  const institution = await models.Institution.findByPk(request.institutionId);
  const numberCompositions = unitService.resolveCompositions(institution, {
    single: body.numberComposition,
    list: body.numberCompositions,
    count: body.unitCount,
  });

  // REQ-UNIT-012: the units' own funding source, checked against the Contract
  // the asset has — or, for a new asset, the one it is established under via
  // the contract item. A contractless asset records it here, or not at all.
  const funding = await unitService.resolveFundingSource(
    {
      contractId: asset ? (asset.contractId ?? null) : (contractItem?.contractId ?? null),
      fundingSourceId: body.fundingSourceId,
    },
    { models }
  );

  const unitIds = await withTransaction(
    async (transaction) => {
      const { step, assignment } = await lockRegistration(request.id, principal, {
        models,
        transaction,
      });
      const item = await models.RequestItem.findByPk(itemId, { transaction });

      const remaining = await remainingFor(item, { models, transaction });
      if (body.unitCount > remaining) {
        throw new ValidationError('More units than remain to be registered', [
          {
            field: 'unitCount',
            issue: `at most ${Math.max(remaining, 0)} unit(s) remain to be registered for this item`,
          },
        ]);
      }

      const target =
        asset ??
        (await models.Asset.create(
          {
            name: body.name,
            classificationId: body.classificationId,
            vendorId: body.vendorId ?? null,
            // Traceability as in the contract flow: a unit on a contract item
            // belongs to an asset established under that contract.
            contractId: contractItem?.contractId ?? null,
            institutionId: request.institutionId,
            createdBy: principal.userId,
            updatedBy: principal.userId,
          },
          { transaction }
        ));

      const codes = await unitService.allocateCodesForAsset(target, body.unitCount, {
        models,
        transaction,
        departmentId,
        numberCompositions,
        fundingSource: funding.source,
      });

      const ids = [];
      for (let index = 0; index < body.unitCount; index += 1) {
        // One row at a time, so each unit and each link is audited. D1: no
        // location, condition or history is written — the unit stays
        // REGISTERED with no location, exactly as after direct registration.
        const unit = await models.AssetUnit.create(
          {
            assetId: target.id,
            contractItemId: body.contractItemId ?? null,
            departmentId,
            description: body.description ?? null,
            inventoryCode: codes[index],
            numberComposition: numberCompositions[index] ?? null,
            fundingSourceId: funding.fundingSourceId,
            createdBy: principal.userId,
            updatedBy: principal.userId,
          },
          { transaction }
        );
        await models.RequestItemUnit.create(
          { requestItemId: item.id, assetUnitId: unit.id, linkedBy: principal.userId },
          { transaction }
        );
        ids.push(unit.id);
      }

      await completeIfRegistered(request, step, assignment, principal, { models, transaction });
      return ids;
    },
    { sequelize }
  ).catch((error) => {
    throw unitService.asDuplicateCodeError(error, numberCompositions);
  });

  const units = await models.AssetUnit.findAll({
    where: { id: unitIds },
    order: [['inventoryCode', 'ASC']],
  });
  return {
    units: units.map(unitService.serialize),
    request: await requests.detail(request.id, principal, { models }),
  };
}

// --- Link ---------------------------------------------------------------------

/**
 * D3: the unit is linkable. `unit` was loaded through the unit service, so it is
 * already known to be reachable by the caller (`BR-007`, the PIC narrowing).
 */
/**
 * P3 (`IMPLEMENTATION_PLAN.md` §64.3): whether this request's registration is
 * done in a department-bound capacity — a KAJUR, a TOOLMAN, any position bound
 * to a department. The REGISTER step's position is the acting context (the
 * application's own model: `actorAssignmentFor`), so this holds whatever else
 * the registering user may hold. Such a registrar acts for the request's
 * department: its units belong to it, and only its units may be linked.
 */
async function registersForDepartment(request, { models, transaction }) {
  const step = await currentStep(request.id, 'REGISTER', {
    models,
    transaction,
    attributes: ['actorPositionCode'],
  });
  return Boolean(step?.actorPositionCode && requiresDepartment(step.actorPositionCode));
}

const departmentOnlyIssue = (subject) =>
  `the registration step belongs to the request's department: ${subject}`;

function assertLinkable(unit, request) {
  if (unit.asset?.institutionId !== request.institutionId) {
    throw new ValidationError('The asset unit belongs to a different institution', [
      { field: 'assetUnitId', issue: "must belong to the request's institution" },
    ]);
  }
  if (!unit.isActive) {
    throw new ValidationError('The asset unit is inactive', [
      { field: 'assetUnitId', issue: 'an inactive unit cannot be registered against a request' },
    ]);
  }
  if (UNLINKABLE_STATES.includes(unit.lifecycleState)) {
    throw new ValidationError('The asset unit has reached end of life', [
      {
        field: 'assetUnitId',
        issue: `a ${unit.lifecycleState} unit cannot be registered against a request`,
      },
    ]);
  }
}

/**
 * `POST /request-items/:id/units` — link one existing unit (D3, D11).
 *
 * Reaching the unit is necessary, never sufficient: the request, its status, the
 * REGISTER step, the actor, the unit's eligibility and the remaining quantity
 * are all checked, the last four again under the request's row lock.
 */
async function link(itemId, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);
  const { item: line, request } = await visibleItem(itemId, principal, { models });
  assertAssetLine(line);
  const reached = await unitService.getById(body.assetUnitId, principal, { models });
  assertLinkable(reached, request);
  // P3 (§64.3): a department-bound registrar links the department's units only.
  if (
    (await registersForDepartment(request, { models })) &&
    reached.departmentId !== request.departmentId
  ) {
    throw new ValidationError("The unit does not belong to the request's department", [
      {
        field: 'assetUnitId',
        issue: departmentOnlyIssue("only that department's units can be linked"),
      },
    ]);
  }

  const linkId = await withTransaction(
    async (transaction) => {
      const { step, assignment } = await lockRegistration(request.id, principal, {
        models,
        transaction,
      });
      const item = await models.RequestItem.findByPk(itemId, { transaction });

      // Re-read inside the transaction. Two links racing for one unit are
      // settled by `uq_request_item_units_unit`, not by a lock here.
      const unit = await models.AssetUnit.findByPk(body.assetUnitId, {
        include: [{ association: 'asset', attributes: ['id', 'institutionId'] }],
        transaction,
      });
      assertLinkable(unit, request);

      const existing = await models.RequestItemUnit.findOne({
        where: { assetUnitId: unit.id },
        transaction,
      });
      if (existing) {
        throw new ConflictError('That asset unit is already registered against a request item', [
          {
            field: 'assetUnitId',
            issue:
              existing.requestItemId === item.id
                ? 'it is already registered against this item'
                : 'a unit fulfils at most one request item',
          },
        ]);
      }

      if ((await remainingFor(item, { models, transaction })) < 1) {
        throw new ConflictError('This item is already fully registered', [
          { field: 'requestItemId', issue: 'no units remain to be registered for this item' },
        ]);
      }

      const created = await models.RequestItemUnit.create(
        { requestItemId: item.id, assetUnitId: unit.id, linkedBy: principal.userId },
        { transaction }
      );
      await completeIfRegistered(request, step, assignment, principal, { models, transaction });
      return created.id;
    },
    { sequelize }
  ).catch((error) => {
    throw asAlreadyLinked(error);
  });

  const [created] = await listLinks({ id: linkId }, request, principal, { models });
  return { link: created, request: await requests.detail(request.id, principal, { models }) };
}

// --- Unlink -------------------------------------------------------------------

/**
 * `DELETE /request-item-units/:id` — D5. Only while REGISTER is ACTIVE, by its
 * current actor or with `request:oversee`. Removes the link only: the unit
 * stays, unchanged, as an ordinary unit.
 */
async function unlink(linkId, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  requests.assertNotPicScoped(principal);

  await withTransaction(
    async (transaction) => {
      const found = await models.RequestItemUnit.findByPk(linkId, {
        include: [{ association: 'item', attributes: ['id', 'requestId'] }],
        transaction,
      });
      if (!found) throw new NotFoundError('Registration link not found');

      let request;
      try {
        request = await requests.getVisible(found.item.requestId, principal, {
          models,
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
      } catch (error) {
        if (error instanceof NotFoundError) throw new NotFoundError('Registration link not found');
        throw error;
      }

      const step = await currentStep(request.id, 'REGISTER', {
        models,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!step || step.state !== 'ACTIVE') {
        throw new ConflictError('Registration is finished; its links cannot be removed', [
          {
            field: 'state',
            issue: `the REGISTER step is ${step?.state ?? 'missing'}; links are removed only while it is ACTIVE`,
          },
        ]);
      }

      const actor = await actorAssignmentFor(principal.userId, step, request, {
        models,
        transaction,
      });
      if (!actor && !hasPermission(principal, 'request:oversee')) {
        throw new ForbiddenError('You cannot remove this registration link', [
          {
            issue: 'only the REGISTER step’s current actor, or request:oversee, may remove a link',
          },
        ]);
      }

      // P3 (§64.3): the department-bound actor removes the department's own
      // links only — another department's unit, linked before the rule, stays
      // for oversight to decide.
      if (
        !hasPermission(principal, 'request:oversee') &&
        requiresDepartment(step.actorPositionCode)
      ) {
        const unit = await models.AssetUnit.findByPk(found.assetUnitId, {
          attributes: ['id', 'departmentId'],
          transaction,
        });
        if (unit?.departmentId !== request.departmentId) {
          throw new ForbiddenError('This link can be removed only with oversight', [
            { issue: departmentOnlyIssue("another department's unit stays linked, read-only") },
          ]);
        }
      }

      // Phase 41 (R11): a link whose receipt is recorded stays.
      const received = await models.RequestItemUnitReceipt.count({
        where: { requestItemUnitId: found.id, reversedAt: null },
        transaction,
      });
      if (received > 0) {
        throw new ConflictError('This unit’s receipt is recorded; its link cannot be removed', [
          { field: 'receipt', issue: 'a received unit stays linked to its request item' },
        ]);
      }

      await found.destroy({ transaction });
    },
    { sequelize }
  );
}

// --- Read ---------------------------------------------------------------------

/**
 * The links of one item, oldest first, each with its unit's CURRENT state shown
 * separately (D4): an inactive or disposed unit keeps its link and still counts.
 *
 * Phase 41: each link also carries its active receipt (or null), its whole
 * receipt history — reversals included — whether the unit can be received now
 * (D41-1 b), and whether the caller may reverse the active receipt (Q2c).
 */
async function listLinks(where, request, principal, { models }) {
  const step = await currentStep(request.id, 'REGISTER', { models });
  const open = step?.state === 'ACTIVE';
  const overseer = hasPermission(principal, 'request:oversee');
  const mayUnlink =
    open &&
    hasPermission(principal, 'request-item-unit:delete') &&
    (overseer || Boolean(await actorAssignmentFor(principal.userId, step, request, { models })));
  // P3 (§64.3): read-only for the department-bound actor when the unit is not
  // the department's; and whether the caller can open the unit at all.
  const departmentOnly = !overseer && Boolean(step && requiresDepartment(step.actorPositionCode));
  const departments = unitDepartmentScope(principal);

  const openRequest = OPEN_FULFILMENT_STATUSES.includes(request.status);
  const mayReverse =
    openRequest &&
    hasPermission(principal, 'request-receipt:reverse') &&
    hasPermission(principal, 'request:oversee');

  const rows = await models.RequestItemUnit.findAll({
    where,
    include: [
      { association: 'linker', attributes: PERSON },
      {
        association: 'receipts',
        include: [
          { association: 'recorder', attributes: PERSON },
          { association: 'reverser', attributes: PERSON },
        ],
      },
      {
        association: 'assetUnit',
        include: [
          { association: 'asset', attributes: ['id', 'name'] },
          { association: 'department', attributes: ['id', 'code', 'name'] },
          { association: 'currentLocation', attributes: ['id', 'name'] },
        ],
      },
    ],
    order: [
      ['linkedAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const serializeReceipt = (receipt) => ({
    id: receipt.id,
    receivedOn: receipt.receivedOn,
    recordedAt: receipt.recordedAt,
    recordedBy: serializeUser(receipt.recorder),
    // Phase 41 receipts only; a newer receipt's description is its
    // confirmation's (migration 057).
    note: receipt.note ?? null,
    confirmationId: receipt.receiptConfirmationId ?? null,
    reversedAt: receipt.reversedAt ?? null,
    reversedBy: serializeUser(receipt.reverser),
    reversalReason: receipt.reversalReason ?? null,
  });

  return rows.map((row) => {
    const unit = row.assetUnit;
    const history = [...(row.receipts ?? [])].sort(
      (a, b) => new Date(a.recordedAt) - new Date(b.recordedAt)
    );
    const active = history.find((receipt) => !receipt.reversedAt) ?? null;
    return {
      id: row.id,
      requestItemId: row.requestItemId,
      linkedAt: row.linkedAt,
      linkedBy: serializeUser(row.linker),
      assetUnit: {
        id: unit.id,
        inventoryCode: unit.inventoryCode ?? null,
        asset: unit.asset ? { id: unit.asset.id, name: unit.asset.name } : null,
        department: unit.department
          ? { id: unit.department.id, code: unit.department.code, name: unit.department.name }
          : null,
        currentLocation: unit.currentLocation
          ? { id: unit.currentLocation.id, name: unit.currentLocation.name }
          : null,
        lifecycleState: unit.lifecycleState,
        isActive: unit.isActive,
        // P3 (§64.3): false when the unit is outside the caller's own reach —
        // the link is the request's record; the unit page would be `404`.
        accessible: !departments || departments.has(unit.departmentId),
      },
      canUnlink:
        mayUnlink && !active && !(departmentOnly && unit.departmentId !== request.departmentId),
      // Phase 41 — receipt is its own fact, never inferred from the link.
      receipt: active ? serializeReceipt(active) : null,
      receipts: history.map(serializeReceipt),
      receivable: !active && isReceivableUnit(unit),
      canReverse: Boolean(active) && mayReverse && active.recordedBy !== principal.userId,
    };
  });
}

/** `GET /request-items/:id/units` — anyone who can see the request. */
async function listUnits(itemId, principal, { models = getModels() } = {}) {
  requests.assertNotPicScoped(principal);
  const { item, request } = await visibleItem(itemId, principal, { models });
  return listLinks({ requestItemId: item.id }, request, principal, { models });
}

module.exports = { register, link, unlink, listUnits, REGISTRABLE_STATUSES, UNLINKABLE_STATES };
