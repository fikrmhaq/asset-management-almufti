import { useRequestAttention } from './useRequestAttention';

/**
 * How many requests need the caller's action now — P5
 * (`IMPLEMENTATION_PLAN.md` §64.5), REQ-REQUEST-016. Since P6 read from
 * `GET /requests/attention`, whose `actionNeeded` is exactly the total of the
 * `awaiting=me` list, so the badge and the list cannot disagree.
 */
export function useActionsNeededCount() {
  return useRequestAttention().actionNeeded;
}

/** How many involved requests have an unseen update — P6 (§64.6). */
export function useUpdatesCount() {
  return useRequestAttention().updated;
}
