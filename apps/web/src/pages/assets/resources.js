import { assetsApi, locationsApi } from '@/api/assetCore';
import { createResourceHooks } from '@/hooks/useResource';
import { queryKeys } from '@/lib/queryKeys';

/** Asset core resource hooks — `IMPLEMENTATION_PLAN.md` §18. */

export const assets = createResourceHooks({
  api: assetsApi,
  keys: queryKeys.assets,
  labelKey: 'resources.asset',
});

export const locations = createResourceHooks({
  api: locationsApi,
  keys: queryKeys.locations,
  labelKey: 'resources.location',
});
