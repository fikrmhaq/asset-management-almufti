import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import winston from 'winston';

import { TEST_ENV } from './helpers/testApp.js';

const require = createRequire(import.meta.url);

const { createLogger, redact, REDACTED } = require('../src/logger.js');
const { loadConfig } = require('../src/config/index.js');

/** Operational logging — 05-infrastructure.md §8.1. */

const baseEnv = TEST_ENV;

/** Captures what actually reaches a transport, formats and all. */
function capturingLogger(env) {
  const lines = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  const logger = createLogger(loadConfig({ ...baseEnv, ...env }));
  logger.clear();
  logger.add(new winston.transports.Stream({ stream }));
  return { logger, lines };
}

let captured;

beforeEach(() => {
  captured = capturingLogger({ NODE_ENV: 'production', LOG_LEVEL: 'silly' });
});

afterEach(() => {
  captured.logger.close();
});

describe('log formatting', () => {
  it('writes structured JSON in production', () => {
    captured.logger.info('request', { status: 200 });

    expect(JSON.parse(captured.lines[0])).toMatchObject({
      level: 'info',
      message: 'request',
      status: 200,
      service: 'asset-management-api',
    });
  });

  it('stamps every entry with a timestamp', () => {
    captured.logger.info('anything');

    expect(JSON.parse(captured.lines[0]).timestamp).toEqual(expect.any(String));
  });

  it.each(['error', 'warn', 'info', 'http', 'debug'])(
    'emits a %s entry without throwing in the colorized development format',
    (level) => {
      // Regression guard: a format that rebuilt the entry stripped winston's
      // internal symbol keys, and colorize threw on the missing level.
      const dev = capturingLogger({ NODE_ENV: 'development', LOG_LEVEL: 'silly' });

      expect(() => dev.logger.log(level, 'message', { meta: true })).not.toThrow();
      expect(dev.lines).toHaveLength(1);
      dev.logger.close();
    }
  );

  it('preserves an Error stack passed as metadata', () => {
    captured.logger.error('failed', { error: new Error('the real cause') });

    expect(captured.lines[0]).toMatch(/the real cause/);
  });
});

describe('redaction', () => {
  it.each(['password', 'passwordHash', 'token', 'refreshToken', 'authorization', 'secret'])(
    'never writes a %s value',
    (key) => {
      captured.logger.info('sensitive', { [key]: 'super-secret-value' });

      expect(captured.lines[0]).not.toMatch(/super-secret-value/);
      expect(captured.lines[0]).toMatch(/redacted/);
    }
  );

  it('redacts nested values too', () => {
    captured.logger.info('nested', { user: { name: 'jdoe', passwordHash: 'bcrypt-hash' } });

    const entry = JSON.parse(captured.lines[0]);
    expect(entry.user.name).toBe('jdoe');
    expect(entry.user.passwordHash).toBe(REDACTED);
  });

  it('redacts inside arrays', () => {
    expect(redact([{ token: 'abc' }, { safe: 'ok' }])).toEqual([
      { token: REDACTED },
      { safe: 'ok' },
    ]);
  });

  it('survives a circular reference', () => {
    const circular = { name: 'loop' };
    circular.self = circular;

    expect(redact(circular)).toEqual({ name: 'loop', self: '[circular]' });
  });

  it('leaves non-sensitive values untouched', () => {
    expect(redact({ page: 1, name: 'Desk' })).toEqual({ page: 1, name: 'Desk' });
  });
});

describe('log level', () => {
  it('is quiet under test so failures stay readable', () => {
    const quiet = capturingLogger({ NODE_ENV: 'test' });
    quiet.logger.debug('noise');
    quiet.logger.info('noise');
    quiet.logger.error('a real problem');

    expect(quiet.lines).toHaveLength(1);
    quiet.logger.close();
  });
});
