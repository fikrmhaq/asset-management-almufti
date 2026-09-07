'use strict';

/**
 * Audit read use cases — `IMPLEMENTATION_PLAN.md` §21.0, `06-api.md` §10;
 * REQ-AUDIT-001/002/003, `DR-015`.
 *
 * READ-ONLY, and structurally so: this module exposes `list` and `detail` and
 * nothing else, exactly as Phase 8's writer exposes `record` and nothing else.
 * Between them there is no code path in the application that can modify or
 * delete an audit row, which is how REQ-AUDIT-003 is met rather than merely
 * asserted. `04-data-model.md` §5.6.1 makes the same point in a CAUTION block.
 *
 * NOT ORGANIZATION-SCOPED — `DEC-050`. `audit.audit_logs` has no
 * `institution_id` and no join path to one: `entity_id` is a `VARCHAR(255)`
 * holding keys from 25 different tables, several of which (Role, Permission,
 * MeasurementUnit) have no institution at all. So `audit-log:read` is an
 * administrative permission in effect, and this is stated rather than
 * approximated by a filter that would be wrong in a different way — scoping by
 * the ACTOR's institution would answer "who acted", not "what was acted on".
 */

const { Op } = require('sequelize');

const { getModels } = require('../../db/models');
const { NotFoundError } = require('../../errors');
const { toFindOptions, paginate } = require('../../query/listQuery');
const { equals } = require('../../query/filtering');

const SORTABLE = ['timestamp'];

/**
 * `timestamp` is `TIMESTAMPTZ` while the filters are calendar days, so `dateTo`
 * covers the whole of that day. Comparing against midnight would silently
 * exclude everything that happened after it — including, for a same-day range,
 * every row.
 */
const startOfDay = (value) => new Date(`${value}T00:00:00.000Z`);
const endOfDay = (value) => new Date(`${value}T23:59:59.999Z`);

function timestampRange(params) {
  const bounds = {};
  if (params.dateFrom) bounds[Op.gte] = startOfDay(params.dateFrom);
  if (params.dateTo) bounds[Op.lte] = endOfDay(params.dateTo);

  return Object.getOwnPropertySymbols(bounds).length ? { timestamp: bounds } : undefined;
}

/** The six filters `06-api.md` §10 documents, and no others. */
const FILTERS = {
  entityType: (value) => equals('entityType', value),
  entityId: (value) => equals('entityId', value),
  actorId: (value) => equals('actorId', value),
  action: (value) => equals('action', value),
  dateFrom: (value, params) => timestampRange(params),
  // Handled together with `dateFrom` above, so a lone `dateTo` still applies.
  dateTo: (value, params) => (params.dateFrom ? undefined : timestampRange(params)),
};

/**
 * `oldValues`/`newValues` are returned as stored.
 *
 * Phase 8 already redacted what must never be exposed — password hashes and
 * storage paths (`services/audit.js`) — at WRITE time, which is the only place
 * it can be guaranteed. Re-filtering here would imply the stored rows are
 * untrusted, and would hide a genuine finding if one ever were.
 */
function serialize(entry) {
  return {
    id: entry.id,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    timestamp: entry.timestamp,
    oldValues: entry.oldValues ?? null,
    newValues: entry.newValues ?? null,
    ipAddress: entry.ipAddress ?? null,
    metadata: entry.metadata ?? null,
  };
}

async function list(params, { models = getModels() } = {}) {
  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    // Newest first — `06-api.md` §10, and the order `idx_audit_logs_timestamp`
    // is declared in (`DESC`).
    defaultSort: [['timestamp', 'DESC']],
  });

  const { rows, pagination } = await paginate(models.AuditLog, options);

  return { rows: rows.map(serialize), pagination };
}

/** @throws {NotFoundError} */
async function detail(id, { models = getModels() } = {}) {
  const entry = await models.AuditLog.findByPk(id);
  if (!entry) throw new NotFoundError('Audit log entry not found');

  return serialize(entry);
}

module.exports = { list, detail, serialize, SORTABLE };
