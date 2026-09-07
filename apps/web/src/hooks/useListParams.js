import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * URL-synced list state — `07-ui.md` §4.1, `IMPLEMENTATION_PLAN.md` §15.5.
 *
 * §4.1 requires list state to live in the URL (`?page=&sort=&status=…`) rather
 * than in component state, so back/forward and a page refresh preserve what the
 * user was looking at, and a filtered view can be shared as a link.
 *
 * The params map 1:1 onto the API's query params (`06-api.md` §1.6), so what is
 * in the URL is what is sent — no translation layer that could drift.
 */

const DEFAULT_PAGE_SIZE = 20;

/** Blank values are removed rather than sent as `?q=`, which would filter on ''. */
function pruned(entries) {
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([, value]) => value !== undefined && value !== null && value !== ''
    )
  );
}

export function useListParams({ defaults = {}, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo(() => {
    const fromUrl = Object.fromEntries(searchParams.entries());
    return {
      ...defaults,
      ...fromUrl,
      page: Number(fromUrl.page ?? 1),
      pageSize: Number(fromUrl.pageSize ?? pageSize),
    };
  }, [searchParams, defaults, pageSize]);

  /**
   * Merges a partial change into the URL.
   *
   * Any change other than paging resets to page 1: staying on page 7 of a result
   * set that just shrank to two pages shows an empty table and looks broken.
   */
  const setParams = useCallback(
    (changes, { resetPage = true } = {}) => {
      setSearchParams(
        (current) => {
          const next = pruned({
            ...Object.fromEntries(current.entries()),
            ...changes,
          });

          if (resetPage && !('page' in changes)) delete next.page;
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setPage = useCallback((page) => setParams({ page }, { resetPage: false }), [setParams]);

  const setSort = useCallback(
    (field, order = 'asc') => setParams({ sort: field, order }),
    [setParams]
  );

  const clearFilters = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);

  return { params, setParams, setPage, setSort, clearFilters };
}
