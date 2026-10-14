import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  SCHOOL_POSITIONS,
  POSITION_CODES,
  positionOf,
  isKnownPosition,
  requiresDepartment,
  isSingleHolder,
  TEACHER_POSITION_CODES,
  isTeacherPosition,
} = require('../src/domain/schoolPositions.js');
const {
  getCatalog,
  PIC_ALLOWED_PERMISSIONS,
  systemWideOnlyCodes,
} = require('../src/auth/permissionCatalog.js');

/**
 * The school position list — Phase 35 (`CR-014` §4), REQ-POS-001. The database
 * side of the same list is asserted in `tests/database/29-position-assignments`.
 */
describe('school positions', () => {
  it('is the fixed list of eight, without SARPRAS_STAFF (CR-014 Q4)', () => {
    expect(POSITION_CODES).toEqual([
      'COMMON_TEACHER',
      'JURUSAN_TEACHER',
      'TOOLMAN',
      'KAJUR',
      'WAKASEK_SARPRAS',
      'WAKASEK_KURIKULUM',
      'WAKASEK_KESISWAAN',
      'KEPALA_SEKOLAH',
    ]);
    expect(isKnownPosition('SARPRAS_STAFF')).toBe(false);
  });

  it('cannot be modified at runtime', () => {
    expect(Object.isFrozen(SCHOOL_POSITIONS)).toBe(true);
    expect(SCHOOL_POSITIONS.every((position) => Object.isFrozen(position))).toBe(true);
  });

  it.each([
    ['JURUSAN_TEACHER', true],
    ['TOOLMAN', true],
    ['KAJUR', true],
    ['COMMON_TEACHER', false],
    ['WAKASEK_SARPRAS', false],
    ['KEPALA_SEKOLAH', false],
  ])('%s requires a department: %s', (code, expected) => {
    expect(requiresDepartment(code)).toBe(expected);
  });

  it.each([
    ['KAJUR', true],
    ['TOOLMAN', true],
    ['WAKASEK_KURIKULUM', true],
    ['KEPALA_SEKOLAH', true],
    ['COMMON_TEACHER', false],
    ['JURUSAN_TEACHER', false],
  ])('%s is single-holder: %s', (code, expected) => {
    expect(isSingleHolder(code)).toBe(expected);
  });

  /**
   * `CR-014` §4.2: the two teacher codes are one concept — teacher without a
   * Jurusan, teacher for Jurusan X — marked as request contexts, never as jobs.
   */
  it('marks exactly the two teacher codes as request contexts', () => {
    expect(SCHOOL_POSITIONS.filter((p) => p.requestContext).map((p) => p.code)).toEqual([
      'COMMON_TEACHER',
      'JURUSAN_TEACHER',
    ]);
    expect(positionOf('COMMON_TEACHER').department).toBe('NONE');
    expect(positionOf('JURUSAN_TEACHER').department).toBe('REQUIRED');
  });

  it('answers null for an unknown code', () => {
    expect(positionOf('BENDAHARA')).toBeNull();
    expect(requiresDepartment('BENDAHARA')).toBe(false);
  });
});

describe('school position permissions (CR-014 §10.1)', () => {
  const CODES = [
    'school-position:read',
    'position-assignment:read',
    'position-assignment:create',
    'position-assignment:end',
  ];

  it('are in the catalog, with a readable description for `end`', () => {
    const catalog = new Map(getCatalog().map((entry) => [entry.code, entry]));

    for (const code of CODES) expect(catalog.has(code), code).toBe(true);
    expect(catalog.get('position-assignment:end').description).toBe(
      'End: School position assignments'
    );
  });

  it('are institution-assignable, not system-wide-only', () => {
    const systemWide = systemWideOnlyCodes();

    for (const code of CODES) expect(systemWide, code).not.toContain(code);
  });

  it('are outside the PIC ceiling, which stays at 30 codes (DEC-P)', () => {
    for (const code of CODES) expect(PIC_ALLOWED_PERMISSIONS.has(code), code).toBe(false);
    expect(PIC_ALLOWED_PERMISSIONS.size).toBe(30);
  });
});

/** REQ-REQUEST-023: the Teacher Storage Room default is a teacher's only. */
describe('teacher positions', () => {
  it('are the two teacher request contexts, and nothing else', () => {
    expect(TEACHER_POSITION_CODES).toEqual(['COMMON_TEACHER', 'JURUSAN_TEACHER']);
    for (const code of POSITION_CODES) {
      expect(isTeacherPosition(code), code).toBe(TEACHER_POSITION_CODES.includes(code));
    }
    expect(isTeacherPosition('UNKNOWN')).toBe(false);
  });

  it('carry teacher-storage-room codes that are institution-assignable, outside the PIC ceiling', () => {
    const codes = ['teacher-storage-room:read', 'teacher-storage-room:update'];
    const catalog = new Map(getCatalog().map((entry) => [entry.code, entry]));

    for (const code of codes) {
      expect(catalog.get(code), code).toMatchObject({ group: 'Organization', picAllowed: false });
      expect(systemWideOnlyCodes(), code).not.toContain(code);
    }
  });
});
