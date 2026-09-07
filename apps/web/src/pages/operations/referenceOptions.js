import { useQuery } from '@tanstack/react-query';

import { usersApi } from '@/api/organization';
import { contractsApi } from '@/api/procurement';
import { lookupApis } from '@/api/reference';
import { usePermission } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Option lists the operations screens need — `IMPLEMENTATION_PLAN.md` §20.
 *
 * The same shape Phase 13 established: each list is read through its OWN
 * permission, and a screen hides the control rather than firing a request that
 * answers 403 (`07-ui.md` §6). Institutions and suppliers are imported from the
 * procurement module rather than re-declared, so both phases share one cache
 * entry per resource.
 */

export { useInstitutionOptions, useSupplierOptions } from '../procurement/referenceOptions';

const REFERENCE_PARAMS = { pageSize: 100 };

function useOptions({ permission, keys, fetch, toOption }) {
  const allowed = usePermission(permission);

  const query = useQuery({
    queryKey: keys.list(REFERENCE_PARAMS),
    queryFn: () => fetch(REFERENCE_PARAMS),
    enabled: allowed,
  });

  const rows = query.data?.data ?? [];
  const options = rows.map(toOption);

  return {
    allowed,
    rows,
    options,
    isLoading: query.isLoading,
    labels: new Map(options.map((option) => [option.value, option.label])),
  };
}

export const useTransactionTypeOptions = () =>
  useOptions({
    permission: 'transaction-type:read',
    keys: queryKeys.transactionTypes,
    fetch: (params) => lookupApis['transaction-types'].list(params),
    toOption: (row) => ({ value: String(row.id), label: row.name }),
  });

/** The responsible person on a borrowing — REQ-BORROW-003. */
export const useUserOptions = () =>
  useOptions({
    permission: 'user:read',
    keys: queryKeys.users,
    fetch: (params) => usersApi.list(params),
    toOption: (row) => ({
      value: row.id,
      label: [row.firstName, row.lastName].filter(Boolean).join(' ') || row.username,
    }),
  });

/** The optional procurement reference on a transaction — REQ-TXN-009. */
export const useContractOptions = () =>
  useOptions({
    permission: 'contract:read',
    keys: queryKeys.contracts,
    fetch: (params) => contractsApi.list(params),
    toOption: (row) => ({ value: row.id, label: row.contractNumber }),
  });
