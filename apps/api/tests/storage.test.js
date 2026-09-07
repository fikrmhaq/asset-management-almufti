import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

import { TEST_ENV } from './helpers/testApp.js';

const require = createRequire(import.meta.url);

const storage = require('../src/services/storage.js');
const { loadConfig, REPO_ROOT } = require('../src/config/index.js');
const { ValidationError } = require('../src/errors/index.js');

/** File storage adapter — 05-infrastructure.md §5, REQ-FILE-004. */

const configWith = (storagePath) => loadConfig({ ...TEST_ENV, STORAGE_PATH: storagePath });

describe('storage root resolution', () => {
  it('resolves a relative path against the repo root, not the working directory', () => {
    // Regression guard: `path.resolve` would follow the cwd, which differs
    // between `npm start`, a workspace script and the test runner — the same
    // configured value would then name three different directories.
    const root = storage.storageRoot(configWith('./storage/attachments'));

    expect(root).toBe(path.join(REPO_ROOT, 'storage', 'attachments'));
  });

  it('is independent of the process working directory', () => {
    const config = configWith('./storage/attachments');
    const before = storage.storageRoot(config);

    const originalCwd = process.cwd();
    try {
      process.chdir(path.join(REPO_ROOT, 'apps', 'api'));
      expect(storage.storageRoot(config)).toBe(before);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('leaves an absolute path alone, as production uses (§9.1)', () => {
    const absolute = path.resolve('/storage/attachments');

    expect(storage.storageRoot(configWith(absolute))).toBe(absolute);
  });
});

describe('file name sanitization', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32\\evil.exe', 'evil.exe'],
    ['...hidden', 'hidden'],
    ['normal file (1).pdf', 'normal_file__1_.pdf'],
  ])('reduces %s to %s', (input, expected) => {
    expect(storage.sanitizeFileName(input)).toBe(expected);
  });

  it('strips control characters', () => {
    expect(storage.sanitizeFileName(`${String.fromCharCode(0)}nul.pdf`)).toBe('nul.pdf');
  });

  it('never returns an empty name', () => {
    expect(storage.sanitizeFileName('...')).toBe('file');
    expect(storage.sanitizeFileName('')).toBe('file');
  });

  it('bounds the length', () => {
    expect(storage.sanitizeFileName(`${'a'.repeat(500)}.pdf`).length).toBeLessThanOrEqual(200);
  });
});

describe('path traversal defence', () => {
  it('refuses to resolve a stored reference outside the root', () => {
    const config = configWith('./storage/attachments');

    expect(() => storage.resolveStoredPath('../../../etc/passwd', config)).toThrow(
      /outside the storage directory/
    );
  });

  it('resolves an ordinary reference inside the root', () => {
    const config = configWith('./storage/attachments');
    const resolved = storage.resolveStoredPath('asset-id/file.pdf', config);

    expect(resolved.startsWith(storage.storageRoot(config))).toBe(true);
  });
});

describe('upload type validation (REQ-FILE-004, §5.3)', () => {
  const file = (originalname, mimetype) => ({ originalname, mimetype });

  it.each([
    ['doc.pdf', 'application/pdf'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.png', 'image/png'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('accepts %s', (name, type) => {
    expect(() => storage.assertAllowedType(file(name, type))).not.toThrow();
  });

  it.each([
    ['evil.exe', 'application/x-msdownload'],
    ['script.js', 'text/javascript'],
    ['page.html', 'text/html'],
    ['vector.svg', 'image/svg+xml'],
  ])('rejects %s', (name, type) => {
    expect(() => storage.assertAllowedType(file(name, type))).toThrow(ValidationError);
  });

  it('rejects a mismatch between extension and declared type', () => {
    expect(() => storage.assertAllowedType(file('evil.exe', 'application/pdf'))).toThrow();
  });

  it('restricts floor plans to raster images', () => {
    const asFloorPlan = { mimeTypes: storage.FLOOR_PLAN_MIME_TYPES, label: 'floor plan' };

    expect(() =>
      storage.assertAllowedType(file('plan.png', 'image/png'), asFloorPlan)
    ).not.toThrow();
    expect(() =>
      storage.assertAllowedType(file('plan.pdf', 'application/pdf'), asFloorPlan)
    ).toThrow(ValidationError);
  });
});
