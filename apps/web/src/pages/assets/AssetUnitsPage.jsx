import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';

import { assetUnitsApi } from '@/api/assetCore';
import { usePermission, usePicScope } from '@/auth/useSession';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/patterns/data-table';
import { SearchFilter, SelectFilter, StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { useListParams } from '@/hooks/useListParams';
import { queryKeys } from '@/lib/queryKeys';
import { CONDITIONS } from './AssetsPage';
import { LIFECYCLE_STATES } from './AssetUnitDetailPage';
import { locations } from './resources';

/**
 * Asset Unit list — `06-api.md` §5.2, `CR-005`.
 *
 * THE DISTINCTION THIS SCREEN EXISTS TO DRAW:
 *
 *   Asset       a master/administrative resource. Browsing it needs `asset:read`.
 *   Asset Unit  an operational resource, which may be scoped to a Department
 *               PIC. Browsing it needs `asset-unit:read`.
 *
 * Before this page the only ways to reach a list of units were through an Asset,
 * a Location, or a Contract Item. A Department PIC holds none of those read
 * permissions, and a unit whose first location has never been recorded has no
 * `current_location_id` to be listed under — so their own units were, in the
 * literal sense, unreachable. This is their primary discovery surface.
 *
 * SCOPE IS NOT A FILTER. Every control below narrows what the server already
 * decided the caller may see; none of them widens it. A PIC-scoped caller who
 * clears the department filter, or types another department's inventory code
 * into the search box, still gets only their own units — that is enforced in
 * `assetUnits/service.js list`, not here. Nothing on this screen is a security
 * control.
 *
 * The parent asset's name is shown per row because a unit's identity is
 * incomplete without it ("unit 3 of what?"). It is contextual information about
 * a record the caller already holds — the link is rendered only for callers who
 * can actually open an asset, so a PIC sees the name as plain text rather than a
 * link into a page that would answer 403.
 *
 * BATCH LABELS (§73). Units can be selected — across pages and filters — and
 * printed together on `/asset-units/labels?ids=…`: each the same label, and the
 * same QR, it has on its own. Only units with an inventory code can be selected;
 * the server re-checks every one against the caller's scope.
 */

/** The most labels one sheet prints — the server's own limit. */
const MAX_BATCH_LABELS = 200;

export function AssetUnitsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const { isPicScoped, picDepartments } = usePicScope();
  const canReadAssets = usePermission('asset:read');
  const canReadLocations = usePermission('location:read');
  const navigate = useNavigate();
  // Selected for printing, in the order picked: id → inventory code.
  const [selected, setSelected] = useState(() => new Map());

  const query = useQuery({
    queryKey: queryKeys.assetUnits.list(params),
    queryFn: () => assetUnitsApi.list(params),
  });

  // Labels for the location filter and column. A caller without `location:read`
  // simply does not see the filter; the column falls back to the id.
  const locationList = locations.useList(
    { pageSize: 100, status: 'active' },
    { enabled: canReadLocations }
  );

  const locationLabels = new Map(
    (locationList.data?.data ?? []).map((location) => [location.id, location.name])
  );

  /**
   * The department filter's options.
   *
   * For a PIC-scoped caller these come from `picDepartments` on the session
   * (`CR-003` `DEC-095`) rather than from `GET /departments`, which they cannot
   * call. For everyone else the control is hidden rather than half-populated:
   * offering an empty picker is worse than offering none, and the URL parameter
   * still works for a caller who has one.
   */
  const departmentOptions = picDepartments.map((department) => ({
    value: department.id,
    label: `${department.code} — ${department.name}`,
  }));

  const rows = query.data?.data ?? [];
  const labellable = rows.filter((row) => row.inventoryCode);
  const allOnPage = labellable.length > 0 && labellable.every((row) => selected.has(row.id));
  const toggle = (row, on) =>
    setSelected((current) => {
      const next = new Map(current);
      if (on) next.set(row.id, row.inventoryCode);
      else next.delete(row.id);
      return next;
    });
  const togglePage = (on) =>
    setSelected((current) => {
      const next = new Map(current);
      for (const row of labellable) {
        if (on) next.set(row.id, row.inventoryCode);
        else next.delete(row.id);
      }
      return next;
    });
  const tooMany = selected.size > MAX_BATCH_LABELS;

  const columns = [
    {
      id: 'select',
      header: () => (
        <Checkbox
          aria-label={t('units.labels.selectPage')}
          checked={allOnPage}
          disabled={labellable.length === 0}
          onChange={(event) => togglePage(event.target.checked)}
        />
      ),
      cell: ({ row }) =>
        row.original.inventoryCode ? (
          <Checkbox
            aria-label={t('units.labels.selectUnit', { code: row.original.inventoryCode })}
            checked={selected.has(row.original.id)}
            onChange={(event) => toggle(row.original, event.target.checked)}
          />
        ) : null,
    },
    {
      accessorKey: 'inventoryCode',
      header: t('units.columns.unit'),
      cell: ({ row }) => (
        <Link
          to={`/assets/${row.original.assetId}/units/${row.original.id}`}
          className="font-mono text-xs hover:underline"
        >
          {row.original.inventoryCode ?? t('assets.label.noCode')}
        </Link>
      ),
    },
    {
      id: 'asset',
      header: t('units.columns.asset'),
      cell: ({ row }) => {
        const asset = row.original.asset;
        if (!asset) return <span className="text-muted-foreground">—</span>;

        // Plain text without `asset:read` — the name is context, not a doorway.
        return canReadAssets ? (
          <Link to={`/assets/${asset.id}`} className="hover:underline">
            {asset.name}
          </Link>
        ) : (
          <span>{asset.name}</span>
        );
      },
    },
    {
      id: 'department',
      header: t('units.columns.department'),
      cell: ({ row }) =>
        row.original.department ? (
          <span>
            <span className="font-mono text-xs">{row.original.department.code}</span>{' '}
            <span className="text-muted-foreground">{row.original.department.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('units.unassignedDepartment')}</span>
        ),
    },
    {
      id: 'location',
      header: t('units.columns.location'),
      cell: ({ row }) => {
        const { currentLocation, currentLocationId } = row.original;
        if (currentLocation) return <span>{currentLocation.name}</span>;
        if (currentLocationId) {
          return <span>{locationLabels.get(currentLocationId) ?? '—'}</span>;
        }
        // A unit with no recorded location is exactly what this page exists to
        // surface, so it is labelled rather than left blank.
        return <span className="text-muted-foreground">{t('units.noLocation')}</span>;
      },
    },
    {
      accessorKey: 'lifecycleState',
      header: t('units.columns.lifecycle'),
      meta: { sortField: 'lifecycleState' },
      cell: ({ row }) => <StatusBadge value={row.original.lifecycleState} />,
    },
    {
      id: 'condition',
      header: t('units.columns.condition'),
      cell: ({ row }) =>
        row.original.currentCondition ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'status',
      header: t('common.fields.status'),
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <ListPage
      title={t('units.list.title')}
      description={
        isPicScoped ? t('units.list.descriptionPic') : t('units.list.description')
      }
      filters={
        <>
          <SearchFilter
            value={params.q ?? ''}
            onChange={(q) => setParams({ q })}
            placeholder={t('units.list.searchPlaceholder')}
          />

          {departmentOptions.length > 0 ? (
            <SelectFilter
              id="filter-department"
              label={t('units.columns.department')}
              value={params.departmentId ?? 'all'}
              options={departmentOptions}
              onChange={(departmentId) => setParams({ departmentId })}
            />
          ) : null}

          {(locationList.data?.data ?? []).length > 0 ? (
            <SelectFilter
              id="filter-location"
              label={t('assets.list.location')}
              value={params.locationId ?? 'all'}
              options={(locationList.data?.data ?? []).map((location) => ({
                value: location.id,
                label: location.name,
              }))}
              onChange={(locationId) => setParams({ locationId })}
            />
          ) : null}

          <SelectFilter
            id="filter-lifecycle"
            label={t('units.columns.lifecycle')}
            value={params.lifecycleState ?? 'all'}
            options={LIFECYCLE_STATES.map((state) => ({ value: state, label: state }))}
            onChange={(lifecycleState) => setParams({ lifecycleState })}
            width="w-44"
          />

          <SelectFilter
            id="filter-condition"
            label={t('assets.list.condition')}
            value={params.condition ?? 'all'}
            options={CONDITIONS.map((condition) => ({ value: condition, label: condition }))}
            onChange={(condition) => setParams({ condition })}
            width="w-44"
          />

          {/* REQ-REQUEST-024: received, not placed — derived by the server. */}
          <SelectFilter
            id="filter-placement"
            label={t('units.list.placement')}
            value={params.needsPlacement ?? 'all'}
            options={[{ value: 'true', label: t('units.list.needsPlacement') }]}
            onChange={(needsPlacement) => setParams({ needsPlacement })}
            width="w-44"
          />

          <StatusFilter
            value={params.status ?? 'all'}
            onChange={(status) => setParams({ status })}
          />
        </>
      }
      meta={query.data?.meta}
      onPageChange={setPage}
      actions={
        selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="label-selection">
            <span className="text-sm text-muted-foreground">
              {t('units.labels.selected', { count: selected.size })}
            </span>
            <Button variant="outline" size="sm" onClick={() => setSelected(new Map())}>
              {t('units.labels.clear')}
            </Button>
            <Button
              size="sm"
              disabled={tooMany}
              title={tooMany ? t('units.labels.tooMany', { max: MAX_BATCH_LABELS }) : undefined}
              onClick={() =>
                navigate(`/asset-units/labels?ids=${[...selected.keys()].join(',')}`)
              }
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              {t('units.labels.print', { count: selected.size })}
            </Button>
          </div>
        ) : null
      }
    >
      {tooMany ? (
        <p className="mb-3 text-sm text-warning-foreground">
          {t('units.labels.tooMany', { max: MAX_BATCH_LABELS })}
        </p>
      ) : null}
      <DataTable
        columns={columns}
        data={rows}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        sort={params.sort}
        order={params.order}
        onSortChange={setSort}
        emptyTitle={t('units.list.empty')}
        emptyDescription={
          isPicScoped ? t('units.list.emptyDescriptionPic') : t('units.list.emptyDescription')
        }
      />
    </ListPage>
  );
}
