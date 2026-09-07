import { describe, it, expect } from 'vitest';

import { ERROR_CODES } from '@/api/errors';
import { createQueryClient, mutationDefaults, queryDefaults, shouldRetry } from './queryClient';
import { queryKeys, resourceKeys } from './queryKeys';
import { formatQuantity } from './numbers';
import { cn } from './utils';

/**
 * Query infrastructure and utilities — `IMPLEMENTATION_PLAN.md` §15.3.
 */

describe('query keys', () => {
  it('nests keys so a prefix invalidates everything beneath it', () => {
    const keys = resourceKeys('assets');

    expect(keys.all).toEqual(['assets']);
    expect(keys.list({ page: 1 })).toEqual(['assets', 'list', { page: 1 }]);
    expect(keys.detail('abc')).toEqual(['assets', 'detail', 'abc']);
    expect(keys.sub('abc', 'units')).toEqual(['assets', 'detail', 'abc', 'units', {}]);

    // Every key starts with the resource prefix, which is what makes one
    // invalidation refresh lists and details together.
    for (const key of [keys.list({}), keys.detail('abc'), keys.sub('abc', 'units')]) {
      expect(key[0]).toBe('assets');
    }
  });

  it('treats different filters as different queries', () => {
    const keys = resourceKeys('assets');

    expect(keys.list({ page: 1 })).not.toEqual(keys.list({ page: 2 }));
  });

  it('covers every API resource group', () => {
    for (const resource of [
      'institutions',
      'users',
      'roles',
      'classifications',
      'assets',
      'assetUnits',
      'locations',
      'suppliers',
      'contracts',
      'contractItems',
      'vendors',
      'borrowings',
      'transactions',
      'reports',
      'auditLogs',
    ]) {
      expect(queryKeys[resource], resource).toBeDefined();
      expect(queryKeys[resource].all, resource).toHaveLength(1);
    }
  });
});

describe('query defaults', () => {
  it('does not retry an answer the server already gave', () => {
    for (const code of [
      ERROR_CODES.VALIDATION_ERROR,
      ERROR_CODES.UNAUTHORIZED,
      ERROR_CODES.FORBIDDEN,
      ERROR_CODES.NOT_FOUND,
      ERROR_CODES.CONFLICT,
      ERROR_CODES.CANCELLED,
    ]) {
      expect(shouldRetry(0, { code }), code).toBe(false);
    }
  });

  it('retries a transient failure, but only twice', () => {
    expect(shouldRetry(0, { code: ERROR_CODES.NETWORK_ERROR })).toBe(true);
    expect(shouldRetry(1, { code: ERROR_CODES.NETWORK_ERROR })).toBe(true);
    expect(shouldRetry(2, { code: ERROR_CODES.NETWORK_ERROR })).toBe(false);
  });

  it('never retries a mutation — a timed-out POST may have succeeded', () => {
    expect(mutationDefaults.retry).toBe(false);
  });

  it('keeps the previous page visible while the next one loads', () => {
    expect(queryDefaults.placeholderData('page-1')).toBe('page-1');
  });

  it('builds a client carrying those defaults', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries.staleTime).toBe(30_000);
    expect(defaults.queries.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations.retry).toBe(false);
  });
});

describe('cn', () => {
  it('lets a later Tailwind utility override an earlier one', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('ignores falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});

/**
 * Quantity and unit of measure are two columns and two different facts; the
 * Asset Unit is a third thing entirely and never passes through here.
 */
describe('formatQuantity', () => {
  it('reads as an order, not a bare number', () => {
    expect(formatQuantity(10, 'piece')).toBe('10 piece');
    expect(formatQuantity(3, 'box')).toBe('3 box');
  });

  it('falls back to the count alone when no unit of measure was recorded', () => {
    expect(formatQuantity(10, null)).toBe('10');
    expect(formatQuantity(10, '   ')).toBe('10');
  });

  it('renders nothing for a quantity that was never recorded', () => {
    // Both columns are nullable, and a contract line may carry neither.
    expect(formatQuantity(null, 'piece')).toBe('');
    expect(formatQuantity(undefined, undefined)).toBe('');
    expect(formatQuantity('', 'piece')).toBe('');
  });

  it('keeps a zero visible rather than treating it as missing', () => {
    expect(formatQuantity(0, 'piece')).toBe('0 piece');
  });
});
