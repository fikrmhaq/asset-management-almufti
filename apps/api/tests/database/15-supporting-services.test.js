import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import {
  api,
  config,
  models,
  createAdminCaller,
  resetOperationsData,
  resetAssetCoreData,
  resetProcurementData,
  resetOrganizationData,
} from './helpers/apiClient.js';
import { seed } from './helpers/db.js';

const require = createRequire(import.meta.url);

const audit = require('../../src/services/audit.js');
const { AUDITED_MODELS } = require('../../src/db/auditHooks.js');
const { runWithAuditContext } = require('../../src/http/auditContext.js');
const { JOB_NAME, runBorrowingOverdueSweep } = require('../../src/jobs/borrowingOverdueSweep.js');
const {
  QUEUE_NAME,
  HANDLERS,
  DEFAULT_JOB_OPTIONS,
  createQueue,
  createWorker,
  scheduleRecurringJobs,
  startJobs,
  stopJobs,
} = require('../../src/jobs/index.js');
const { createJobConnection } = require('../../src/jobs/connection.js');
const { pingRedis } = require('../../src/db/redis.js');
const storage = require('../../src/services/storage.js');

/**
 * Supporting backend services — `IMPLEMENTATION_PLAN.md` §14;
 * `05-infrastructure.md` §5, §7.
 *
 * Redis, the job queue and its worker, the borrowing overdue sweep, audit
 * logging and its append-only guarantee, and attachment storage.
 */

const V1 = '/api/v1';
const LEAF = '117010101001';

let admin;
let institution;

function request(method, path, caller = admin) {
  return api()
    [method](`${V1}${path}`)
    .set(...caller.auth);
}

const get = (path, caller = admin) => request('get', path, caller);
const post = (path, body, caller = admin) => request('post', path, caller).send(body);
const patch = (path, body, caller = admin) => request('patch', path, caller).send(body);
const del = (path, caller = admin) => request('delete', path, caller);

const isoDate = (offsetDays = 0) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const auditFor = (entityType, entityId) =>
  models.AuditLog.findAll({
    where: { entityType, entityId: String(entityId) },
    order: [['timestamp', 'ASC']],
  });

async function createAsset(overrides = {}) {
  const response = await post('/assets', {
    name: 'Audited Asset',
    classificationId: LEAF,
    institutionId: institution.id,
    ...overrides,
  });
  return response.body.data;
}

/** An ACTIVE borrowing already past its expected return date. */
async function overdueBorrowing() {
  const asset = await createAsset();
  const unit = (await post(`/assets/${asset.id}/units`, {})).body.data;
  const location = (
    await post('/locations', {
      name: 'Gudang',
      classificationId: '117010101002',
      institutionId: institution.id,
    })
  ).body.data;

  await post(`/asset-units/${unit.id}/history`, {
    condition: 'GOOD',
    locationId: location.id,
    lifecycleState: 'ACTIVE',
    description: 'Commissioned',
  });

  const borrowing = (
    await post('/borrowings', {
      borrowerName: 'Budi',
      borrowerContact: '0812',
      borrowDate: isoDate(-30),
      expectedReturnDate: isoDate(-2),
      institutionId: institution.id,
    })
  ).body.data;

  await post(`/borrowings/${borrowing.id}/items`, { assetUnitId: unit.id });
  await post(`/borrowings/${borrowing.id}/activate`);

  return { borrowing, unit };
}

beforeAll(async () => {
  await seed();
});

beforeEach(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
  await models.AuditLog.destroy({ where: {} });

  admin = await createAdminCaller();
  institution = await models.Institution.create({
    name: 'Support Institution',
    code: `SUP-${Math.random().toString(36).slice(2, 7)}`,
    address: 'Somewhere',
  });
});

afterAll(async () => {
  await resetOperationsData();
  await resetAssetCoreData();
  await resetProcurementData();
  await resetOrganizationData();
  await models.AuditLog.destroy({ where: {} });
});

describe('redis (§14.1, 05-infrastructure.md §6.2)', () => {
  it('answers a ping on the shared application client', async () => {
    expect(await pingRedis()).toBe('PONG');
  });

  it('gives BullMQ its own connection with the options it requires', async () => {
    const connection = createJobConnection({ role: 'test' });

    try {
      // BullMQ's blocking commands require this exact setting; ioredis's default
      // of 20 would abandon a blocking read mid-wait.
      expect(connection.options.maxRetriesPerRequest).toBeNull();
      expect(connection.options.enableOfflineQueue).toBe(true);

      await connection.connect();
      expect(await connection.ping()).toBe('PONG');
    } finally {
      await connection.quit().catch(() => connection.disconnect());
    }
  });

  it('survives a connection error rather than crashing the process', async () => {
    const connection = createJobConnection({ role: 'test' });

    // An `error` event with no listener is fatal in Node. Proving a listener is
    // attached is proving a Redis blip cannot take the API down.
    expect(connection.listenerCount('error')).toBeGreaterThan(0);
    await connection.quit().catch(() => connection.disconnect());
  });
});

describe('job queue and worker (§14.2, 05-infrastructure.md §7.3)', () => {
  it('declares a retry policy with bounded history', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ count: 50 });
  });

  it('registers a handler for every job it schedules', () => {
    expect(Object.keys(HANDLERS)).toContain(JOB_NAME);
  });

  it('creates the queue and upserts one repeatable schedule', async () => {
    const queue = createQueue();

    try {
      await queue.obliterate({ force: true });
      await scheduleRecurringJobs(queue, { config });
      // Twice: a restart must update the existing schedule, not add a second.
      await scheduleRecurringJobs(queue, { config });

      const schedulers = await queue.getJobSchedulers();
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0].name).toBe(JOB_NAME);
      expect(Number(schedulers[0].every)).toBe(config.jobs.overdueSweepIntervalMs);
    } finally {
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close();
    }
  });

  /**
   * These two wait on the JOB'S PERSISTED STATE, not on a `Worker` event.
   *
   * They used to hang on `worker.once('completed'|'failed')`. The worker was
   * doing its job the whole time — a probe showed the enqueued job reaching the
   * failed set inside one second — but under Vitest the event never reaches a
   * listener, so both tests sat until their own 30-second budget expired. The
   * event was the only thing that was broken, and it was never what was under
   * test.
   *
   * Reading `isCompleted()` / `failedReason` off the job asserts the same claims
   * against what BullMQ actually stored, which is the stronger evidence anyway:
   * an event can fire for a job that was never persisted, and a return value
   * read from the job is the one the next process would see.
   */
  const settles = async (job, state, { attempts = 60, every = 250 } = {}) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await job.updateData;
      const current = await job.getState();
      if (current === state) return current;
      await new Promise((resolve) => setTimeout(resolve, every));
    }

    throw new Error(`job ${job.name} never reached "${state}" (last: ${await job.getState()})`);
  };

  it('starts a worker that processes an enqueued job', async () => {
    const queue = createQueue();
    const worker = createWorker();

    try {
      await worker.waitUntilReady();
      // Redis outlives the suite. A repeatable schedule left behind by a
      // previous run — or by a development server pointed at the same Redis —
      // would otherwise sweep this fixture before the job under test does, and
      // the sweep would find nothing left to do.
      await queue.obliterate({ force: true }).catch(() => {});

      const { borrowing } = await overdueBorrowing();
      const job = await queue.add(JOB_NAME, {});

      await settles(job, 'completed');

      expect(job.name).toBe(JOB_NAME);
      // The value the handler returned, read back from the stored job.
      const { returnvalue } = await queue.getJob(job.id);
      expect(returnvalue.borrowingIds).toContain(borrowing.id);
      expect((await get(`/borrowings/${borrowing.id}`)).body.data.status).toBe('OVERDUE');
    } finally {
      await worker.close(true);
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close();
    }
  }, 30000);

  it('fails a job with no registered handler rather than dropping it', async () => {
    const queue = createQueue();
    const worker = createWorker();

    try {
      await worker.waitUntilReady();
      await queue.obliterate({ force: true }).catch(() => {});

      const job = await queue.add('no-such-job', {}, { attempts: 1 });
      await settles(job, 'failed');

      // Failed, not silently dropped: the reason is stored on the job.
      const { failedReason } = await queue.getJob(job.id);
      expect(failedReason).toMatch(/No handler registered/);
    } finally {
      await worker.close(true);
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close();
    }
  }, 30000);

  it('does not start a worker when jobs are disabled', async () => {
    // The test environment disables them, so a suite run never leaves a worker
    // polling Redis after the file that started it finished.
    expect(config.jobs.enabled).toBe(false);
    expect(await startJobs({ config })).toBeNull();
    await expect(stopJobs(null)).resolves.toBeUndefined();
  });

  it('names the queue once, so producer and consumer cannot drift', () => {
    expect(QUEUE_NAME).toBe('asset-management');
  });
});

describe('borrowing overdue sweep (§14.3, REQ-BORROW-012)', () => {
  it('moves an ACTIVE borrowing past its expected return date to OVERDUE', async () => {
    const { borrowing } = await overdueBorrowing();

    const result = await runBorrowingOverdueSweep();

    expect(result.sweptCount).toBe(1);
    expect(result.borrowingIds).toEqual([borrowing.id]);
    expect((await models.Borrowing.findByPk(borrowing.id)).status).toBe('OVERDUE');
  });

  it('leaves borrowings that are not yet due alone', async () => {
    const asset = await createAsset();
    await post('/borrowings', {
      borrowerName: 'Budi',
      borrowerContact: '0812',
      borrowDate: isoDate(0),
      expectedReturnDate: isoDate(7),
      institutionId: institution.id,
    });
    expect(asset.id).toBeDefined();

    expect((await runBorrowingOverdueSweep()).sweptCount).toBe(0);
  });

  it('never touches DRAFT, RETURNED or CANCELLED records', async () => {
    const { borrowing } = await overdueBorrowing();
    await post(`/borrowings/${borrowing.id}/return`, { actualReturnDate: isoDate(-1) });

    // A DRAFT that is already past its date is still not overdue — nothing was
    // ever lent out.
    await post('/borrowings', {
      borrowerName: 'Siti',
      borrowerContact: '0813',
      borrowDate: isoDate(-30),
      expectedReturnDate: isoDate(-5),
      institutionId: institution.id,
    });

    expect((await runBorrowingOverdueSweep()).sweptCount).toBe(0);
    expect((await models.Borrowing.findByPk(borrowing.id)).status).toBe('RETURNED');
  });

  it('is idempotent — a second pass sweeps nothing', async () => {
    await overdueBorrowing();

    expect((await runBorrowingOverdueSweep()).sweptCount).toBe(1);
    expect((await runBorrowingOverdueSweep()).sweptCount).toBe(0);
  });

  it('preserves the borrowing’s dates and leaves its units out (REQ-BORROW-015)', async () => {
    const { borrowing, unit } = await overdueBorrowing();

    await runBorrowingOverdueSweep();

    const after = await models.Borrowing.findByPk(borrowing.id);
    expect(after.borrowDate).toBe(isoDate(-30));
    expect(after.expectedReturnDate).toBe(isoDate(-2));
    expect(after.actualReturnDate).toBeNull();
    // Still physically out — overdue is not returned.
    expect((await models.AssetUnit.findByPk(unit.id)).lifecycleState).toBe('BORROWED');
  });

  it('lets an OVERDUE borrowing still be returned (03-domain.md §7.2)', async () => {
    const { borrowing, unit } = await overdueBorrowing();
    await runBorrowingOverdueSweep();

    const response = await post(`/borrowings/${borrowing.id}/return`, {});

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('RETURNED');
    expect((await models.AssetUnit.findByPk(unit.id)).lifecycleState).toBe('ACTIVE');
  });

  it('records the change as a system STATUS_CHANGE (REQ-AUDIT-002)', async () => {
    const { borrowing } = await overdueBorrowing();
    await models.AuditLog.destroy({ where: {} });

    await runBorrowingOverdueSweep();

    const [entry] = await auditFor('Borrowing', borrowing.id);
    expect(entry.action).toBe('STATUS_CHANGE');
    // No request, so no user: NULL is "system" per 04-data-model.md §5.6.1.
    expect(entry.actorId).toBeNull();
    expect(entry.oldValues).toEqual({ status: 'ACTIVE' });
    expect(entry.newValues).toEqual({ status: 'OVERDUE' });
    expect(entry.metadata.job).toBe(JOB_NAME);
  });

  it('rolls back the whole sweep if its audit write fails', async () => {
    const { borrowing } = await overdueBorrowing();

    // `record` swallows its own failures by design, so an audit outage must not
    // block the sweep either.
    const original = models.AuditLog.create;
    models.AuditLog.create = async () => {
      throw new Error('simulated audit outage');
    };

    try {
      expect((await runBorrowingOverdueSweep()).sweptCount).toBe(1);
      expect((await models.Borrowing.findByPk(borrowing.id)).status).toBe('OVERDUE');
    } finally {
      models.AuditLog.create = original;
    }
  });
});

describe('audit logging (§14.4, REQ-AUDIT-001/002)', () => {
  it('records a CREATE with the actor, IP and new values', async () => {
    const asset = await createAsset();

    const [entry] = await auditFor('Asset', asset.id);

    expect(entry.action).toBe('CREATE');
    expect(entry.actorId).toBe(admin.user.id);
    expect(entry.entityType).toBe('Asset');
    expect(entry.entityId).toBe(asset.id);
    expect(entry.newValues.name).toBe('Audited Asset');
    expect(entry.ipAddress).not.toBeNull();
    expect(entry.metadata.requestId).toBeTruthy();
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it('records an UPDATE with only what changed, before and after', async () => {
    const asset = await createAsset();
    await patch(`/assets/${asset.id}`, { name: 'Renamed Asset' });

    const entries = await auditFor('Asset', asset.id);
    const update = entries.find((entry) => entry.action === 'UPDATE');

    expect(update.oldValues.name).toBe('Audited Asset');
    expect(update.newValues.name).toBe('Renamed Asset');
    // Untouched columns are absent — the row is a diff, not a snapshot.
    expect(update.newValues.classificationId).toBeUndefined();
  });

  it('distinguishes a status transition from an edit (audit_action)', async () => {
    const asset = await createAsset();
    await post(`/assets/${asset.id}/deactivate`, {});

    const entries = await auditFor('Asset', asset.id);
    const statusChange = entries.find((entry) => entry.action === 'STATUS_CHANGE');

    expect(statusChange).toBeDefined();
    expect(statusChange.oldValues).toEqual({ isActive: true });
    expect(statusChange.newValues).toEqual({ isActive: false });
  });

  it('records a DELETE with the values that were removed', async () => {
    const contract = (
      await post('/contracts', {
        contractNumber: `CTR-AUDIT-${Math.random().toString(36).slice(2, 7)}`,
        contractDate: isoDate(-10),
        institutionId: institution.id,
      })
    ).body.data;
    const item = (await post(`/contracts/${contract.id}/items`, { assetName: 'Laptop' })).body.data;

    await del(`/contract-items/${item.id}`);

    const entries = await auditFor('ContractItem', item.id);
    const removed = entries.find((entry) => entry.action === 'DELETE');

    expect(removed).toBeDefined();
    expect(removed.oldValues.assetName).toBe('Laptop');
    expect(removed.newValues).toBeNull();
  });

  it('audits the authorization model itself', async () => {
    const role = (await post('/roles', { name: `Auditor-${Date.now()}` })).body.data;

    const [entry] = await auditFor('Role', role.id);

    expect(entry.action).toBe('CREATE');
    expect(entry.actorId).toBe(admin.user.id);
  });

  it('never writes a password hash into the trail (REQ-NFR-SEC-001)', async () => {
    const user = (
      await post('/users', {
        username: `audited-${Math.random().toString(36).slice(2, 8)}`,
        password: 'a-perfectly-fine-password',
        firstName: 'Test',
        lastName: 'User',
      })
    ).body.data;

    const [entry] = await auditFor('User', user.id);

    expect(entry.newValues.passwordHash).toBe('[REDACTED]');
    expect(JSON.stringify(entry.newValues)).not.toContain('a-perfectly-fine-password');
  });

  it('uses composite keys for association tables', async () => {
    const role = (await post('/roles', { name: `Assignable-${Date.now()}` })).body.data;
    await post(`/users/${admin.user.id}/roles`, { roleId: role.id });

    const entries = await models.AuditLog.findAll({ where: { entityType: 'UserRole' } });

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.entityId === `${admin.user.id}:${role.id}`)).toBe(true);
  });

  it('leaves no audit trail behind a rolled-back operation', async () => {
    const before = await models.AuditLog.count();

    // Rejected by the leaf-classification rule, so nothing was created.
    await post('/assets', { name: 'Never Created', classificationId: '100000000000' });

    expect(await models.AuditLog.count()).toBe(before);
  });

  it('records a NULL actor outside a request (04-data-model.md §5.6.1)', async () => {
    await audit.record({
      action: 'CREATE',
      entityType: 'TestEntity',
      entityId: 'seed-run',
      newValues: { source: 'cli' },
    });

    const [entry] = await auditFor('TestEntity', 'seed-run');
    expect(entry.actorId).toBeNull();
    expect(entry.ipAddress).toBeNull();
  });

  it('attributes writes to the actor bound by the ambient context', async () => {
    await runWithAuditContext(
      { actorId: admin.user.id, ipAddress: '10.0.0.9', requestId: 'r-1' },
      () => audit.record({ action: 'UPDATE', entityType: 'TestEntity', entityId: 'ctx' })
    );

    const [entry] = await auditFor('TestEntity', 'ctx');
    expect(entry.actorId).toBe(admin.user.id);
    expect(entry.ipAddress).toBe('10.0.0.9');
    expect(entry.metadata.requestId).toBe('r-1');
  });

  it('excludes history tables that are already their own record', () => {
    for (const excluded of [
      'AuditLog',
      'LongitudinalHistory',
      'AssetUnitLocation',
      'Transaction',
    ]) {
      expect(AUDITED_MODELS).not.toContain(excluded);
    }

    // And covers the business entities it claims to.
    for (const audited of ['Asset', 'AssetUnit', 'Contract', 'Borrowing', 'User', 'Role']) {
      expect(AUDITED_MODELS).toContain(audited);
    }
  });

  it('never fails the business operation when the audit write fails', async () => {
    const original = models.AuditLog.create;
    models.AuditLog.create = async () => {
      throw new Error('simulated audit outage');
    };

    try {
      const response = await post('/assets', { name: 'Still Created', classificationId: LEAF });
      expect(response.status).toBe(201);
    } finally {
      models.AuditLog.create = original;
    }
  });
});

describe('audit immutability (§14.4, REQ-AUDIT-003, DR-015)', () => {
  it('exposes no HTTP route that could modify the trail', async () => {
    const asset = await createAsset();
    const [entry] = await auditFor('Asset', asset.id);

    // Phase 15 added the READ API (`06-api.md` §10, owned by `GAP-002`), so
    // these paths now resolve — but only for GET. No write verb exists on
    // either of them, which is what REQ-AUDIT-003 actually requires.
    for (const path of ['/audit-logs', `/audit-logs/${entry.id}`]) {
      expect((await del(path)).status).toBe(404);
      expect((await patch(path, { action: 'CREATE' })).status).toBe(404);
    }

    expect((await post('/audit-logs', { action: 'CREATE' })).status).toBe(404);
  });

  it('offers no update or delete anywhere in the audit service', () => {
    expect(Object.keys(audit)).toContain('record');
    for (const forbidden of ['update', 'remove', 'delete', 'destroy', 'purge']) {
      expect(audit[forbidden]).toBeUndefined();
    }
  });

  it('does not audit the audit trail, so it cannot grow by being read', async () => {
    await createAsset();
    const before = await models.AuditLog.count();

    await models.AuditLog.findAll({ limit: 5 });

    expect(await models.AuditLog.count()).toBe(before);
  });

  it('keeps the record after the entity it describes is gone (REQ-LIFE-006)', async () => {
    const contract = (
      await post('/contracts', {
        contractNumber: `CTR-GONE-${Math.random().toString(36).slice(2, 7)}`,
        contractDate: isoDate(-10),
        institutionId: institution.id,
      })
    ).body.data;
    const item = (await post(`/contracts/${contract.id}/items`, { assetName: 'Gone' })).body.data;
    await del(`/contract-items/${item.id}`);

    expect(await models.ContractItem.findByPk(item.id)).toBeNull();
    expect((await auditFor('ContractItem', item.id)).length).toBeGreaterThan(0);
  });
});

describe('file storage (§14.5, 05-infrastructure.md §5)', () => {
  const pngFile = (name = 'plan.png') => ({
    originalname: name,
    mimetype: 'image/png',
    buffer: Buffer.from('fake-png-bytes'),
  });

  it('stores under the documented layout and reads back', async () => {
    const asset = await createAsset();
    const stored = await storage.store(pngFile(), { shard: asset.id });

    try {
      expect(stored.storageReference.startsWith(`${asset.id}/`)).toBe(true);
      expect(stored.fileName).toBe('plan.png');
      expect(await storage.read(stored.storageReference)).toEqual(Buffer.from('fake-png-bytes'));
    } finally {
      await storage.remove(stored.storageReference);
    }
  });

  it('refuses to escape the storage root', async () => {
    await expect(storage.read('../../../etc/passwd')).rejects.toThrow();
    // A traversal in the file name is stripped rather than honoured.
    const stored = await storage.store(pngFile('../../evil.png'), { shard: 'shard' });
    expect(stored.fileName).not.toContain('..');
    await storage.remove(stored.storageReference);
  });

  it('rejects a type outside the allow-list (REQ-FILE-004)', () => {
    expect(() =>
      storage.assertAllowedType({ originalname: 'shell.sh', mimetype: 'application/x-sh' })
    ).toThrow();
    expect(() => storage.assertAllowedType(pngFile())).not.toThrow();
  });

  it('treats a missing file as already deleted rather than an error', async () => {
    expect(await storage.remove('does-not-exist/nothing.png')).toBe(false);
  });

  it('leaves no orphaned file when the database write fails', async () => {
    const asset = await createAsset();
    const original = models.Attachment.create;
    models.Attachment.create = async () => {
      throw new Error('simulated insert failure');
    };

    try {
      const response = await api()
        .post(`${V1}/assets/${asset.id}/attachments`)
        .set(...admin.auth)
        .attach('file', Buffer.from('fake-png-bytes'), 'orphan.png');

      expect(response.status).toBe(500);
      expect(await models.Attachment.count({ where: { assetId: asset.id } })).toBe(0);

      // The compensating delete ran, so nothing was left behind for a sweep.
      const { readdir } = await import('node:fs/promises');
      const shard = `${storage.storageRoot()}/${asset.id}`;
      const files = await readdir(shard).catch(() => []);
      expect(files).toHaveLength(0);
    } finally {
      models.Attachment.create = original;
    }
  });

  it('authorizes downloads through the owning asset (REQ-FILE-005)', async () => {
    const asset = await createAsset();
    const uploaded = await api()
      .post(`${V1}/assets/${asset.id}/attachments`)
      .set(...admin.auth)
      .attach('file', Buffer.from('fake-png-bytes'), 'doc.png');

    expect(uploaded.status).toBe(201);
    expect((await get(`/attachments/${uploaded.body.data.id}`)).status).toBe(200);
    expect((await api().get(`${V1}/attachments/${uploaded.body.data.id}`)).status).toBe(401);
  });
});
