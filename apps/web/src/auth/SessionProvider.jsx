import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { refresh } from '@/api/auth';
import { SESSION_STATUS, useSessionStore } from '@/stores/session';
import { installAuthInterceptors } from './interceptors';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/states';

/**
 * Session restoration — `IMPLEMENTATION_PLAN.md` §16.1.
 *
 * The access token is memory-only (`stores/session.js`), so every page load
 * starts signed out as far as the client knows. The httpOnly refresh cookie is
 * what actually survives, and this asks the server to exchange it for a token
 * before anything renders.
 *
 * Without this, a refresh of the page — or opening a bookmarked deep link —
 * would bounce a perfectly valid session to the login screen.
 *
 * WHY THE FAILURE IS SPLIT IN TWO. This used to treat every rejection as "not
 * signed in". That is only true for a `401`: the cookie is gone, expired, or the
 * session was revoked. A network drop, a `5xx`, or a rate limit means something
 * quite different — we could not ask, so we do not know. Clearing the session
 * there destroys a valid one and drops the user on a login form for no reason,
 * which is exactly what a shared rate limit on `/auth/refresh` used to cause on
 * the eleventh page reload.
 *
 * So: `401` signs out. Anything else offers a retry and leaves the cookie alone.
 *
 * Nothing renders until the attempt resolves. Rendering children first would
 * flash the login page at an authenticated user for as long as the round trip
 * takes, and would fire route guards against a session that is still unknown.
 */
export function SessionProvider({ children }) {
  const { t } = useTranslation();
  const status = useSessionStore((state) => state.status);
  const setSession = useSessionStore((state) => state.setSession);
  const clearSession = useSessionStore((state) => state.clearSession);
  const setUnavailable = useSessionStore((state) => state.setUnavailable);
  const started = useRef(false);
  const [retrying, setRetrying] = useState(false);

  const restore = useCallback(
    () =>
      refresh()
        .then(setSession)
        .catch((error) => {
          // The one case that genuinely means "not signed in". `isAuthFailure` is
          // the ApiError getter for it — every failure reaching here has already
          // been normalized by the response interceptor in `api/client.js`.
          if (error?.isAuthFailure) return clearSession();
          return setUnavailable();
        }),
    [setSession, clearSession, setUnavailable]
  );

  useEffect(() => {
    // StrictMode double-invokes effects in development; the restore must not run
    // twice and race with itself.
    if (started.current) return;
    started.current = true;

    installAuthInterceptors();
    restore();
  }, [restore]);

  const onRetry = async () => {
    setRetrying(true);
    try {
      await restore();
    } finally {
      setRetrying(false);
    }
  };

  if (status === SESSION_STATUS.RESTORING) {
    return (
      <div className="flex min-h-screen items-center justify-center p-10">
        <LoadingState rows={1} columns={1} label={t('auth.session.restoring')} />
      </div>
    );
  }

  // Not a sign-out. The refresh cookie is untouched, so a retry that reaches the
  // server will pick the session straight back up.
  if (status === SESSION_STATUS.UNAVAILABLE) {
    return (
      <div className="flex min-h-screen items-center justify-center p-10">
        <div role="alert" className="max-w-md space-y-3 text-center">
          <p className="text-sm font-semibold">{t('auth.session.unavailableTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {t('auth.session.unavailableDescription')}
          </p>
          <Button onClick={onRetry} loading={retrying}>
            {t('common.actions.retry')}
          </Button>
        </div>
      </div>
    );
  }

  return children;
}
