import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Can } from '@/auth/guards';
import { useListParams } from '@/hooks/useListParams';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable } from '@/components/patterns/data-table';
import { SearchFilter, SelectFilter, StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { ClassificationPicker } from '@/components/reference/ClassificationPicker';
import { useContractOptions } from '../operations/referenceOptions';
import { useInstitutionOptions, useVendorOptions } from '../procurement/referenceOptions';
import { assets, locations } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Asset list — `07-ui.md` §5.3, `IMPLEMENTATION_PLAN.md` §18.1, §18.9;
 * REQ-ASSET-007/009, REQ-ASSET-011, REQ-SEARCH-001/002.
 *
 * Every filter maps 1:1 onto a documented query param (`06-api.md` §5.1) and
 * lives in the URL, so a filtered view is shareable and survives a refresh.
 * Searching, filtering, sorting and paging all happen server-side — the table
 * never holds more than one page (`IMPLEMENTATION_PLAN.md` §33).
 *
 * The classification filter uses the shared picker (§4.5) rather than a flat
 * select, for the same reason the forms do: the hierarchy is thousands of leaves
 * deep.
 *
 * Vendor and contract were added in Phase 16: the API accepted both filters from
 * Phase 5 and `07-ui.md` §5.3 lists them, but no control existed. Contract
 * numbers are resolved from a reference query and a lookup map — the LIST
 * serializer carries `contractId` only, so the column showed a dash for every
 * row until this was fixed (`GAP-006`, resolved the `DEC-037` way rather than by
 * changing the API).
 */

const CONDITIONS = ['GOOD', 'FAIR', 'POOR', 'DAMAGED', 'UNSERVICEABLE'];

/** A foreign key rendered through a label map, falling back to the id itself. */
function resolve(labels, id) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  return labels.get(id) ?? <span className="font-mono text-xs">{id.slice(0, 8)}</span>;
}

export function AssetsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = assets.useList(params);
  const [picking, setPicking] = useState(false);
  const [classification, setClassification] = useState(null);

  // Only for the location filter's labels; a caller without `location:read`
  // simply does not see that filter.
  const locationList = locations.useList({ pageSize: 100, status: 'active' });

  const institutions = useInstitutionOptions();
  const vendors = useVendorOptions();
  const contracts = useContractOptions();

  const columns = [
    {
      accessorKey: 'name',
      header: 'Name',
      meta: { sortField: 'name' },
      cell: ({ row }) => (
        <Link to={`/assets/${row.original.id}`} className="hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      id: 'classification',
      header: 'Classification',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.classificationId}</span>,
    },
    // Both of these read from a lookup map rather than an embedded object: the
    // LIST serializer carries `institutionId` and `contractId` only, so
    // `row.institution?.name` was `undefined` on every row and both columns
    // rendered a dash regardless of the data (`GAP-006`). The raw id is the
    // fallback when a record sits outside the loaded reference page — never a
    // blank, which would look like "no institution" rather than "not resolved".
    {
      id: 'institution',
      header: 'Institution',
      cell: ({ row }) => resolve(institutions.labels, row.original.institutionId),
    },
    {
      id: 'contract',
      header: 'Contract',
      cell: ({ row }) =>
        row.original.contractId ? (
          <Link
            to={`/procurement/contracts/${row.original.contractId}`}
            className="hover:underline"
          >
            {contracts.labels.get(row.original.contractId) ?? row.original.contractId.slice(0, 8)}
          </Link>
        ) : (
          // REQ-ASSET-011's documented exception: donated, self-constructed or
          // migrated assets legitimately have no procurement record.
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <ListPage
      title={t('assets.list.title')}
      description="The master registry. Each asset has one or more physical units."
      actions={
        <Can code="asset:create">
          <Button asChild>
            <Link to="/assets/new">New asset</Link>
          </Button>
        </Can>
      }
      filters={
        <>
          <SearchFilter
            value={params.q ?? ''}
            onChange={(q) => setParams({ q })}
            placeholder={t('assets.list.searchPlaceholder')}
          />

          <div className="space-y-1.5">
            <span className="block text-sm leading-none font-medium">Classification</span>
            <Button
              variant="outline"
              onClick={() => setPicking(true)}
              className="w-56 justify-start font-normal"
            >
              {classification ? classification.name : 'Any classification'}
            </Button>
          </div>

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

          {/* `07-ui.md` §5.3 lists both; the API has accepted them since
              Phase 5, and only the controls were missing (Phase 16). */}
          {vendors.allowed ? (
            <SelectFilter
              id="filter-vendor"
              label={t('assets.list.vendor')}
              value={params.vendorId ?? 'all'}
              options={vendors.options}
              onChange={(vendorId) => setParams({ vendorId })}
            />
          ) : null}

          {contracts.allowed ? (
            <SelectFilter
              id="filter-contract"
              label={t('assets.list.contract')}
              value={params.contractId ?? 'all'}
              options={contracts.options}
              onChange={(contractId) => setParams({ contractId })}
            />
          ) : null}

          <SelectFilter
            id="filter-condition"
            label={t('assets.list.condition')}
            value={params.condition ?? 'all'}
            options={CONDITIONS.map((condition) => ({ value: condition, label: condition }))}
            onChange={(condition) => setParams({ condition })}
            width="w-44"
          />

          <StatusFilter
            value={params.status ?? 'all'}
            onChange={(status) => setParams({ status })}
          />

          {classification ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setClassification(null);
                setParams({ classificationId: '' });
              }}
            >
              Clear classification
            </Button>
          ) : null}
        </>
      }
      meta={query.data?.meta}
      onPageChange={setPage}
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        sort={params.sort}
        order={params.order}
        onSortChange={setSort}
        emptyTitle={t('assets.list.empty')}
        emptyDescription={t('assets.list.emptyDescription')}
      />

      <ClassificationPicker
        open={picking}
        onOpenChange={setPicking}
        title={t('assets.list.filterByClassification')}
        onSelect={(node) => {
          setClassification(node);
          setParams({ classificationId: node.id });
        }}
      />
    </ListPage>
  );
}

export { CONDITIONS };
