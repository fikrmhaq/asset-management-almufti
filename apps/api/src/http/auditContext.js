'use strict';

/**
 * Ambient request context for audit logging — `IMPLEMENTATION_PLAN.md` §14.4,
 * REQ-AUDIT-002.
 *
 * `audit.audit_logs` wants the actor and the client IP on every row
 * (`04-data-model.md` §5.6.1). Neither is available where the audit rows are
 * actually written — Sequelize model hooks, which see the record and nothing
 * about the request that caused the change.
 *
 * Threading a context argument through every service and every model call would
 * touch all of Phases 4–7 and would silently lose the actor wherever somebody
 * forgot. `AsyncLocalStorage` carries it instead: the value is bound once per
 * request and is visible to everything that request awaits, however deep.
 *
 * Outside a request — a seeder, the bootstrap CLI, a background job — the store
 * is simply empty and the actor is recorded as `NULL`, which the data model
 * defines as "system".
 */

const { AsyncLocalStorage } = require('node:async_hooks');

/** @typedef {{actorId: string|null, ipAddress: string|null, requestId: string|null}} AuditContext */

const storage = new AsyncLocalStorage();

/** Runs `work` with `context` visible to everything it awaits. */
function runWithAuditContext(context, work) {
  return storage.run(Object.freeze({ ...context }), work);
}

/** @returns {AuditContext} an empty context outside a request, never undefined */
function getAuditContext() {
  return storage.getStore() ?? { actorId: null, ipAddress: null, requestId: null };
}

/**
 * Sets the actor once authentication has resolved it.
 *
 * The context is established before `authenticate` runs — a failed login still
 * has an IP worth recording — so the actor is filled in afterwards rather than
 * at creation. Mutating the frozen object is not possible, so the store is
 * re-entered with the actor added.
 */
function setAuditActor(actorId) {
  const current = storage.getStore();
  if (!current) return;
  storage.enterWith(Object.freeze({ ...current, actorId }));
}

/**
 * Binds an audit context to every request — `05-infrastructure.md` §8.1.
 *
 * @returns {import('express').RequestHandler}
 */
function auditContext() {
  return function bindAuditContext(req, res, next) {
    runWithAuditContext(
      { actorId: null, ipAddress: req.ip ?? null, requestId: req.id ?? null },
      () => next()
    );
  };
}

module.exports = { auditContext, runWithAuditContext, getAuditContext, setAuditActor };
