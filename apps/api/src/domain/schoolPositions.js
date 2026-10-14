'use strict';

/**
 * The school positions — Phase 35 (`CR-014` §4), REQ-POS-001.
 *
 * THE AUTHORITATIVE LIST. Migration 049 writes the same codes into
 * `chk_pos_assign_position`, frozen as migrations must be, and
 * `tests/database/29-position-assignments.test.js` fails if the two ever
 * disagree (`CR-014` `DEC-U`). Adding a position is therefore a reviewed
 * migration plus an edit here — never something an administrator does
 * (`DEC-C`): workflow rules name positions, so an unknown one must not exist.
 *
 * ── The two teacher codes ──────────────────────────────────────────────────
 *
 * `COMMON_TEACHER` and `JURUSAN_TEACHER` are not two jobs. They encode ONE
 * concept — a teacher, either without a Jurusan or for Jurusan X — as two
 * request contexts, so that workflow selection stays an exact match on the code
 * (`CR-014` §4.2). A user may hold `COMMON_TEACHER` once and `JURUSAN_TEACHER`
 * once per department at the same time: one teacher, several capacities.
 *
 * `SARPRAS_STAFF` is absent until `CR-014` Q4 is answered.
 */

/** @typedef {'REQUIRED' | 'NONE'} DepartmentRule */
/** @typedef {'ONE_PER_INSTITUTION' | 'ONE_PER_DEPARTMENT' | 'MANY'} HolderLimit */

/**
 * @type {ReadonlyArray<{code: string, department: DepartmentRule, holders: HolderLimit,
 *   requestContext: boolean}>}
 */
const SCHOOL_POSITIONS = Object.freeze(
  [
    { code: 'COMMON_TEACHER', department: 'NONE', holders: 'MANY', requestContext: true },
    { code: 'JURUSAN_TEACHER', department: 'REQUIRED', holders: 'MANY', requestContext: true },
    {
      code: 'TOOLMAN',
      department: 'REQUIRED',
      holders: 'ONE_PER_DEPARTMENT',
      requestContext: false,
    },
    { code: 'KAJUR', department: 'REQUIRED', holders: 'ONE_PER_DEPARTMENT', requestContext: false },
    {
      code: 'WAKASEK_SARPRAS',
      department: 'NONE',
      holders: 'ONE_PER_INSTITUTION',
      requestContext: false,
    },
    {
      code: 'WAKASEK_KURIKULUM',
      department: 'NONE',
      holders: 'ONE_PER_INSTITUTION',
      requestContext: false,
    },
    {
      code: 'WAKASEK_KESISWAAN',
      department: 'NONE',
      holders: 'ONE_PER_INSTITUTION',
      requestContext: false,
    },
    {
      code: 'KEPALA_SEKOLAH',
      department: 'NONE',
      holders: 'ONE_PER_INSTITUTION',
      requestContext: false,
    },
  ].map((position) => Object.freeze(position))
);

const POSITION_CODES = Object.freeze(SCHOOL_POSITIONS.map((position) => position.code));

const BY_CODE = new Map(SCHOOL_POSITIONS.map((position) => [position.code, position]));

function positionOf(code) {
  return BY_CODE.get(code) ?? null;
}

function isKnownPosition(code) {
  return BY_CODE.has(code);
}

/** Whether the position is held FOR a department (and must name one). */
function requiresDepartment(code) {
  return positionOf(code)?.department === 'REQUIRED';
}

/**
 * The two teacher codes (above) — one teacher, in either capacity. The Teacher
 * Storage Room default (REQ-REQUEST-023) is offered in these contexts only.
 */
const TEACHER_POSITION_CODES = Object.freeze(['COMMON_TEACHER', 'JURUSAN_TEACHER']);

function isTeacherPosition(code) {
  return TEACHER_POSITION_CODES.includes(code);
}

/** Whether at most one person may hold it at a time within its scope. */
function isSingleHolder(code) {
  const holders = positionOf(code)?.holders;
  return holders === 'ONE_PER_INSTITUTION' || holders === 'ONE_PER_DEPARTMENT';
}

module.exports = {
  SCHOOL_POSITIONS,
  POSITION_CODES,
  positionOf,
  isKnownPosition,
  requiresDepartment,
  isSingleHolder,
  TEACHER_POSITION_CODES,
  isTeacherPosition,
};
