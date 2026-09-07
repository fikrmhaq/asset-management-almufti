import { Link } from 'react-router-dom';

import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useListParams } from '@/hooks/useListParams';
import { formatDate } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { DataTable } from '@/components/patterns/data-table';
import { SelectFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import {
  useContractOptions,
  useInstitutionOptions,
  useTransactionTypeOptions,
} from './referenceOptions';
import { transactions } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Transactions — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §20.5; REQ-TXN-001.
 *
 * Filters map 1:1 onto `06-api.md` §7.3, which — unlike borrowings
 * (`GAP-011`) — does offer a real date range, so this list has one.
 *
 * There is no create-anything-else and no row action: a transaction is a
 * historical record (REQ-TXN-007), so the only write in this module is the
 * create page.
 */

/**
 * A date filter bound straight to the API's own `dateFrom`/`dateTo`.
 *
 * The placeholder carries the field name rather than a bare "Any": `DatePicker`
 * renders a button whose accessible name is its own content, so two adjacent
 * pickers reading "Any" would be indistinguishable to a screen reader. The
 * caption beside it is therefore a `<span>` and not a `<Label htmlFor>` — an
 * association would REPLACE that self-describing name with "From".
 *
 * `clearable`, because a filter is optional by definition: having narrowed the
 * list to a range, the way back out has to exist.
 */
function DateFilter({ label, placeholder, value, onChange, clearLabel }) {
  return (
    <div className="w-44 space-y-1.5">
      <span className="block text-sm leading-none font-medium">{label}</span>
      <DatePicker
        value={value}
        onChange={(next) => onChange(next ?? '')}
        placeholder={placeholder}
        clearable
        clearLabel={clearLabel}
      />
    </div>
  );
}

export function TransactionsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = transactions.useList(params);
  const canCreate = usePermission('transaction:create');

  const types = useTransactionTypeOptions();
  const institutions = useInstitutionOptions();
  const contracts = useContractOptions();

  const columns = [
    {
      id: 'transactionDate',
      header: 'Date',
      meta: { sortField: 'transactionDate' },
      cell: ({ row }) => (
        <Link to={`/operations/transactions/${row.original.id}`} className="hover:underline">
          {formatDate(row.original.transactionDate)}
        </Link>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) =>
        types.labels.get(String(row.original.transactionTypeId)) ?? (
          <span className="font-mono text-xs">{row.original.transactionTypeId}</span>
        ),
    },
    { accessorKey: 'description', header: 'Description' },
    {
      id: 'contract',
      header: 'Contract',
      cell: ({ row }) =>
        row.original.contractId ? (
          (contracts.labels.get(row.original.contractId) ?? (
            <span className="font-mono text-xs">{row.original.contractId}</span>
          ))
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <ListPage
      title={t('operations.transactions.title')}
      description={t('operations.transactions.description')}
      actions={
        <Can code="transaction:create">
          <Button asChild>
            <Link to="/operations/transactions/new">New transaction</Link>
          </Button>
        </Can>
      }
      filters={
        <>
          {types.allowed ? (
            <SelectFilter
              id="filter-type"
              label={t('operations.transactions.type')}
              value={params.transactionTypeId ?? 'all'}
              options={types.options}
              onChange={(transactionTypeId) => setParams({ transactionTypeId })}
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

          {contracts.allowed ? (
            <SelectFilter
              id="filter-contract"
              label={t('operations.transactions.contract')}
              value={params.contractId ?? 'all'}
              options={contracts.options}
              onChange={(contractId) => setParams({ contractId })}
            />
          ) : null}

          <DateFilter
            label={t('common.fields.from')}
            placeholder={t('operations.transactions.anyStartDate')}
            clearLabel="Clear start date"
            value={params.dateFrom ?? ''}
            onChange={(dateFrom) => setParams({ dateFrom })}
          />
          <DateFilter
            label="To"
            placeholder={t('operations.transactions.anyEndDate')}
            clearLabel="Clear end date"
            value={params.dateTo ?? ''}
            onChange={(dateTo) => setParams({ dateTo })}
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
        emptyTitle={t('operations.transactions.empty')}
        emptyDescription={
          canCreate ? 'Record one against the units it affected.' : 'Nothing matches these filters.'
        }
      />
    </ListPage>
  );
}
