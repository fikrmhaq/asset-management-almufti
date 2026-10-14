'use strict';

/**
 * Action Needed — P5 (`IMPLEMENTATION_PLAN.md` §64.5), REQ-REQUEST-016.
 *
 * "Something I need to do on this request, now." DERIVED, NEVER STORED: every
 * kind below is the condition the matching action is already offered and
 * authorized on, so a request needs the caller's action exactly when the
 * request page would show them that action's button — and only then.
 *
 *   SUBMIT    own DRAFT + `request:submit` — `availableActions().submit`. Listed
 *             even while blocked; `blocked` says so, and the page lists why.
 *   RESUBMIT  own request returned for revision + `request:submit` —
 *             `availableActions().resubmit` (REQ-REQUEST-018): revise and
 *             resubmit. `blocked` as for SUBMIT. The returned cycle's decisions
 *             are no longer ACTIVE, so no approver keeps a DECIDE from it.
 *   DECIDE    an ACTIVE step of that type the caller currently resolves as actor
 *   PROCURE   of, holding the step's permission — `canAct`, and the existing
 *   REGISTER  `awaiting=me` (decision F6) unchanged. Oversight never counts.
 *   RECEIVE   own request + `request:receive`, open, a registered unit that can
 *             be received now — `availableActions().receive`.
 *   CLOSE     `request:close`, open, and a STRANDED remainder: registered units
 *             that can no longer be received (inactive, DISPOSED, DEACTIVATED)
 *             and that a close would cancel — `availableActions().close` narrowed
 *             to the case the request page warns about. An unregistered
 *             remainder alone is not a need: registration may still come.
 *
 * NOT ACTION NEEDED, though possible: edit, discard / cancel, change the
 * destination, upload a document, unlink, reverse a receipt.
 *
 * Two evaluations of ONE definition: `fromDetail` reads the very values the
 * request page's buttons read (`actions`, each step's `canAct`, the item
 * figures); `sqlPredicates` states the same conditions in SQL for the list, its
 * filter (`awaiting=me`) and its count. The database suite holds them equal.
 * Both run inside the request visibility rule (REQ-REQUEST-015) the list and
 * the detail already apply; PIC-scoped callers stay refused before either.
 */

const { hasPermission } = require('../auth/principal');
const { getSequelize } = require('../db/sequelize');
const { activeActorSql } = require('./actorResolution');
const { STEP_ACTION_PERMISSION } = require('./requestStepStates');
const { OPEN_FULFILMENT_STATUSES, UNRECEIVABLE_STATES } = require('./requestFulfilmentRules');

/** In the order a request meets them. */
const ACTION_KINDS = Object.freeze([
  'SUBMIT',
  'RESUBMIT',
  'DECIDE',
  'PROCURE',
  'REGISTER',
  'RECEIVE',
  'CLOSE',
]);

/** The kinds whose `blocked` comes from the submission blockers. */
const SUBMIT_KINDS = Object.freeze(['SUBMIT', 'RESUBMIT']);

const STEP_KINDS = Object.freeze(['DECIDE', 'PROCURE', 'REGISTER']);

// --- From the request detail --------------------------------------------------

/**
 * The caller's needed actions on one request, from what the detail computed.
 *
 * @param {{actions: object, steps: Array<{id: string, stepType: string, canAct: boolean}>,
 *   figures: Array<{cancellableBlocked: number}>, submitBlockers?: Array}} detail
 * @returns {Array<{kind: string, stepId?: string, blocked?: boolean}>}
 */
function fromDetail({ actions, steps, figures, submitBlockers = [] }) {
  const needed = [];
  if (actions.submit) needed.push({ kind: 'SUBMIT', blocked: submitBlockers.length > 0 });
  if (actions.resubmit) needed.push({ kind: 'RESUBMIT', blocked: submitBlockers.length > 0 });
  for (const kind of STEP_KINDS) {
    const step = steps.find((entry) => entry.stepType === kind && entry.canAct);
    if (step) needed.push({ kind, stepId: step.id });
  }
  if (actions.receive) needed.push({ kind: 'RECEIVE' });
  if (actions.close && figures.some((figure) => figure.cancellableBlocked > 0)) {
    needed.push({ kind: 'CLOSE' });
  }
  return needed;
}

// --- In SQL, for the list ----------------------------------------------------

const list = (values, sequelize) => values.map((value) => sequelize.escape(value)).join(', ');

/**
 * Per unit link: whether it has an active receipt, and whether its unit can be
 * received now (`isReceivableUnit`). Shared by RECEIVE and CLOSE.
 */
function linkStateSql(itemRef, sequelize) {
  return `SELECT (rr.id IS NOT NULL) AS received,
                 (u.is_active AND u.lifecycle_state NOT IN (${list(UNRECEIVABLE_STATES, sequelize)})) AS receivable
            FROM public.request_item_units l
            JOIN public.asset_units u ON u.id = l.asset_unit_id
            LEFT JOIN public.request_item_unit_receipts rr
              ON rr.request_item_unit_id = l.id AND rr.reversed_at IS NULL
           WHERE l.request_item_id = ${itemRef}.id`;
}

/**
 * Each kind as a SQL boolean over `ref` (the request row), or `null` when the
 * caller lacks the permission — a kind they can never act on is never asked.
 *
 * @returns {Record<string, string|null>}
 */
function sqlPredicates(ref, principal, { sequelize = getSequelize() } = {}) {
  const me = sequelize.escape(principal.userId);
  const can = (code) => hasPermission(principal, code);
  const open = `${ref}."status" IN (${list(OPEN_FULFILMENT_STATUSES, sequelize)})`;
  const own = `${ref}."requester_user_id" = ${me}`;

  const predicates = {
    SUBMIT: can('request:submit') ? `(${own} AND ${ref}."status" = 'DRAFT')` : null,
    RESUBMIT: can('request:submit') ? `(${own} AND ${ref}."status" = 'REVISION_REQUESTED')` : null,
  };
  for (const kind of STEP_KINDS) {
    predicates[kind] = can(STEP_ACTION_PERMISSION[kind])
      ? activeActorSql(ref, me, [kind], sequelize)
      : null;
  }

  // `pending > 0` for some item (`fulfilmentCounts`, `availableActions`).
  predicates.RECEIVE = can('request:receive')
    ? `(${own} AND ${open} AND EXISTS (
         SELECT 1 FROM public.request_items ri
           CROSS JOIN LATERAL (${linkStateSql('ri', sequelize)}) s
          WHERE ri.request_id = ${ref}."id" AND NOT s.received AND s.receivable))`
    : null;

  /**
   * `cancellableBlocked > 0` for some item — `itemFigures` in SQL:
   *   cancellable = min(max(requested − received − pending, cancelled), requested) − cancelled
   *   unregistered = min(max(required − registered, 0), cancellable)
   *   blocked part = cancellable − unregistered
   */
  predicates.CLOSE = can('request:close')
    ? `(${open} AND EXISTS (
         SELECT 1 FROM public.request_items ri
           CROSS JOIN LATERAL (
             SELECT count(*)::int AS registered,
                    count(*) FILTER (WHERE s.received)::int AS received,
                    count(*) FILTER (WHERE NOT s.received AND s.receivable)::int AS pending
               FROM (${linkStateSql('ri', sequelize)}) s) c
           CROSS JOIN LATERAL (
             SELECT LEAST(GREATEST(ri.quantity_requested - c.received - c.pending,
                                   ri.quantity_cancelled),
                          ri.quantity_requested) - ri.quantity_cancelled AS cancellable) k
          WHERE ri.request_id = ${ref}."id"
            AND k.cancellable
                - LEAST(GREATEST(ri.quantity_requested - ri.quantity_cancelled - c.registered, 0),
                        k.cancellable) > 0))`
    : null;

  return predicates;
}

/** Whether the request needs any action of the caller — `awaiting=me`. */
function actionNeededSql(ref, principal, options) {
  const clauses = Object.values(sqlPredicates(ref, principal, options)).filter(Boolean);
  return clauses.length > 0 ? `(${clauses.join(' OR ')})` : 'FALSE';
}

/**
 * The needed actions of each request of a list page, in one query.
 *
 * @param {Array<{id: string}>} requests rows already visible to the caller
 * @param {(request: object) => Promise<Array>} blockersFor the submission
 *   blockers of a DRAFT, for SUBMIT's `blocked`
 * @returns {Promise<Record<string, Array<{kind: string, stepId?: string, blocked?: boolean}>>>}
 */
async function forRequests(requests, principal, { models, blockersFor }) {
  if (requests.length === 0) return {};
  const sequelize = models.Request.sequelize;
  const predicates = sqlPredicates('r', principal, { sequelize });
  const columns = ACTION_KINDS.map((kind) => `${predicates[kind] ?? 'FALSE'} AS "${kind}"`).join(
    ',\n'
  );
  const stepColumns = STEP_KINDS.map(
    (kind) =>
      `(SELECT s.id FROM public.request_steps s
         WHERE s.request_id = r.id AND s.state = 'ACTIVE' AND s.step_type = '${kind}'
         ORDER BY s.sequence LIMIT 1) AS "${kind}_step"`
  ).join(',\n');

  const rows = await sequelize.query(
    `SELECT r.id, ${columns}, ${stepColumns} FROM public.requests r WHERE r.id = ANY($1::uuid[])`,
    { bind: [requests.map((request) => request.id)], type: sequelize.QueryTypes.SELECT }
  );

  const byId = new Map(requests.map((request) => [request.id, request]));
  const result = {};
  for (const row of rows) {
    const needed = [];
    for (const kind of ACTION_KINDS) {
      if (!row[kind]) continue;
      if (SUBMIT_KINDS.includes(kind)) {
        const blockers = await blockersFor(byId.get(row.id));
        needed.push({ kind, blocked: blockers.length > 0 });
      } else if (STEP_KINDS.includes(kind)) {
        needed.push({ kind, stepId: row[`${kind}_step`] });
      } else {
        needed.push({ kind });
      }
    }
    result[row.id] = needed;
  }
  return result;
}

module.exports = { ACTION_KINDS, fromDetail, sqlPredicates, actionNeededSql, forRequests };
