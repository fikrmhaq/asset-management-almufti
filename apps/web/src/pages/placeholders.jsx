import { Link, useRouteError } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { normalizeError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';

/**
 * Not-found and error pages.
 *
 * This file also held `ModulePlaceholder` from Phase 10 to Phase 15 — the stand-in
 * that named the phase which would build each unbuilt module. Phase 15 filled the
 * last route, and it was removed in Phase 16 rather than left as dead code that
 * a reader would have to check for callers. `routes.test.jsx` asserts no
 * placeholder remains in the route table.
 */
export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <EmptyState
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <Button asChild variant="outline">
            <Link to="/">{t('notFound.back')}</Link>
          </Button>
        }
      />
    </div>
  );
}

/**
 * Global error boundary — `IMPLEMENTATION_PLAN.md` §16.3.
 *
 * The router's `errorElement`, so a render-time crash anywhere in the tree shows
 * something recoverable instead of a blank page. A reload is offered rather than
 * an in-place retry: the component tree that threw is not in a state worth
 * re-rendering.
 */
export function RouteErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  const normalized = normalizeError(error);

  return (
    <div className="mx-auto max-w-xl py-16">
      <ErrorState error={normalized} />
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('notFound.reload')}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/">{t('notFound.back')}</Link>
        </Button>
      </div>
    </div>
  );
}
