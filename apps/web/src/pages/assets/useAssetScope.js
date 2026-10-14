import { useQuery } from '@tanstack/react-query';

import { assetsApi } from '@/api/assetCore';
import { usePermission } from '@/auth/useSession';

/**
 * The caller's own Asset reach — P3 (`IMPLEMENTATION_PLAN.md` §64.3,
 * REQ-AUTHZ-009): whether they operate as a KAJUR / TOOLMAN narrowed to their
 * departments, which departments, and whether a standalone asset may be
 * created. The screens use it only to avoid offering what the server refuses;
 * the server enforces every rule itself.
 *
 * While unknown, nothing is hidden (`data` undefined).
 */
export function useAssetScope() {
  const canRead = usePermission('asset:read');
  return useQuery({
    queryKey: ['assets', 'scope'],
    queryFn: () => assetsApi.scope(),
    enabled: canRead,
    staleTime: 60_000,
  });
}
