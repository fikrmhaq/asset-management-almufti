import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { locationsApi } from '@/api/assetCore';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

/**
 * A location's place in the hierarchy, and the floor plan that shows it.
 *
 * `GET /locations/:id/context` answers both in one request. The hierarchy is
 * arbitrary — `Site → Building → Floor → Wing → Room → Storage` is as valid as
 * two levels — so NOTHING here counts levels or names them. The path is whatever
 * the server returned, rendered in order.
 */
export function useLocationContext(locationId, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.locations.sub(locationId, 'context'),
    queryFn: () => locationsApi.context(locationId),
    enabled: enabled && Boolean(locationId),
  });
}

/**
 * The trail from the root down to a location: `Building A → 2nd Floor → Lab 2`.
 *
 * Each step links to its own location page, so the hierarchy is navigable from
 * anywhere a location is shown rather than only from the Locations screen.
 *
 * @param {object} props
 * @param {{id: string, name: string, isActive?: boolean}[]} props.path root-first
 * @param {string} [props.emptyLabel] shown when there is no location at all
 * @param {boolean} [props.linkLast] whether the final step is a link too
 */
export function LocationPath({ path, emptyLabel = 'Not assigned', linkLast = true, className }) {
  if (!path || path.length === 0) {
    return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
  }

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1 text-sm', className)}>
      {path.map((node, index) => {
        const isLast = index === path.length - 1;
        const content = (
          <span className={cn(isLast && 'font-medium', !node.isActive && 'text-muted-foreground')}>
            {node.name}
          </span>
        );

        return (
          <Fragment key={node.id}>
            {isLast && !linkLast ? (
              content
            ) : (
              <Link to={`/locations/${node.id}`} className="hover:underline">
                {content}
              </Link>
            )}
            {isLast ? null : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            )}
          </Fragment>
        );
      })}
    </span>
  );
}

/**
 * The same trail, loaded for one location id.
 *
 * A unit's row carries `currentLocationId` and nothing else, so this is what
 * turns that into something a person can read and click.
 */
export function LocationPathFor({ locationId, emptyLabel, linkLast, className }) {
  const query = useLocationContext(locationId);

  if (!locationId) {
    return <span className="text-sm text-muted-foreground">{emptyLabel ?? 'Not assigned'}</span>;
  }

  // A failure here must not blank out where the unit is: the id is still a
  // truthful answer, just an unfriendly one.
  if (query.isError) {
    return <span className="font-mono text-xs text-muted-foreground">{locationId}</span>;
  }

  if (query.isLoading) {
    return <span className="text-sm text-muted-foreground">Loading…</span>;
  }

  return (
    <LocationPath
      path={query.data?.path}
      emptyLabel={emptyLabel}
      linkLast={linkLast}
      className={className}
    />
  );
}
