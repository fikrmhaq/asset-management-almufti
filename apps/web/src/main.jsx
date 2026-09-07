import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { createQueryClient } from '@/lib/queryClient';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { SessionProvider } from '@/auth/SessionProvider';
import { Toaster } from '@/components/ui/toast';
import { createAppRouter } from '@/routes';
import { initI18n } from '@/i18n';
import './index.css';

// Before the first render: a screen that mounted with no dictionary would show
// raw keys for a frame, and the stored language would appear not to have stuck.
initI18n();

/**
 * Application entry — `IMPLEMENTATION_PLAN.md` §16.
 *
 * Provider order matters. `SessionProvider` sits ABOVE the router: it installs
 * the Axios interceptors and restores the session before any route renders, so a
 * guard never runs against a session that is still unknown and a deep link never
 * bounces a valid session to the login screen.
 */
const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SessionProvider>
          <RouterProvider router={router} />
          <Toaster />
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
