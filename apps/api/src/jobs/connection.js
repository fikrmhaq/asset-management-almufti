'use strict';

/**
 * Redis connections for BullMQ — `05-infrastructure.md` §7.3,
 * `IMPLEMENTATION_PLAN.md` §14.1.
 *
 * The same Redis instance as sessions (§6.2), but NOT the same client. BullMQ's
 * worker issues blocking commands (`BRPOPLPUSH`) that occupy a connection for
 * as long as the queue is idle, so sharing the application's client would stall
 * every session lookup behind an empty queue.
 *
 * The options differ for the same reason:
 *
 *   maxRetriesPerRequest: null   BullMQ requires it; a blocking command must not
 *                                be abandoned mid-wait.
 *   enableOfflineQueue: true     a job enqueued during a blip should wait for
 *                                the reconnect rather than be lost, which is the
 *                                opposite of what an HTTP request wants.
 */

const Redis = require('ioredis');

const { getConfig } = require('../config');
const { getLogger } = require('../logger');

/**
 * @param {{role?: string, config?: object, logger?: import('winston').Logger}} [options]
 * @returns {import('ioredis').Redis}
 */
function createJobConnection({ role = 'queue', config = getConfig(), logger = getLogger() } = {}) {
  const client = new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: true,
  });

  // Without a listener, ioredis's `error` event is an unhandled error event and
  // takes the process down — a Redis blip must not kill the API (§7.3 runs the
  // worker in the same process).
  client.on('error', (error) => {
    logger.warn('job redis connection error', { role, error: error.message });
  });

  return client;
}

module.exports = { createJobConnection };
