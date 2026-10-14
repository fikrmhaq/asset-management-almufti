'use strict';

/**
 * Category guidance — `CR-014` §4.4, REQ-REQUEST-003.
 *
 * The TYPICAL map is INFORMATIONAL ONLY; the ELIGIBLE map at the end of this file
 * is the one enforced rule (a UAT decision, 2026-09-28).
 *
 * TYPICAL orders and annotates the category choice in the
 * request form. Nothing in the application refuses a request because of it: an
 * unusual category is allowed, and so is a category with no active workflow —
 * such a DRAFT can be saved, and only submission (Phase 38) depends on a
 * workflow existing (Phase 37 guidance decision). Whether a context can SUBMIT a
 * category is decided solely by an explicit workflow definition (`DEC-F`).
 */

const { REQUEST_CATEGORIES } = require('./requestCategories');
const { ValidationError } = require('../errors');

const NON_JURUSAN = Object.freeze(REQUEST_CATEGORIES.filter((category) => category !== 'JURUSAN'));

/** The school's matrix (brief §7): each context's typical categories, in order. */
const TYPICAL_CATEGORIES = Object.freeze({
  COMMON_TEACHER: Object.freeze(['COMMON', 'KBM', 'EKSKUL']),
  JURUSAN_TEACHER: Object.freeze(['COMMON', 'JURUSAN']),
  TOOLMAN: Object.freeze(['COMMON', 'JURUSAN']),
  KAJUR: Object.freeze(['COMMON', 'JURUSAN']),
  WAKASEK_SARPRAS: NON_JURUSAN,
  WAKASEK_KURIKULUM: NON_JURUSAN,
  WAKASEK_KESISWAAN: NON_JURUSAN,
  KEPALA_SEKOLAH: NON_JURUSAN,
});

function typicalCategoriesFor(positionCode) {
  return TYPICAL_CATEGORIES[positionCode] ?? [];
}

/**
 * ELIGIBILITY — ENFORCED, unlike the guidance above (UAT decision, 2026-09-28).
 *
 * A requester context may be limited to the categories it can request at all.
 * Only contexts listed here are limited; every other context may choose any
 * category, exactly as before, and the guidance above still orders and
 * annotates the choice. This does not change the categories themselves, and it
 * is not a workflow rule: a context that is eligible for a category still needs
 * an ACTIVE workflow to submit it (`DEC-F`).
 *
 *   JURUSAN_TEACHER — COMMON and JURUSAN only. KBM and EKSKUL are requested by a
 *   teacher of common subjects.
 *   COMMON_TEACHER  — COMMON, KBM and EKSKUL only: a teacher of common subjects
 *   never requests for a Jurusan (P2, 2026-09-29, `IMPLEMENTATION_PLAN.md` §64.2).
 *
 * THE ONE SOURCE: request create, a draft's change of category, submission
 * (`requestSubmission.js`) and workflow configuration — creating a definition
 * and publishing one (`workflowShape.publicationIssues`) — all read this map, so
 * no process can exist for a request that may not be made.
 */
const ELIGIBLE_CATEGORIES = Object.freeze({
  JURUSAN_TEACHER: Object.freeze(['COMMON', 'JURUSAN']),
  COMMON_TEACHER: Object.freeze(['COMMON', 'KBM', 'EKSKUL']),
});

function eligibleCategoriesFor(positionCode) {
  return ELIGIBLE_CATEGORIES[positionCode] ?? REQUEST_CATEGORIES;
}

function isEligibleCategory(positionCode, category) {
  return eligibleCategoriesFor(positionCode).includes(category);
}

/**
 * Refuses a category the requester context may not request — on create, on a
 * draft's change of category, and again at submission (a draft saved before the
 * rule existed).
 *
 * @throws {ValidationError}
 */
function assertEligibleCategory(positionCode, category) {
  if (isEligibleCategory(positionCode, category)) return;
  throw new ValidationError('This category cannot be requested in this capacity', [
    {
      field: 'category',
      issue:
        `a request made as ${positionCode} may be one of ` +
        `${eligibleCategoriesFor(positionCode).join(', ')}; ${category} is not among them`,
    },
  ]);
}

module.exports = {
  TYPICAL_CATEGORIES,
  ELIGIBLE_CATEGORIES,
  typicalCategoriesFor,
  eligibleCategoriesFor,
  isEligibleCategory,
  assertEligibleCategory,
};
