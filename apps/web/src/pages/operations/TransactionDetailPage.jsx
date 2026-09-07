import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { transactionsApi } from '@/api/operations';
import { formatDate } from '@/lib/dates';
import { queryKeys } from '@/lib/queryKeys';
import { StatusBadge } from '@/components/ui/badge';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { DataTable } from '@/components/patterns/data-table';
import { DetailField, DetailFieldList, DetailPage, SectionCard } from '@/components/patterns/page';
import { transactions } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Transaction detail — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §20.5;
 * REQ-TXN-004, REQ-TXN-007.
 *
 * READ-ONLY, with no edit affordance anywhere on the page — no Edit button, no
 * Deactivate, no row action, no delete. That is not an oversight to be filled in
 * later: `06-api.md` §7.3 exposes no `PATCH` and no `DELETE`, because REQ-TXN-007
 * requires that a recorded transaction never be silently modified.
 *
 * Corrections are made by recording another transaction, which is what keeps the
 * unit-level history in REQ-TXN-010 truthful.
 */

function ItemsPanel({ transactionId }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.transactions.sub(transactionId, 'items'),
    queryFn: () => transactionsApi.listItems(transactionId),
  });

  const columns = [
    {
      id: 'unit',
      header: 'Asset unit',
      cell: ({ row }) => {
        const unit = row.original.assetUnit;
        if (!unit) return <span className="font-mono text-xs">{row.original.assetUnitId}</span>;

        return (
          <Link
            to={`/assets/${unit.assetId}/units/${unit.id}`}
            className="font-mono text-xs hover:underline"
          >
            {unit.id.slice(0, 8)}
          </Link>
        );
      },
    },
    {
      id: 'description',
      header: 'Description',
      cell: ({ row }) => row.original.assetUnit?.description ?? '—',
    },
    {
      id: 'lifecycle',
      header: 'Lifecycle now',
      cell: ({ row }) =>
        row.original.assetUnit ? (
          <StatusBadge value={row.original.assetUnit.lifecycleState} />
        ) : null,
    },
    { accessorKey: 'notes', header: 'Note' },
  ];

  return (
    <SectionCard
      title={t('operations.transactions.affectedUnits')}
      description={t('operations.transactions.affectedUnitsDetail')}
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('operations.transactions.noUnits')}
      />
    </SectionCard>
  );
}

export function TransactionDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = transactions.useDetail(id);

  const transaction = query.data;

  if (query.isLoading) return <LoadingState variant="detail" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <DetailPage
      title={transaction.transactionType?.name ?? 'Transaction'}
      description={formatDate(transaction.transactionDate)}
    >
      <SectionCard title={t('operations.transactions.section')}>
        <DetailFieldList>
          <DetailField label={t('common.fields.date')}>
            {formatDate(transaction.transactionDate)}
          </DetailField>
          <DetailField label={t('operations.transactions.type')}>
            {transaction.transactionType?.name}
          </DetailField>
          <DetailField label={t('common.fields.institution')}>
            {transaction.institution?.name}
          </DetailField>

          {/* Populated only for procurement-originated transactions
              (REQ-TXN-008/009) — absent is the normal case, not missing data. */}
          <DetailField label={t('operations.transactions.supplier')}>
            {transaction.supplier ? (
              <Link
                to={`/procurement/suppliers/${transaction.supplier.id}`}
                className="hover:underline"
              >
                {transaction.supplier.name}
              </Link>
            ) : null}
          </DetailField>
          <DetailField label={t('operations.transactions.contract')}>
            {transaction.contract ? (
              <Link
                to={`/procurement/contracts/${transaction.contract.id}`}
                className="hover:underline"
              >
                {transaction.contract.contractNumber}
              </Link>
            ) : null}
          </DetailField>
          <DetailField label={t('common.fields.description')} className="sm:col-span-2">
            {transaction.description}
          </DetailField>
        </DetailFieldList>
      </SectionCard>

      <ItemsPanel transactionId={id} />
    </DetailPage>
  );
}
