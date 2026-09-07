'use strict';

/**
 * Department domain rules — Phase 20 (`CR-003`), REQ-ORG-004, `BR-007`.
 *
 * One rule, applied at every path that can write `asset_units.department_id`.
 * Before this module there were two identically-named `assertDepartmentExists`
 * helpers — one in `modules/assetUnits/service.js`, one in
 * `modules/contractItems/service.js` — which checked only that the row existed.
 * Two copies of a rule is two places for it to be wrong, and both were missing
 * the institution check this phase exists to add.
 *
 * The rule is a DATA-CONSISTENCY rule, not an access rule. It is judged against
 * the asset's own institution rather than the caller's scope, so it holds even
 * for a system-wide caller who can legitimately reach both institutions: a unit
 * of an Institution A asset must not carry an Institution B department no matter
 * who is asking.
 *
 * Caller scope is enforced separately and earlier — `assetService.getById` and
 * `assetUnits/service.js getById` both run `assertCanAccess` before any body is
 * validated.
 */

const { getModels } = require('../db/models');
const { ValidationError } = require('../errors');

/**
 * Whether a department may be attached to a unit of `asset`.
 *
 * `null`/`undefined` is always accepted: an asset unit with no department has
 * not been assigned to one yet (REQ-ORG-004 — the association is optional), and
 * clearing it is a legitimate edit.
 *
 * @param {string|null|undefined} departmentId
 * @param {{institutionId: string|null}} asset the unit's parent asset
 * @throws {ValidationError}
 */
async function assertDepartmentAssignable(departmentId, asset, { models = getModels() } = {}) {
  if (!departmentId) return;

  const department = await models.Department.findByPk(departmentId);

  if (!department) {
    throw new ValidationError('The department does not exist', [
      { field: 'departmentId', issue: 'must reference an existing department' },
    ]);
  }

  if (!department.isActive) {
    throw new ValidationError('That department has been deactivated', [
      { field: 'departmentId', issue: 'must not reference a deactivated department' },
    ]);
  }

  /**
   * Both sides must be known before they can be compared.
   *
   * `NULL = NULL` is two absences, not a match. An unassigned department
   * (`institution_id IS NULL`, `CR-003` §4.3) and an asset with no institution
   * would otherwise satisfy the equality below and pass — which is exactly the
   * case that must not pass, since neither has an organizational owner to agree
   * about. An institution-less asset has no inventory code either
   * (REQ-UNIT-007), so refusing here is consistent with how the rest of the
   * model treats that state.
   */
  if (!department.institutionId || !asset.institutionId) {
    throw new ValidationError('Both the department and the asset must belong to an institution', [
      {
        field: 'departmentId',
        issue: department.institutionId
          ? 'the asset has no owning institution, so it cannot take a department (REQ-ORG-005)'
          : 'that department is not assigned to an institution yet (REQ-ORG-004)',
      },
    ]);
  }

  if (department.institutionId !== asset.institutionId) {
    throw new ValidationError('That department belongs to a different institution', [
      {
        field: 'departmentId',
        issue: "must belong to the same institution as the unit's asset (BR-007)",
      },
    ]);
  }
}

module.exports = { assertDepartmentAssignable };
