import { useQuery } from '@tanstack/react-query';

import { requestsApi } from '@/api/requests';
import { usePermission } from '@/auth/useSession';

/**
 * The two request counts for the navigation — P5 + P6
 * (`IMPLEMENTATION_PLAN.md` §64.5, §64.6): `actionNeeded` ("Needs my action")
 * and `updated` ("Updates"). One call, two independent server derivations.
 *
 * Refreshed on window focus and every two minutes while the app is open (not in
 * a background tab), and — being under `['requests']` — after any request
 * action. No websocket, push or e-mail.
 */
export const ATTENTION_KEY = ['requests', 'attention'];

export function useRequestAttention() {
  const canRead = usePermission('request:read');
  const query = useQuery({
    queryKey: ATTENTION_KEY,
    queryFn: () => requestsApi.attention(),
    enabled: canRead,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
  return query.data ?? { actionNeeded: 0, updated: 0 };
}
