import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, List, MapPin, Network } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { locationsApi } from '@/api/assetCore';
import { Can } from '@/auth/guards';
import { useListParams } from '@/hooks/useListParams';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { DataTable } from '@/components/patterns/data-table';
import { SearchFilter, StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { locations } from '../assets/resources';
import { useTranslation } from 'react-i18next';

/**
 * Locations — `07-ui.md` §5.3, `IMPLEMENTATION_PLAN.md` §18.5; REQ-LOC-001/007.
 *
 * List with a tree toggle, because locations nest to represent physical
 * containment: a flat table answers "where is X" and a tree answers "what is
 * inside Y", and both are wanted.
 *
 * The tree is lazy — `GET /locations/:id/children` per expanded node — rather
 * than loading the whole hierarchy up front. A site with thousands of rooms
 * would otherwise pay for all of them to show its top level.
 */

function TreeNode({ location, depth = 0 }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const children = useQuery({
    queryKey: queryKeys.locations.sub(location.id, 'children'),
    queryFn: () => locationsApi.children(location.id),
    enabled: expanded,
  });

  // Indentation is computed from the depth the DATA has, not from a fixed set
  // of levels. Six deep and two deep render through the same branch.
  const indent = (level) => ({ paddingLeft: `${level * 1.25 + 0.25}rem` });

  return (
    <li>
      <div
        className="flex items-center gap-1.5 rounded-md py-1 pr-2 transition-colors hover:bg-neutral-100"
        style={indent(depth)}
      >
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t('locations.collapse', { name: location.name })
              : t('locations.expand', { name: location.name })
          }
          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-neutral-200 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronRight
            className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
            aria-hidden="true"
          />
        </button>

        <Link
          to={`/locations/${location.id}`}
          className="rounded-sm text-sm hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {location.name}
        </Link>

        {!location.isActive ? <StatusBadge value="inactive" /> : null}
      </div>

      {expanded ? (
        children.isLoading ? (
          <div style={indent(depth + 1)} className="py-1">
            <LoadingState variant="list" rows={2} />
          </div>
        ) : (children.data?.data ?? []).length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground" style={indent(depth + 1)}>
            {t('locations.nothingInside')}
          </p>
        ) : (
          <ul>
            {children.data.data.map((child) => (
              <TreeNode key={child.id} location={child} depth={depth + 1} />
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

export function LocationsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const [view, setView] = useState('list');

  const query = locations.useList(params);

  /**
   * The top of the tree, asked for as such.
   *
   * `?rootsOnly=true` is a real server-side filter. This used to fetch a page of
   * every location and keep the ones with no parent, which silently lost any
   * root past the page cap.
   */
  const roots = useQuery({
    queryKey: queryKeys.locations.list({ rootsOnly: true }),
    queryFn: () => locationsApi.list({ rootsOnly: true, pageSize: 100, status: 'active' }),
    enabled: view === 'tree',
  });

  const columns = [
    {
      accessorKey: 'name',
      header: t('common.fields.name'),
      meta: { sortField: 'name' },
      cell: ({ row }) => (
        <Link to={`/locations/${row.original.id}`} className="hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      id: 'classification',
      header: t('common.fields.classification'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.classificationId}</span>,
    },
    {
      id: 'parent',
      header: t('locations.columns.inside'),
      /**
       * The parent by NAME. This used to print the first eight characters of a
       * UUID, which told a user nothing and was not even unique enough to be
       * looked up. `parentLocation` comes from the API for exactly this.
       */
      cell: ({ row }) =>
        row.original.parentLocationId ? (
          <Link
            to={`/locations/${row.original.parentLocationId}`}
            className="rounded-sm hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {/* The id remains the fallback for a parent outside the caller's
                scope, where the API cannot resolve a name (`BR-007`). */}
            {row.original.parentLocation?.name ?? t('locations.parentUnavailable')}
          </Link>
        ) : (
          <span className="text-muted-foreground">{t('locations.topLevel')}</span>
        ),
    },
    {
      id: 'status',
      header: t('common.fields.status'),
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <ListPage
      title={t('locations.title')}
      description={t('locations.description')}
      actions={
        <>
          <Button
            variant="outline"
            size="icon"
            aria-label={view === 'list' ? t('locations.treeView') : t('locations.listView')}
            onClick={() => setView(view === 'list' ? 'tree' : 'list')}
          >
            {view === 'list' ? (
              <Network className="h-4 w-4" aria-hidden="true" />
            ) : (
              <List className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          <Can code="location:create">
            <Button asChild>
              <Link to="/locations/new">{t('locations.new')}</Link>
            </Button>
          </Can>
        </>
      }
      filters={
        view === 'list' ? (
          <>
            <SearchFilter
              value={params.q ?? ''}
              onChange={(q) => setParams({ q })}
              placeholder={t('locations.namePlaceholder')}
            />
            <StatusFilter
              value={params.status ?? 'all'}
              onChange={(status) => setParams({ status })}
            />
          </>
        ) : undefined
      }
      meta={view === 'list' ? query.data?.meta : undefined}
      onPageChange={setPage}
    >
      {view === 'list' ? (
        <DataTable
          columns={columns}
          data={query.data?.data ?? []}
          isLoading={query.isLoading}
          error={query.error}
          onRetry={query.refetch}
          sort={params.sort}
          order={params.order}
          onSortChange={setSort}
          emptyTitle={t('locations.emptyList')}
        />
      ) : roots.isLoading ? (
        <div className="p-4">
          <LoadingState variant="list" />
        </div>
      ) : roots.isError ? (
        <div className="p-4">
          <ErrorState error={roots.error} onRetry={roots.refetch} />
        </div>
      ) : (roots.data?.data ?? []).length === 0 ? (
        <div className="p-4">
          <EmptyState title={t('locations.emptyRoots')} icon={MapPin} />
        </div>
      ) : (
        // No border of its own: `ListPage`'s surface is the panel now.
        <ul className="p-2">
          {roots.data.data.map((location) => (
            <TreeNode key={location.id} location={location} />
          ))}
        </ul>
      )}
    </ListPage>
  );
}
