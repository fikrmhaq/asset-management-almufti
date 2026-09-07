import { borrowingsApi, transactionsApi } from '@/api/operations';
import { createResourceHooks } from '@/hooks/useResource';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Operations resource hooks — `IMPLEMENTATION_PLAN.md` §20.
 *
 * Only the hooks each resource actually HAS are re-exported. A Borrowing has no
 * deactivate and no delete; a Transaction has neither, nor an update. Exposing
 * `useSetActive` or `useRemove` here would offer a screen an operation the API
 * does not implement, and the failure would surface as a runtime error rather
 * than as the absence it really is.
 *
 * The state transitions are not here either: each is its own action endpoint
 * with its own permission and its own confirmation, so they live with the screen
 * that performs them.
 */

const borrowingHooks = createResourceHooks({
  api: borrowingsApi,
  keys: queryKeys.borrowings,
  labelKey: 'resources.borrowing',
});

export const borrowings = {
  useList: borrowingHooks.useList,
  useDetail: borrowingHooks.useDetail,
  useCreate: borrowingHooks.useCreate,
  useUpdate: borrowingHooks.useUpdate,
  keys: borrowingHooks.keys,
};

const transactionHooks = createResourceHooks({
  api: transactionsApi,
  keys: queryKeys.transactions,
  labelKey: 'resources.transaction',
});

/** Create and read only — REQ-TXN-007. There is no update and no delete. */
export const transactions = {
  useList: transactionHooks.useList,
  useDetail: transactionHooks.useDetail,
  useCreate: transactionHooks.useCreate,
  keys: transactionHooks.keys,
};
