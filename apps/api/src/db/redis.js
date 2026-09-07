'use strict';

/**
 * Minimal Redis client.
 *
 * Phase 2 needs exactly one thing from Redis: the connectivity check that
 * `GET /api/health` reports (`05-infrastructure.md` §8.2). The shared Redis
 * service — session storage, BullMQ coordination, retry policy — belongs to
 * Phase 3 and Phase 8 (`IMPLEMENTATION_PLAN.md` §14.1), so this deliberately
 * stops at connect / ping / quit.
 */

const Redis = require('ioredis');

const { getConfig } = require('../config');
const { getLogger } = require('../logger');

/**
 * @param {object} [config]
 * @param {import('winston').Logger} [logger]
 * @returns {import('ioredis').Redis}
 */
function createRedis(config = getConfig(), logger = getLogger()) {
  const client = new Redis(config.redis.url, {
    // Connect on first use rather than at import time, so requiring this module
    // never opens a socket as a side effect.
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });

  // ioredis emits `error` on every reconnect attempt. Without a listener Node
  // treats it as an unhandled error event and terminates the process — a Redis
  // blip must not take the API down.
  client.on('error', (error) => {
    logger.warn('redis connection error', { error: error.message });
  });

  return client;
}

let instance;

function getRedis() {
  if (!instance) instance = createRedis();
  return instance;
}

/**
 * Connects the client if it is not connected yet.
 *
 * The client is created lazily (`lazyConnect`), so any caller that reaches
 * Redis without going through application boot — a CLI, a test, a worker — must
 * not depend on something else having connected it first.
 */
async function ensureRedis(client = getRedis()) {
  if (client.status === 'wait' || client.status === 'end') {
    await client.connect();
  }
  return client;
}

/** Verifies the connection is usable. Returns the PING reply. */
async function pingRedis(client = getRedis()) {
  await ensureRedis(client);
  return client.ping();
}

/** Closes the connection. Called during graceful shutdown. */
async function closeRedis() {
  if (instance) {
    await instance.quit().catch(() => instance.disconnect());
    instance = undefined;
  }
}

module.exports = { createRedis, getRedis, ensureRedis, pingRedis, closeRedis };
