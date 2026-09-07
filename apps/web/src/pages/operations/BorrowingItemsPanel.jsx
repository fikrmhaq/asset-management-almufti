import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { borrowingsApi } from '@/api/operations';
import { Can } from '@/auth/guards';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateResources } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { DataTable } from '@/components/patterns/data-table';
import { SectionCard } from '@/components/patterns/page';
import { UnitPicker } from '@/components/operations/UnitPicker';
import { useTranslation } from 'react-i18next';

/**
 * The units a borrowing covers — `IMPLEMENTATION_PLAN.md` §20.3;
 * REQ-BORROW-006, REQ-BORROW-008.
 *
 * Editable while `DRAFT` only (`DEC-012`): a borrowing's composition is fixed at
 * activation, because adding a unit to an already-`ACTIVE` loan would need an
 * undocumented rule about when that unit becomes `BORROWED`. Past `DRAFT` the
 * table is a record, not a form.
 *
 * The picker only offers units that can actually be borrowed (`DEC-041`), and
 * `BR-003` — another `ACTIVE`/`OVERDUE` borrowing already holding the unit — is
 * still the server's call, surfaced as a `CONFLICT` naming the borrowing that
 * holds it.
 */
export function BorrowingItemsPanel({ borrowingId, editable }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);

  const itemsKey = queryKeys.borrowings.sub(borrowingId, 'items');

  const query = useQuery({
    queryKey: itemsKey,
    queryFn: () => borrowingsApi.listItems(borrowingId),
  });

  const items = query.data?.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: itemsKey });

  const addItem = useMutation({
    mutationFn: (assetUnitId) => borrowingsApi.addItem(borrowingId, assetUnitId),
    onSuccess: async () => {
      await refresh();
      toast.success('Unit added');
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const removeItem = useMutation({
    mutationFn: (itemId) => borrowingsApi.removeItem(borrowingId, itemId),
    onSuccess: async () => {
      await refresh();
      toast.success('Unit removed');
    },
    onError: (error) => toast.fromError(error),
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
      header: 'Lifecycle',
      cell: ({ row }) =>
        row.original.assetUnit ? (
          <StatusBadge value={row.original.assetUnit.lifecycleState} />
        ) : null,
    },
    {
      id: 'condition',
      header: 'Condition',
      cell: ({ row }) =>
        row.original.assetUnit?.currentCondition ? (
          <StatusBadge value={row.original.assetUnit.currentCondition} />
        ) : (
          <span className="text-muted-foreground">Not recorded</span>
        ),
    },
    ...(editable
      ? [
          {
            id: 'actions',
            header: '',
            meta: { cellClassName: 'text-right whitespace-nowrap' },
            cell: ({ row }) => (
              <Can code="borrowing-item:delete">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={removeItem.isPending}
                  onClick={() => removeItem.mutate(row.original.id)}
                >
                  Remove
                </Button>
              </Can>
            ),
          },
        ]
      : []),
  ];

  return (
    <SectionCard
      title={t('operations.borrowings.units')}
      description={
        editable ? t('operations.borrowings.unitsEditable') : t('operations.borrowings.unitsFixed')
      }
      actions={
        editable ? (
          <Can code="borrowing-item:create">
            <Button size="sm" onClick={() => setPicking(true)}>
              Add unit
            </Button>
          </Can>
        ) : null
      }
    >
      <DataTable
        columns={columns}
        data={items}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('operations.borrowings.noUnits')}
        emptyDescription={t('operations.borrowings.noUnitsDescription')}
      />

      <UnitPicker
        open={picking}
        onOpenChange={setPicking}
        title={t('operations.borrowings.addUnit')}
        borrowable
        excludeUnitIds={items.map((item) => item.assetUnitId)}
        onSelect={async ([unit]) => {
          await addItem.mutateAsync(unit.id).catch(() => undefined);
          // The unit list the picker shows is filtered by lifecycle state, which
          // this add does not change — but the asset caches carry unit rows too.
          await invalidateResources(queryClient, queryKeys.assets);
        }}
      />
    </SectionCard>
  );
}
