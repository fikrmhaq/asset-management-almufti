'use strict';

/**
 * Loads the caller's department-bound operating scope once per request — P3
 * (`IMPLEMENTATION_PLAN.md` §64.3). Mounted directly after `authenticate` on
 * every protected route, so the scope layer (`domain/scope.js`) can apply it
 * synchronously wherever it already applies PIC scope, and can refuse — rather
 * than widen — if it was ever not loaded (`operatingDepartments`).
 *
 * Authentication is not changed: the principal is what `resolvePrincipal`
 * produced; this only reads current position assignments beside it.
 */

const { getModels } = require('../db/models');
const { loadOperatingScope } = require('../domain/operatingScope');

function operatingScope({ models } = {}) {
  return async function loadScope(req, res, next) {
    try {
      await loadOperatingScope(req.principal, { models: models ?? getModels() });
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { operatingScope };
