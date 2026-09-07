'use strict';

/**
 * Request correlation and access logging — `05-infrastructure.md` §8.1.
 *
 * Assigns each request an id and logs one structured line on completion, so an
 * error log and the request that produced it can be tied together after the
 * fact. Logging on `finish` rather than on entry means the line carries the
 * status and duration, which is what makes it worth keeping.
 */

const { randomUUID } = require('node:crypto');

const { getLogger } = require('../logger');

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Attaches `req.id` and echoes it back, so a client can quote the id when
 * reporting a problem. An inbound id is trusted only as a correlation label —
 * it grants nothing and is never used for lookups.
 *
 * @returns {import('express').RequestHandler}
 */
function requestId() {
  return function assignRequestId(req, res, next) {
    const inbound = req.get(REQUEST_ID_HEADER);
    req.id = inbound && inbound.length <= 128 ? inbound : randomUUID();
    res.set(REQUEST_ID_HEADER, req.id);
    next();
  };
}

/**
 * Logs one line per completed request. 5xx logs at `error`, 4xx at `warn`,
 * everything else at `http` — so a normal day is quiet and a bad one is not.
 *
 * @param {{logger?: import('winston').Logger}} [options]
 * @returns {import('express').RequestHandler}
 */
function requestLogger({ logger = getLogger() } = {}) {
  return function logRequest(req, res, next) {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';

      logger.log(level, 'request', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
        ip: req.ip,
      });
    });

    next();
  };
}

module.exports = { requestId, requestLogger, REQUEST_ID_HEADER };
