import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

import { TEST_ENV } from './helpers/testApp.js';

const require = createRequire(import.meta.url);

const { loadConfig } = require('../src/config/index.js');
const {
  hashPassword,
  verifyPassword,
  COST_FACTOR,
  HASH_LENGTH,
} = require('../src/auth/password.js');
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  durationToMs,
} = require('../src/auth/tokens.js');
const {
  getCatalog,
  allPermissionCodes,
  systemWideOnlyCodes,
  isKnownPermission,
  permissionCode,
} = require('../src/auth/permissionCatalog.js');
const {
  hasPermission,
  organizationScope,
  scopeWhere,
  toPublicProfile,
} = require('../src/auth/principal.js');

const config = loadConfig(TEST_ENV);

/** Password hashing — 05-infrastructure.md §6.3, REQ-NFR-SEC-001. */
describe('password hashing', () => {
  it('uses bcrypt at cost factor 12', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(COST_FACTOR).toBe(12);
    expect(hash.startsWith('$2b$12$')).toBe(true);
  });

  it('produces a hash that fits the CHAR(60) column', async () => {
    expect(await hashPassword('anything')).toHaveLength(HASH_LENGTH);
  });

  it('salts, so the same password hashes differently each time', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);

    expect(first).not.toBe(second);
    expect(await verifyPassword('same', first)).toBe(true);
    expect(await verifyPassword('same', second)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPassword('wrong', await hashPassword('right'))).toBe(false);
  });

  it.each([
    ['an empty hash', ''],
    ['a malformed hash', 'not-a-bcrypt-hash'],
    ['a null hash', null],
  ])('returns false rather than throwing for %s', async (label, hash) => {
    expect(await verifyPassword('password', hash)).toBe(false);
  });

  it('refuses to hash an empty password', async () => {
    await expect(hashPassword('')).rejects.toThrow(TypeError);
  });
});

/** JWT issuing — 05-infrastructure.md §6.1. */
describe('tokens', () => {
  const claims = { userId: 'user-1', roleIds: ['role-1'], institutionId: 'inst-1' };

  it('carries userId, roleIds and institutionId on the access token', () => {
    const payload = verifyAccessToken(signAccessToken(claims, config), config);

    expect(payload.sub).toBe('user-1');
    expect(payload.roleIds).toEqual(['role-1']);
    expect(payload.institutionId).toBe('inst-1');
  });

  it('normalizes an absent institution to null rather than omitting it', () => {
    const token = signAccessToken({ ...claims, institutionId: undefined }, config);

    expect(verifyAccessToken(token, config).institutionId).toBeNull();
  });

  it('carries only a session id on the refresh token, never permissions', () => {
    const payload = verifyRefreshToken(
      signRefreshToken({ userId: 'user-1', sessionId: 'sess-1' }, config),
      config
    );

    expect(payload.sessionId).toBe('sess-1');
    expect(payload).not.toHaveProperty('roleIds');
  });

  it('refuses a refresh token presented as an access token', () => {
    const refreshToken = signRefreshToken({ userId: 'u', sessionId: 's' }, config);

    expect(() => verifyAccessToken(refreshToken, config)).toThrow();
  });

  it('refuses an access token presented as a refresh token', () => {
    expect(() => verifyRefreshToken(signAccessToken(claims, config), config)).toThrow();
  });

  it('refuses a token signed with the wrong secret', () => {
    const other = loadConfig({
      ...TEST_ENV,
      JWT_ACCESS_SECRET: 'z'.repeat(48),
      JWT_REFRESH_SECRET: 'y'.repeat(48),
    });

    expect(() => verifyAccessToken(signAccessToken(claims, other), config)).toThrow();
  });

  it('reports an expired token distinctly', () => {
    const expired = loadConfig({ ...TEST_ENV, JWT_ACCESS_EXPIRY: '-1s' });

    expect(() => verifyAccessToken(signAccessToken(claims, expired), config)).toThrow(/expired/i);
  });

  it('refuses a tampered token', () => {
    const token = signAccessToken(claims, config);
    const [header, , signature] = token.split('.');
    const forged = `${header}.${Buffer.from('{"sub":"admin"}').toString('base64url')}.${signature}`;

    expect(() => verifyAccessToken(forged, config)).toThrow();
  });

  it.each([
    ['15m', 900000],
    ['7d', 604800000],
    ['30s', 30000],
    ['1h', 3600000],
    ['500ms', 500],
    [3600, 3600000],
  ])('converts a duration of %s to %i ms', (input, expected) => {
    expect(durationToMs(input)).toBe(expected);
  });
});

/** Permission catalog — 06-api.md §1.3, REQ-ROLE-006, BR-013. */
describe('permission catalog', () => {
  it('derives every code as {resource}:{action}', () => {
    for (const entry of getCatalog()) {
      expect(entry.code).toBe(permissionCode(entry.resource, entry.action));
      expect(entry.code).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });

  it('contains no duplicate codes', () => {
    const codes = allPermissionCodes();

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every code a description', () => {
    expect(getCatalog().every((entry) => entry.description.length > 0)).toBe(true);
  });

  it.each([
    'institution:create',
    'user:deactivate',
    'role:delete',
    'classification:read',
    'asset:create',
    'asset-unit:record-history',
    'attachment:read',
    'borrowing:return',
    'borrowing:extend',
    'transaction:create',
    'audit-log:read',
    // Phase 17 (`CR-001`): classifications became writable for application-defined
    // nodes. The permission exists; `BR-016` is what keeps government rows safe.
    'classification:create',
    'classification:promote',
  ])('includes the documented code %s', (code) => {
    expect(isKnownPermission(code)).toBe(true);
  });

  it.each([
    ['permission:create', 'the catalog is fixed (BR-013)'],
    ['transaction:update', 'transactions are immutable (REQ-TXN-007)'],
    ['audit-log:delete', 'audit records are immutable (REQ-AUDIT-003)'],
  ])('excludes %s because %s', (code) => {
    expect(isKnownPermission(code)).toBe(false);
  });

  it('marks the management resources that require a system-wide role (BR-015)', () => {
    const codes = systemWideOnlyCodes();

    expect(codes).toContain('institution:create');
    expect(codes).toContain('role:update');
    expect(codes).toContain('role-permission:update');
    expect(codes).not.toContain('asset:create');
  });

  it('keeps every role and role-permission WRITE system-wide-only (BR-015)', () => {
    const codes = systemWideOnlyCodes();

    // Roles stay authored centrally. `CR-002` opened delegation of ASSIGNMENT,
    // not of authoring, and this is the line between the two.
    for (const code of ['role:create', 'role:update', 'role:delete', 'role-permission:update']) {
      expect(codes, code).toContain(code);
    }
  });

  it('exempts role reads so an institution admin can see what they are assigning', () => {
    const codes = systemWideOnlyCodes();

    // REQ-ROLE-010: assigning a role without being able to read what it grants
    // is assigning blind.
    expect(codes).not.toContain('role:read');
    expect(codes).not.toContain('role-permission:read');
  });

  it('lets a scoped role assign roles at all (REQ-ROLE-010)', () => {
    const codes = systemWideOnlyCodes();

    // `user-role` left SYSTEM_WIDE_RESOURCES entirely. Assignment is bounded by
    // the ceiling in the users service (BR-022), not by BR-015.
    for (const code of ['user-role:create', 'user-role:delete', 'user-role:read']) {
      expect(codes, code).not.toContain(code);
    }
  });

  it('keeps the permission catalog itself system-wide-only', () => {
    // Only someone editing a role's grants needs the full catalog, and editing
    // grants is system-wide-only.
    expect(systemWideOnlyCodes()).toContain('permission:read');
  });

  it('groups every code for the role-permission checklist (07-ui.md §5.1)', () => {
    const groups = new Set(getCatalog().map((entry) => entry.group));

    expect(groups).toEqual(
      new Set([
        'Organization',
        'Reference',
        'Asset Core',
        'Procurement',
        'Operations',
        'Reports',
        'Audit',
      ])
    );
  });

  it('rejects an unknown code', () => {
    expect(isKnownPermission('asset:teleport')).toBe(false);
  });
});

/** Authorization decisions — REQ-AUTHZ-004/005, BR-007. */
describe('principal', () => {
  const scoped = {
    userId: 'u1',
    username: 'scoped',
    institutionId: 'inst-1',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Asset Manager', isSystemWide: false }],
    permissions: new Set(['asset:read', 'asset:create']),
    isSystemWide: false,
  };

  const systemWide = {
    ...scoped,
    userId: 'u2',
    username: 'admin',
    institutionId: null,
    roles: [{ id: 'r2', name: 'System Admin', isSystemWide: true }],
    isSystemWide: true,
  };

  it('grants a held permission', () => {
    expect(hasPermission(scoped, 'asset:read')).toBe(true);
  });

  it('denies one that was never granted', () => {
    expect(hasPermission(scoped, 'asset:deactivate')).toBe(false);
  });

  it('gives a system-wide role no implicit permissions it was not granted', () => {
    const admin = { ...systemWide, permissions: new Set(['asset:read']) };

    expect(hasPermission(admin, 'institution:create')).toBe(false);
  });

  it('scopes an ordinary user to their own institution (BR-007)', () => {
    expect(organizationScope(scoped)).toEqual({ unrestricted: false, institutionId: 'inst-1' });
    expect(scopeWhere(scoped)).toEqual({ institutionId: 'inst-1' });
  });

  it('lifts the scope for a system-wide role (REQ-AUTHZ-005)', () => {
    expect(organizationScope(systemWide).unrestricted).toBe(true);
    expect(scopeWhere(systemWide)).toEqual({});
  });

  it('does not let a null institution widen access on its own (REQ-AUTHZ-005)', () => {
    const unassigned = { ...scoped, institutionId: null };

    expect(scopeWhere(unassigned)).toEqual({ institutionId: null });
  });

  it('applies the scope to whichever column the model uses', () => {
    expect(scopeWhere(scoped, 'ownerInstitutionId')).toEqual({ ownerInstitutionId: 'inst-1' });
  });

  // Async since Phase 22 (`CR-003`): the profile now resolves the caller's
  // current PIC departments, so a PIC-scoped role needs no `department:read`.
  it('never exposes a password hash in the public profile', async () => {
    const profile = await toPublicProfile(scoped, {
      models: { Department: { findAll: async () => [] } },
    });

    expect(JSON.stringify(profile)).not.toMatch(/password/i);
    expect(profile.permissions).toEqual(['asset:create', 'asset:read']);
  });
});
