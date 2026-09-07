import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/stores/session';
import { Toaster } from '@/components/ui/toast';

/**
 * Test harness for screens — `IMPLEMENTATION_PLAN.md` §17.
 *
 * A screen needs three things to render: a signed-in session with a specific
 * permission set, a query client, and a data router. Assembling them per test
 * file would be four copies of the same wiring, and a screen's test would drift
 * from the providers it actually runs under in `main.jsx`.
 */

/** Signs in with exactly the given permission codes. */
export function signInWith(permissions = [], overrides = {}) {
  useSessionStore.getState().setSession({
    accessToken: 'test-token',
    user: {
      id: 'user-1',
      username: 'tester',
      firstName: 'Test',
      lastName: 'User',
      institutionId: null,
      roles: [{ id: 'role-1', name: 'Tester', isSystemWide: true }],
      permissions,
      isSystemWide: true,
      ...overrides,
    },
  });
}

export function signOut() {
  useSessionStore.getState().clearSession();
}

/**
 * Renders one screen at a route.
 *
 * Retries are off: a test asserting an error state should not wait through two
 * retries first.
 */
export function renderScreen(element, { route = '/', path = '/', extraRoutes = [] } = {}) {
  const queryClient = createQueryClient({ queries: { retry: false } });

  const router = createMemoryRouter(
    [{ path, element, handle: { crumb: 'Test' } }, ...extraRoutes],
    { initialEntries: [route] }
  );

  // The `Toaster` is mounted because it is how the application reports a
  // failure that has no field to attach to — a `CONFLICT`, say. Leaving it out
  // would make those messages untestable and quietly unasserted.
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );

  return { ...result, router, queryClient };
}
