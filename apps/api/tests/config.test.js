import { describe, it, expect } from 'vitest';

import { loadConfig } from '../src/config/index.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/asset_management',
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_PATH: './storage/attachments',
  MAX_UPLOAD_SIZE_MB: '10',
  CORS_ORIGIN: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
};

describe('configuration (05-infrastructure.md §1.2)', () => {
  it('parses a complete environment', () => {
    expect(loadConfig(validEnv)).toMatchObject({
      nodeEnv: 'test',
      isTest: true,
      isProduction: false,
      port: 3000,
      database: { url: validEnv.DATABASE_URL },
      redis: { url: validEnv.REDIS_URL },
      storage: { path: './storage/attachments', maxUploadSizeMb: 10 },
    });
  });

  it.each([
    'DATABASE_URL',
    'REDIS_URL',
    'STORAGE_PATH',
    'MAX_UPLOAD_SIZE_MB',
    'CORS_ORIGIN',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ])('fails fast when %s is missing', (name) => {
    const incomplete = { ...validEnv };
    delete incomplete[name];

    expect(() => loadConfig(incomplete)).toThrow(new RegExp(name));
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/
    );
  });

  it('rejects identical access and refresh secrets', () => {
    const shared = 'c'.repeat(48);

    expect(() =>
      loadConfig({ ...validEnv, JWT_ACCESS_SECRET: shared, JWT_REFRESH_SECRET: shared })
    ).toThrow(/must differ/);
  });

  it('defaults the token lifetimes documented in §6.1', () => {
    expect(loadConfig(validEnv).auth).toMatchObject({ accessExpiry: '15m', refreshExpiry: '7d' });
  });

  it('reports every problem at once rather than one per restart', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*STORAGE_PATH/
    );
  });

  it('applies documented defaults for optional variables', () => {
    const config = loadConfig(validEnv);

    expect(config.http.rateLimit).toEqual({ windowMs: 900000, max: 300 });
    expect(config.http.maxRequestBodyKb).toBe(256);
  });

  it('defaults NODE_ENV and PORT', () => {
    const { NODE_ENV, PORT, ...rest } = validEnv;

    expect(loadConfig(rest)).toMatchObject({ nodeEnv: 'development', port: 3000 });
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/
    );
  });

  it('rejects a malformed REDIS_URL', () => {
    expect(() => loadConfig({ ...validEnv, REDIS_URL: 'not a url' })).toThrow(/REDIS_URL/);
  });

  it('rejects a wildcard CORS origin (§12.3)', () => {
    expect(() => loadConfig({ ...validEnv, CORS_ORIGIN: '*' })).toThrow(/never "\*"/);
  });

  it('splits multiple CORS origins', () => {
    const config = loadConfig({
      ...validEnv,
      CORS_ORIGIN: 'http://localhost:5173, https://assets.example.test',
    });

    expect(config.http.corsOrigins).toEqual([
      'http://localhost:5173',
      'https://assets.example.test',
    ]);
  });

  it.each([
    ['PORT', 'http'],
    ['PORT', '70000'],
    ['MAX_UPLOAD_SIZE_MB', '0'],
    ['NODE_ENV', 'staging'],
  ])('rejects an invalid %s of "%s"', (name, value) => {
    expect(() => loadConfig({ ...validEnv, [name]: value })).toThrow(new RegExp(name));
  });

  it('chooses a log level appropriate to the environment', () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: 'production' }).logLevel).toBe('info');
    expect(loadConfig({ ...validEnv, NODE_ENV: 'development' }).logLevel).toBe('debug');
    expect(loadConfig(validEnv).logLevel).toBe('error');
    expect(loadConfig({ ...validEnv, LOG_LEVEL: 'warn' }).logLevel).toBe('warn');
  });

  /**
   * The business calendar — `CR-012` `DEC-L`/`DEC-M`, REQ-COND-006.
   *
   * The zone is validated against the runtime's own list rather than a regex,
   * because a plausible-looking name ICU does not know would otherwise be
   * accepted here and silently produce UTC months at first use — which is the
   * defect the variable exists to fix.
   */
  describe('business timezone (CR-012)', () => {
    it('defaults to Asia/Jakarta', () => {
      expect(loadConfig(validEnv).businessTimeZone).toBe('Asia/Jakarta');
    });

    it('accepts another IANA zone', () => {
      expect(
        loadConfig({ ...validEnv, BUSINESS_TIMEZONE: 'Asia/Makassar' }).businessTimeZone
      ).toBe('Asia/Makassar');
    });

    it.each(['Asia/Jakartaa', 'WIB', 'UTC+7', 'Mars/Olympus'])(
      'refuses to start on an unrecognized zone "%s"',
      (value) => {
        expect(() => loadConfig({ ...validEnv, BUSINESS_TIMEZONE: value })).toThrow(
          /BUSINESS_TIMEZONE/
        );
      }
    );
  });

  /** Request Updates baseline — P6 (`IMPLEMENTATION_PLAN.md` §64.6). */
  describe('request updates baseline (P6)', () => {
    it('defaults to the rollout day, in business time', () => {
      expect(loadConfig(validEnv).requestUpdatesSince.toISOString()).toBe(
        '2026-09-28T17:00:00.000Z'
      );
    });

    it('accepts a deployment’s own moment', () => {
      expect(
        loadConfig({ ...validEnv, REQUEST_UPDATES_SINCE: '2027-01-02T08:00:00+07:00' })
          .requestUpdatesSince.toISOString()
      ).toBe('2027-01-02T01:00:00.000Z');
    });

    it.each(['2026-09-29', 'yesterday', '2026-09-29T00:00:00'])(
      'refuses to start on "%s" — a date-time with an offset is required',
      (value) => {
        expect(() => loadConfig({ ...validEnv, REQUEST_UPDATES_SINCE: value })).toThrow(
          /REQUEST_UPDATES_SINCE/
        );
      }
    );
  });
});
