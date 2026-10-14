'use strict';

/**
 * Who may upload and delete a request's documents — Phase 39 (`CR-014` §9,
 * §10.1, §10.2; `IMPLEMENTATION_PLAN.md` §58.1 H1, H3).
 *
 * PURE: the caller supplies whether they are an ACTIVE step's actor, so the
 * request detail (which has already resolved its steps) and the document
 * service (which asks the database under a row lock) share one rule.
 *
 * Each function answers `null` when the action is allowed, or the error to
 * throw. The permission CODE is checked separately — by the route, and in the
 * UI flags below — because a code is necessary but never sufficient.
 *
 *   upload   request not terminal, AND one of: the requester; the resolved actor
 *            of ANY ACTIVE step (DECIDE, PROCURE or REGISTER — H1); or
 *            `request:oversee`. The actor rule gives upload only — never a
 *            step's own action. A PENDING-step holder or a former actor does not
 *            qualify through it.
 *   delete   `request:oversee`, at any status (H3); otherwise only the uploader,
 *            and only while the request is DRAFT. Never a receipt-confirmation
 *            photo, by anyone (migration 057).
 *
 * Oversight here is the `request:oversee` code itself, as for every Phase 38
 * oversight action: a system-wide role widens visibility, not actions.
 */

const { ConflictError, ForbiddenError } = require('../errors');
const { hasPermission } = require('../auth/principal');
const { TERMINAL_REQUEST_STATUSES } = require('./requestStepStates');
const { CONFIRMATION_PHOTO } = require('./requestDocumentTypes');

/** @returns {Error|null} */
function uploadRefusal(principal, request, { activeActor }) {
  if (TERMINAL_REQUEST_STATUSES.includes(request.status)) {
    return new ConflictError('This request has ended', [
      { field: 'status', issue: `documents cannot be added to a ${request.status} request` },
    ]);
  }
  if (
    request.requesterUserId === principal.userId ||
    activeActor ||
    hasPermission(principal, 'request:oversee')
  ) {
    return null;
  }
  return new ForbiddenError('You cannot add documents to this request', [
    {
      issue:
        'only the requester, the actor of an active step, or request:oversee may add documents (CR-014 §9)',
    },
  ]);
}

/** @returns {Error|null} */
function deleteRefusal(principal, request, document) {
  // Receipt evidence (migration 057): never deleted, by anyone. A wrong
  // confirmation is corrected by reversing its receipts and receiving again,
  // which keeps both.
  if (document.documentType === CONFIRMATION_PHOTO) {
    return new ConflictError('A receipt confirmation photo cannot be deleted', [
      {
        field: 'documentType',
        issue:
          'it is the requester’s receipt evidence; reverse the receipt and record it again to correct it',
      },
    ]);
  }
  if (hasPermission(principal, 'request:oversee')) return null;
  if (document.uploadedBy !== principal.userId) {
    return new ForbiddenError('You cannot delete this document', [
      {
        issue:
          'a document is deleted by its uploader while the request is a draft, otherwise only with request:oversee',
      },
    ]);
  }
  if (request.status !== 'DRAFT') {
    return new ConflictError('This document can no longer be deleted by its uploader', [
      {
        field: 'status',
        issue: `the uploader may delete only while the request is a draft; it is ${request.status}`,
      },
    ]);
  }
  return null;
}

/** UI flag: the code AND the rule. */
function mayUpload(principal, request, context) {
  return (
    hasPermission(principal, 'request-document:create') &&
    uploadRefusal(principal, request, context) === null
  );
}

/** UI flag: the code AND the rule. */
function mayDelete(principal, request, document) {
  return (
    hasPermission(principal, 'request-document:delete') &&
    deleteRefusal(principal, request, document) === null
  );
}

module.exports = { uploadRefusal, deleteRefusal, mayUpload, mayDelete };
