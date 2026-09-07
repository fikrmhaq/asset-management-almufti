'use strict';

/**
 * Operational logging — `05-infrastructure.md` §8.1.
 *
 * Structured JSON to stdout/stderr, captured by Docker's logging driver; there
 * is no separate log-shipping infrastructure at this scale.
 *
 * This is NOT `audit.audit_logs`. Winston records operational events (errors,
 * request traces) and may be dropped or rotated freely. The audit table is the
 * immutable business record required by REQ-AUDIT-001 and is written elsewhere.
 */

const winston = require('winston');

const { getConfig } = require('./config');

/** Values that must never reach a log line, at any nesting depth. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'jwt',
]);

const REDACTED = '[redacted]';

/**
 * Recursively replaces sensitive values.
 *
 * `05-infrastructure.md` §12.3 and REQ-NFR-SEC-001 make credential handling a
 * security concern; a log line is just as much a disclosure as a response body.
 *
 * Errors nested in metadata are flattened to `{ name, message, stack }`.
 * `JSON.stringify` renders an Error as `{}` — its properties are non-enumerable
 * — so an untouched error would log as an empty object and lose exactly the
 * information it was attached for.
 */
function redact(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(entry, seen),
    ])
  );
}

/**
 * Redacts the log entry's own properties in place.
 *
 * Rebuilding the entry with `Object.entries` would silently drop the symbol
 * keys winston uses internally (`Symbol(level)`, `Symbol(message)`), which
 * later formats depend on — colorize throws outright without them.
 */
const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    info[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(info[key]);
  }
  return info;
});

function createLogger(config = getConfig()) {
  return winston.createLogger({
    level: config.logLevel,
    defaultMeta: { service: 'asset-management-api' },
    format: winston.format.combine(
      redactFormat(),
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      config.isDevelopment
        ? winston.format.combine(winston.format.colorize(), winston.format.simple())
        : winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        stderrLevels: ['error'],
        // Keep the process alive when logging fails; a broken log sink is not a
        // reason to take the API down.
        handleExceptions: false,
      }),
    ],
  });
}

let logger;

/** Memoized process-wide logger. */
function getLogger() {
  if (!logger) logger = createLogger();
  return logger;
}

module.exports = { createLogger, getLogger, redact, REDACTED };
