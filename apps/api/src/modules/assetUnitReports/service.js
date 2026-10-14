'use strict';

/**
 * Room PIC reports — REQ-REQUEST-025 (`IMPLEMENTATION_PLAN.md` §72, migrations
 * 065–066).
 *
 * The person in charge of a room REPORTS what they see about a unit that is
 * currently in that exact room: a CONDITION, a MOVEMENT, or an OBSERVATION. A
 * report is a claim; a reviewer confirms or rejects it. Confirming a CONDITION or
 * MOVEMENT report changes the unit through the one authoritative writer
 * (`applyStateChange`) as a `REPORT` history row — never an assessment
 * (`CR-012`) — in the same transaction; confirming an OBSERVATION changes nothing.
 *
 * REPORTING IS NOT ACCESS (REQ-AUTHZ-006 as amended). `asset-unit-report:create`
 * lets a caller file a report about a unit only while they are the CURRENT
 * Location PIC of the unit's CURRENT location, exactly — a parent location's PIC
 * gets nothing — in their own institution. They see their rooms' units through
 * `myUnits` and nothing else; anything outside is `404`, as out of scope is
 * everywhere (§1.4).
 *
 * THE ORIGINAL OBSERVATION IS NEVER CHANGED. The review writes only the review
 * fields, once. A report whose unit changed since it was filed (its open history
 * row moved on) is STALE: confirming it needs `acknowledgeStale`, recorded on the
 * report — a stale move or condition is never applied silently.
 */

const { Op } = require('sequelize');

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { ValidationError, ConflictError, ForbiddenError, NotFoundError } = require('../../errors');
const { hasPermission } = require('../../auth/principal');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { equals } = require('../../query/filtering');
const { canAccessInstitution, scopeFilter, assertCanAccessUnit } = require('../../domain/scope');
const { serializeUser } = require('../../domain/picAssignments');

const REPORT_KINDS = Object.freeze(['CONDITION', 'MOVEMENT', 'OBSERVATION']);
const REPORT_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'REJECTED']);
// A unit in one of these is no longer something to report on, or to change.
const CLOSED_LIFECYCLE = Object.freeze(['DISPOSED', 'DEACTIVATED']);

const PERSON = ['id', 'username', 'firstName', 'lastName'];
const NOT_YOURS = 'Asset unit not found';

const personName = (user) =>
  `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.username || '';

const isOpenUnit = (unit) =>
  Boolean(unit?.isActive) && !CLOSED_LIFECYCLE.includes(unit.lifecycleState);

/** A system-wide caller belongs to no institution, so has no room to report on. */
function assertReporter(principal) {
  if (principal.isSystemWide || !principal.institutionId) {
    throw new ForbiddenError('Reports are filed by the person in charge of a room', [
      { issue: 'only a user of the unit’s institution who is its room’s PIC may report' },
    ]);
  }
}

/** The caller's rooms: locations of their institution they are CURRENTLY PIC of. */
async function roomIdsOf(principal, { models, transaction }) {
  const assignments = await models.LocationPicAssignment.findAll({
    where: { userId: principal.userId, isCurrent: true },
    include: [
      {
        association: 'location',
        attributes: ['id'],
        where: { institutionId: principal.institutionId },
        required: true,
      },
    ],
    transaction,
  });
  return assignments.map((row) => row.locationId);
}

/** The unit's open history row — what a report snapshots and a review compares. */
async function openHistoryOf(unitId, { models, transaction }) {
  return models.LongitudinalHistory.findOne({
    where: { assetUnitId: unitId, effectiveTo: null },
    order: [['effectiveFrom', 'DESC']],
    transaction,
  });
}

function serializeUnit(unit) {
  if (!unit) return null;
  return {
    id: unit.id,
    inventoryCode: unit.inventoryCode ?? null,
    assetName: unit.asset?.name ?? null,
    currentLocation: unit.currentLocation
      ? { id: unit.currentLocation.id, name: unit.currentLocation.name }
      : null,
    currentCondition: unit.currentCondition ?? null,
    lifecycleState: unit.lifecycleState,
  };
}

/**
 * Two views of one report.
 *
 * `reviewer` — the report, and the unit NOW: its live state, whether it changed
 * since the report (`stale`), and the open history row the reviewer is looking
 * at (`currentHistoryId`), which a confirmation must send back as
 * `seenHistoryId`.
 *
 * `reporter` — what they reported and what became of it: the report, its
 * snapshots, the review. Never the unit's live state: reporting is not access,
 * and a unit that has left their room is no longer theirs to follow.
 */
function serialize(report, { view, openHistoryId = null }) {
  const base = serializeReport(report);
  if (view === 'reporter') {
    const unit = report.assetUnit;
    return {
      ...base,
      unit: unit
        ? {
            id: unit.id,
            inventoryCode: unit.inventoryCode ?? null,
            assetName: unit.asset?.name ?? null,
          }
        : null,
    };
  }
  const pending = report.status === 'PENDING';
  return {
    ...base,
    unit: serializeUnit(report.assetUnit),
    // Only meaningful while pending: the unit has changed since it was reported.
    stale: pending ? openHistoryId !== (report.snapshotHistoryId ?? null) : false,
    currentHistoryId: pending ? openHistoryId : null,
  };
}

function serializeReport(report) {
  return {
    id: report.id,
    kind: report.kind,
    narrative: report.narrative,
    reportedCondition: report.reportedCondition ?? null,
    // The destination AS REPORTED — its name then, not now.
    destination: report.destinationLocationId
      ? { id: report.destinationLocationId, name: report.destinationName }
      : null,
    // The unit when it was reported.
    reportedState: {
      location: { id: report.snapshotLocationId, name: report.snapshotLocationName },
      condition: report.snapshotCondition ?? null,
    },
    reporter: serializeUser(report.reporter),
    reportedAt: report.reportedAt,
    status: report.status,
    reviewer: serializeUser(report.reviewer),
    reviewedAt: report.reviewedAt ?? null,
    reviewNote: report.reviewNote ?? null,
    staleAcknowledged: report.staleAcknowledged,
    historyId: report.historyId ?? null,
  };
}

const UNIT_INCLUDE = {
  association: 'assetUnit',
  attributes: ['id', 'inventoryCode', 'currentCondition', 'lifecycleState', 'isActive'],
  include: [
    { association: 'asset', attributes: ['id', 'name'] },
    { association: 'currentLocation', attributes: ['id', 'name'] },
  ],
};
const REPORT_INCLUDE = [
  UNIT_INCLUDE,
  { association: 'reporter', attributes: PERSON },
  { association: 'reviewer', attributes: PERSON },
];

/** The open history row of each pending report's unit — what a reviewer sees now. */
async function openHistoryIds(reports, { models, transaction }) {
  const pending = reports.filter((report) => report.status === 'PENDING');
  if (pending.length === 0) return new Map();
  const open = await models.LongitudinalHistory.findAll({
    where: { assetUnitId: [...new Set(pending.map((r) => r.assetUnitId))], effectiveTo: null },
    attributes: ['id', 'assetUnitId'],
    transaction,
  });
  return new Map(open.map((row) => [row.assetUnitId, row.id]));
}

/** Serializes rows in one view, reading live state only for the reviewer's. */
async function serializeAll(reports, view, { models }) {
  const open = view === 'reviewer' ? await openHistoryIds(reports, { models }) : new Map();
  return reports.map((report) =>
    serialize(report, { view, openHistoryId: open.get(report.assetUnitId) ?? null })
  );
}

// --- The reporter's view ------------------------------------------------------

/** `GET /asset-unit-reports/my-units` — units currently in the caller's rooms, exactly. */
async function myUnits(principal, { models = getModels() } = {}) {
  assertReporter(principal);
  const rooms = await roomIdsOf(principal, { models });
  if (rooms.length === 0) return [];

  const units = await models.AssetUnit.findAll({
    where: {
      currentLocationId: rooms,
      isActive: true,
      lifecycleState: { [Op.notIn]: CLOSED_LIFECYCLE },
    },
    attributes: UNIT_INCLUDE.attributes,
    include: [
      {
        association: 'asset',
        attributes: ['id', 'name'],
        where: { institutionId: principal.institutionId },
        required: true,
      },
      { association: 'currentLocation', attributes: ['id', 'name'] },
    ],
    order: [['inventoryCode', 'ASC']],
  });
  return units.map(serializeUnit);
}

/** `GET /asset-unit-reports/destinations` — where a move may be reported to. */
async function destinations(principal, { models = getModels() } = {}) {
  assertReporter(principal);
  const locations = await models.Location.findAll({
    where: { institutionId: principal.institutionId, isActive: true },
    attributes: ['id', 'name'],
    order: [['name', 'ASC']],
  });
  return locations.map((location) => ({ id: location.id, name: location.name }));
}

// --- Filing a report ----------------------------------------------------------

/** `POST /asset-unit-reports` — by the CURRENT PIC of the unit's EXACT current room. */
async function create(body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  assertReporter(principal);

  const id = await withTransaction(
    async (transaction) => {
      // Held while the snapshot is taken, so it describes one consistent state.
      const unit = await models.AssetUnit.findByPk(body.assetUnitId, {
        transaction,
        lock: transaction.LOCK.SHARE,
      });
      const asset = unit
        ? await models.Asset.findByPk(unit.assetId, { attributes: ['institutionId'], transaction })
        : null;
      // Not the caller's to report on is indistinguishable from not existing.
      if (
        !isOpenUnit(unit) ||
        asset?.institutionId !== principal.institutionId ||
        !unit.currentLocationId
      ) {
        throw new NotFoundError(NOT_YOURS);
      }
      const room = await models.Location.findByPk(unit.currentLocationId, { transaction });
      const pic = await models.LocationPicAssignment.findOne({
        where: { locationId: unit.currentLocationId, userId: principal.userId, isCurrent: true },
        transaction,
      });
      if (!room || room.institutionId !== principal.institutionId || !pic) {
        throw new NotFoundError(NOT_YOURS);
      }

      let destination = null;
      if (body.kind === 'MOVEMENT') {
        destination = await models.Location.findByPk(body.destinationLocationId, { transaction });
        const refuse = (issue) =>
          new ValidationError('That destination cannot be reported', [
            { field: 'destinationLocationId', issue },
          ]);
        if (!destination || destination.institutionId !== principal.institutionId) {
          throw refuse('must be a location of your institution');
        }
        if (!destination.isActive) throw refuse('must not be a deactivated location');
        if (destination.id === unit.currentLocationId) {
          throw refuse('is where the unit already is');
        }
      }

      const open = await openHistoryOf(unit.id, { models, transaction });
      const report = await models.AssetUnitReport.create(
        {
          institutionId: principal.institutionId,
          assetUnitId: unit.id,
          kind: body.kind,
          narrative: body.narrative.trim(),
          reportedCondition: body.kind === 'CONDITION' ? body.reportedCondition : null,
          destinationLocationId: destination?.id ?? null,
          destinationName: destination?.name ?? null,
          snapshotLocationId: room.id,
          snapshotLocationName: room.name,
          snapshotCondition: unit.currentCondition ?? null,
          snapshotHistoryId: open?.id ?? null,
          reporterId: principal.userId,
          reportedAt: new Date(),
          status: 'PENDING',
        },
        { transaction }
      );
      return report.id;
    },
    { sequelize }
  );

  return detail(id, principal, { models });
}

// --- Reading ------------------------------------------------------------------

/**
 * A report is visible to its reporter (with `create`) and to a reviewer (with
 * `review`) of its institution — to anyone else it does not exist.
 */
function viewOf(report, principal) {
  const reviewer =
    report &&
    hasPermission(principal, 'asset-unit-report:review') &&
    canAccessInstitution(principal, report.institutionId);
  if (reviewer) return 'reviewer';
  const ownReport =
    report &&
    report.reporterId === principal.userId &&
    hasPermission(principal, 'asset-unit-report:create');
  if (ownReport) return 'reporter';
  throw new NotFoundError('Report not found');
}

/** A reviewer sees the unit now; its reporter only what they reported (M2). */
async function detail(id, principal, { models = getModels() } = {}) {
  const report = await models.AssetUnitReport.findByPk(id, { include: REPORT_INCLUDE });
  const [serialized] = await serializeAll([report], viewOf(report, principal), { models });
  return serialized;
}

/**
 * `GET /asset-unit-reports` — `mine=true`: the caller's own reports (reporter);
 * otherwise the reviewer's queue for their institution, `status` to narrow it.
 */
async function list(params, principal, { models = getModels() } = {}) {
  let where;
  if (params.mine) {
    if (!hasPermission(principal, 'asset-unit-report:create')) {
      throw new ForbiddenError('You cannot file unit reports');
    }
    where = { reporterId: principal.userId };
  } else {
    if (!hasPermission(principal, 'asset-unit-report:review')) {
      throw new ForbiddenError('You cannot review unit reports');
    }
    where = scopeFilter(principal);
  }

  const options = toFindOptions(params, {
    filters: { status: (value) => equals('status', value) },
    sortable: ['reportedAt', 'createdAt'],
    defaultSort: [['reportedAt', 'DESC']],
  });
  options.where = { [Op.and]: [options.where, where] };

  const { rows, pagination } = await paginate(models.AssetUnitReport, options, {
    include: REPORT_INCLUDE,
  });
  // `mine` is the reporter's list, in the reporter's view — whatever else they hold.
  return {
    rows: await serializeAll(rows, params.mine ? 'reporter' : 'reviewer', { models }),
    pagination,
  };
}

// --- Reviewing ----------------------------------------------------------------

/** "now at Lab (DAMAGED)" — the unit's state for a refusal the reviewer reads. */
async function describeNow(unit, { models, transaction }) {
  const location = unit.currentLocationId
    ? await models.Location.findByPk(unit.currentLocationId, { transaction })
    : null;
  return `now at ${location?.name ?? 'no location'} (${unit.currentCondition ?? 'no condition'})`;
}

/** The pending report and its unit, locked, for a reviewer who may act on it. */
async function lockForReview(id, principal, { models, transaction }) {
  const report = await models.AssetUnitReport.findByPk(id, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!report || !canAccessInstitution(principal, report.institutionId)) {
    throw new NotFoundError('Report not found');
  }
  if (report.reporterId === principal.userId) {
    throw new ForbiddenError('You cannot review your own report', [
      { issue: 'a report is confirmed or rejected by someone other than its reporter' },
    ]);
  }
  if (report.status !== 'PENDING') {
    throw new ConflictError(`This report is already ${report.status.toLowerCase()}`);
  }
  const unit = await models.AssetUnit.findByPk(report.assetUnitId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  assertCanAccessUnit(principal, unit, { label: 'Report' });
  return { report, unit };
}

/**
 * `POST /asset-unit-reports/:id/confirm` — CONDITION / MOVEMENT write one
 * `REPORT` history row through `applyStateChange`, in this transaction, dated
 * now; OBSERVATION writes nothing. `seenHistoryId` must still be the unit's
 * open history row; a stale report additionally needs `acknowledgeStale`.
 */
async function confirm(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  await withTransaction(
    async (transaction) => {
      const { report, unit } = await lockForReview(id, principal, { models, transaction });
      const open = await openHistoryOf(unit.id, { models, transaction });
      const openId = open?.id ?? null;
      const stale = openId !== (report.snapshotHistoryId ?? null);

      /**
       * The reviewer confirms what they SAW (M1): `seenHistoryId` is the open
       * history row the report showed them. Checked first, under the report and
       * unit locks — if the unit changed after they looked, nothing is applied,
       * however `acknowledgeStale` was set; they reload and look again.
       */
      if ((body.seenHistoryId ?? null) !== openId) {
        throw new ConflictError('The unit has changed since you looked at this report', [
          {
            field: 'seenHistoryId',
            issue: `${await describeNow(unit, { models, transaction })} — reload the report to review the current state`,
          },
        ]);
      }

      let historyId = null;
      if (report.kind !== 'OBSERVATION') {
        // What can no longer be applied is rejected, never forced.
        if (!isOpenUnit(unit)) {
          throw new ConflictError('This report can no longer be confirmed', [
            {
              issue: `the unit is ${unit.isActive ? unit.lifecycleState : 'inactive'}; reject it instead`,
            },
          ]);
        }
        if (report.kind === 'MOVEMENT') {
          const destination = await models.Location.findByPk(report.destinationLocationId, {
            transaction,
            lock: transaction.LOCK.SHARE,
          });
          if (
            !destination ||
            !destination.isActive ||
            destination.institutionId !== report.institutionId
          ) {
            throw new ConflictError('This report can no longer be confirmed', [
              {
                field: 'destinationLocationId',
                issue:
                  'the reported destination is no longer an active location of the institution; reject it instead',
              },
            ]);
          }
        }
        if (stale && body.acknowledgeStale !== true) {
          throw new ConflictError('The unit has changed since this report was filed', [
            {
              field: 'acknowledgeStale',
              issue:
                `reported at ${report.snapshotLocationName} (${report.snapshotCondition ?? 'no condition'}); ` +
                `${await describeNow(unit, { models, transaction })} — ` +
                'confirm again with acknowledgeStale to apply it anyway',
            },
          ]);
        }

        const reporter = await models.User.findByPk(report.reporterId, {
          attributes: PERSON,
          transaction,
        });
        // Lazy: the unit service reaches back into the request domain.
        const { applyStateChange } = require('../assetUnits/service');
        const row = await applyStateChange(
          unit,
          {
            ...(report.kind === 'CONDITION'
              ? { condition: report.reportedCondition }
              : { locationId: report.destinationLocationId }),
            description: `${report.narrative} — reported by ${personName(reporter)}`,
          },
          principal,
          { models, transaction, entryType: 'REPORT' }
        );
        historyId = row.id;
      } else if (stale && body.acknowledgeStale !== true) {
        // Nothing is applied, but the reviewer still says they saw the change.
        throw new ConflictError('The unit has changed since this report was filed', [
          { field: 'acknowledgeStale', issue: 'confirm again with acknowledgeStale' },
        ]);
      }

      await report.update(
        {
          status: 'CONFIRMED',
          reviewedBy: principal.userId,
          reviewedAt: new Date(),
          reviewNote: body.note?.trim() || null,
          staleAcknowledged: stale,
          historyId,
        },
        { transaction }
      );
    },
    { sequelize }
  );

  return detail(id, principal, { models });
}

/** `POST /asset-unit-reports/:id/reject` — a note is required; the report stays. */
async function reject(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  await withTransaction(
    async (transaction) => {
      const { report } = await lockForReview(id, principal, { models, transaction });
      await report.update(
        {
          status: 'REJECTED',
          reviewedBy: principal.userId,
          reviewedAt: new Date(),
          reviewNote: body.note.trim(),
        },
        { transaction }
      );
    },
    { sequelize }
  );

  return detail(id, principal, { models });
}

module.exports = {
  REPORT_KINDS,
  REPORT_STATUSES,
  myUnits,
  destinations,
  create,
  detail,
  list,
  confirm,
  reject,
};
