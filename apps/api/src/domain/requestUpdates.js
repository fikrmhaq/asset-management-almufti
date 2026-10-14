'use strict';

/**
 * Request Updates — P6 (`IMPLEMENTATION_PLAN.md` §64.6), REQ-REQUEST-017.
 *
 * "Something relevant happened on a request I am involved in, since I last
 * looked." Informational only: it never says what to do — that is Action
 * Needed (REQ-REQUEST-016, `requestActionsNeeded.js`), derived independently.
 * A request can need my action with nothing new on it, and the reverse.
 *
 * ── Events: derived from the business tables, never stored ──────────────────
 *
 *   STEP_DECIDED            DECIDE step APPROVED / REJECTED / RETURNED (a
 *                           revision requested, REQ-REQUEST-018) — every cycle
 *   REQUEST_RESUBMITTED     a cycle after the first began: the requester
 *                           resubmitted after revision (REQ-REQUEST-018)
 *   ACQUISITION_DECLARED    PROCURE step DONE
 *   REGISTRATION_COMPLETED  REGISTER step DONE
 *   UNITS_REGISTERED        registration links, grouped by who linked them
 *   RECEIPT_RECORDED        receipts, grouped by who recorded them — the
 *                           confirmation and its photos are part of this event
 *   RECEIPT_REVERSED        reversed receipts, grouped by who reversed them
 *   DOCUMENT_ADDED          request documents, except confirmation photos
 *   REMAINDER_CLOSED        close events
 *   REQUEST_ENDED           the request reached a terminal status
 *
 * Not derivable without the audit log, so not an update: unlinking a unit (the
 * link row is deleted, its event with it) and a destination change.
 *
 * ── Unseen ───────────────────────────────────────────────────────────────────
 *
 * An event is unseen when it happened after BOTH the user's last view of that
 * request (`request_views`, migration 058) and the configured baseline
 * (`REQUEST_UPDATES_SINCE`), and was not done by the user. No backfill: with no
 * view row, the baseline alone decides.
 *
 * ── Involvement ──────────────────────────────────────────────────────────────
 *
 * Only the requester, a current actor of an ACTIVE step, and a recorded former
 * actor — visibility clauses 1 – 3 (REQ-REQUEST-015), the same SQL helpers.
 * Oversight (clause 4) makes a request visible, never "involved": Sarpras, the
 * head teacher or an administrator is not told about every request they can
 * browse. Always applied on top of the visibility rule itself.
 *
 * ONE NARROW EXCEPTION (REQ-REQUEST-018, D10): `REQUEST_RESUBMITTED` also reaches
 * the current holders of every DECIDE position of the restarted chain — the
 * newest cycle — including an approver who never acted on the request. That
 * event only: they are not otherwise involved, and only the first decision's
 * actor is asked to act (Action Needed).
 */

const { Op, literal } = require('sequelize');

const { getConfig } = require('../config');
const { getSequelize } = require('../db/sequelize');
const { activeActorSql, actedSql, resubmittedDecideHolderSql } = require('./actorResolution');
const { TERMINAL_REQUEST_STATUSES } = require('./requestStepStates');

const UPDATE_KINDS = Object.freeze([
  'STEP_DECIDED',
  'REQUEST_RESUBMITTED',
  'ACQUISITION_DECLARED',
  'REGISTRATION_COMPLETED',
  'UNITS_REGISTERED',
  'RECEIPT_RECORDED',
  'RECEIPT_REVERSED',
  'DOCUMENT_ADDED',
  'REMAINDER_CLOSED',
  'REQUEST_ENDED',
]);

/** How many events a list row summarises. */
const ROW_LIMIT = 3;

const baseline = () => getConfig().requestUpdatesSince;

/** SQL: the user is involved in the request `ref` (visibility clauses 1 – 3). */
function involvedSql(ref, me, sequelize) {
  return `(${ref}."requester_user_id" = ${me}
           OR ${activeActorSql(ref, me, undefined, sequelize)}
           OR ${actedSql(ref, me)})`;
}

/**
 * SQL: the event row `e` reaches the user on the request `ref` — involvement,
 * or the one exception: a resubmission reaches every current DECIDE holder of
 * the newest cycle (REQ-REQUEST-018, D10).
 */
function audienceSql(ref, me, sequelize) {
  return `(${involvedSql(ref, me, sequelize)}
           OR (e.kind = 'REQUEST_RESUBMITTED' AND ${resubmittedDecideHolderSql(ref, me)}))`;
}

/**
 * SQL: every event of the requests matching `requestCondition` (a condition on
 * the column named by the placeholder `$REQ`), one row per event or group:
 * (request_id, kind, key, at, by_user, count, detail, extra).
 *
 * `key` separates events that must not be grouped (one step, one document…);
 * grouped kinds leave it NULL so they group by who did them.
 */
function eventsSql(requestCondition, sequelize) {
  const on = (column) => requestCondition.replaceAll('$REQ', column);
  const terminal = TERMINAL_REQUEST_STATUSES.map((status) => sequelize.escape(status)).join(', ');
  return `
    SELECT s.request_id,
           CASE s.step_type WHEN 'DECIDE' THEN 'STEP_DECIDED'
                            WHEN 'PROCURE' THEN 'ACQUISITION_DECLARED'
                            ELSE 'REGISTRATION_COMPLETED' END AS kind,
           s.id::text AS key, s.completed_at AS at, s.acted_by_user_id AS by_user,
           s.state AS detail, s.actor_position_code AS extra
      FROM public.request_steps s
     WHERE s.state IN ('APPROVED', 'REJECTED', 'RETURNED', 'DONE') AND s.completed_at IS NOT NULL
       AND ${on('s.request_id')}
    UNION ALL
    SELECT s.request_id, 'REQUEST_RESUBMITTED', s.cycle::text, min(s.created_at),
           rq.requester_user_id, NULL, NULL
      FROM public.request_steps s
      JOIN public.requests rq ON rq.id = s.request_id
     WHERE s.cycle > 1 AND ${on('s.request_id')}
     GROUP BY s.request_id, s.cycle, rq.requester_user_id
    UNION ALL
    SELECT ri.request_id, 'UNITS_REGISTERED', NULL, l.linked_at, l.linked_by, NULL, NULL
      FROM public.request_item_units l
      JOIN public.request_items ri ON ri.id = l.request_item_id
     WHERE ${on('ri.request_id')}
    UNION ALL
    SELECT ri.request_id, 'RECEIPT_RECORDED', NULL, rr.recorded_at, rr.recorded_by, NULL, NULL
      FROM public.request_item_unit_receipts rr
      JOIN public.request_item_units l ON l.id = rr.request_item_unit_id
      JOIN public.request_items ri ON ri.id = l.request_item_id
     WHERE ${on('ri.request_id')}
    UNION ALL
    SELECT ri.request_id, 'RECEIPT_REVERSED', NULL, rr.reversed_at, rr.reversed_by, NULL, NULL
      FROM public.request_item_unit_receipts rr
      JOIN public.request_item_units l ON l.id = rr.request_item_unit_id
      JOIN public.request_items ri ON ri.id = l.request_item_id
     WHERE rr.reversed_at IS NOT NULL AND ${on('ri.request_id')}
    UNION ALL
    SELECT d.request_id, 'DOCUMENT_ADDED', d.id::text, d.created_at, d.uploaded_by,
           d.document_type, d.title
      FROM public.request_documents d
     WHERE d.receipt_confirmation_id IS NULL AND ${on('d.request_id')}
    UNION ALL
    SELECT c.request_id, 'REMAINDER_CLOSED', c.id::text, c.closed_at, c.closed_by, NULL, c.reason
      FROM public.request_close_events c
     WHERE ${on('c.request_id')}
    UNION ALL
    SELECT r.id, 'REQUEST_ENDED', r.id::text, r.closed_at, r.updated_by, r.status, r.close_reason
      FROM public.requests r
     WHERE r.status IN (${terminal}) AND r.closed_at IS NOT NULL AND ${on('r.id')}`;
}

/** SQL: an event row `e` is unseen by `me` (the view row `v` may be absent). */
function unseenSql(me, sinceLiteral) {
  return `e.at > GREATEST(COALESCE(v.last_seen_at, '-infinity'::timestamptz), ${sinceLiteral})
          AND e.by_user IS DISTINCT FROM ${me}`;
}

/**
 * SQL: the request `ref` has an unseen update for the caller that reaches them
 * (`audienceSql`). Used by the `updated=me` scope and the attention count.
 */
function updatedSql(ref, principal, { sequelize = getSequelize(), since = baseline() } = {}) {
  const me = sequelize.escape(principal.userId);
  const sinceLiteral = `${sequelize.escape(since.toISOString())}::timestamptz`;
  return `EXISTS (
    SELECT 1 FROM (${eventsSql(`$REQ = ${ref}."id"`, sequelize)}) e
      LEFT JOIN public.request_views v ON v.user_id = ${me} AND v.request_id = e.request_id
     WHERE ${unseenSql(me, sinceLiteral)} AND ${audienceSql(ref, me, sequelize)})`;
}

/** A `where` fragment for the list's `updated=me`. */
function updatedWhere(params, principal, options) {
  if (params.updated !== 'me') return {};
  return literal(updatedSql('"Request"', principal, options));
}

/**
 * The unseen events of each request, grouped, newest first — only for requests
 * the caller is involved in; the others get none.
 *
 * @returns {Promise<Record<string, {since: string, events: Array}>>}
 */
async function unseenFor(requestIds, principal, { models, since = baseline() }) {
  if (requestIds.length === 0) return {};
  const sequelize = models.Request.sequelize;
  const me = sequelize.escape(principal.userId);
  const sinceLiteral = `${sequelize.escape(since.toISOString())}::timestamptz`;

  const rows = await sequelize.query(
    `SELECT e.request_id, e.kind, e.key, e.by_user, e.detail, e.extra,
            count(*)::int AS count, max(e.at) AS at,
            GREATEST(COALESCE(max(v.last_seen_at), '-infinity'::timestamptz), ${sinceLiteral}) AS since,
            u.first_name, u.last_name, u.username
       FROM (${eventsSql('$REQ = ANY($1::uuid[])', sequelize)}) e
       JOIN public.requests r ON r.id = e.request_id
       LEFT JOIN public.request_views v ON v.user_id = ${me} AND v.request_id = e.request_id
       LEFT JOIN public.users u ON u.id = e.by_user
      WHERE ${audienceSql('r', me, sequelize)} AND ${unseenSql(me, sinceLiteral)}
      GROUP BY e.request_id, e.kind, e.key, e.by_user, e.detail, e.extra,
               u.first_name, u.last_name, u.username
      ORDER BY max(e.at) DESC`,
    { bind: [requestIds], type: sequelize.QueryTypes.SELECT }
  );

  const result = {};
  for (const row of rows) {
    const entry = (result[row.request_id] ??= { since: row.since, events: [] });
    entry.events.push({
      kind: row.kind,
      at: row.at,
      count: row.count,
      by: row.by_user
        ? {
            id: row.by_user,
            username: row.username,
            firstName: row.first_name,
            lastName: row.last_name,
          }
        : null,
      ...(row.detail ? { detail: row.detail } : {}),
      ...(row.extra ? { extra: row.extra } : {}),
    });
  }
  return result;
}

/**
 * The "since your last view" of one request: when the caller last looked (or
 * the baseline), and every unseen event. Empty when they are not involved.
 */
async function forDetail(request, principal, { models, since = baseline() }) {
  const found = (await unseenFor([request.id], principal, { models, since }))[request.id];
  if (found) return found;
  const view = await models.RequestView.findOne({
    where: { userId: principal.userId, requestId: request.id },
  });
  const last = view?.lastSeenAt ?? null;
  return { since: last && last > since ? last : since, events: [] };
}

/** `POST /requests/:id/view`: this user, this request, now — nothing else. */
async function markViewed(requestId, principal, { models }) {
  await models.RequestView.upsert({
    userId: principal.userId,
    requestId,
    lastSeenAt: new Date(),
  });
}

/** The two counts for the navigation — derived independently of each other. */
async function counts(principal, { models, visibleWhere, actionNeededWhere }) {
  const count = (extra) =>
    models.Request.count({ where: { [Op.and]: [visibleWhere, extra] }, distinct: true });
  const [actionNeeded, updated] = await Promise.all([
    count(actionNeededWhere),
    count(literal(updatedSql('"Request"', principal))),
  ]);
  return { actionNeeded, updated };
}

module.exports = {
  UPDATE_KINDS,
  ROW_LIMIT,
  involvedSql,
  updatedSql,
  updatedWhere,
  unseenFor,
  forDetail,
  markViewed,
  counts,
};
