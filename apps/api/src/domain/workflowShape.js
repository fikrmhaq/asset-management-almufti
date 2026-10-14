'use strict';

/**
 * Workflow definition rules that need no database — Phase 36 (`CR-014` §6),
 * REQ-WF-001 – REQ-WF-004, REQ-WF-006, `BR-026`, `BR-030`.
 *
 * Kept pure so the same rules answer three callers identically: publication
 * (which refuses), the definition detail (which reports what publication would
 * refuse, for the editor), and the unit tests.
 *
 * ── What a definition may express ─────────────────────────────────────────
 *
 *     DECIDE × n (n ≥ 0)  →  at most one PROCURE  →  exactly one REGISTER
 *
 * Each step names ONE actor position. No condition, branch, loop, expression or
 * fallback exists anywhere in the model (`BR-026`), and none can be written: the
 * step schema has no field that could hold one.
 *
 * ── What this module deliberately does NOT do ─────────────────────────────
 *
 * It never resolves a position to a person. Whether a position is held, by
 * whom, and what happens when it is vacant is execution (Phase 38). Here a
 * position is a code, and the only question asked of it is whether it is bound
 * to a department.
 */

const { POSITION_CODES, requiresDepartment } = require('./schoolPositions');
const { REQUEST_CATEGORIES, DEPARTMENT_CATEGORY } = require('./requestCategories');
const { eligibleCategoriesFor, isEligibleCategory } = require('./requestGuidance');

const STEP_TYPES = Object.freeze(['DECIDE', 'PROCURE', 'REGISTER']);
const PROCUREMENT_MODES = Object.freeze(['INTERNAL', 'EXTERNAL']);
const DEFINITION_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'RETIRED']);

/** Enough for any real approval chain; bounds a PUT body, nothing more. */
const MAX_STEPS = 20;

/**
 * The confirmed flows (`CR-014` §6.5) — and only those.
 *
 * `actorPositionCode: null` marks an actor the school has NOT decided. Each
 * carries the open question that decides it, so the editor can say why the
 * field is empty rather than leave it looking forgotten:
 *
 *   Q4  who the Sarpras actor is — the Wakasek Sarpras alone, or Sarpras staff;
 *   Q3  who acquires and registers for a Jurusan.
 *
 * Nothing here guesses an answer. A template with an undecided actor becomes a
 * DRAFT that cannot be published until an administrator chooses one (Phase 36
 * decision D1). Templates are never seeded; they exist only when an
 * administrator asks for one (`CR-014` §6.5).
 *
 * `skipIfRequesterIsActor` is false everywhere (`DEC-I`, Q7).
 */
const decide = (actorPositionCode) => ({
  stepType: 'DECIDE',
  actorPositionCode,
  procurementMode: null,
  skipIfRequesterIsActor: false,
});

const procure = (procurementMode, unresolvedQuestion) => ({
  stepType: 'PROCURE',
  actorPositionCode: null,
  procurementMode,
  skipIfRequesterIsActor: false,
  unresolvedQuestion,
});

const register = (unresolvedQuestion) => ({
  stepType: 'REGISTER',
  actorPositionCode: null,
  procurementMode: null,
  skipIfRequesterIsActor: false,
  unresolvedQuestion,
});

const WORKFLOW_TEMPLATES = Object.freeze(
  [
    {
      key: 'COMMON_COMMON_TEACHER',
      category: 'COMMON',
      requesterPositionCode: 'COMMON_TEACHER',
      steps: [
        decide('WAKASEK_SARPRAS'),
        decide('KEPALA_SEKOLAH'),
        procure('INTERNAL', 'Q4'),
        register('Q4'),
      ],
    },
    {
      // Distribution to the Jurusan is the registered units' location and
      // department, set through the existing history mechanism — not a step.
      key: 'COMMON_JURUSAN_TEACHER',
      category: 'COMMON',
      requesterPositionCode: 'JURUSAN_TEACHER',
      steps: [
        decide('KAJUR'),
        decide('WAKASEK_SARPRAS'),
        decide('KEPALA_SEKOLAH'),
        procure('INTERNAL', 'Q4'),
        register('Q4'),
      ],
    },
    {
      key: 'KBM_COMMON_TEACHER',
      category: 'KBM',
      requesterPositionCode: 'COMMON_TEACHER',
      steps: [
        decide('WAKASEK_KURIKULUM'),
        decide('KEPALA_SEKOLAH'),
        decide('WAKASEK_SARPRAS'),
        procure('INTERNAL', 'Q4'),
        register('Q4'),
      ],
    },
    {
      key: 'EKSKUL_COMMON_TEACHER',
      category: 'EKSKUL',
      requesterPositionCode: 'COMMON_TEACHER',
      steps: [
        decide('WAKASEK_KESISWAAN'),
        decide('KEPALA_SEKOLAH'),
        decide('WAKASEK_SARPRAS'),
        procure('INTERNAL', 'Q4'),
        register('Q4'),
      ],
    },
    {
      // External acquisition by the Jurusan, presented as "Acquisition
      // completed". No Sarpras step: Sarpras seeing the registered units is the
      // visibility the school described.
      key: 'JURUSAN_KAJUR',
      category: 'JURUSAN',
      requesterPositionCode: 'KAJUR',
      steps: [decide('KEPALA_SEKOLAH'), procure('EXTERNAL', 'Q3'), register('Q3')],
    },
  ].map((template) =>
    Object.freeze({
      ...template,
      steps: Object.freeze(
        template.steps.map((step, index) => Object.freeze({ sequence: index + 1, ...step }))
      ),
    })
  )
);

const TEMPLATES_BY_KEY = new Map(WORKFLOW_TEMPLATES.map((template) => [template.key, template]));

function templateOf(key) {
  return TEMPLATES_BY_KEY.get(key) ?? null;
}

/**
 * Whether every Request selecting a definition for this key must carry a
 * department — the only condition under which a department-bound actor can be
 * resolved at run time (REQ-WF-004, `CR-014` §6.3).
 */
/**
 * The category a requester position may never request (`requestGuidance.js`
 * `ELIGIBLE_CATEGORIES`), as a configuration issue on `category` — or `null`.
 * Only for known values: an unknown category or position has its own issue.
 */
function categoryEligibilityIssue({ category, requesterPositionCode }) {
  if (!REQUEST_CATEGORIES.includes(category)) return null;
  if (!POSITION_CODES.includes(requesterPositionCode)) return null;
  if (isEligibleCategory(requesterPositionCode, category)) return null;
  return {
    field: 'category',
    issue:
      `a request made as ${requesterPositionCode} may be one of ` +
      `${eligibleCategoriesFor(requesterPositionCode).join(', ')}; ${category} is not among ` +
      'them, so no request could ever use this process',
  };
}

function keyGuaranteesDepartment(category, requesterPositionCode) {
  return category === DEPARTMENT_CATEGORY || requiresDepartment(requesterPositionCode);
}

/**
 * Everything publication would refuse, one entry per problem, each naming the
 * step it concerns. An empty list means the definition may be published.
 *
 * `field` follows the `details[].field` convention of `06-api.md` §1.4, as
 * `steps.<i>.actorPositionCode` with `i` the zero-based index — the same path a
 * request-validation error on the step PUT carries — so the editor can put each
 * message against the control it concerns.
 *
 * @param {{category: string, requesterPositionCode: string}} key
 * @param {Array<{sequence: number, stepType: string, actorPositionCode: string|null,
 *   procurementMode: string|null}>} steps ordered by sequence
 * @returns {{field: string, issue: string}[]}
 */
function publicationIssues(key, steps) {
  const issues = [];
  const at = (index, name) => `steps.${index}${name ? `.${name}` : ''}`;

  if (!REQUEST_CATEGORIES.includes(key.category)) {
    issues.push({ field: 'category', issue: 'must be one of the request categories' });
  }
  if (!POSITION_CODES.includes(key.requesterPositionCode)) {
    issues.push({
      field: 'requesterPositionCode',
      issue: 'must be one of the school positions',
    });
  }
  // P2 (§64.2): the request-category eligibility map is the one source — a
  // process for a request nobody may make is refused, not left unused.
  const eligibility = categoryEligibilityIssue(key);
  if (eligibility) issues.push(eligibility);

  if (steps.length === 0) {
    issues.push({ field: 'steps', issue: 'a definition needs at least a REGISTER step' });
    return issues;
  }

  // Contiguous from 1. The step PUT already guarantees this; checked again
  // because publication is the gate every running Request depends on.
  steps.forEach((step, index) => {
    if (step.sequence !== index + 1) {
      issues.push({
        field: at(index, 'sequence'),
        issue: `must be ${index + 1}: steps are numbered from 1 with no gaps`,
      });
    }
  });

  // --- Shape: DECIDE*, PROCURE?, REGISTER --------------------------------
  const registers = steps.filter((step) => step.stepType === 'REGISTER').length;
  const procures = steps.filter((step) => step.stepType === 'PROCURE').length;

  if (registers === 0) {
    issues.push({
      field: 'steps',
      issue: 'exactly one REGISTER step is required, and none exists',
    });
  }

  const last = steps.length - 1;
  let seenProcure = false;

  steps.forEach((step, index) => {
    switch (step.stepType) {
      case 'DECIDE':
        if (seenProcure) {
          issues.push({
            field: at(index, 'stepType'),
            issue: 'a DECIDE step must come before the PROCURE step',
          });
        }
        if (index === last) {
          issues.push({
            field: at(index, 'stepType'),
            issue: 'the last step must be REGISTER',
          });
        }
        break;
      case 'PROCURE':
        if (seenProcure) {
          issues.push({
            field: at(index, 'stepType'),
            issue: `at most one PROCURE step is allowed; this definition has ${procures}`,
          });
        }
        seenProcure = true;
        if (index === last) {
          issues.push({ field: at(index, 'stepType'), issue: 'the last step must be REGISTER' });
        }
        if (!PROCUREMENT_MODES.includes(step.procurementMode)) {
          issues.push({
            field: at(index, 'procurementMode'),
            issue: 'a PROCURE step must be INTERNAL or EXTERNAL',
          });
        }
        break;
      case 'REGISTER':
        if (index !== last) {
          issues.push({
            field: at(index, 'stepType'),
            issue:
              registers > 1
                ? `exactly one REGISTER step is allowed; this definition has ${registers}`
                : 'REGISTER must be the last step',
          });
        }
        break;
      default:
        issues.push({ field: at(index, 'stepType'), issue: 'must be DECIDE, PROCURE or REGISTER' });
    }

    if (
      step.stepType !== 'PROCURE' &&
      step.procurementMode !== null &&
      step.procurementMode !== undefined
    ) {
      issues.push({
        field: at(index, 'procurementMode'),
        issue: 'only a PROCURE step has a procurement mode',
      });
    }

    // --- Actor: exactly one concrete position (Phase 36 decision D1) -------
    if (step.actorPositionCode === null || step.actorPositionCode === undefined) {
      issues.push({
        field: at(index, 'actorPositionCode'),
        issue: 'an actor position must be chosen before publishing',
      });
    } else if (!POSITION_CODES.includes(step.actorPositionCode)) {
      issues.push({
        field: at(index, 'actorPositionCode'),
        issue: 'must be one of the school positions',
      });
    } else if (
      requiresDepartment(step.actorPositionCode) &&
      !keyGuaranteesDepartment(key.category, key.requesterPositionCode)
    ) {
      // REQ-WF-004. A definition rule only: nothing here asks who holds the
      // position. It guarantees that when Phase 38 does ask, there is always a
      // department to ask within — so nothing ever has to be skipped (BR-030).
      issues.push({
        field: at(index, 'actorPositionCode'),
        issue:
          `${step.actorPositionCode} is held for a department, but a ${key.category} ` +
          `request from ${key.requesterPositionCode} need not have one (REQ-WF-004)`,
      });
    }
  });

  return issues;
}

module.exports = {
  STEP_TYPES,
  PROCUREMENT_MODES,
  DEFINITION_STATUSES,
  MAX_STEPS,
  WORKFLOW_TEMPLATES,
  templateOf,
  keyGuaranteesDepartment,
  categoryEligibilityIssue,
  publicationIssues,
};
