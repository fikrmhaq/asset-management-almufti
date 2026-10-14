'use strict';

/**
 * Request document types — `CR-014` §9, `03-domain.md` §4.42.
 *
 * THE AUTHORITATIVE LIST. Migrations 053 and 057 write the same values into
 * `chk_request_documents_type` — `ALL_REQUEST_DOCUMENT_TYPES` below — and
 * `tests/database/33-request-documents.test.js` fails if the two disagree
 * (`CR-014` `DEC-U`).
 *
 * `REQUEST_DOCUMENT_TYPES` are the types a user UPLOADS. A
 * `CONFIRMATION_PHOTO` is never uploaded on its own: it is written only by
 * recording receipt, linked to its receipt confirmation (migration 057,
 * `chk_request_documents_confirmation`), and never deleted.
 *
 * No type is mandatory (`CR-014` §9, §17.2): whether a proposal is ever required
 * is deferred, and nothing reads this list to require one.
 *
 * `RECEIPT` is a payment receipt ("kuitansi") — a document. It is NOT the
 * recorded receipt of goods by the requester (`BR-031`, Phase 41).
 */

const REQUEST_DOCUMENT_TYPES = Object.freeze([
  'PROPOSAL',
  'SUPPORTING',
  'INVOICE',
  'RECEIPT',
  'BAST',
  'OTHER',
]);

/** Receipt-confirmation evidence — written by `requestFulfilment.receive` only. */
const CONFIRMATION_PHOTO = 'CONFIRMATION_PHOTO';

const ALL_REQUEST_DOCUMENT_TYPES = Object.freeze([...REQUEST_DOCUMENT_TYPES, CONFIRMATION_PHOTO]);

module.exports = { REQUEST_DOCUMENT_TYPES, CONFIRMATION_PHOTO, ALL_REQUEST_DOCUMENT_TYPES };
