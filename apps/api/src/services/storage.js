'use strict';

/**
 * File storage adapter — `05-infrastructure.md` §5.
 *
 * Local disk, for now. `storageReference` is a plain path string, so nothing
 * here couples the data model to disk: moving to S3-compatible object storage
 * later is an adapter swap, not a migration (§5.1).
 *
 * Layout (§5.2):
 *   /storage/attachments/{assetId}/{uuid}-{originalFileName}
 *
 * Sharding by owner id avoids tens of thousands of files in one flat directory.
 *
 * Phase 5 needs this to make attachments and floor plans work at all. Phase 8
 * §14.5 owns the hardening around it — orphaned-file cleanup in particular,
 * where a file lands on disk and its database transaction then fails.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { getConfig, REPO_ROOT } = require('../config');
const { InternalError, ValidationError } = require('../errors');

/** Allowed upload types — `05-infrastructure.md` §5.3, REQ-FILE-004. */
const ALLOWED_EXTENSIONS = Object.freeze(['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx']);

const ALLOWED_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** Floor plans are images only — an SVG or PDF plan is not what the editor draws on. */
const FLOOR_PLAN_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png']);

/**
 * Strips everything that could escape the storage directory.
 *
 * The original name is caller-controlled and ends up in a path, so `..`, slashes
 * and NUL bytes are removed rather than trusted.
 */
function sanitizeFileName(name) {
  // `basename` drops any directory part, including `..` segments and both
  // separator styles. Control characters are escaped rather than written
  // literally, so the pattern survives an editor round-trip.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  const base = path.basename(String(name ?? 'file')).replace(/[\u0000-\u001f\u007f]/g, '');
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 200) || 'file';
}

function extensionOf(fileName) {
  return path.extname(fileName).replace('.', '').toLowerCase();
}

/**
 * @throws {ValidationError} when the type is not allowed (REQ-FILE-004)
 */
function assertAllowedType(file, { mimeTypes = ALLOWED_MIME_TYPES, label = 'file' } = {}) {
  const extension = extensionOf(file.originalname);

  if (!ALLOWED_EXTENSIONS.includes(extension) || !mimeTypes.includes(file.mimetype)) {
    throw new ValidationError(`That ${label} type is not allowed`, [
      {
        field: 'file',
        issue: `must be one of: ${mimeTypes.join(', ')}`,
      },
    ]);
  }
}

/**
 * Absolute root of the storage tree, from `STORAGE_PATH`.
 *
 * A relative path is resolved against the repository root, NOT the process's
 * working directory. `path.resolve` would use the cwd, which differs between
 * `npm start` at the root, `npm run --workspace apps/api`, and the test runner —
 * so the same configured value would name three different directories, and a
 * file written by one would be unreadable by another.
 *
 * Production sets an absolute path (`05-infrastructure.md` §9.1), which is
 * unaffected either way.
 */
function storageRoot(config = getConfig()) {
  const configured = config.storage.path;
  return path.isAbsolute(configured) ? configured : path.resolve(REPO_ROOT, configured);
}

/**
 * Writes a buffer and returns its storage reference.
 *
 * The reference is relative to the storage root, so moving the root — a bind
 * mount changing, a restore onto a different host — does not invalidate every
 * row in `attachments`.
 *
 * @returns {Promise<{storageReference: string, fileName: string, fileSize: number}>}
 */
async function store(file, { shard, config = getConfig() } = {}) {
  const root = storageRoot(config);
  const safeName = sanitizeFileName(file.originalname);
  const relativeDir = path.join(String(shard));
  const relativePath = path.join(relativeDir, `${randomUUID()}-${safeName}`);
  const absolutePath = path.join(root, relativePath);

  // Refuse anything that resolves outside the root, whatever the shard was.
  if (!absolutePath.startsWith(root + path.sep)) {
    throw new InternalError('Refusing to write outside the storage directory');
  }

  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);
  } catch (error) {
    throw new InternalError('The file could not be stored', { cause: error });
  }

  return {
    storageReference: relativePath.split(path.sep).join('/'),
    fileName: safeName,
    fileSize: file.buffer.length,
  };
}

/** Absolute path for a stored reference, refusing any traversal attempt. */
function resolveStoredPath(storageReference, config = getConfig()) {
  const root = storageRoot(config);
  const absolutePath = path.resolve(root, storageReference);

  if (!absolutePath.startsWith(root + path.sep)) {
    throw new InternalError('Refusing to read outside the storage directory');
  }

  return absolutePath;
}

async function read(storageReference, config = getConfig()) {
  try {
    return await fs.readFile(resolveStoredPath(storageReference, config));
  } catch (error) {
    throw new InternalError('The stored file could not be read', { cause: error });
  }
}

/**
 * Deletes a stored file.
 *
 * A missing file is not an error: the database row is the record of truth, and
 * refusing to delete it because the file already vanished would strand it.
 */
async function remove(storageReference, config = getConfig()) {
  try {
    await fs.unlink(resolveStoredPath(storageReference, config));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new InternalError('The stored file could not be removed', { cause: error });
  }
}

module.exports = {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  FLOOR_PLAN_MIME_TYPES,
  sanitizeFileName,
  extensionOf,
  assertAllowedType,
  storageRoot,
  store,
  read,
  remove,
  resolveStoredPath,
};
