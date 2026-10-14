import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { consumablesApi } from '@/api/consumables';
import { Can } from '@/auth/guards';
import { useListParams } from '@/hooks/useListParams';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { DataTable } from '@/components/patterns/data-table';
import { SearchFilter, StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { ConsumableFormDialog } from './ConsumableFormDialog';
import { CONSUMABLES_KEY } from './consumableKeys';

/**
 * Consumables — `IMPLEMENTATION_PLAN.md` §73. Quantity-based stock items of the
 * institution: a name, one measurement unit, the stock on hand. Not Assets — no
 * units, inventory codes or labels. Stock changes on the detail page (receive,
 * adjust) and by issuing against a request.
 */

export function ConsumablesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { params, setParams, setPage, setSort } = useListParams();
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: [...CONSUMABLES_KEY, 'list', params],
    queryFn: () => consumablesApi.list(params),
  });

  const create = useMutation({
    mutationFn: (body) => consumablesApi.create(body),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: CONSUMABLES_KEY });
      toast.success(t('consumables.created'));
      setCreating(false);
      navigate(`/consumables/${created.id}`);
    },
  });

  const columns = [
    {
      accessorKey: 'name',
      header: t('consumables.columns.name'),
      meta: { sortField: 'name' },
      cell: ({ row }) => (
        <Link to={`/consumables/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      id: 'unit',
      header: t('consumables.columns.unit'),
      cell: ({ row }) => row.original.measurementUnit?.name ?? '—',
    },
    {
      accessorKey: 'quantityOnHand',
      header: t('consumables.columns.onHand'),
      meta: { sortField: 'quantityOnHand' },
      cell: ({ row }) => (
        <span className="font-mono tabular-nums" data-testid={`on-hand-${row.original.id}`}>
          {row.original.quantityOnHand}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('consumables.columns.status'),
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <ListPage
      title={t('consumables.title')}
      description={t('consumables.description')}
      actions={
        <Can code="consumable:create">
          <Button onClick={() => setCreating(true)}>{t('consumables.new')}</Button>
        </Can>
      }
      filters={
        <>
          <SearchFilter
            value={params.q ?? ''}
            onChange={(q) => setParams({ q })}
            placeholder={t('consumables.searchPlaceholder')}
          />
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
        emptyTitle={t('consumables.empty')}
        emptyDescription={t('consumables.emptyDescription')}
        getRowId={(row) => row.id}
      />
      {creating ? (
        <ConsumableFormDialog
          title={t('consumables.new')}
          submitLabel={t('common.actions.create')}
          mutation={create}
          onOpenChange={(open) => (open ? null : setCreating(false))}
        />
      ) : null}
    </ListPage>
  );
}
