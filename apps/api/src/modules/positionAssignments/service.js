'use strict';

/**
 * School position endpoints — Phase 35 (`CR-014`), `06-api.md` §12.1.
 *
 * Every path that names a user or a department loads it through that module's
 * own scoped `getById`, so a record outside the caller's institution answers
 * `404` exactly as it does everywhere else (`06-api.md` §1.4). The rules
 * themselves are in `domain/positionAssignments.js`.
 */

const { getModels } = require('../../db/models');
const positions = require('../../domain/positionAssignments');
const { SCHOOL_POSITIONS } = require('../../domain/schoolPositions');
const usersService = require('../users/service');
const departmentsService = require('../departments/service');

/** The fixed list, with each position's department rule and holder limit. */
function listPositions() {
  return SCHOOL_POSITIONS.map((position) => ({ ...position }));
}

async function listForUser(userId, query, principal, { models = getModels() } = {}) {
  const user = await usersService.getById(userId, principal, { models });
  return positions.listFor({ userId: user.id }, { current: query.current, models });
}

async function assignToUser(userId, body, principal, { models = getModels() } = {}) {
  const user = await usersService.getById(userId, principal, { models });
  return positions.assign(user, body, principal, { models });
}

async function end(id, principal, options = {}) {
  return positions.end(id, principal, options);
}

async function listForDepartment(departmentId, query, principal, { models = getModels() } = {}) {
  const department = await departmentsService.getById(departmentId, principal, { models });
  return positions.listFor({ departmentId: department.id }, { current: query.current, models });
}

module.exports = { listPositions, listForUser, assignToUser, end, listForDepartment };
