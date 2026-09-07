import { useQuery } from '@tanstack/react-query';

import { institutionsApi } from '@/api/organization';
import { contractsApi, suppliersApi, vendorsApi } from '@/api/procurement';
import { lookupApis } from '@/api/reference';
import { usePermission } from '@/auth/useSession';
import { formatQuantity } from '@/lib/numbers';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Option lists for the contract screens — `IMPLEMENTATION_PLAN.md` §19.3.
 *
 * A Contract references five other resources (`06-api.md` §6.2), each read
 * through its OWN permission: a caller may hold `contract:create` without
 * `supplier:read`. So each list reports whether the caller may read it at all,
 * and the screen hides the control rather than firing a request that answers 403
 * (`07-ui.md` §6).
 *
 * One parameter object per resource, so the contract list's filter and the
 * contract form's selector share a single cache entry instead of each holding
 * their own copy of the same 100 rows.
 *
 * These are short reference lists, not the tables §33 is about — a supplier
 * catalogue is tens of rows, and the contract LIST itself remains server-side
 * filtered, sorted and paged.
 */

const REFERENCE_PARAMS = { pageSize: 100 };

/**
 * `queryKey` and `enabled` exist for lists that are not global: a contract's
 * line items are one contract's, so they cannot share the flat `list(params)`
 * cache entry the resource-wide lists use, and there is nothing to fetch until a
 * contract is chosen.
 */
export function useOptions({ permission, keys, queryKey, fetch, toOption, enabled = true }) {
  const allowed = usePermission(permission);

  const query = useQuery({
    queryKey: queryKey ?? keys.list(REFERENCE_PARAMS),
    queryFn: () => fetch(REFERENCE_PARAMS),
    enabled: allowed && enabled,
  });

  const rows = query.data?.data ?? [];
  const options = rows.map(toOption);

  return {
    allowed,
    rows,
    options,
    isLoading: query.isLoading,
    /**
     * `id → label`, for a list response that carries only the foreign key.
     * `GET /contracts` returns `supplierId` and nothing else (`DEC-037`).
     */
    labels: new Map(options.map((option) => [option.value, option.label])),
  };
}

const byName = (row) => ({ value: String(row.id), label: row.name });

export const useSupplierOptions = () =>
  useOptions({
    permission: 'supplier:read',
    keys: queryKeys.suppliers,
    fetch: (params) => suppliersApi.list(params),
    toOption: byName,
  });

export const useVendorOptions = () =>
  useOptions({
    permission: 'vendor:read',
    keys: queryKeys.vendors,
    fetch: (params) => vendorsApi.list(params),
    toOption: byName,
  });

export const useContractTypeOptions = () =>
  useOptions({
    permission: 'contract-type:read',
    keys: queryKeys.contractTypes,
    fetch: (params) => lookupApis['contract-types'].list(params),
    toOption: byName,
  });

export const useFundingSourceOptions = () =>
  useOptions({
    permission: 'funding-source:read',
    keys: queryKeys.fundingSources,
    fetch: (params) => lookupApis['funding-sources'].list(params),
    toOption: byName,
  });

/** Keyed by its `CHAR(12)` natural key, not an id (REQ-PROC-008). */
export const useAccountCodeOptions = () =>
  useOptions({
    permission: 'account-code:read',
    keys: queryKeys.accountCodes,
    fetch: (params) => lookupApis['account-codes'].list(params),
    toOption: (row) => ({ value: row.code, label: `${row.code} — ${row.name}` }),
  });

export const useInstitutionOptions = () =>
  useOptions({
    permission: 'institution:read',
    keys: queryKeys.institutions,
    fetch: (params) => institutionsApi.list(params),
    toOption: byName,
  });

/**
 * The line items of ONE contract — REQ-PROC-006.
 *
 * Used where a unit is traced back to what it arrived on. Two items on the same
 * contract can share an asset name, so the ordered quantity is part of the label
 * rather than a decoration: it is often the only thing telling them apart.
 */
export const useContractItemOptions = (contractId) =>
  useOptions({
    permission: 'contract-item:read',
    keys: queryKeys.contractItems,
    queryKey: queryKeys.contractItems.list({ contractId, pageSize: 100 }),
    enabled: Boolean(contractId),
    fetch: (params) => contractsApi.listItems(contractId, params),
    toOption: (row) => ({
      value: row.id,
      label: row.quantity
        ? `${row.assetName} — ${formatQuantity(row.quantity, row.unitType)}`
        : row.assetName,
    }),
  });
