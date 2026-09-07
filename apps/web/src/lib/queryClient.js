import { QueryClient } from '@tanstack/react-query';

import { ERROR_CODES } from '@/api/errors';

/**
 * TanStack Query configuration — `IMPLEMENTATION_PLAN.md` §15.3.
 *
 * The defaults encode two decisions from `07-ui.md`:
 *
 *   - **No optimistic updates** (§4.3). Mutations wait for the server, because
 *     lifecycle transitions and borrowing actions have server-enforced rules
 *     that can legitimately reject a request; showing a state the server then
 *     reverses is worse than a half-second wait.
 *   - **Errors are surfaced, not retried away** (§4 shared states). A `403` or a
 *     `409` is an answer, not a blip, and retrying it three times only delays
 *     showing the user what happened.
 */

/** Codes where retrying cannot change the outcome. */
const TERMINAL_CODES = new Set([
  ERROR_CODES.VALIDATION_ERROR,
  ERROR_CODES.UNAUTHORIZED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.CONFLICT,
  ERROR_CODES.CANCELLED,
]);

/** Retry only what a retry could plausibly fix, and only twice. */
export function shouldRetry(failureCount, error) {
  if (TERMINAL_CODES.has(error?.code)) return false;
  return failureCount < 2;
}

export const queryDefaults = Object.freeze({
  // Reference data changes rarely and asset lists change often; 30s is short
  // enough that a colleague's edit shows up on the next navigation, long enough
  // that tabbing between pages is not a burst of refetches.
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  retry: shouldRetry,
  refetchOnWindowFocus: false,
  // A list page keeps showing the previous page while the next one loads, so the
  // table does not collapse to a skeleton on every pagination click.
  placeholderData: (previous) => previous,
});

export const mutationDefaults = Object.freeze({
  // Never retried: a POST that timed out may well have succeeded, and repeating
  // it could create a second borrowing or a second asset.
  retry: false,
});

export function createQueryClient(overrides = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: { ...queryDefaults, ...overrides.queries },
      mutations: { ...mutationDefaults, ...overrides.mutations },
    },
  });
}

/**
 * The cache-invalidation convention — §15.3.
 *
 * After a mutation, invalidate the resource's whole key prefix rather than
 * guessing which list pages are affected. Filtered lists are separate cache
 * entries and there is no way to know from here which ones contained the record.
 *
 * @param {import('@tanstack/react-query').QueryClient} client
 * @param {{all: string[]}[]} resources key sets from `queryKeys`
 */
export function invalidateResources(client, ...resources) {
  return Promise.all(
    resources
      .filter(Boolean)
      .map((resource) => client.invalidateQueries({ queryKey: resource.all }))
  );
}
