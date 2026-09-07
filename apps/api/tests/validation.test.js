import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

import { silentLogger } from './helpers/testApp.js';

const require = createRequire(import.meta.url);

const { validate } = require('../src/middleware/validate.js');
const { errorHandler } = require('../src/middleware/errorHandler.js');
const { paginationSchema, toLimitOffset, MAX_PAGE_SIZE } = require('../src/query/pagination.js');
const { sortingSchema, toOrder } = require('../src/query/sorting.js');
const { buildWhere, activeStatus, contains, escapeLike } = require('../src/query/filtering.js');
const { sendList } = require('../src/http/respond.js');
const { ValidationError } = require('../src/errors/index.js');

function appWith(schemas, handler) {
  const app = express();
  app.use(express.json());
  app.post('/thing/:id', validate(schemas), handler);
  app.get('/things', validate(schemas), handler);
  app.use(errorHandler({ logger: silentLogger() }));
  return app;
}

describe('request validation (REQ-VAL-001/002/006)', () => {
  const bodySchema = z.object({
    name: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
  });

  it('passes validated and coerced values to the handler', async () => {
    const app = appWith({ body: bodySchema }, (req, res) => res.json({ data: req.body }));
    const response = await request(app).post('/thing/1').send({ name: 'Desk', quantity: '3' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ name: 'Desk', quantity: 3 });
  });

  it('returns VALIDATION_ERROR with a field for each problem', async () => {
    const app = appWith({ body: bodySchema }, (req, res) => res.json({ data: req.body }));
    const response = await request(app).post('/thing/1').send({ name: '', quantity: -2 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.map((d) => d.field)).toEqual(['body.name', 'body.quantity']);
  });

  it('prefixes the request part so body and query fields stay distinct', async () => {
    const app = appWith(
      { body: bodySchema, params: z.object({ id: z.string().uuid() }) },
      (req, res) => res.json({ data: {} })
    );
    const response = await request(app).post('/thing/not-a-uuid').send({ name: 'x', quantity: 1 });

    expect(response.body.error.details).toEqual([
      { field: 'params.id', issue: expect.stringMatching(/uuid/i) },
    ]);
  });

  it('reports problems from every request part in one response', async () => {
    const app = appWith(
      { body: bodySchema, params: z.object({ id: z.string().uuid() }) },
      (req, res) => res.json({ data: {} })
    );
    const response = await request(app).post('/thing/bad').send({ name: '' });

    const fields = response.body.error.details.map((d) => d.field);
    expect(fields).toContain('params.id');
    expect(fields).toContain('body.name');
  });

  it('strips unknown keys rather than passing them through', async () => {
    const app = appWith({ body: bodySchema }, (req, res) => res.json({ data: req.body }));
    const response = await request(app)
      .post('/thing/1')
      .send({ name: 'Desk', quantity: 1, isAdmin: true });

    expect(response.body.data).not.toHaveProperty('isAdmin');
  });
});

describe('pagination (§1.5)', () => {
  it('defaults to page 1, pageSize 20', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces numeric strings from the query string', () => {
    expect(paginationSchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('caps pageSize at 100 (REQ-NFR-PERF-002)', () => {
    expect(paginationSchema.safeParse({ pageSize: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
  });

  it.each([['0'], ['-1'], ['abc']])('rejects a page of "%s"', (page) => {
    expect(paginationSchema.safeParse({ page }).success).toBe(false);
  });

  it('converts to limit and offset', () => {
    expect(toLimitOffset({ page: 1, pageSize: 20 })).toEqual({ limit: 20, offset: 0 });
    expect(toLimitOffset({ page: 4, pageSize: 25 })).toEqual({ limit: 25, offset: 75 });
  });
});

describe('list envelope meta (§1.4)', () => {
  function metaFor(pagination) {
    const captured = {};
    const res = {
      status() {
        return this;
      },
      json(body) {
        Object.assign(captured, body);
        return this;
      },
    };
    sendList(res, [], pagination);
    return captured.meta;
  }

  it('computes totalPages from total and pageSize', () => {
    expect(metaFor({ page: 1, pageSize: 20, total: 134 })).toEqual({
      page: 1,
      pageSize: 20,
      total: 134,
      totalPages: 7,
    });
  });

  it('reports zero pages for an empty result set', () => {
    expect(metaFor({ page: 1, pageSize: 20, total: 0 }).totalPages).toBe(0);
  });

  it('does not round a full final page up', () => {
    expect(metaFor({ page: 1, pageSize: 20, total: 40 }).totalPages).toBe(2);
  });
});

describe('sorting (§1.6)', () => {
  it('defaults order to ascending', () => {
    expect(sortingSchema.parse({})).toEqual({ order: 'asc' });
  });

  it('rejects an order other than asc or desc', () => {
    expect(sortingSchema.safeParse({ order: 'sideways' }).success).toBe(false);
  });

  it('builds an order clause for an allowed field', () => {
    expect(toOrder({ sort: 'name', order: 'desc' }, { allowed: ['name', 'createdAt'] })).toEqual([
      ['name', 'DESC'],
    ]);
  });

  it('falls back to the default when no sort is requested', () => {
    const fallback = [['createdAt', 'DESC']];

    expect(toOrder({ order: 'asc' }, { allowed: ['name'], default: fallback })).toBe(fallback);
  });

  it('rejects a field outside the allow-list rather than interpolating it', () => {
    expect(() => toOrder({ sort: 'password_hash', order: 'asc' }, { allowed: ['name'] })).toThrow(
      ValidationError
    );
  });
});

describe('filtering (§1.6)', () => {
  it('returns an empty clause when no filter is supplied', () => {
    expect(buildWhere({}, { status: activeStatus() })).toEqual({});
  });

  it('maps status=active onto the is_active flag', () => {
    expect(buildWhere({ status: 'active' }, { status: activeStatus() })).toEqual({
      isActive: true,
    });
  });

  it('maps status=inactive onto the is_active flag', () => {
    expect(buildWhere({ status: 'inactive' }, { status: activeStatus() })).toEqual({
      isActive: false,
    });
  });

  it('ignores an unrecognized status value', () => {
    expect(buildWhere({ status: 'whatever' }, { status: activeStatus() })).toEqual({});
  });

  it('combines multiple filters with AND (REQ-SEARCH-002)', () => {
    const where = buildWhere(
      { status: 'active', q: 'desk' },
      { status: activeStatus(), q: (value) => contains('name', value) }
    );

    expect(Object.getOwnPropertySymbols(where)).toHaveLength(1);
  });

  it('escapes LIKE wildcards so a search term cannot widen its own match', () => {
    expect(escapeLike('100%_raw\\')).toBe('100\\%\\_raw\\\\');
  });

  it('never derives a filter from an undeclared query param', () => {
    expect(buildWhere({ isAdmin: 'true' }, { status: activeStatus() })).toEqual({});
  });
});
