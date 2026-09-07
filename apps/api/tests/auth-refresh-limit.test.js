import { describe, it, expect } from 'vitest';
import request from 'supertest';

import { buildTestApp } from './helpers/testApp.js';

/**
 * `/auth/refresh` must not be rate-limited as if it were `/auth/login`.
 *
 * THE REGRESSION. Refresh shared the login limiter, capped at 10 per 15 minutes.
 * A page load spends exactly one refresh, so the eleventh reload answered `429`,
 * the client read that as "not signed in", and the user was silently signed out
 * of a session that was perfectly valid.
 *
 * The two are not the same kind of endpoint. Login accepts a guessable secret
 * and the ceiling is what makes guessing impractical. Refresh is authenticated
 * by a signed httpOnly cookie — there is nothing to guess — and is spent by
 * ordinary navigation.
 *
 * The config is INJECTED with a deliberately tiny login ceiling, because that is
 * the only way this test can fail against the old code. The database suite sets
 * `AUTH_RATE_LIMIT_MAX=10000` so its own logins are never throttled, which would
 * make a test there pass whether or not the limiters were separate.
 */

const V1 = '/api/v1';

/** A login ceiling of 2, and a refresh ceiling well above it. */
const app = () =>
  buildTestApp({
    env: {
      AUTH_RATE_LIMIT_MAX: '2',
      AUTH_RATE_LIMIT_WINDOW_MS: '900000',
      REFRESH_RATE_LIMIT_MAX: '25',
      REFRESH_RATE_LIMIT_WINDOW_MS: '900000',
    },
  });

describe('refresh is not behind the login limiter', () => {
  it('keeps answering past the login ceiling', async () => {
    const server = app();

    const statuses = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(server).post(`${V1}/auth/refresh`);
      statuses.push(response.status);
    }

    // No cookie is sent, so every one of these is a 401 — the point is that
    // none of them is a 429. Against the old code, attempts 3 onward were.
    expect(statuses).toHaveLength(10);
    expect(statuses.every((status) => status === 401)).toBe(true);
    expect(statuses).not.toContain(429);
  });

  it('still throttles login at its own ceiling', async () => {
    const server = app();

    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(server)
        .post(`${V1}/auth/login`)
        .send({ username: 'nobody', password: 'wrong-password' });
      statuses.push(response.status);
    }

    // The control that makes password guessing impractical is untouched.
    expect(statuses).toContain(429);
  });

  it('throttles refresh eventually, so a replayed cookie is not free', async () => {
    const server = app();

    const statuses = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await request(server).post(`${V1}/auth/refresh`);
      statuses.push(response.status);
    }

    // A ceiling still exists — it is simply set where normal use cannot reach it.
    expect(statuses).toContain(429);
  });

  it('answers a missing cookie with 401, never 429', async () => {
    const response = await request(app()).post(`${V1}/auth/refresh`);

    // The client signs out on 401 and only on 401, so this has to stay exact.
    expect(response.status).toBe(401);
  });
});
