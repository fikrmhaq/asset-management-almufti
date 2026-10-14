import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';

import { mainDatabaseUrl, query } from './helpers/db.js';

// Point the process-wide config at the verification database BEFORE the
// application modules below are required — they memoize their connections on
// first load. `loadDotEnvFiles` never overwrites an already-set variable, so
// this wins over `.env`.
process.env.DATABASE_URL = mainDatabaseUrl();

// Lift the global rate limit for the shared app. Every test here calls the API
// from the same address, so the ceiling would trip partway through and turn
// later assertions into unexplained 429s.
process.env.RATE_LIMIT_MAX = '10000';

const require = createRequire(import.meta.url);

const { getConfig, loadConfig } = require('../../src/config/index.js');
const { createApp } = require('../../src/app.js');
const { createLogger } = require('../../src/logger.js');
const { getModels } = require('../../src/db/models/index.js');
const { closeSequelize } = require('../../src/db/sequelize.js');
const { getRedis, closeRedis } = require('../../src/db/redis.js');
const { hashPassword } = require('../../src/auth/password.js');
const { bootstrapAdmin, BootstrapError } = require('../../src/auth/bootstrapService.js');
const { revokeAllUserSessions } = require('../../src/auth/sessionStore.js');
const { resolvePrincipal } = require('../../src/auth/principal.js');
const { allPermissionCodes } = require('../../src/auth/permissionCatalog.js');
const { seed } = require('./helpers/db.js');

/**
 * End-to-end authentication and authorization — `IMPLEMENTATION_PLAN.md` §9.5.
 *
 * Runs against real PostgreSQL and real Redis: session revocation is the whole
 * point of the Redis dependency (`05-infrastructure.md` §6.2), and stubbing it
 * would test nothing that matters.
 */

const PASSWORD = 'correct-horse-battery-staple';
const AUTH = '/api/v1/auth';

let app;
let models;
let config;

/** Extracts the refresh cookie from a login response. */
function refreshCookieFrom(response) {
  const cookies = response.headers['set-cookie'] ?? [];
  return cookies.find((cookie) => cookie.startsWith('refreshToken='));
}

async function createUser({
  username,
  password = PASSWORD,
  isActive = true,
  institutionId = null,
  roleName = null,
}) {
  const user = await models.User.create({
    username,
    passwordHash: await hashPassword(password),
    firstName: 'Test',
    lastName: 'User',
    institutionId,
    isActive,
  });

  if (roleName) {
    const role = await models.Role.findOne({ where: { name: roleName } });
    await models.UserRole.create({ userId: user.id, roleId: role.id });
  }

  return user;
}

async function login(username, password = PASSWORD) {
  return request(app).post(`${AUTH}/login`).send({ username, password });
}

beforeAll(async () => {
  // The permission seeder is new in this phase; make sure the catalog is loaded.
  await seed();

  config = getConfig();
  const logger = createLogger(config);
  logger.silent = true;

  models = getModels();
  app = createApp({ config, logger });

  await getRedis()
    .connect()
    .catch(() => {});
});

afterAll(async () => {
  await models.UserRole.destroy({ where: {} });
  await models.User.destroy({ where: {} });
  await models.Institution.destroy({ where: {} });
  await closeSequelize();
  await closeRedis();
});

beforeEach(async () => {
  await models.UserRole.destroy({ where: {} });
  await models.User.destroy({ where: {} });
  await models.Institution.destroy({ where: {} });
});

describe('permission catalog seeding', () => {
  it('seeds every derived code into ref.permissions (REQ-ROLE-006)', async () => {
    const rows = await query('SELECT code FROM ref.permissions ORDER BY code');

    expect(rows.map((row) => row.code)).toEqual([...allPermissionCodes()].sort());
  });

  it('grants every permission to the System Admin role (§10.3)', async () => {
    const [{ granted }] = await query(`
      SELECT count(*)::int AS granted
        FROM public.role_permissions rp
        JOIN ref.roles r ON r.id = rp.role_id
       WHERE r.name = 'System Admin'
    `);

    expect(granted).toBe(allPermissionCodes().length);
  });

  it('is idempotent — re-seeding changes no counts', async () => {
    const before = await query('SELECT count(*)::int AS n FROM ref.permissions');
    await seed();
    const after = await query('SELECT count(*)::int AS n FROM ref.permissions');

    expect(after[0].n).toBe(before[0].n);
  });
});

describe('POST /auth/login (REQ-AUTH-002)', () => {
  it('returns an access token and the user profile', async () => {
    await createUser({ username: 'alice', roleName: 'System Admin' });

    const response = await login('alice');

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.user).toMatchObject({ username: 'alice', isSystemWide: true });
    expect(response.body.data.user.permissions.length).toBe(allPermissionCodes().length);
  });

  it('sets the refresh token as an httpOnly cookie (§6.1)', async () => {
    await createUser({ username: 'alice' });

    const cookie = refreshCookieFrom(await login('alice'));

    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/i);
  });

  it('never returns the refresh token in the body', async () => {
    await createUser({ username: 'alice' });

    expect(JSON.stringify((await login('alice')).body)).not.toMatch(/refreshToken/);
  });

  it('never returns the password hash', async () => {
    await createUser({ username: 'alice' });

    expect(JSON.stringify((await login('alice')).body)).not.toMatch(/\$2b\$|passwordHash/);
  });

  it('rejects a wrong password (REQ-AUTH-004)', async () => {
    await createUser({ username: 'alice' });

    const response = await login('alice', 'wrong-password');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('uses one indistinguishable message for unknown user, wrong password and inactive account', async () => {
    await createUser({ username: 'alice' });
    await createUser({ username: 'dormant', isActive: false });

    const [unknown, wrong, inactive] = await Promise.all([
      login('nobody'),
      login('alice', 'wrong-password'),
      login('dormant'),
    ]);

    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    expect(wrong.body.error.message).toBe(inactive.body.error.message);
    expect(unknown.body.error.message).not.toMatch(/not found|inactive|deactivated/i);
  });

  it('refuses an inactive user (REQ-USER-004)', async () => {
    await createUser({ username: 'dormant', isActive: false });

    expect((await login('dormant')).status).toBe(401);
  });

  it('validates the request body', async () => {
    const response = await request(app).post(`${AUTH}/login`).send({ username: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.map((d) => d.field)).toContain('body.password');
  });
});

describe('POST /auth/refresh (REQ-AUTH-005)', () => {
  it('issues a new access token from a valid refresh cookie', async () => {
    await createUser({ username: 'alice', roleName: 'System Admin' });
    const cookie = refreshCookieFrom(await login('alice'));

    const response = await request(app).post(`${AUTH}/refresh`).set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.user.username).toBe('alice');
  });

  it('rejects a request with no refresh cookie', async () => {
    expect((await request(app).post(`${AUTH}/refresh`)).status).toBe(401);
  });

  it('rejects a forged refresh cookie', async () => {
    const response = await request(app)
      .post(`${AUTH}/refresh`)
      .set('Cookie', 'refreshToken=not.a.real.token');

    expect(response.status).toBe(401);
  });

  it('reflects a permission change without waiting for the token to expire', async () => {
    const user = await createUser({ username: 'alice', roleName: 'System Admin' });
    const cookie = refreshCookieFrom(await login('alice'));

    await models.UserRole.destroy({ where: { userId: user.id } });
    const response = await request(app).post(`${AUTH}/refresh`).set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.user.permissions).toEqual([]);
  });

  it('stops refreshing once the account is deactivated (REQ-USER-004, §6.2)', async () => {
    const user = await createUser({ username: 'alice' });
    const cookie = refreshCookieFrom(await login('alice'));

    await user.update({ isActive: false });

    expect((await request(app).post(`${AUTH}/refresh`).set('Cookie', cookie)).status).toBe(401);
  });

  it('stops refreshing once every session for the user is revoked', async () => {
    const user = await createUser({ username: 'alice' });
    const cookie = refreshCookieFrom(await login('alice'));

    expect(await revokeAllUserSessions(user.id)).toBeGreaterThan(0);

    expect((await request(app).post(`${AUTH}/refresh`).set('Cookie', cookie)).status).toBe(401);
  });
});

describe('POST /auth/logout (REQ-AUTH-003)', () => {
  it('revokes the session so the refresh token stops working', async () => {
    await createUser({ username: 'alice' });
    const loginResponse = await login('alice');
    const cookie = refreshCookieFrom(loginResponse);
    const { accessToken } = loginResponse.body.data;

    const logout = await request(app)
      .post(`${AUTH}/logout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', cookie);
    expect(logout.status).toBe(204);

    const afterLogout = await request(app).post(`${AUTH}/refresh`).set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });

  it('clears the refresh cookie', async () => {
    await createUser({ username: 'alice' });
    const loginResponse = await login('alice');

    const logout = await request(app)
      .post(`${AUTH}/logout`)
      .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
      .set('Cookie', refreshCookieFrom(loginResponse));

    expect((logout.headers['set-cookie'] ?? []).join(';')).toMatch(/refreshToken=;/);
  });

  it('requires authentication', async () => {
    expect((await request(app).post(`${AUTH}/logout`)).status).toBe(401);
  });

  it('leaves a second logout harmless', async () => {
    await createUser({ username: 'alice' });
    const loginResponse = await login('alice');
    const cookie = refreshCookieFrom(loginResponse);
    const auth = `Bearer ${loginResponse.body.data.accessToken}`;

    await request(app).post(`${AUTH}/logout`).set('Authorization', auth).set('Cookie', cookie);
    const second = await request(app)
      .post(`${AUTH}/logout`)
      .set('Authorization', auth)
      .set('Cookie', cookie);

    expect(second.status).toBe(204);
  });
});

describe('login is not rate-limited', () => {
  it('keeps answering repeated attempts with 401, never 429', async () => {
    // A separate app with a tiny global ceiling that login must not count against.
    const limited = createApp({
      config: loadConfig({ ...process.env, RATE_LIMIT_MAX: '3' }),
      logger: Object.assign(createLogger(config), { silent: true }),
    });

    await createUser({ username: 'target' });

    const attempts = [];
    for (let i = 0; i < 15; i += 1) {
      attempts.push(
        await request(limited).post(`${AUTH}/login`).send({
          username: 'target',
          password: 'wrong-password',
        })
      );
    }

    expect(attempts.every((response) => response.status === 401)).toBe(true);
  });
});

describe('GET /auth/me (REQ-AUTH-001)', () => {
  it('returns the caller profile, roles and effective permissions', async () => {
    await createUser({ username: 'alice', roleName: 'System Admin' });
    const { accessToken } = (await login('alice')).body.data;

    const response = await request(app)
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ username: 'alice', isSystemWide: true });
    expect(response.body.data.roles[0].name).toBe('System Admin');
    expect(response.body.data.permissions).toContain('asset:create');
  });

  it('requires a token', async () => {
    expect((await request(app).get(`${AUTH}/me`)).status).toBe(401);
  });

  it('never exposes the password hash', async () => {
    await createUser({ username: 'alice' });
    const { accessToken } = (await login('alice')).body.data;

    const response = await request(app)
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(JSON.stringify(response.body)).not.toMatch(/\$2b\$|passwordHash/);
  });
});

describe('permission and scope resolution against real data', () => {
  it('resolves permissions through role grants', async () => {
    const user = await createUser({ username: 'alice', roleName: 'System Admin' });

    const principal = await resolvePrincipal(user.id);

    expect(principal.permissions.size).toBe(allPermissionCodes().length);
    expect(principal.isSystemWide).toBe(true);
  });

  it('gives a user with no roles no permissions', async () => {
    const user = await createUser({ username: 'nobody' });

    const principal = await resolvePrincipal(user.id);

    expect([...principal.permissions]).toEqual([]);
    expect(principal.isSystemWide).toBe(false);
  });

  it('returns null for an inactive user, so no token can be honoured', async () => {
    const user = await createUser({ username: 'dormant', isActive: false });

    expect(await resolvePrincipal(user.id)).toBeNull();
  });

  it('scopes an institution-bound user without a system-wide role (BR-007)', async () => {
    const institution = await models.Institution.create({
      name: 'Test Institution',
      code: 'SCOPE-1',
      address: 'Somewhere',
    });
    const role = await models.Role.create({ name: 'Scoped Role', isSystemWide: false });
    const user = await createUser({ username: 'scoped', institutionId: institution.id });
    await models.UserRole.create({ userId: user.id, roleId: role.id });

    const principal = await resolvePrincipal(user.id);

    expect(principal.isSystemWide).toBe(false);
    expect(principal.institutionId).toBe(institution.id);

    await models.UserRole.destroy({ where: { roleId: role.id } });
    await role.destroy();
  });
});

describe('bootstrap command (§9.4, 05-infrastructure.md §10.3)', () => {
  it('creates the first user with the System Admin role', async () => {
    const created = await bootstrapAdmin({ username: 'root', password: PASSWORD });

    expect(created).toMatchObject({ username: 'root', role: 'System Admin' });

    const principal = await resolvePrincipal(created.id);
    expect(principal.isSystemWide).toBe(true);
    expect(principal.permissions.size).toBe(allPermissionCodes().length);
  });

  it('produces an account that can actually sign in', async () => {
    await bootstrapAdmin({ username: 'root', password: PASSWORD });

    const response = await login('root');

    expect(response.status).toBe(200);
    expect(response.body.data.user.username).toBe('root');
  });

  it('refuses to run once any user exists', async () => {
    await createUser({ username: 'existing' });

    await expect(bootstrapAdmin({ username: 'root', password: PASSWORD })).rejects.toThrow(
      BootstrapError
    );
  });

  it('refuses a password below the minimum length', async () => {
    await expect(bootstrapAdmin({ username: 'root', password: 'short' })).rejects.toThrow(
      /at least 12 characters/
    );
  });

  it('refuses a missing username', async () => {
    await expect(bootstrapAdmin({ password: PASSWORD })).rejects.toThrow(/username is required/i);
  });

  it('stores a bcrypt hash, never the password itself', async () => {
    await bootstrapAdmin({ username: 'root', password: PASSWORD });

    const [row] = await query('SELECT password_hash FROM public.users WHERE username = $1', [
      'root',
    ]);

    expect(row.password_hash).toMatch(/^\$2b\$12\$/);
    expect(row.password_hash).not.toContain(PASSWORD);
  });
});
