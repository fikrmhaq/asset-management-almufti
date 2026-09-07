'use strict';

/**
 * Development connectivity check.
 *
 * Satisfies the Phase 0 completion criteria "Backend can reach PostgreSQL" and
 * "Backend can reach Redis" (`IMPLEMENTATION_PLAN.md` §6.5) without building any
 * of the application-layer infrastructure that owns those connections later:
 * the Sequelize setup is Phase 1/2 and the shared Redis service is Phase 8.
 *
 * This is a standalone operator tool, not part of the running application.
 *
 * Usage: npm run check:services
 * Exit code 0 when both datastores answered, 1 otherwise.
 */

const { Client } = require('pg');
const Redis = require('ioredis');

const { loadDotEnvFiles, loadConfig } = require('../src/config');

const CONNECT_TIMEOUT_MS = 5000;

async function checkPostgres(databaseUrl) {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });

  try {
    await client.connect();
    const { rows } = await client.query('SELECT version() AS version, current_database() AS db');
    return { ok: true, detail: `${rows[0].db} — ${rows[0].version.split(',')[0]}` };
  } catch (error) {
    return { ok: false, detail: error.message };
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkRedis(redisUrl) {
  const redis = new Redis(redisUrl, {
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    const serverInfo = await redis.info('server');
    const versionLine = serverInfo.split('\n').find((line) => line.startsWith('redis_version:'));
    return { ok: pong === 'PONG', detail: (versionLine || 'redis').trim() };
  } catch (error) {
    return { ok: false, detail: error.message };
  } finally {
    redis.disconnect();
  }
}

async function main() {
  loadDotEnvFiles();

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`configuration error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const [postgres, redis] = await Promise.all([
    checkPostgres(config.database.url),
    checkRedis(config.redis.url),
  ]);

  const report = (label, result) => {
    console.log(`${result.ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(10)} ${result.detail}`);
  };

  report('postgres', postgres);
  report('redis', redis);

  if (!postgres.ok || !redis.ok) {
    console.error('\nOne or more services are unreachable. Start them with: npm run docker:up');
    process.exitCode = 1;
  }
}

main();
