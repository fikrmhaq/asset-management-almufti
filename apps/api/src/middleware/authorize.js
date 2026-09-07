'use strict';

/**
 * Permission middleware — `IMPLEMENTATION_PLAN.md` §9.3, REQ-AUTHZ-002/003,
 * REQ-ROLE-004.
 *
 * `requirePermission('asset:create')` guards a route. The code is checked
 * against the generated catalog at construction time, not at request time, so a
 * typo fails when the router is built rather than silently guarding nothing —
 * that is what keeps routes and `ref.permissions` in step (`06-api.md` §1.3).
 */

const { UnauthorizedError, ForbiddenError } = require('../errors');
const { hasPermission } = require('../auth/principal');
const { isKnownPermission } = require('../auth/permissionCatalog');

/**
 * @param {string} code a `{resource}:{action}` code from the catalog
 * @returns {import('express').RequestHandler}
 * @throws {Error} at construction when the code is not in the catalog
 */
function requirePermission(code) {
  if (!isKnownPermission(code)) {
    throw new Error(
      `Unknown permission "${code}". Add the resource or action to ` +
        'src/auth/permissionCatalog.js — permission codes are generated, not ad hoc.'
    );
  }

  return function checkPermission(req, res, next) {
    // Ordering matters: an unauthenticated caller is 401, not 403. Reporting
    // 403 would confirm the resource exists to someone who never identified
    // themselves.
    if (!req.principal) return next(new UnauthorizedError('Authentication is required'));

    if (!hasPermission(req.principal, code)) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }

    return next();
  };
}

/** Passes when the caller holds ANY of the given permissions. */
function requireAnyPermission(...codes) {
  const guards = codes.map((code) => {
    if (!isKnownPermission(code)) throw new Error(`Unknown permission "${code}".`);
    return code;
  });

  return function checkAnyPermission(req, res, next) {
    if (!req.principal) return next(new UnauthorizedError('Authentication is required'));

    if (!guards.some((code) => hasPermission(req.principal, code))) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }

    return next();
  };
}

module.exports = { requirePermission, requireAnyPermission };
