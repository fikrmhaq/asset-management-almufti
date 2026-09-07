'use strict';

/**
 * Response envelopes — `06-api.md` §1.4.
 *
 * Every response body in the API has one of exactly three shapes. Building them
 * here rather than inline in controllers is what keeps that true.
 */

/**
 * Single resource: `{ "data": { ... } }`
 *
 * @param {import('express').Response} res
 * @param {unknown} data
 * @param {number} [status=200]
 */
function sendItem(res, data, status = 200) {
  return res.status(status).json({ data });
}

/**
 * Created resource. Distinct from `sendItem` only in status, but naming the
 * intent keeps 201-vs-200 out of each controller's head.
 */
function sendCreated(res, data) {
  return sendItem(res, data, 201);
}

/**
 * Collection with the pagination meta block:
 *
 * `{ "data": [...], "meta": { page, pageSize, total, totalPages } }`
 *
 * @param {import('express').Response} res
 * @param {unknown[]} rows
 * @param {{page: number, pageSize: number, total: number}} pagination
 */
function sendList(res, rows, { page, pageSize, total }) {
  return res.status(200).json({
    data: rows,
    meta: {
      page,
      pageSize,
      total,
      // A zero-result query has zero pages, not one — `Math.ceil(0/20)` is 0.
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

/**
 * A COMPLETE collection, in the same envelope a paged list uses.
 *
 * For sub-collections that are returned whole and are bounded by the data
 * itself — a node's direct children — rather than by a page size. They are
 * still collections, and a client should not have to know which of the two
 * kinds it asked for in order to read the response: both are
 * `{ data: [...], meta: {...} }`.
 *
 * WHY THIS EXISTS. `/locations/:id/children` and `/classifications/:id/children`
 * used to answer with `sendItem`, which made them the only collection endpoints
 * in the API whose body was `{ data }` with no `meta`. Two clients then read
 * them two different ways, and the location picker read the wrong one — the
 * drill-down came back empty and no location below the top level could be
 * chosen. One envelope for every collection is what stops that recurring.
 *
 * `meta` describes the whole set honestly: one page containing everything, and
 * zero pages when there is nothing. No `page`/`pageSize` query params are
 * accepted, because the answer is never a page. Adding real paging here would
 * have capped a response that is currently complete — silently truncating the
 * pickers and the tree view at the default page size, which is a worse bug than
 * the one being fixed.
 *
 * @param {import('express').Response} res
 * @param {unknown[]} rows
 */
function sendCollection(res, rows) {
  return res.status(200).json({
    data: rows,
    meta: {
      page: 1,
      pageSize: rows.length,
      total: rows.length,
      totalPages: rows.length ? 1 : 0,
    },
  });
}

/** Successful action with nothing to return. */
function sendNoContent(res) {
  return res.status(204).end();
}

/** OOXML spreadsheet. */
const SPREADSHEET_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * A generated spreadsheet, as a download — `CR-009` `DEC-D`.
 *
 * THE ONE RESPONSE IN THIS API WITH NO ENVELOPE, and deliberately so. The three
 * shapes above exist to give a client a predictable thing to unwrap; a file the
 * browser saves to disk is not unwrapped by anything, and base64 inside a `data`
 * key would only mean the client had to undo it.
 *
 * `attachment`, never `inline` — the same rule the attachment download follows.
 * A generated file rendered in the application's own origin is how a payload
 * would execute, and the fact that this one was generated rather than uploaded
 * is not a distinction the browser makes.
 *
 * The caller is responsible for a filename that cannot break the header;
 * `reports/routes.js` reduces it to the identifier alphabet before it gets here.
 *
 * @param {import('express').Response} res
 * @param {Buffer} buffer
 * @param {string} filename
 */
function sendSpreadsheet(res, buffer, filename) {
  res.type(SPREADSHEET_TYPE);
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('Content-Length', String(buffer.length));
  return res.send(buffer);
}

/**
 * Error: `{ "error": { code, message, details? } }`
 *
 * Only the error middleware should call this — controllers throw instead, so a
 * failure cannot be reported and then accidentally followed by more work.
 */
function sendError(res, { status, code, message, details }) {
  const error = { code, message };
  if (details?.length) error.details = details;
  return res.status(status).json({ error });
}

module.exports = {
  sendItem,
  sendCreated,
  sendList,
  sendCollection,
  sendNoContent,
  sendSpreadsheet,
  sendError,
  SPREADSHEET_TYPE,
};
