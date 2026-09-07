import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';

import { silentLogger, TEST_ENV } from './helpers/testApp.js';

const require = createRequire(import.meta.url);

const { loadConfig } = require('../src/config/index.js');
const { authenticate } = require('../src/middleware/authenticate.js');
const { requirePermission, requireAnyPermission } = require('../src/middleware/authorize.js');
const { errorHandler } = require('../src/middleware/errorHandler.js');
const { signAccessToken, signRefreshToken } = require('../src/auth/tokens.js');
const { sendItem } = require('../src/http/respond.js');

const config = loadConfig(TEST_ENV);

function principalFor({ permissions = [], isSystemWide = false, institutionId = 'inst-1' } = {}) {
  return {
    userId: 'user-1',
    username: 'tester',
    institutionId,
    roleIds: ['role-1'],
    roles: [{ id: 'role-1', name: 'Tester', isSystemWide }],
    permissions: new Set(permissions),
    isSystemWide,
  };
}

/**
 * Builds a guarded app. `resolve` stands in for the database lookup, so the
 * middleware's decisions are tested without a live database.
 */
function guardedApp({ resolve, guard = requirePermission('asset:read') } = {}) {
  const app = express();
  app.get('/guarded', authenticate({ resolve, config }), guard, (req, res) =>
    sendItem(res, { institutionId: req.principal.institutionId })
  );
  app.use(errorHandler({ logger: silentLogger() }));
  return app;
}

const bearer = (token) => ['Authorization', `Bearer ${token}`];

function tokenFor(overrides = {}) {
  return signAccessToken(
    { userId: 'user-1', roleIds: ['role-1'], institutionId: 'inst-1', ...overrides },
    config
  );
}

/** Authentication middleware — 06-api.md §1.2, REQ-AUTHZ-001/003. */
describe('authenticate', () => {
  it('accepts a valid bearer token and attaches the principal', async () => {
    const app = guardedApp({ resolve: async () => principalFor({ permissions: ['asset:read'] }) });
    const response = await request(app)
      .get('/guarded')
      .set(...bearer(tokenFor()));

    expect(response.status).toBe(200);
    expect(response.body.data.institutionId).toBe('inst-1');
  });

  it('rejects a request with no Authorization header', async () => {
    const response = await request(guardedApp({ resolve: async () => principalFor() })).get(
      '/guarded'
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each([
    ['a malformed scheme', 'Basic abc123'],
    ['an empty bearer value', 'Bearer '],
    ['a garbage token', 'Bearer not.a.jwt'],
  ])('rejects %s', async (label, header) => {
    const app = guardedApp({ resolve: async () => principalFor() });
    const response = await request(app).get('/guarded').set('Authorization', header);

    expect(response.status).toBe(401);
  });

  it('reports an expired token as expired, so the client knows to refresh', async () => {
    const expiredConfig = loadConfig({ ...TEST_ENV, JWT_ACCESS_EXPIRY: '-1s' });
    const app = guardedApp({ resolve: async () => principalFor({ permissions: ['asset:read'] }) });

    const response = await request(app)
      .get('/guarded')
      .set(...bearer(signAccessToken({ userId: 'user-1', roleIds: [] }, expiredConfig)));

    expect(response.status).toBe(401);
    expect(response.body.error.message).toMatch(/expired/i);
  });

  it('rejects a refresh token used as an access token', async () => {
    const app = guardedApp({ resolve: async () => principalFor({ permissions: ['asset:read'] }) });
    const refreshToken = signRefreshToken({ userId: 'user-1', sessionId: 's1' }, config);

    const response = await request(app)
      .get('/guarded')
      .set(...bearer(refreshToken));

    expect(response.status).toBe(401);
  });

  it('rejects a token whose account no longer resolves (REQ-USER-004)', async () => {
    // resolvePrincipal returns null for a deleted or deactivated user.
    const app = guardedApp({ resolve: async () => null });

    const response = await request(app)
      .get('/guarded')
      .set(...bearer(tokenFor()));

    expect(response.status).toBe(401);
    expect(response.body.error.message).toMatch(/no longer active/i);
  });

  it('never echoes the token back in an error', async () => {
    const token = tokenFor();
    const app = guardedApp({ resolve: async () => null });

    const response = await request(app)
      .get('/guarded')
      .set(...bearer(token));

    expect(JSON.stringify(response.body)).not.toContain(token);
  });
});

/** Permission middleware — REQ-AUTHZ-002/003, REQ-ROLE-004. */
describe('requirePermission', () => {
  it('allows a caller holding the permission', async () => {
    const app = guardedApp({ resolve: async () => principalFor({ permissions: ['asset:read'] }) });

    expect(
      (
        await request(app)
          .get('/guarded')
          .set(...bearer(tokenFor()))
      ).status
    ).toBe(200);
  });

  it('forbids a caller who is authenticated but unauthorized', async () => {
    const app = guardedApp({
      resolve: async () => principalFor({ permissions: ['asset:create'] }),
    });
    const response = await request(app)
      .get('/guarded')
      .set(...bearer(tokenFor()));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('does not let a system-wide role bypass a permission it lacks', async () => {
    const app = guardedApp({
      resolve: async () => principalFor({ permissions: [], isSystemWide: true }),
    });

    expect(
      (
        await request(app)
          .get('/guarded')
          .set(...bearer(tokenFor()))
      ).status
    ).toBe(403);
  });

  it('returns 401 rather than 403 when nobody is authenticated', async () => {
    // Guard mounted without authenticate: an unidentified caller must not be
    // told whether the resource exists.
    const app = express();
    app.get('/naked', requirePermission('asset:read'), (req, res) => sendItem(res, {}));
    app.use(errorHandler({ logger: silentLogger() }));

    expect((await request(app).get('/naked')).status).toBe(401);
  });

  it('refuses to build a guard for a code outside the catalog', () => {
    expect(() => requirePermission('asset:teleport')).toThrow(/Unknown permission/);
  });

  it('names the catalog in that error, so the fix is obvious', () => {
    expect(() => requirePermission('nonsense:read')).toThrow(/permissionCatalog/);
  });
});

describe('requireAnyPermission', () => {
  it('allows a caller holding one of the listed permissions', async () => {
    const app = guardedApp({
      resolve: async () => principalFor({ permissions: ['asset:update'] }),
      guard: requireAnyPermission('asset:read', 'asset:update'),
    });

    expect(
      (
        await request(app)
          .get('/guarded')
          .set(...bearer(tokenFor()))
      ).status
    ).toBe(200);
  });

  it('forbids a caller holding none of them', async () => {
    const app = guardedApp({
      resolve: async () => principalFor({ permissions: ['vendor:read'] }),
      guard: requireAnyPermission('asset:read', 'asset:update'),
    });

    expect(
      (
        await request(app)
          .get('/guarded')
          .set(...bearer(tokenFor()))
      ).status
    ).toBe(403);
  });
});
