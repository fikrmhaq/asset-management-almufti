'use strict';

/**
 * Application configuration.
 *
 * `05-infrastructure.md` §1.2 requires the application to fail at startup when a
 * required variable is missing, rather than failing later at first use. The Zod
 * schema below is the single place that decides what "valid configuration" means;
 * everything else reads the parsed object, never `process.env` directly.
 *
 * This replaces the minimal Phase 0 validator, as planned.
 */

const path = require('node:path');
const dotenv = require('dotenv');
const { z } = require('zod');

const API_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(API_ROOT, '..', '..');

/**
 * Reads `.env` files into `process.env` without overwriting variables already
 * set — a real environment variable always wins over a file.
 *
 * The workspace file is read first so it can override the repo-root file, since
 * dotenv keeps the first value it sees for a given key.
 */
function loadDotEnvFiles() {
  dotenv.config({ path: path.join(API_ROOT, '.env') });
  dotenv.config({ path: path.join(REPO_ROOT, '.env') });
}

const port = z.coerce.number().int().positive().max(65535);
const url = (protocols) =>
  z.string().refine(
    (value) => {
      try {
        return protocols.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: `must be a URL using one of: ${protocols.join(', ')}` }
  );

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: port.default(3000),

  DATABASE_URL: url(['postgres:', 'postgresql:']),
  REDIS_URL: url(['redis:', 'rediss:']),

  STORAGE_PATH: z.string().min(1),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().positive(),

  // Never `*` — 05-infrastructure.md §12.3. Comma-separated for multiple origins.
  CORS_ORIGIN: z
    .string()
    .min(1)
    .refine((value) => value !== '*', { message: 'must name explicit origins, never "*"' }),

  // Request-layer rate limiting (REQ-NFR-SEC-004). Auth-specific limits are Phase 3.
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // Largest accepted JSON/urlencoded body. File uploads are bounded separately
  // by MAX_UPLOAD_SIZE_MB once multer arrives in Phase 5.
  MAX_REQUEST_BODY_KB: z.coerce.number().int().positive().default(256),

  // Authentication — 05-infrastructure.md §6. The two secrets MUST differ: a
  // shared secret would let a refresh token be presented as an access token.
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().min(1).default('15m'),
  JWT_REFRESH_EXPIRY: z.string().min(1).default('7d'),

  // Stricter limit for the login endpoint specifically — a ceiling loose enough
  // for browsing assets is far too loose for password attempts (§12.3).
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // Refresh is NOT a password-guessing surface, so it does not belong behind the
  // login limiter. It is authenticated by a signed httpOnly cookie — there is
  // nothing to brute-force — and every page load spends exactly one call, so the
  // login ceiling of 10 logged a user out on their eleventh reload.
  //
  // It still gets a limit: a stolen cookie replayed in a loop should not be free.
  // The ceiling is simply set where normal use cannot reach it.
  REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // Background jobs — 05-infrastructure.md §7. The worker runs in the API
  // process (§7.3), so this switch exists for the processes that must NOT run
  // it: the test suite, and any one-off CLI. Defaults on, because a deployment
  // that silently stops writing OVERDUE would be a quiet correctness bug.
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  OVERDUE_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),

  /**
   * The zone the institution's calendar month is expressed in — `CR-012`
   * `DEC-L`/`DEC-M`, `05-infrastructure.md` §7.5, REQ-COND-006.
   *
   * Validated against the runtime's own zone list rather than a regex: a
   * plausible-looking name that ICU does not know would otherwise be accepted
   * here and silently produce UTC months at first use, which is precisely the
   * defect this variable exists to fix. Failing at startup is the whole
   * contract of this file (§1.2).
   */
  BUSINESS_TIMEZONE: z
    .string()
    .trim()
    .min(1)
    .default('Asia/Jakarta')
    .refine((value) => Intl.supportedValuesOf('timeZone').includes(value), {
      message: 'must be an IANA time zone this runtime recognizes, e.g. Asia/Jakarta',
    }),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug', 'silly']).optional(),
});

/** Turns a ZodError into one readable, actionable message. */
function formatIssues(error) {
  return error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Validates the environment and returns the application configuration.
 *
 * @throws {Error} listing every invalid or missing variable at once, so a
 *   misconfigured deployment does not have to be fixed one restart at a time.
 */
function loadConfig(source = process.env) {
  const result = configSchema.safeParse(source);

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${formatIssues(result.error)}\n` +
        'Copy .env.example to .env and fill in the missing values.'
    );
  }

  const env = result.data;
  const nodeEnv = env.NODE_ENV;

  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  JWT_REFRESH_SECRET: must differ from JWT_ACCESS_SECRET, otherwise a ' +
        'refresh token can be presented as an access token.'
    );
  }

  return {
    nodeEnv,
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
    isProduction: nodeEnv === 'production',

    port: env.PORT,

    database: { url: env.DATABASE_URL },
    redis: { url: env.REDIS_URL },

    storage: {
      path: env.STORAGE_PATH,
      maxUploadSizeMb: env.MAX_UPLOAD_SIZE_MB,
    },

    http: {
      corsOrigins: env.CORS_ORIGIN.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      maxRequestBodyKb: env.MAX_REQUEST_BODY_KB,
      rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
      authRateLimit: {
        windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
        max: env.AUTH_RATE_LIMIT_MAX,
      },
      refreshRateLimit: {
        windowMs: env.REFRESH_RATE_LIMIT_WINDOW_MS,
        max: env.REFRESH_RATE_LIMIT_MAX,
      },
    },

    jobs: {
      // Never under test: a worker polling Redis across a suite run would
      // outlive the test that started it.
      enabled: env.JOBS_ENABLED && nodeEnv !== 'test',
      overdueSweepIntervalMs: env.OVERDUE_SWEEP_INTERVAL_MS,
    },

    // Flat rather than nested: it is one value with no siblings, and a
    // `calendar: { timeZone }` object would invent a grouping nothing else uses.
    businessTimeZone: env.BUSINESS_TIMEZONE,

    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiry: env.JWT_ACCESS_EXPIRY,
      refreshExpiry: env.JWT_REFRESH_EXPIRY,
    },

    // Quiet by default under test so a failing assertion is not buried in logs.
    logLevel:
      env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : nodeEnv === 'test' ? 'error' : 'debug'),
  };
}

let cached;

/** Memoized configuration for the running process. */
function getConfig() {
  if (!cached) {
    loadDotEnvFiles();
    cached = loadConfig();
  }
  return cached;
}

/** Test-only: forgets the memoized configuration. */
function resetConfig() {
  cached = undefined;
}

module.exports = {
  API_ROOT,
  REPO_ROOT,
  configSchema,
  loadDotEnvFiles,
  loadConfig,
  getConfig,
  resetConfig,
};
