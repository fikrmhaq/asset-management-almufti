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
 * Login itself is no longer rate-limited at all (removed by request), and is
 * exempt from the app-wide limiter too.
 */

const V1 = '/api/v1';

/** A refresh ceiling the tests below can reach. */
const app = () =>
  buildTestApp({
    env: {
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

  it('never throttles login, even past the global ceiling', async () => {
    // A global ceiling of 2, so anything that still counted login would trip.
    const server = buildTestApp({ env: { RATE_LIMIT_MAX: '2' } });

    const statuses = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await request(server)
        .post(`${V1}/auth/login`)
        .send({ username: '', password: '' });
      statuses.push(response.status);
    }

    // Empty credentials fail validation (400) before touching the database —
    // the point is that none of them is a 429.
    expect(statuses).not.toContain(429);
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
