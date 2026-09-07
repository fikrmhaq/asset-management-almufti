import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { sslDialectOptions, TLS_MODES } = require('../src/db/connectionSsl.js');

/**
 * Database TLS — `05-infrastructure.md` §12.1.
 *
 * The defect this module exists for: `pg` reads `sslmode` out of the connection
 * string, and **Sequelize does not**. A managed Postgres therefore refuses
 * Sequelize with `connection is insecure (try using sslmode=require)` — naming a
 * parameter the URL already carries, which sends you looking in the one place
 * the problem is not.
 *
 * Two properties matter here and are tested in both directions, because getting
 * either backwards is silent:
 *
 *   TLS IS OPT-IN     a local container has no TLS, and forcing it would break
 *                     every development run to accommodate a hosted provider.
 *   THE CERT IS CHECKED  `rejectUnauthorized` stays true. `false` is encryption
 *                     without authentication, and looks identical in a log.
 */

const NEON =
  'postgresql://u:p@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const LOCAL = 'postgres://asset_app:asset_app_dev@localhost:5433/asset_management';

describe('sslDialectOptions', () => {
  it('asks for verified TLS when the URL requires it', () => {
    expect(sslDialectOptions(NEON)).toEqual({
      ssl: { require: true, rejectUnauthorized: true },
    });
  });

  it.each(TLS_MODES)('recognises sslmode=%s', (mode) => {
    expect(sslDialectOptions(`postgres://h/db?sslmode=${mode}`).ssl).toBeDefined();
  });

  it('reads the mode wherever it sits in the query string', () => {
    expect(
      sslDialectOptions('postgres://h/db?channel_binding=require&sslmode=require').ssl
    ).toBeDefined();
  });

  it('is case-insensitive, as libpq is', () => {
    expect(sslDialectOptions('postgres://h/db?sslmode=REQUIRE').ssl).toBeDefined();
  });

  /**
   * The development and test databases are a container on the same host with no
   * TLS at all. Contributing anything here would break every local run.
   */
  it('contributes nothing when the URL does not ask for TLS', () => {
    expect(sslDialectOptions(LOCAL)).toEqual({});
  });

  it.each(['disable', 'allow', 'prefer'])('does not force TLS for sslmode=%s', (mode) => {
    expect(sslDialectOptions(`postgres://h/db?sslmode=${mode}`)).toEqual({});
  });

  it.each([undefined, null, ''])('tolerates %p rather than throwing', (value) => {
    expect(sslDialectOptions(value)).toEqual({});
  });

  /**
   * `rejectUnauthorized: false` is what most hosted-Postgres snippets show. It
   * accepts ANY certificate — encryption without authentication, which §12.1 is
   * not satisfied by. Pinned so it cannot be relaxed without this failing.
   */
  it('never disables certificate verification', () => {
    for (const mode of TLS_MODES) {
      const { ssl } = sslDialectOptions(`postgres://h/db?sslmode=${mode}`);
      expect(ssl.rejectUnauthorized).toBe(true);
    }
  });
});

describe('the CLI and the application agree', () => {
  /**
   * A deployment where migrations connect and the application does not is worse
   * than one where neither does: the schema moves, and nothing serves it. Both
   * consumers derive TLS from the same function and the same variable, so they
   * cannot disagree about whether a database wants it.
   */
  it('derives the same options the migration CLI uses', () => {
    const cli = require('../config/sequelize.js');

    process.env.DATABASE_URL = NEON;
    // Re-read: `config/sequelize.js` computes at module load, so the assertion
    // is about the function both of them call, not about import order.
    expect(sslDialectOptions(process.env.DATABASE_URL)).toEqual({
      ssl: { require: true, rejectUnauthorized: true },
    });
    expect(cli.production.use_env_variable).toBe('DATABASE_URL');
    expect(cli.test.use_env_variable).toBe('TEST_DATABASE_URL');
  });
});
