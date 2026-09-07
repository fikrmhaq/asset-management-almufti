import { Link } from 'react-router-dom';

import { ERROR_CODES } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';

/**
 * `FORBIDDEN` page — `07-ui.md` §6, `IMPLEMENTATION_PLAN.md` §16.2.
 *
 * Shown when a route is reached without the permission it requires. It says so
 * plainly rather than redirecting: a silent bounce leaves the user unsure
 * whether they mistyped the URL or genuinely lack access, and a redirect to a
 * page they also cannot see would loop.
 */
export function ForbiddenPage({ requiredPermission }) {
  return (
    <div className="mx-auto max-w-xl py-16">
      <ErrorState
        error={{
          code: ERROR_CODES.FORBIDDEN,
          message: requiredPermission
            ? `This page requires the "${requiredPermission}" permission. Ask an administrator if you need it.`
            : 'You do not have permission to view this page.',
        }}
      />
      <div className="mt-4 flex justify-center">
        <Button asChild variant="outline">
          <Link to="/">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
