'use strict';

/**
 * Background jobs — `05-infrastructure.md` §7, `IMPLEMENTATION_PLAN.md` §14.2.
 *
 * BullMQ over the same Redis as sessions. The worker runs inside the API
 * process as a second entry point, not a separate container (§7.3): BullMQ
 * coordinates through Redis, so splitting it out later is a deployment change
 * with no code change.
 *
 * One job exists today — the borrowing overdue sweep (§14.3). The queue is
 * built to hold the others §7.2 anticipates (due-date reminders, orphaned-file
 * cleanup, audit archival) without further plumbing; none of them is implemented,
 * because no requirement calls for them yet.
 */

const { Queue, Worker } = require('bullmq');

const { getConfig } = require('../config');
const { getLogger } = require('../logger');
const { createJobConnection } = require('./connection');
const { JOB_NAME: OVERDUE_SWEEP, runBorrowingOverdueSweep } = require('./borrowingOverdueSweep');

const QUEUE_NAME = 'asset-management';

/**
 * Job name → handler.
 *
 * A job whose name is not here fails loudly rather than being silently dropped:
 * a queued job nobody processes is worse than a visible error, because the queue
 * looks healthy while the work never happens.
 */
const HANDLERS = Object.freeze({
  [OVERDUE_SWEEP]: () => runBorrowingOverdueSweep(),
});

/**
 * Retry policy — §14.2.
 *
 * Three attempts with exponential backoff. Failures here are almost always a
 * datastore blip, which a retry a few seconds later clears; a genuinely broken
 * job would fail three times and stay visible in the failed set rather than
 * being retried forever.
 */
const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  // Keep recent history bounded — enough to investigate a failure, not enough to
  // grow without limit.
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 100 },
});

function createQueue({ config = getConfig(), logger = getLogger() } = {}) {
  return new Queue(QUEUE_NAME, {
    connection: createJobConnection({ role: 'queue', config, logger }),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

/**
 * Registers the repeatable schedule — every 15 minutes (§7.2).
 *
 * A job scheduler is upserted under a fixed id, so restarting the process
 * updates the existing schedule rather than adding a second one. Without that,
 * every deploy would multiply the sweep.
 */
async function scheduleRecurringJobs(queue, { config = getConfig() } = {}) {
  await queue.upsertJobScheduler(
    `${OVERDUE_SWEEP}-scheduler`,
    { every: config.jobs.overdueSweepIntervalMs },
    { name: OVERDUE_SWEEP }
  );
}

function createWorker({ config = getConfig(), logger = getLogger() } = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const handler = HANDLERS[job.name];

      if (!handler) {
        throw new Error(`No handler registered for job "${job.name}"`);
      }

      logger.info('job started', { job: job.name, jobId: job.id, attempt: job.attemptsMade + 1 });
      return handler(job);
    },
    {
      connection: createJobConnection({ role: 'worker', config, logger }),
      concurrency: 1,
    }
  );

  worker.on('failed', (job, error) => {
    logger.error('job failed', {
      job: job?.name,
      jobId: job?.id,
      attempt: job?.attemptsMade,
      willRetry: (job?.attemptsMade ?? 0) < (job?.opts?.attempts ?? 1),
      error: error?.message,
    });
  });

  worker.on('error', (error) => {
    logger.warn('worker error', { error: error?.message });
  });

  return worker;
}

/**
 * Starts the queue, its schedule and the worker.
 *
 * Returns `null` when jobs are disabled, so a test run or a one-off process does
 * not open a worker connection it will never use.
 *
 * @returns {Promise<{queue: Queue, worker: Worker}|null>}
 */
async function startJobs({ config = getConfig(), logger = getLogger() } = {}) {
  if (!config.jobs.enabled) {
    logger.info('background jobs disabled');
    return null;
  }

  const queue = createQueue({ config, logger });
  await scheduleRecurringJobs(queue, { config });
  const worker = createWorker({ config, logger });

  logger.info('background jobs started', {
    queue: QUEUE_NAME,
    overdueSweepIntervalMs: config.jobs.overdueSweepIntervalMs,
  });

  return { queue, worker };
}

/**
 * Closes the worker before the queue: the worker must finish or release the job
 * it is holding before the connection behind the queue goes away.
 */
async function stopJobs(runtime, { logger = getLogger() } = {}) {
  if (!runtime) return;

  const results = await Promise.allSettled([runtime.worker.close(), runtime.queue.close()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn('error while closing background jobs', { error: result.reason?.message });
    }
  }
}

module.exports = {
  QUEUE_NAME,
  HANDLERS,
  DEFAULT_JOB_OPTIONS,
  createQueue,
  createWorker,
  scheduleRecurringJobs,
  startJobs,
  stopJobs,
};
