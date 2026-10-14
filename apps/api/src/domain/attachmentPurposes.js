'use strict';

/**
 * What an Asset / Asset Unit attachment is FOR — REQ-REQUEST-020, migration 061
 * (`IMPLEMENTATION_PLAN.md` §67). An ordinary attachment has none (NULL).
 *
 *   REGISTRATION_PHOTO  evidence of what was registered against a request
 *                       item: a JPG / PNG of a unit linked to one, or of an
 *                       asset with such a unit. Not proof of receipt — receipt
 *                       photos are request documents (migration 057).
 *
 * `chk_attachments_purpose` admits exactly these values (`DEC-U`).
 */
const ATTACHMENT_PURPOSES = Object.freeze(['REGISTRATION_PHOTO']);

module.exports = { ATTACHMENT_PURPOSES };
