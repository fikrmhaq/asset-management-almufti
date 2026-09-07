import { describe, it, expect } from 'vitest';
import request from 'supertest';

import { buildTestApp } from './helpers/testApp.js';

/** `GET /api/health` — 05-infrastructure.md §8.2. */

describe('health endpoint', () => {
  it('reports ok when both datastores answer', async () => {
    const response = await request(buildTestApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' } },
    });
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
  });

  it('reports degraded with 503 when the database is unreachable', async () => {
    const app = buildTestApp({
      health: {
        checkDatabase: async () => {
          throw new Error('connection refused');
        },
      },
    });
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks).toEqual({
      database: { status: 'down' },
      redis: { status: 'up' },
    });
  });

  it('reports degraded when Redis is unreachable', async () => {
    const app = buildTestApp({
      health: {
        checkRedis: async () => {
          throw new Error('connection refused');
        },
      },
    });
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body.checks.redis.status).toBe('down');
  });

  it('never discloses why a check failed', async () => {
    const app = buildTestApp({
      health: {
        checkDatabase: async () => {
          throw new Error('password authentication failed for user "asset_app"');
        },
      },
    });
    const response = await request(app).get('/api/health');

    expect(JSON.stringify(response.body)).not.toMatch(/password|asset_app/);
  });

  it('is served outside the version prefix so infrastructure polling is stable', async () => {
    // Not 200: there is no health endpoint under the version prefix. It answers
    // 401 rather than 404 because everything under /api/v1 except /auth sits
    // behind `authenticate` — the health probe must stay outside it, or Nginx
    // and Docker would need a token to poll it.
    const versioned = await request(buildTestApp()).get('/api/v1/health');

    expect(versioned.status).toBe(401);
  });
});
