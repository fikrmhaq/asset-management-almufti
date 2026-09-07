import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { locationsApi } from '@/api/assetCore';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Floor-plan data loading — `07-ui.md` §5.4, `IMPLEMENTATION_PLAN.md` §18.6.
 */

/**
 * The plan's image, fetched through the authorized endpoint and held as an
 * object URL.
 *
 * A plain `<img src>` cannot be used: the image endpoint requires the bearer
 * token like every other route (`06-api.md` §1.2), and the browser would send
 * the request without it. So the bytes are fetched by the API client and turned
 * into a blob URL, which is revoked when the component unmounts or the plan
 * changes — an un-revoked object URL leaks the whole image for the life of the
 * tab.
 */
export function useFloorPlanImage(locationId, { enabled = true } = {}) {
  const [url, setUrl] = useState(null);

  const query = useQuery({
    queryKey: queryKeys.locations.sub(locationId, 'floor-plan-image'),
    queryFn: () => locationsApi.downloadFloorPlan(locationId),
    enabled: enabled && Boolean(locationId),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!query.data) return undefined;

    const objectUrl = URL.createObjectURL(query.data);
    setUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [query.data]);

  return { url, isLoading: query.isLoading, error: query.error };
}

/**
 * Every location beneath this one, AT ANY DEPTH — `REQ-LOC-012`.
 *
 * A floor-plan area may only represent a DESCENDANT of the location the plan
 * belongs to, and the server rejects anything else with `CONFLICT`. The picker
 * is restricted to the same set so that rejection is not how a user finds out.
 *
 * `?descendantsOf=` resolves the subtree in one query. This used to walk
 * `/children` level by level, which cost a request per node and stopped after
 * four levels — in a hierarchy like `Site → Building → Floor → Wing → Room →
 * Storage` the deepest rooms could not be picked at all, and the containment
 * rule they violated was invisible until the server refused the draw.
 */
/** The API's own page cap (`06-api.md` §1.5). */
const MAX_NODES = 100;

/**
 * How far each row sits below `rootId`, for indenting the picker.
 *
 * Derived from the `parentLocationId`s in the result itself rather than
 * requested from the server: it is presentation, and the walk terminates on any
 * parent that is not in the set. Nothing branches on the value.
 */
export function withRelativeDepth(rows, rootId) {
  const byId = new Map(rows.map((row) => [row.id, row]));

  const depthOf = (row) => {
    let depth = 0;
    let current = row;

    while (current && current.parentLocationId !== rootId) {
      const parent = byId.get(current.parentLocationId);
      if (!parent) break;
      current = parent;
      depth += 1;
    }

    return depth;
  };

  return rows.map((row) => ({ ...row, depth: depthOf(row) }));
}

export function useDescendantLocations(locationId, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.locations.sub(locationId, 'descendants'),
    enabled: enabled && Boolean(locationId),
    queryFn: async () => {
      const result = await locationsApi.list({
        descendantsOf: locationId,
        pageSize: MAX_NODES,
        status: 'active',
      });

      return withRelativeDepth(result.data ?? [], locationId);
    },
  });
}

export function useFloorPlan(locationId) {
  return useQuery({
    queryKey: queryKeys.locations.sub(locationId, 'floor-plan'),
    queryFn: () => locationsApi.floorPlan(locationId),
    enabled: Boolean(locationId),
    // A location with no plan answers 404, and that is an answer, not a failure.
    retry: false,
  });
}
