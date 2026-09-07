import { Link } from 'react-router-dom';

import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useListParams } from '@/hooks/useListParams';
import { formatDate } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable } from '@/components/patterns/data-table';
import { SearchFilter, SelectFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { useInstitutionOptions } from './referenceOptions';
import { borrowings } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Borrowings — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §20.1;
 * REQ-BORROW-001, REQ-REPORT-007.
 *
 * The four filters `06-api.md` §7.2 documents, and no others (`DEC-043`):
 * `q` searches borrower name and contact, and there are no date filters to bind
 * to (`GAP-011`). Filtering a single page in the browser instead would be worse
 * than not offering it (§33).
 *
 * `overdue` is a separate control from `status` on purpose. It is DERIVED —
 * still holding units past the expected return date — so it catches a loan the
 * Phase 8 sweep has not stamped `OVERDUE` yet (`DEC-016`).
 */

const STATUSES = ['DRAFT', 'ACTIVE', 'OVERDUE', 'RETURNED', 'CANCELLED'];

export function BorrowingsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = borrowings.useList(params);
  const canCreate = usePermission('borrowing:create');
  const institutions = useInstitutionOptions();

  const columns = [
    {
      accessorKey: 'borrowerName',
      header: 'Borrower',
      cell: ({ row }) => (
        <Link to={`/operations/borrowings/${row.original.id}`} className="hover:underline">
          {row.original.borrowerName}
        </Link>
      ),
    },
    { accessorKey: 'borrowerContact', header: 'Contact' },
    {
      id: 'borrowDate',
      header: 'Borrowed',
      meta: { sortField: 'borrowDate' },
      cell: ({ row }) => formatDate(row.original.borrowDate),
    },
    {
      id: 'expectedReturnDate',
      header: 'Due',
      meta: { sortField: 'expectedReturnDate' },
      cell: ({ row }) => formatDate(row.original.expectedReturnDate),
    },
    {
      id: 'actualReturnDate',
      header: 'Returned',
      cell: ({ row }) =>
        row.original.actualReturnDate ? (
          formatDate(row.original.actualReturnDate)
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      meta: { sortField: 'status' },
      cell: ({ row }) => <StatusBadge value={row.original.status} />,
    },
  ];

  return (
    <ListPage
      title={t('operations.borrowings.title')}
      description={t('operations.borrowings.description')}
      actions={
        <Can code="borrowing:create">
          <Button asChild>
            <Link to="/operations/borrowings/new">New borrowing</Link>
          </Button>
        </Can>
      }
      filters={
        <>
          <SearchFilter
            value={params.q ?? ''}
            onChange={(q) => setParams({ q })}
            placeholder={t('operations.borrowings.searchPlaceholder')}
          />

          <SelectFilter
            id="filter-status"
            label={t('common.fields.status')}
            value={params.status ?? 'all'}
            options={STATUSES.map((status) => ({ value: status, label: status }))}
            onChange={(status) => setParams({ status })}
            width="w-44"
          />

          <SelectFilter
            id="filter-overdue"
            label={t('operations.borrowings.overdue')}
            value={params.overdue ?? 'all'}
            options={[{ value: 'true', label: 'Past due only' }]}
            onChange={(overdue) => setParams({ overdue })}
            width="w-44"
          />

          {institutions.allowed ? (
            <SelectFilter
              id="filter-institution"
              label={t('common.fields.institution')}
              value={params.institutionId ?? 'all'}
              options={institutions.options}
              onChange={(institutionId) => setParams({ institutionId })}
            />
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
        emptyTitle={t('operations.borrowings.empty')}
        emptyDescription={
          canCreate ? 'Create one to record a loan.' : 'Nothing matches these filters.'
        }
      />
    </ListPage>
  );
}

export { STATUSES };
