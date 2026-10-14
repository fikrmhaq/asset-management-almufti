'use strict';

/**
 * Department-bound operating scope — P3 (`IMPLEMENTATION_PLAN.md` §64.3), a new
 * decision recorded in `CR-014` (`DEC-DS`).
 *
 * A KAJUR or a TOOLMAN operates the assets of their own Jurusan. Their Asset
 * Unit reach is narrowed to the departments of those posts; an Asset is within
 * reach when at least one of its units is. That narrowing is applied by the
 * existing scope layer (`domain/scope.js`) exactly where PIC scope already
 * narrows Asset Units — this module only decides WHICH departments, if any.
 *
 * ── Positions, not roles; neither generic auth nor PIC ───────────────────
 *
 * Roles still decide WHAT a user may do; this decides only WHERE. It is read
 * from CURRENT position assignments on every request, so ending a Kajur post
 * takes effect on the next call, not at the next sign-in. `resolvePrincipal` is
 * untouched, and a PIC-scoped user is left to PIC scope (they cannot reach the
 * request module at all, and their narrowing already exists).
 *
 * ── Which context: the existing acting-position model ────────────────────
 *
 * The application has an explicit acting context only inside a request: the
 * requester context chosen at creation, and the step's resolved actor
 * (`actorAssignmentFor`, recorded as `actedAs`). Request registration therefore
 * decides by the REGISTER step's position (`requestRegistration.js`), whatever
 * else the user holds.
 *
 * Ordinary Asset screens have no such context, so the positions a user holds
 * are classified:
 *
 *   DEPARTMENT OPERATOR    KAJUR, TOOLMAN — narrow to their departments
 *   INSTITUTION OPERATOR   WAKASEK_SARPRAS, KEPALA_SEKOLAH — operate the whole
 *                          institution's assets; holding one keeps institution
 *                          scope on these screens
 *   NEUTRAL                COMMON_TEACHER, JURUSAN_TEACHER, WAKASEK_KURIKULUM,
 *                          WAKASEK_KESISWAAN — requester or decision posts; they
 *                          neither narrow nor widen anything
 *
 * So a Kajur who also teaches stays narrowed, and a teacher with no operator
 * post is unchanged. Only an institution-level asset operator is not narrowed.
 * A system-wide principal is never narrowed.
 */

const { InternalError } = require('../errors');
const { organizationScope } = require('../auth/principal');

const DEPARTMENT_OPERATOR_POSITIONS = Object.freeze(['KAJUR', 'TOOLMAN']);
const INSTITUTION_OPERATOR_POSITIONS = Object.freeze(['WAKASEK_SARPRAS', 'KEPALA_SEKOLAH']);

/** principal → Set of department ids | null. One lookup per HTTP request. */
const loaded = new WeakMap();

/**
 * The departments a caller's positions narrow them to, from the assignments
 * held NOW, or `null` for no narrowing.
 *
 * @returns {Promise<Set<string>|null>}
 */
async function resolveOperatingDepartments(principal, { models }) {
  const scope = organizationScope(principal);
  if (!principal?.userId || scope.unrestricted || scope.picScoped) return null;

  const held = await models.PositionAssignment.findAll({
    attributes: ['positionCode', 'departmentId'],
    where: {
      userId: principal.userId,
      isCurrent: true,
      ...(scope.institutionId ? { institutionId: scope.institutionId } : {}),
    },
  });

  if (held.some((row) => INSTITUTION_OPERATOR_POSITIONS.includes(row.positionCode))) return null;

  const departments = new Set(
    held
      .filter((row) => DEPARTMENT_OPERATOR_POSITIONS.includes(row.positionCode) && row.departmentId)
      .map((row) => row.departmentId)
  );
  return departments.size > 0 ? departments : null;
}

/** Loads and remembers the caller's operating scope for this request. */
async function loadOperatingScope(principal, { models }) {
  if (!principal) return null;
  if (loaded.has(principal)) return loaded.get(principal);
  const departments = await resolveOperatingDepartments(principal, { models });
  loaded.set(principal, departments);
  return departments;
}

/**
 * The loaded scope. FAILS CLOSED: a caller the scope was never loaded for is an
 * error, never "unrestricted" — a path that skipped the middleware must not
 * quietly see every department. System-wide and PIC principals need no load.
 *
 * @returns {Set<string>|null}
 */
function operatingDepartments(principal) {
  const scope = organizationScope(principal);
  if (scope.unrestricted || scope.picScoped) return null;
  if (!loaded.has(principal)) {
    throw new InternalError('The operating scope was not loaded for this request');
  }
  return loaded.get(principal);
}

module.exports = {
  DEPARTMENT_OPERATOR_POSITIONS,
  INSTITUTION_OPERATOR_POSITIONS,
  resolveOperatingDepartments,
  loadOperatingScope,
  operatingDepartments,
};
