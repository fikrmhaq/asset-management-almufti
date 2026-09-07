import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { institutionsApi } from '@/api/organization';
import { queryKeys } from '@/lib/queryKeys';
import { t } from '@/i18n';
import { toast } from '@/components/ui/toast';

/**
 * An institution's inventory code format — Phase 25 (`CR-006`), REQ-ORG-007.
 *
 * Bespoke rather than `createResourceHooks`, because this is not a resource in
 * that sense: it is ONE value on one institution, with no list, no create and no
 * delete. Bending the CRUD factory around a singleton would produce four hooks
 * that throw and one that works.
 *
 * The response carries the format, the token registry, the preview and the
 * length ceiling together (`06-api.md` §3.1) — the server is the only place that
 * knows which institution is being configured, so it is the only place that can
 * produce institution-aware samples. The client renders what it is given and
 * keeps no token list of its own.
 *
 * A `VALIDATION_ERROR` is deliberately not toasted: it names the offending
 * position and belongs against the builder (`07-ui.md` §4.3). `toast.fromError`
 * already declines to duplicate it.
 */

const formatKey = (id) => queryKeys.institutions.sub(id, 'inventory-code-format');

export function useInventoryCodeFormat(institutionId) {
  return useQuery({
    queryKey: formatKey(institutionId),
    queryFn: () => institutionsApi.inventoryCodeFormat(institutionId),
    enabled: Boolean(institutionId),
  });
}

export function useSetInventoryCodeFormat(institutionId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (format) => institutionsApi.setInventoryCodeFormat(institutionId, format),
    onSuccess: async (data) => {
      /**
       * Write the response straight into the cache rather than refetching it.
       * The `PUT` already returns the stored format with its recomputed preview,
       * so a refetch would ask the same question again and leave the builder
       * showing the old preview until it answered.
       */
      queryClient.setQueryData(formatKey(institutionId), data);
      toast.success(t('organization.inventoryCodeFormat.saved'));
    },
    onError: (error) => toast.fromError(error),
  });
}
