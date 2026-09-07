import { Fragment } from 'react';
import { Link, useMatches } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Breadcrumb trail — `07-ui.md` §3, `IMPLEMENTATION_PLAN.md` §16.3.
 *
 * Built from the matched route hierarchy rather than by parsing the URL: a route
 * declares its own label in `handle.crumb`, so `/assets/:id` can eventually say
 * "Laptop Dell" instead of a UUID, and no component has to know the shape of
 * every path in the application.
 *
 * `handle.crumb` may be a string or a function of the route's params.
 *
 * A static crumb is a TRANSLATION KEY (`crumbs.assets`). A dynamic one is a
 * value from the route — an id, and eventually a record's name — which has no
 * translation and must not be mangled by the attempt: `t()` falls back to the
 * string it was given, so both kinds pass through this one path.
 */
export function Breadcrumbs() {
  const { t } = useTranslation();
  const matches = useMatches();

  const crumbs = matches
    .filter((match) => match.handle?.crumb)
    .map((match) => {
      const raw =
        typeof match.handle.crumb === 'function'
          ? match.handle.crumb(match.params, match.data)
          : match.handle.crumb;

      return {
        key: match.id,
        to: match.pathname,
        label: typeof raw === 'string' && raw.startsWith('crumbs.') ? t(raw) : raw,
      };
    })
    .filter((crumb) => crumb.label);

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label={t('nav.breadcrumb')} className="min-w-0">
      {/*
        Truncated from the LEFT on a narrow bar (`flex-row-reverse` on the
        overflow, not on the list) is tempting, but the ancestors are what give
        the current page meaning. Instead the trail wraps: it is at most a few
        short segments, and a wrapped second line costs less than a hidden one.
      */}
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;

          return (
            <Fragment key={crumb.key}>
              <li className="min-w-0">
                {isLast ? (
                  // The current page is not a link to itself.
                  <span
                    aria-current="page"
                    className="block truncate font-semibold text-foreground"
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    to={crumb.to}
                    className="block truncate rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
              {isLast ? null : (
                <li aria-hidden="true" className="flex items-center">
                  <ChevronRight className="h-3.5 w-3.5 text-neutral-300" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
