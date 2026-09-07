import { describe, it, expect } from 'vitest';
import request from 'supertest';

import { buildTestApp } from './helpers/testApp.js';

/** Application bootstrap, routing and the response envelopes of `06-api.md` §1.4. */

describe('application bootstrap', () => {
  it('creates an Express application', () => {
    expect(typeof buildTestApp()).toBe('function');
  });

  it('does not advertise the server implementation', async () => {
    const response = await request(buildTestApp()).get('/api/v1');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sets security headers (§12.3)', async () => {
    const response = await request(buildTestApp()).get('/api/v1');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });

  it('assigns and echoes a request id', async () => {
    const response = await request(buildTestApp()).get('/api/v1');

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('preserves an inbound request id for correlation', async () => {
    const response = await request(buildTestApp())
      .get('/api/v1')
      .set('x-request-id', 'trace-abc-123');

    expect(response.headers['x-request-id']).toBe('trace-abc-123');
  });
});

describe('API versioning (§1.1)', () => {
  it('mounts the v1 router and wraps its body in the data envelope', async () => {
    const response = await request(buildTestApp()).get('/api/v1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { version: 'v1' } });
  });
});

describe('404 handling', () => {
  it('returns the documented NOT_FOUND envelope for an unknown path', async () => {
    const response = await request(buildTestApp()).get('/nope');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toContain('/nope');
  });

  it('returns JSON, not an HTML error page', async () => {
    const response = await request(buildTestApp()).get('/nope');

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  it('answers an unknown versioned path with 401 before 404 when unauthenticated', async () => {
    // Everything under /api/v1 except /auth sits behind `authenticate`, so an
    // unidentified caller is told to authenticate rather than which paths exist.
    // Same ordering as the permission middleware's 401-before-403.
    const response = await request(buildTestApp()).get('/api/v1/does-not-exist');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('request body handling', () => {
  it('rejects malformed JSON as a validation error', async () => {
    const response = await request(buildTestApp())
      .post('/api/v1')
      .set('content-type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toMatch(/valid JSON/);
  });

  it('rejects a body larger than the configured limit', async () => {
    const app = buildTestApp({ env: { MAX_REQUEST_BODY_KB: '1' } });
    const response = await request(app)
      .post('/api/v1')
      .set('content-type', 'application/json')
      .send({ payload: 'x'.repeat(4096) });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/too large/);
  });
});

describe('CORS (§12.3)', () => {
  it('allows a configured origin', async () => {
    const response = await request(buildTestApp())
      .get('/api/v1')
      .set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects an unconfigured origin', async () => {
    const response = await request(buildTestApp())
      .get('/api/v1')
      .set('Origin', 'https://evil.example.test');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('allows requests with no Origin, such as health probes', async () => {
    const response = await request(buildTestApp()).get('/api/v1');

    expect(response.status).toBe(200);
  });
});

describe('rate limiting (REQ-NFR-SEC-004)', () => {
  it('rejects requests past the configured limit', async () => {
    const app = buildTestApp({ env: { RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' } });

    await request(app).get('/api/v1');
    await request(app).get('/api/v1');
    const limited = await request(app).get('/api/v1');

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('advertises the limit in standard headers', async () => {
    const app = buildTestApp({ env: { RATE_LIMIT_MAX: '5' } });
    const response = await request(app).get('/api/v1');

    expect(response.headers['ratelimit-limit']).toBe('5');
  });
});
