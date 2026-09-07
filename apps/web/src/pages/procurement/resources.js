import { contractsApi, suppliersApi, vendorsApi } from '@/api/procurement';
import { createResourceHooks } from '@/hooks/useResource';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Procurement resource hooks — `IMPLEMENTATION_PLAN.md` §19.
 *
 * Bound in one place so a screen imports the hooks for its resource rather than
 * re-pairing an endpoint with a cache key, which is where the two would drift.
 *
 * Contract items have no hook set: they are always reached through their parent
 * contract, so their queries live with the panel that owns them.
 */

export const suppliers = createResourceHooks({
  api: suppliersApi,
  keys: queryKeys.suppliers,
  labelKey: 'resources.supplier',
});

export const contracts = createResourceHooks({
  api: contractsApi,
  keys: queryKeys.contracts,
  labelKey: 'resources.contract',
});

/** Vendors live under Operations in the nav, but are built here — `DEC-034`. */
export const vendors = createResourceHooks({
  api: vendorsApi,
  keys: queryKeys.vendors,
  labelKey: 'resources.vendor',
});
