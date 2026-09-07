import { Link } from 'react-router-dom';

import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useListParams } from '@/hooks/useListParams';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/numbers';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable } from '@/components/patterns/data-table';
import { SearchFilter, SelectFilter, StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import {
  useContractTypeOptions,
  useInstitutionOptions,
  useSupplierOptions,
} from './referenceOptions';
import { contracts } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Contracts — `07-ui.md` §5.5, `IMPLEMENTATION_PLAN.md` §19.3; REQ-PROC-002.
 *
 * Every filter maps 1:1 onto a documented query param (`06-api.md` §6.2) and
 * lives in the URL, so a filtered view survives a refresh and can be shared.
 * `q` searches the contract NUMBER — the server matches nothing else, so the
 * placeholder says so rather than implying a full-text search.
 *
 * The list response carries `supplierId` but no supplier object; names come from
 * one reference query and a lookup map (`DEC-037`), and the column falls back to
 * the raw id for a supplier outside that page. Creating and editing happen on
 * their own routes (`DEC-033`).
 */
export function ContractsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = contracts.useList(params);
  const canCreate = usePermission('contract:create');

  const suppliers = useSupplierOptions();
  const contractTypes = useContractTypeOptions();
  const institutions = useInstitutionOptions();

  const columns = [
    {
      accessorKey: 'contractNumber',
      header: 'Contract number',
      meta: { sortField: 'contractNumber' },
      cell: ({ row }) => (
        <Link to={`/procurement/contracts/${row.original.id}`} className="hover:underline">
          {row.original.contractNumber}
        </Link>
      ),
    },
    {
      id: 'supplier',
      header: 'Supplier',
      cell: ({ row }) =>
        row.original.supplierId ? (
          (suppliers.labels.get(row.original.supplierId) ?? (
            <span className="font-mono text-xs">{row.original.supplierId}</span>
          ))
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'contractDate',
      header: 'Date',
      meta: { sortField: 'contractDate' },
      cell: ({ row }) => formatDate(row.original.contractDate),
    },
    {
      id: 'contractValue',
      header: 'Value',
      meta: {
        sortField: 'contractValue',
        headerClassName: 'text-right',
        cellClassName: 'text-right tabular-nums',
      },
      cell: ({ row }) => formatMoney(row.original.contractValue),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <ListPage
      title={t('procurement.list.title')}
      description={t('procurement.list.description')}
      actions={
        <Can code="contract:create">
          <Button asChild>
            <Link to="/procurement/contracts/new">New contract</Link>
          </Button>
        </Can>
      }
      filters={
        <>
          <SearchFilter
            value={params.q ?? ''}
            onChange={(q) => setParams({ q })}
            placeholder={t('procurement.list.searchPlaceholder')}
          />

          {/* Each reference filter is hidden without ITS own read permission. */}
          {suppliers.allowed ? (
            <SelectFilter
              id="filter-supplier"
              label={t('procurement.list.supplier')}
              value={params.supplierId ?? 'all'}
              options={suppliers.options}
              onChange={(supplierId) => setParams({ supplierId })}
            />
          ) : null}

          {contractTypes.allowed ? (
            <SelectFilter
              id="filter-contract-type"
              label={t('procurement.list.type')}
              value={params.contractTypeId ?? 'all'}
              options={contractTypes.options}
              onChange={(contractTypeId) => setParams({ contractTypeId })}
              width="w-44"
            />
          ) : null}

          {institutions.allowed ? (
            <SelectFilter
              id="filter-institution"
              label={t('common.fields.institution')}
              value={params.institutionId ?? 'all'}
              options={institutions.options}
              onChange={(institutionId) => setParams({ institutionId })}
            />
          ) : null}

          <StatusFilter
            value={params.status ?? 'all'}
            onChange={(status) => setParams({ status })}
          />
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
        emptyTitle={t('procurement.list.empty')}
        emptyDescription={
          canCreate
            ? 'Create one to start recording procurement.'
            : 'Nothing matches these filters.'
        }
      />
    </ListPage>
  );
}
