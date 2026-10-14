'use strict';

/**
 * Multipart upload handling — `05-infrastructure.md` §3.2, §5.3; `06-api.md` §1.8.
 *
 * Files are buffered in memory, not streamed to a temporary path. At the
 * documented 10 MB ceiling and this concurrency (§13: tens of users, not
 * thousands) that is the simpler correct choice — it also means nothing lands on
 * disk until the storage adapter decides where, so a rejected upload leaves no
 * orphan behind.
 */

const multer = require('multer');

const { getConfig } = require('../config');
const { ValidationError } = require('../errors');

/**
 * @param {{field?: string, config?: object}} [options]
 * @returns {import('express').RequestHandler}
 */
function singleUpload({ field = 'file', config = getConfig() } = {}) {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.storage.maxUploadSizeMb * 1024 * 1024,
      files: 1,
    },
  }).single(field);

  return function handleUpload(req, res, next) {
    handler(req, res, (error) => {
      if (!error) return next();

      // Translate multer's own errors into the documented envelope rather than
      // letting them surface as a 500.
      if (error instanceof multer.MulterError) {
        const issue =
          error.code === 'LIMIT_FILE_SIZE'
            ? `must be at most ${config.storage.maxUploadSizeMb} MB`
            : error.message;

        return next(new ValidationError('The upload was rejected', [{ field, issue }]));
      }

      return next(error);
    });
  };
}

/**
 * Files under several named fields, with ONE ceiling across all of them —
 * `req.files` is `{ [field]: File[] }`, text fields in `req.body`. Recording
 * receipt, whose photos arrive with the rest of the form in one request
 * (migration 057; REQ-REQUEST-022): general photos under `photos`, unit photos
 * under `unitPhotos`, at most `maxCount` in total. The count's lower bound is
 * the caller's rule. A count refusal names `countField`, where the total rule
 * is stated.
 *
 * @param {{fields: string[], maxCount: number, countField?: string, config?: object}} options
 * @returns {import('express').RequestHandler}
 */
function fieldsUpload({ fields, maxCount, countField = fields[0], config = getConfig() }) {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.storage.maxUploadSizeMb * 1024 * 1024,
      files: maxCount,
    },
  }).fields(fields.map((name) => ({ name, maxCount })));

  return function handleUpload(req, res, next) {
    handler(req, res, (error) => {
      if (!error) return next();

      if (error instanceof multer.MulterError) {
        let field = countField;
        let issue = error.message;
        if (error.code === 'LIMIT_FILE_SIZE') {
          field = error.field ?? countField;
          issue = `each file must be at most ${config.storage.maxUploadSizeMb} MB`;
        } else if (error.code === 'LIMIT_UNEXPECTED_FILE' && !fields.includes(error.field)) {
          issue = `files are accepted only as ${fields.join(' or ')}`;
        } else if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
          issue = `at most ${maxCount} files in total`;
        }
        return next(new ValidationError('The upload was rejected', [{ field, issue }]));
      }

      return next(error);
    });
  };
}

/** Asserts a file was actually attached, since multer treats absence as valid. */
function requireFile(field = 'file') {
  return function checkFile(req, res, next) {
    if (!req.file) {
      return next(new ValidationError('A file is required', [{ field, issue: 'is required' }]));
    }
    return next();
  };
}

module.exports = { singleUpload, fieldsUpload, requireFile };
