import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { TYPICAL_CATEGORIES, typicalCategoriesFor } = require('../src/domain/requestGuidance.js');
const { formatRequestNumber } = require('../src/domain/requestNumbers.js');
const { REQUEST_STATUSES } = require('../src/domain/requestStatuses.js');
const { POSITION_CODES } = require('../src/domain/schoolPositions.js');
const { REQUEST_CATEGORIES } = require('../src/domain/requestCategories.js');
const { REQUEST_DOCUMENT_TYPES } = require('../src/domain/requestDocumentTypes.js');
const {
  uploadRefusal,
  deleteRefusal,
  mayUpload,
  mayDelete,
} = require('../src/domain/requestDocumentRules.js');
const {
  getCatalog,
  PIC_ALLOWED_PERMISSIONS,
  systemWideOnlyCodes,
} = require('../src/auth/permissionCatalog.js');

/**
 * Request drafting rules that need no database — Phase 37 (`CR-014`). The
 * database and API side are in `tests/database/31-requests`.
 */

describe('category guidance (CR-014 §4.4) — informational only', () => {
  it('covers every school position with known categories', () => {
    expect(Object.keys(TYPICAL_CATEGORIES).sort()).toEqual([...POSITION_CODES].sort());
    for (const categories of Object.values(TYPICAL_CATEGORIES)) {
      for (const category of categories) expect(REQUEST_CATEGORIES).toContain(category);
    }
  });

  it.each([
    ['COMMON_TEACHER', ['COMMON', 'KBM', 'EKSKUL']],
    ['JURUSAN_TEACHER', ['COMMON', 'JURUSAN']],
    ['TOOLMAN', ['COMMON', 'JURUSAN']],
    ['KAJUR', ['COMMON', 'JURUSAN']],
    ['WAKASEK_SARPRAS', ['COMMON', 'KBM', 'EKSKUL']],
    ['KEPALA_SEKOLAH', ['COMMON', 'KBM', 'EKSKUL']],
  ])('lists the typical categories for %s', (position, expected) => {
    expect(typicalCategoriesFor(position)).toEqual(expected);
  });
});

describe('request numbers (decision E7)', () => {
  it.each([
    [2026, 1, 'REQ/2026/0001'],
    [2026, 42, 'REQ/2026/0042'],
    [2027, 9999, 'REQ/2027/9999'],
    [2027, 10000, 'REQ/2027/10000'],
  ])('formats %i / %i as %s', (year, sequence, expected) => {
    expect(formatRequestNumber(year, sequence)).toBe(expected);
  });
});

describe('statuses', () => {
  it('lists the nine request statuses', () => {
    expect(REQUEST_STATUSES).toEqual([
      'DRAFT',
      'SUBMITTED',
      // REQ-REQUEST-018: returned to the requester for revision.
      'REVISION_REQUESTED',
      'APPROVED',
      'PARTIALLY_FULFILLED',
      'FULFILLED',
      'CLOSED',
      'REJECTED',
      'CANCELLED',
    ]);
  });
});

describe('permissions (Phase 37 E2, Phases 38 – 40)', () => {
  const PHASE_37 = [
    'request:read',
    'request:create',
    'request:update',
    'request:oversee',
    'request-item:create',
    'request-item:update',
    'request-item:delete',
    // Phase 38.
    'request:submit',
    'request:cancel',
    'request-step:decide',
    'request-step:complete',
    // Phase 39.
    'request-document:read',
    'request-document:create',
    'request-document:delete',
    // Phase 40.
    'request-item:register',
    'request-item-unit:read',
    'request-item-unit:create',
    'request-item-unit:delete',
    // Phase 41.
    'request:receive',
    'request:close',
    'request-receipt:reverse',
  ];
  const codes = () => getCatalog().map((entry) => entry.code);

  it('holds exactly the Phase 37 – 41 request codes', () => {
    const requestCodes = codes().filter((code) =>
      /^request(-item|-step|-document|-item-unit|-receipt)?:/.test(code)
    );

    expect(requestCodes.sort()).toEqual([...PHASE_37].sort());
  });

  it('adds no code belonging to a later phase', () => {
    for (const code of [
      'request-step:read',
      'request-receipt:delete',
      'request-item-unit:update',
      'request-document:update',
    ]) {
      expect(codes()).not.toContain(code);
    }
  });

  it('keeps them institution-scoped and outside the PIC ceiling', () => {
    expect(PIC_ALLOWED_PERMISSIONS.size).toBe(30);
    for (const code of PHASE_37) {
      expect(systemWideOnlyCodes()).not.toContain(code);
      expect(PIC_ALLOWED_PERMISSIONS.has(code)).toBe(false);
    }
  });
});

/**
 * Request document rules — Phase 39 (`CR-014` §9; `IMPLEMENTATION_PLAN.md`
 * §58.1 H1, H3, H5, H6). The API side is `tests/database/33-request-documents`.
 */
describe('request document types (H5, H6)', () => {
  it('lists the six types, none of them required', () => {
    expect(REQUEST_DOCUMENT_TYPES).toEqual([
      'PROPOSAL',
      'SUPPORTING',
      'INVOICE',
      'RECEIPT',
      'BAST',
      'OTHER',
    ]);
    expect(Object.isFrozen(REQUEST_DOCUMENT_TYPES)).toBe(true);
  });
});

describe('request document rules (H1, H3)', () => {
  const principal = (userId, permissions = []) => ({
    userId,
    permissions: new Set(permissions),
    isSystemWide: false,
  });
  const request = (status, requesterUserId = 'requester') => ({ status, requesterUserId });
  const TERMINAL = ['REJECTED', 'CANCELLED', 'CLOSED', 'FULFILLED'];

  it('lets the requester upload until the request ends', () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_FULFILLED']) {
      expect(uploadRefusal(principal('requester'), request(status), { activeActor: false })).toBe(
        null
      );
    }
    for (const status of TERMINAL) {
      expect(
        uploadRefusal(principal('requester'), request(status), { activeActor: false })?.code
      ).toBe('CONFLICT');
    }
  });

  it('lets an active actor or oversight upload, and nobody else', () => {
    const other = principal('other');
    expect(uploadRefusal(other, request('APPROVED'), { activeActor: true })).toBe(null);
    expect(
      uploadRefusal(principal('other', ['request:oversee']), request('APPROVED'), {
        activeActor: false,
      })
    ).toBe(null);
    expect(uploadRefusal(other, request('APPROVED'), { activeActor: false })?.code).toBe(
      'FORBIDDEN'
    );
    // Oversight never reopens an ended request.
    expect(
      uploadRefusal(principal('other', ['request:oversee']), request('CLOSED'), {
        activeActor: false,
      })?.code
    ).toBe('CONFLICT');
  });

  it('does not treat a system-wide role as oversight for an action', () => {
    const systemWide = { ...principal('other'), isSystemWide: true };
    expect(uploadRefusal(systemWide, request('APPROVED'), { activeActor: false })?.code).toBe(
      'FORBIDDEN'
    );
  });

  it('lets the uploader delete only while DRAFT, and oversight at any status', () => {
    const mine = { uploadedBy: 'requester' };
    expect(deleteRefusal(principal('requester'), request('DRAFT'), mine)).toBe(null);
    expect(deleteRefusal(principal('requester'), request('SUBMITTED'), mine)?.code).toBe(
      'CONFLICT'
    );
    expect(deleteRefusal(principal('other'), request('DRAFT'), mine)?.code).toBe('FORBIDDEN');
    for (const status of ['SUBMITTED', 'APPROVED', ...TERMINAL]) {
      expect(deleteRefusal(principal('other', ['request:oversee']), request(status), mine)).toBe(
        null
      );
    }
  });

  it('needs the code as well as the rule for the UI flags', () => {
    expect(mayUpload(principal('requester'), request('DRAFT'), { activeActor: false })).toBe(false);
    expect(
      mayUpload(principal('requester', ['request-document:create']), request('DRAFT'), {
        activeActor: false,
      })
    ).toBe(true);
    expect(mayDelete(principal('requester'), request('DRAFT'), { uploadedBy: 'requester' })).toBe(
      false
    );
    expect(
      mayDelete(principal('requester', ['request-document:delete']), request('DRAFT'), {
        uploadedBy: 'requester',
      })
    ).toBe(true);
  });
});

describe('category eligibility — enforced (UAT decision, 2026-09-28)', () => {
  const {
    eligibleCategoriesFor,
    isEligibleCategory,
    assertEligibleCategory,
  } = require('../src/domain/requestGuidance.js');

  it('limits a Jurusan teacher to COMMON and JURUSAN', () => {
    expect(eligibleCategoriesFor('JURUSAN_TEACHER')).toEqual(['COMMON', 'JURUSAN']);
    expect(isEligibleCategory('JURUSAN_TEACHER', 'KBM')).toBe(false);
    expect(isEligibleCategory('JURUSAN_TEACHER', 'EKSKUL')).toBe(false);
    expect(() => assertEligibleCategory('JURUSAN_TEACHER', 'KBM')).toThrow(
      'This category cannot be requested in this capacity'
    );
  });

  // P2 (§64.2).
  it('limits a teacher of common subjects to COMMON, KBM and EKSKUL — never JURUSAN', () => {
    expect(eligibleCategoriesFor('COMMON_TEACHER')).toEqual(['COMMON', 'KBM', 'EKSKUL']);
    expect(isEligibleCategory('COMMON_TEACHER', 'JURUSAN')).toBe(false);
    expect(() => assertEligibleCategory('COMMON_TEACHER', 'JURUSAN')).toThrow(
      'This category cannot be requested in this capacity'
    );
    for (const category of ['COMMON', 'KBM', 'EKSKUL']) {
      expect(() => assertEligibleCategory('COMMON_TEACHER', category)).not.toThrow();
    }
  });

  it.each(POSITION_CODES.filter((code) => !['JURUSAN_TEACHER', 'COMMON_TEACHER'].includes(code)))(
    'leaves %s free to request every category',
    (position) => {
      expect(eligibleCategoriesFor(position)).toEqual(REQUEST_CATEGORIES);
      for (const category of REQUEST_CATEGORIES) {
        expect(() => assertEligibleCategory(position, category)).not.toThrow();
      }
    }
  );
});
