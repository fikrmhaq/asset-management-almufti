'use strict';

/**
 * Request categories — Phase 36 (`CR-014` §4.4, `DEC-E`), `03-domain.md` §6.8.
 *
 * THE AUTHORITATIVE LIST. Migration 050 writes the same codes into
 * `chk_wf_def_category`, frozen as migrations must be, and
 * `tests/database/30-workflow-definitions.test.js` fails if the two ever
 * disagree (`CR-014` `DEC-U`). The Phase 37 `requests.category` CHECK will be
 * held to this list the same way.
 *
 * The context a need arises in, NOT an asset classification (`BR-032`): the
 * category lives on workflow definitions and (from Phase 37) on requests, and
 * never on `assets` or `asset_units`.
 *
 * `JURUSAN` is the one category that always carries a department. That is what
 * lets a workflow for it name a department-bound actor (REQ-WF-004).
 */

const REQUEST_CATEGORIES = Object.freeze(['COMMON', 'JURUSAN', 'KBM', 'EKSKUL']);

/** The category whose every Request has a department (`CR-014` §4.4). */
const DEPARTMENT_CATEGORY = 'JURUSAN';

function isKnownCategory(code) {
  return REQUEST_CATEGORIES.includes(code);
}

module.exports = { REQUEST_CATEGORIES, DEPARTMENT_CATEGORY, isKnownCategory };
