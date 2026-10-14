import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { consumablesApi } from '@/api/consumables';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { formatDateTime } from '@/lib/dates';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Textarea } from '@/components/ui/input';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { DetailField, DetailFieldList, DetailPage, SectionCard } from '@/components/patterns/page';
import { ConsumableFormDialog } from './ConsumableFormDialog';
import { CONSUMABLES_KEY } from './consumableKeys';

/**
 * One consumable — `IMPLEMENTATION_PLAN.md` §73. Its master, the stock on hand,
 * and every movement that made it: RECEIPT and ADJUSTMENT recorded here
 * (`consumable:manage-stock`), ISSUE recorded against a request line. The
 * server computes every balance; nothing here sends one.
 */

const MOVEMENT_VARIANT = { RECEIPT: 'success', ISSUE: 'default', ADJUSTMENT: 'warning' };
const personName = (user) =>
  `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.username || '';
const signed = (quantity) => (quantity > 0 ? `+${quantity}` : String(quantity));
const fieldError = (error, name) =>
  error?.fieldErrors?.[name] ?? error?.fieldErrors?.[`body.${name}`] ?? null;

/** Receive (+) or adjust (±, with a reason) — one movement, all or nothing. */
function StockDialog({ consumable, kind, onOpenChange }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState('');
  const [text, setText] = useState('');
  const [clientError, setClientError] = useState({});
  const adjusting = kind === 'adjust';

  const save = useMutation({
    mutationFn: (body) =>
      adjusting
        ? consumablesApi.adjust(consumable.id, body)
        : consumablesApi.receive(consumable.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CONSUMABLES_KEY });
      toast.success(t(adjusting ? 'consumables.adjusted' : 'consumables.received'));
      onOpenChange(false);
    },
  });

  const errorFor = (name) => clientError[name] ?? fieldError(save.error, name);
  const unit = consumable.measurementUnit?.name ?? '';

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t(adjusting ? 'consumables.adjustTitle' : 'consumables.receiveTitle', {
        name: consumable.name,
      })}
      description={t(
        adjusting ? 'consumables.adjustDescription' : 'consumables.receiveDescription',
        {
          onHand: consumable.quantityOnHand,
          unit,
        }
      )}
      submitLabel={t(adjusting ? 'consumables.adjust' : 'consumables.receive')}
      loading={save.isPending}
      error={save.error}
      onSubmit={(event) => {
        event.preventDefault();
        const value = Number(quantity);
        const next = {};
        if (!Number.isInteger(value) || value === 0 || (!adjusting && value < 0)) {
          next.quantity = t(
            adjusting ? 'consumables.errors.nonZero' : 'consumables.errors.positive'
          );
        }
        if (adjusting && !text.trim()) next.reason = t('consumables.errors.reasonRequired');
        setClientError(next);
        if (Object.keys(next).length) return;
        save.mutate(
          adjusting
            ? { quantity: value, reason: text.trim() }
            : { quantity: value, note: text.trim() || null }
        );
      }}
    >
      <Field
        label={t('consumables.fields.quantity', { unit })}
        hint={t(adjusting ? 'consumables.adjustQuantityHint' : 'consumables.receiveQuantityHint')}
        error={errorFor('quantity')}
        required
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="number"
            step={1}
            {...(adjusting ? {} : { min: 1 })}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        )}
      </Field>
      <Field
        label={t(adjusting ? 'consumables.fields.reason' : 'consumables.fields.note')}
        hint={adjusting ? t('consumables.reasonHint') : null}
        error={errorFor(adjusting ? 'reason' : 'note')}
        required={adjusting}
      >
        {(fieldProps) => (
          <Textarea
            {...fieldProps}
            rows={2}
            maxLength={5000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}

function MovementsSection({ consumable }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [...CONSUMABLES_KEY, consumable.id, 'movements', page],
    queryFn: () => consumablesApi.movements(consumable.id, { page, pageSize: 20 }),
  });

  const columns = [
    {
      id: 'when',
      header: t('consumables.movements.when'),
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      id: 'type',
      header: t('consumables.movements.type'),
      cell: ({ row }) => (
        <Badge variant={MOVEMENT_VARIANT[row.original.movementType]}>
          {t(`consumables.movementTypes.${row.original.movementType}`)}
        </Badge>
      ),
    },
    {
      id: 'quantity',
      header: t('consumables.movements.quantity'),
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">{signed(row.original.quantity)}</span>
      ),
    },
    {
      id: 'balance',
      header: t('consumables.movements.balance'),
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">{row.original.balanceAfter}</span>
      ),
    },
    {
      id: 'detail',
      header: t('consumables.movements.detail'),
      cell: ({ row }) => (
        <span className="block max-w-sm">
          {row.original.request ? (
            <Link
              to={`/requests/${row.original.request.id}`}
              className="block font-medium text-primary hover:underline"
            >
              {t('consumables.movements.forRequest', {
                number: row.original.request.requestNumber,
                line: row.original.request.lineNo,
              })}
            </Link>
          ) : null}
          {row.original.note ? (
            <span className="block text-xs text-muted-foreground">{row.original.note}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'by',
      header: t('consumables.movements.by'),
      cell: ({ row }) => personName(row.original.createdBy),
    },
  ];

  return (
    <SectionCard
      title={t('consumables.movements.title')}
      description={t('consumables.movements.description')}
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('consumables.movements.empty')}
        getRowId={(row) => row.id}
      />
      {(query.data?.meta?.totalPages ?? 1) > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('common.pagination.previous')}
          </Button>
          <span>
            {page} / {query.data.meta.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= query.data.meta.totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t('common.pagination.next')}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}

export function ConsumableDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const canManageStock = usePermission('consumable:manage-stock');
  const [dialog, setDialog] = useState(null); // null | 'edit' | 'receive' | 'adjust' | 'status'

  const query = useQuery({
    queryKey: [...CONSUMABLES_KEY, id],
    queryFn: () => consumablesApi.get(id),
  });
  const consumable = query.data;

  const update = useMutation({
    mutationFn: (body) => consumablesApi.update(id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CONSUMABLES_KEY });
      toast.success(t('consumables.saved'));
      setDialog(null);
    },
  });
  const setActive = useMutation({
    mutationFn: () =>
      consumable.isActive ? consumablesApi.deactivate(id) : consumablesApi.reactivate(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CONSUMABLES_KEY });
      setDialog(null);
    },
    onError: (error) => toast.fromError(error),
  });
  // The unit is fixed once stock has moved; the history says whether it has.
  const moved = useQuery({
    queryKey: [...CONSUMABLES_KEY, id, 'movements', 'any'],
    queryFn: () => consumablesApi.movements(id, { page: 1, pageSize: 1 }),
    enabled: dialog === 'edit',
  });

  if (query.isLoading) return <LoadingState variant="detail" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const unit = consumable.measurementUnit?.name ?? '';

  return (
    <DetailPage
      title={consumable.name}
      description={t('consumables.detailDescription')}
      badge={<StatusBadge value={consumable.isActive ? 'active' : 'inactive'} />}
      actions={
        <div className="flex flex-wrap gap-2">
          {canManageStock && consumable.isActive ? (
            <>
              <Button onClick={() => setDialog('receive')}>{t('consumables.receive')}</Button>
              <Button variant="outline" onClick={() => setDialog('adjust')}>
                {t('consumables.adjust')}
              </Button>
            </>
          ) : null}
          <Can code="consumable:update">
            <Button variant="outline" onClick={() => setDialog('edit')}>
              {t('common.actions.edit')}
            </Button>
          </Can>
          <Can code="consumable:deactivate">
            <Button variant="outline" onClick={() => setDialog('status')}>
              {consumable.isActive ? t('consumables.deactivate') : t('consumables.reactivate')}
            </Button>
          </Can>
        </div>
      }
    >
      <SectionCard title={t('consumables.stockTitle')}>
        <DetailFieldList>
          <DetailField label={t('consumables.fields.onHand')}>
            <span className="text-2xl font-semibold tabular-nums" data-testid="on-hand">
              {consumable.quantityOnHand}
            </span>{' '}
            <span className="text-muted-foreground">{unit}</span>
          </DetailField>
          <DetailField label={t('consumables.fields.unit')}>{unit}</DetailField>
          <DetailField label={t('consumables.fields.description')}>
            {consumable.description}
          </DetailField>
        </DetailFieldList>
        {!consumable.isActive ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('consumables.inactiveHint')}</p>
        ) : null}
      </SectionCard>

      <MovementsSection consumable={consumable} />

      {dialog === 'receive' || dialog === 'adjust' ? (
        <StockDialog
          consumable={consumable}
          kind={dialog}
          onOpenChange={(open) => (open ? null : setDialog(null))}
        />
      ) : null}
      {dialog === 'edit' ? (
        <ConsumableFormDialog
          title={t('consumables.editTitle')}
          submitLabel={t('common.actions.save')}
          mutation={update}
          initial={consumable}
          unitLocked={(moved.data?.meta?.total ?? 0) > 0}
          onOpenChange={(open) => (open ? null : setDialog(null))}
        />
      ) : null}
      <ConfirmDialog
        open={dialog === 'status'}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        title={
          consumable.isActive ? t('consumables.deactivateTitle') : t('consumables.reactivateTitle')
        }
        description={
          consumable.isActive
            ? t('consumables.deactivateDescription')
            : t('consumables.reactivateDescription')
        }
        confirmLabel={
          consumable.isActive ? t('consumables.deactivate') : t('consumables.reactivate')
        }
        loading={setActive.isPending}
        onConfirm={() => setActive.mutate()}
      />
    </DetailPage>
  );
}
