import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  STEP_TYPES,
  PROCUREMENT_MODES,
  DEFINITION_STATUSES,
  WORKFLOW_TEMPLATES,
  templateOf,
  keyGuaranteesDepartment,
  publicationIssues,
} = require('../src/domain/workflowShape.js');
const { REQUEST_CATEGORIES } = require('../src/domain/requestCategories.js');
const { POSITION_CODES } = require('../src/domain/schoolPositions.js');
const {
  getCatalog,
  PIC_ALLOWED_PERMISSIONS,
  systemWideOnlyCodes,
} = require('../src/auth/permissionCatalog.js');

/**
 * Workflow definition rules — Phase 36 (`CR-014` §6), REQ-WF-002, REQ-WF-004.
 * Pure rules only; the database and API side are in
 * `tests/database/30-workflow-definitions`.
 */

const decide = (actorPositionCode) => ({ stepType: 'DECIDE', actorPositionCode });
const procure = (actorPositionCode, procurementMode = 'INTERNAL') => ({
  stepType: 'PROCURE',
  actorPositionCode,
  procurementMode,
});
const register = (actorPositionCode) => ({ stepType: 'REGISTER', actorPositionCode });

const numbered = (steps) =>
  steps.map((step, index) => ({
    procurementMode: null,
    skipIfRequesterIsActor: false,
    ...step,
    sequence: index + 1,
  }));

const COMMON_TEACHER = { category: 'COMMON', requesterPositionCode: 'COMMON_TEACHER' };

const issuesFor = (key, steps) => publicationIssues(key, numbered(steps));
const fields = (issues) => issues.map((issue) => issue.field);

describe('the fixed lists', () => {
  it('has the four request categories, which are not asset classifications (BR-032)', () => {
    expect(REQUEST_CATEGORIES).toEqual(['COMMON', 'JURUSAN', 'KBM', 'EKSKUL']);
  });

  it('has three step types, two procurement modes and three statuses', () => {
    expect(STEP_TYPES).toEqual(['DECIDE', 'PROCURE', 'REGISTER']);
    expect(PROCUREMENT_MODES).toEqual(['INTERNAL', 'EXTERNAL']);
    expect(DEFINITION_STATUSES).toEqual(['DRAFT', 'ACTIVE', 'RETIRED']);
  });
});

describe('shape: DECIDE*, then at most one PROCURE, then exactly one REGISTER (REQ-WF-002)', () => {
  it.each([
    ['REGISTER alone', [register('WAKASEK_SARPRAS')]],
    ['DECIDE then REGISTER', [decide('KEPALA_SEKOLAH'), register('WAKASEK_SARPRAS')]],
    [
      'DECIDE, DECIDE, PROCURE, REGISTER',
      [
        decide('WAKASEK_KURIKULUM'),
        decide('KEPALA_SEKOLAH'),
        procure('WAKASEK_SARPRAS'),
        register('WAKASEK_SARPRAS'),
      ],
    ],
    ['PROCURE then REGISTER', [procure('WAKASEK_SARPRAS'), register('WAKASEK_SARPRAS')]],
  ])('accepts %s', (_, steps) => {
    expect(issuesFor(COMMON_TEACHER, steps)).toEqual([]);
  });

  it('refuses an empty definition', () => {
    expect(fields(issuesFor(COMMON_TEACHER, []))).toEqual(['steps']);
  });

  it('refuses a definition with no REGISTER step', () => {
    const issues = issuesFor(COMMON_TEACHER, [decide('KEPALA_SEKOLAH')]);

    expect(fields(issues)).toContain('steps');
    expect(fields(issues)).toContain('steps.0.stepType');
  });

  it('refuses two REGISTER steps, naming the one that is not last', () => {
    const issues = issuesFor(COMMON_TEACHER, [
      register('WAKASEK_SARPRAS'),
      register('WAKASEK_SARPRAS'),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({ field: 'steps.0.stepType', issue: expect.stringMatching(/2/) }),
    ]);
  });

  it('refuses two PROCURE steps', () => {
    const issues = issuesFor(COMMON_TEACHER, [
      procure('WAKASEK_SARPRAS'),
      procure('WAKASEK_SARPRAS'),
      register('WAKASEK_SARPRAS'),
    ]);

    expect(fields(issues)).toEqual(['steps.1.stepType']);
  });

  it('refuses a DECIDE after the PROCURE step', () => {
    const issues = issuesFor(COMMON_TEACHER, [
      procure('WAKASEK_SARPRAS'),
      decide('KEPALA_SEKOLAH'),
      register('WAKASEK_SARPRAS'),
    ]);

    expect(fields(issues)).toEqual(['steps.1.stepType']);
  });

  it('refuses a REGISTER that is not last', () => {
    const issues = issuesFor(COMMON_TEACHER, [
      register('WAKASEK_SARPRAS'),
      decide('KEPALA_SEKOLAH'),
    ]);

    expect(fields(issues)).toEqual(['steps.0.stepType', 'steps.1.stepType']);
  });

  it('refuses a gap in the numbering', () => {
    const steps = numbered([decide('KEPALA_SEKOLAH'), register('WAKASEK_SARPRAS')]);
    steps[1].sequence = 3;

    expect(fields(publicationIssues(COMMON_TEACHER, steps))).toEqual(['steps.1.sequence']);
  });

  it('refuses a PROCURE without a mode, and a mode on any other step', () => {
    const issues = issuesFor(COMMON_TEACHER, [
      { ...decide('KEPALA_SEKOLAH'), procurementMode: 'INTERNAL' },
      procure('WAKASEK_SARPRAS', null),
      register('WAKASEK_SARPRAS'),
    ]);

    expect(fields(issues)).toEqual(['steps.0.procurementMode', 'steps.1.procurementMode']);
  });
});

describe('actors (Phase 36 decision D1)', () => {
  it('refuses a step whose actor has not been chosen, naming the step', () => {
    const issues = issuesFor(COMMON_TEACHER, [decide('KEPALA_SEKOLAH'), register(null)]);

    expect(issues).toEqual([
      { field: 'steps.1.actorPositionCode', issue: expect.stringMatching(/must be chosen/) },
    ]);
  });

  it('refuses an unknown position, including SARPRAS_STAFF (CR-014 Q4)', () => {
    const issues = issuesFor(COMMON_TEACHER, [register('SARPRAS_STAFF')]);

    expect(fields(issues)).toEqual(['steps.0.actorPositionCode']);
  });
});

describe('the department rule (REQ-WF-004)', () => {
  it.each([
    ['COMMON', 'JURUSAN_TEACHER', true],
    ['COMMON', 'TOOLMAN', true],
    ['COMMON', 'KAJUR', true],
    ['JURUSAN', 'COMMON_TEACHER', true],
    ['JURUSAN', 'KEPALA_SEKOLAH', true],
    ['COMMON', 'COMMON_TEACHER', false],
    ['KBM', 'COMMON_TEACHER', false],
    ['EKSKUL', 'WAKASEK_KESISWAAN', false],
  ])('%s from %s guarantees a department: %s', (category, requester, expected) => {
    expect(keyGuaranteesDepartment(category, requester)).toBe(expected);
  });

  it.each(['KAJUR', 'TOOLMAN', 'JURUSAN_TEACHER'])(
    'refuses a %s actor when the request need not have a department',
    (actor) => {
      const issues = issuesFor(COMMON_TEACHER, [decide(actor), register('WAKASEK_SARPRAS')]);

      expect(issues).toEqual([
        { field: 'steps.0.actorPositionCode', issue: expect.stringMatching(/REQ-WF-004/) },
      ]);
    }
  );

  it('accepts a department-bound actor for a department-bound requester', () => {
    const key = { category: 'COMMON', requesterPositionCode: 'JURUSAN_TEACHER' };

    expect(issuesFor(key, [decide('KAJUR'), register('WAKASEK_SARPRAS')])).toEqual([]);
  });

  it('accepts a department-bound actor on a JURUSAN request from any context that may make one', () => {
    const key = { category: 'JURUSAN', requesterPositionCode: 'KEPALA_SEKOLAH' };

    expect(issuesFor(key, [decide('KAJUR'), register('TOOLMAN')])).toEqual([]);
  });

  // P2 (§64.2): the request-category eligibility map is the one source.
  it.each([
    ['JURUSAN', 'COMMON_TEACHER'],
    ['KBM', 'JURUSAN_TEACHER'],
    ['EKSKUL', 'JURUSAN_TEACHER'],
  ])('refuses %s requested as %s — no request could use it', (category, requesterPositionCode) => {
    const key = { category, requesterPositionCode };

    expect(issuesFor(key, [decide('KEPALA_SEKOLAH'), register('WAKASEK_SARPRAS')])).toEqual([
      {
        field: 'category',
        issue: expect.stringMatching(/no request could ever use this process/),
      },
    ]);
  });

  it('never asks who holds a position — an institution-wide actor always passes', () => {
    expect(
      issuesFor(COMMON_TEACHER, [decide('KEPALA_SEKOLAH'), register('WAKASEK_SARPRAS')])
    ).toEqual([]);
  });
});

describe('templates (CR-014 §6.5)', () => {
  it('offers exactly the five confirmed flows', () => {
    expect(WORKFLOW_TEMPLATES.map((t) => `${t.category}/${t.requesterPositionCode}`)).toEqual([
      'COMMON/COMMON_TEACHER',
      'COMMON/JURUSAN_TEACHER',
      'KBM/COMMON_TEACHER',
      'EKSKUL/COMMON_TEACHER',
      'JURUSAN/KAJUR',
    ]);
  });

  it.each([
    ['COMMON_COMMON_TEACHER', ['DECIDE:WAKASEK_SARPRAS', 'PROCURE:?:INTERNAL', 'REGISTER:?']],
    [
      'COMMON_JURUSAN_TEACHER',
      ['DECIDE:KAJUR', 'DECIDE:WAKASEK_SARPRAS', 'PROCURE:?:INTERNAL', 'REGISTER:?'],
    ],
    [
      'KBM_COMMON_TEACHER',
      [
        'DECIDE:WAKASEK_KURIKULUM',
        'DECIDE:KEPALA_SEKOLAH',
        'DECIDE:WAKASEK_SARPRAS',
        'PROCURE:?:INTERNAL',
        'REGISTER:?',
      ],
    ],
    [
      'EKSKUL_COMMON_TEACHER',
      [
        'DECIDE:WAKASEK_KESISWAAN',
        'DECIDE:KEPALA_SEKOLAH',
        'DECIDE:WAKASEK_SARPRAS',
        'PROCURE:?:INTERNAL',
        'REGISTER:?',
      ],
    ],
    ['JURUSAN_KAJUR', ['DECIDE:KEPALA_SEKOLAH', 'PROCURE:?:EXTERNAL', 'REGISTER:?']],
  ])('%s has the confirmed steps, leaving undecided actors empty', (key, expected) => {
    const describeStep = (step) =>
      [step.stepType, step.actorPositionCode ?? '?', step.procurementMode]
        .filter(Boolean)
        .join(':');

    expect(templateOf(key).steps.map(describeStep)).toEqual(expected);
  });

  it('never guesses the Sarpras (Q4) or Jurusan (Q3) actor', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      for (const step of template.steps.filter((s) => s.stepType !== 'DECIDE')) {
        expect(step.actorPositionCode).toBeNull();
        expect(step.unresolvedQuestion).toBe(template.category === 'JURUSAN' ? 'Q3' : 'Q4');
      }
    }
  });

  it('enables self-skip on no step (DEC-I, Q7)', () => {
    const steps = WORKFLOW_TEMPLATES.flatMap((template) => template.steps);

    expect(steps.every((step) => step.skipIfRequesterIsActor === false)).toBe(true);
  });

  it('is complete apart from the undecided actors: every other rule already passes', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const issues = publicationIssues(template, template.steps);

      expect(issues.every((issue) => /actorPositionCode$/.test(issue.field))).toBe(true);
      expect(issues.every((issue) => /must be chosen/.test(issue.issue))).toBe(true);
    }
  });

  it('uses only known positions', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(POSITION_CODES).toContain(template.requesterPositionCode);
      for (const step of template.steps) {
        if (step.actorPositionCode) expect(POSITION_CODES).toContain(step.actorPositionCode);
      }
    }
  });
});

describe('permissions (CR-014 §10.1)', () => {
  const CODES = [
    'workflow-definition:read',
    'workflow-definition:create',
    'workflow-definition:update',
    'workflow-definition:publish',
  ];

  it('adds the four workflow-definition codes to the catalog', () => {
    const codes = getCatalog().map((entry) => entry.code);

    for (const code of CODES) expect(codes).toContain(code);
  });

  it('keeps them institution-scoped and outside the PIC ceiling (DEC-P)', () => {
    for (const code of CODES) {
      expect(systemWideOnlyCodes()).not.toContain(code);
      expect(PIC_ALLOWED_PERMISSIONS.has(code)).toBe(false);
    }
  });
});
