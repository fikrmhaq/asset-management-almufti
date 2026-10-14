/**
 * The fixed lists the workflow screens are built from — Phase 36 (`CR-014`).
 *
 * Client copies of the API's constants (`domain/requestCategories.js`,
 * `domain/schoolPositions.js`, `domain/workflowShape.js`), by decision D5: the
 * lists are closed and change only with a reviewed migration, so a fixed copy
 * plus i18n is simpler than an endpoint. The server validates every value
 * regardless; a stale copy here could only offer less, never permit more.
 */

export const REQUEST_CATEGORIES = Object.freeze(['COMMON', 'JURUSAN', 'KBM', 'EKSKUL']);

/** The requester contexts a definition can be keyed on — every school position. */
export const POSITION_CODES = Object.freeze([
  'COMMON_TEACHER',
  'JURUSAN_TEACHER',
  'TOOLMAN',
  'KAJUR',
  'WAKASEK_SARPRAS',
  'WAKASEK_KURIKULUM',
  'WAKASEK_KESISWAAN',
  'KEPALA_SEKOLAH',
]);

/** Resolved within the request's department at run time (`CR-014` §6.2). */
export const DEPARTMENT_BOUND = Object.freeze(new Set(['JURUSAN_TEACHER', 'TOOLMAN', 'KAJUR']));

export const STEP_TYPES = Object.freeze(['DECIDE', 'PROCURE', 'REGISTER']);

export const PROCUREMENT_MODES = Object.freeze(['INTERNAL', 'EXTERNAL']);

export const MAX_STEPS = 20;

/** Status badge tone — a published version is the one in force. */
export const STATUS_VARIANT = Object.freeze({
  DRAFT: 'warning',
  ACTIVE: 'success',
  RETIRED: 'neutral',
});

/** The step-list field a server `details[].field` names, e.g. `body.steps.2.actorPositionCode`. */
export function stepIssueTarget(field) {
  const match = /^(?:body\.)?steps\.(\d+)(?:\.(\w+))?$/.exec(field ?? '');
  return match ? { index: Number(match[1]), name: match[2] ?? null } : null;
}
