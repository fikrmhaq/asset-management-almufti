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

/** Asserts a file was actually attached, since multer treats absence as valid. */
function requireFile(field = 'file') {
  return function checkFile(req, res, next) {
    if (!req.file) {
      return next(new ValidationError('A file is required', [{ field, issue: 'is required' }]));
    }
    return next();
  };
}

module.exports = { singleUpload, requireFile };
