import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as authApi from '@/api/auth';
import { queryKeys } from '@/lib/queryKeys';
import { hasPermission, SESSION_STATUS, useSessionStore } from '@/stores/session';

/**
 * Session hooks — `IMPLEMENTATION_PLAN.md` §16.1, §16.2; `07-ui.md` §6.
 */

export function useSession() {
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);

  return {
    user,
    status,
    isAuthenticated: status === SESSION_STATUS.AUTHENTICATED,
    isRestoring: status === SESSION_STATUS.RESTORING,
  };
}

/**
 * The caller's organization-scope tier and, when they hold one, the departments
 * they are currently in charge of — Phase 22 (`CR-003` §5.7).
 *
 * `picDepartments` comes from the session profile rather than `GET /departments`
 * so a PIC-scoped role needs no `department:read`: granting that to make a
 * picker work would expose every department in the institution to a role whose
 * whole purpose is to reach less.
 *
 * As with `usePermission`, this is for showing the right controls, not for
 * enforcing anything. The server narrows every query regardless.
 */
export function usePicScope() {
  const user = useSessionStore((state) => state.user);

  return {
    isPicScoped: Boolean(user?.isPicScoped),
    picDepartments: user?.picDepartments ?? [],
  };
}

/**
 * `usePermission(code)` — the single gate behind every nav item, route and
 * action button (`07-ui.md` §6).
 *
 * The frontend is NOT authoritative here; the server checks the same code on
 * every request (`06-api.md` §1.3). This exists so the interface shows what the
 * user can actually do, not to enforce it.
 */
export function usePermission(code) {
  return useSessionStore(useCallback((state) => hasPermission(state.permissions, code), [code]));
}

/** True when the session holds ANY of the codes — used for nav sections. */
export function useAnyPermission(codes = []) {
  return useSessionStore(
    useCallback((state) => codes.some((code) => hasPermission(state.permissions, code)), [codes])
  );
}

export function useLogin() {
  const setSession = useSessionStore((state) => state.setSession);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (session) => {
      setSession(session);
      // A previous user's cached data must not be visible to the next one.
      queryClient.clear();
    },
  });
}

/**
 * Logout — REQ-AUTH-003.
 *
 * The local session is cleared whether or not the server call succeeds. If the
 * request failed because the session was already gone, refusing to sign the user
 * out locally would strand them in a broken state.
 */
export function useLogout() {
  const clearSession = useSessionStore((state) => state.clearSession);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        await authApi.logout();
      } catch {
        // Intentionally swallowed — see above.
      }
    },
    onSettled: () => {
      clearSession();
      queryClient.clear();
    },
  });
}

export { queryKeys };
