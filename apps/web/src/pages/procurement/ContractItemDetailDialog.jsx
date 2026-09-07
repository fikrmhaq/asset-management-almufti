import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { contractItemsApi } from '@/api/procurement';
import { usePermission } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';
import { formatMoney, formatQuantity } from '@/lib/numbers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { DataTable } from '@/components/patterns/data-table';
import { DetailField, DetailFieldList } from '@/components/patterns/page';
import { useTranslation } from 'react-i18next';

/**
 * Contract item detail — `IMPLEMENTATION_PLAN.md` §19.4, `06-api.md` §6.3.
 *
 * A dialog opened from the item's row, not a route (`DEC-035`): `07-ui.md` §5.5
 * specifies an inline sub-table on the contract page and defines no
 * contract-item route, while the traceability matrix still names a "Contract
 * Item Detail" screen. This is that screen.
 *
 * `totalValue` is the server's derived value (`quantity * unitPrice`,
 * `03-domain.md` §4.17) — displayed, never recomputed here.
 *
 * The units section is the REQ-PROC-006 traceability view: what was actually
 * registered against this line. It needs `asset-unit:read`, which is not implied
 * by `contract-item:read`, so without it the section is absent rather than
 * showing an error (`DEC-032`).
 */

function AssetUnitsSection({ itemId }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.contractItems.sub(itemId, 'asset-units'),
    queryFn: () => contractItemsApi.assetUnits(itemId),
  });

  const columns = [
    {
      id: 'unit',
      // Not "Unit": this dialog also shows the ordered quantity and its unit of
      // measure, and the two must not read as the same column.
      header: t('units.columns.unit'),
      cell: ({ row }) => (
        <Link
          to={`/assets/${row.original.assetId}/units/${row.original.id}`}
          className="font-mono text-xs hover:underline"
        >
          {row.original.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      id: 'asset',
      header: t('units.columns.asset'),
      cell: ({ row }) => (
        <Link to={`/assets/${row.original.assetId}`} className="hover:underline">
          {t('common.actions.view')}
        </Link>
      ),
    },
    {
      id: 'lifecycle',
      header: t('units.columns.lifecycle'),
      cell: ({ row }) => <StatusBadge value={row.original.lifecycleState} />,
    },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t('procurement.items.assetUnits')}</h3>
      <p className="text-xs text-muted-foreground">
        {t('procurement.items.assetUnitsDescription')}
      </p>
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('procurement.items.nothingRegistered')}
        emptyDescription={t('procurement.items.nothingRegisteredDescription')}
      />
    </div>
  );
}

export function ContractItemDetailDialog({ itemId, open, onOpenChange }) {
  const { t } = useTranslation();
  const canReadUnits = usePermission('asset-unit:read');

  const query = useQuery({
    queryKey: queryKeys.contractItems.detail(itemId),
    queryFn: () => contractItemsApi.get(itemId),
    enabled: open && Boolean(itemId),
  });

  const item = query.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item?.assetName ?? 'Contract item'}</DialogTitle>
          <DialogDescription>
            One purchased line of this contract, and what has been registered from it.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? <LoadingState variant="detail" rows={4} /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : null}

        {item ? (
          <div className="space-y-6">
            <DetailFieldList>
              <DetailField label={t('procurement.items.item')}>{item.assetName}</DetailField>
              <DetailField label={t('procurement.items.specification')}>
                {item.specification}
              </DetailField>
              <DetailField label={t('procurement.items.quantityOrdered')}>
                {formatQuantity(item.quantity, item.unitType) || null}
              </DetailField>
              <DetailField label={t('procurement.items.unitPrice')}>
                {formatMoney(item.unitPrice) || null}
              </DetailField>
              <DetailField label={t('procurement.items.total')}>
                {formatMoney(item.totalValue) || null}
              </DetailField>
            </DetailFieldList>

            {canReadUnits ? <AssetUnitsSection itemId={item.id} /> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
