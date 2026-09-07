import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { contractItemsApi, contractsApi } from '@/api/procurement';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { queryKeys } from '@/lib/queryKeys';
import { formatMoney, formatQuantity, parseMoney } from '@/lib/numbers';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SectionCard } from '@/components/patterns/page';
import { AddAssetDialog } from './AddAssetDialog';
import { ContractItemDetailDialog } from './ContractItemDetailDialog';
import { useTranslation } from 'react-i18next';

/**
 * Contract items — `07-ui.md` §5.5, `IMPLEMENTATION_PLAN.md` §19.4;
 * REQ-PROC-004/005.
 *
 * An inline sub-table on the contract detail page, exactly as §5.5 specifies:
 * add and edit happen in place, and no contract-item route exists (`DEC-035`).
 *
 * Guarded by `contract-item:*`, not `contract:*` — the item is the resource
 * being acted on (`06-api.md` §1.3), which is also how the server guards these
 * paths.
 *
 * Deletion is a REAL delete: `contract_items` has no `is_active` column, so
 * unlike almost everything else in this application it removes the row. The
 * server blocks it with `CONFLICT` once asset units were procured through the
 * line (REQ-PROC-006), and that message is shown rather than swallowed.
 *
 * `totalValue` is never computed here — it is the server's derived value
 * (`03-domain.md` §4.17).
 */

const itemSchema = z.object({
  assetName: z.string().trim().min(1, 'is required').max(150),
  specification: z.string().trim().max(5000).optional(),
  quantity: z
    .string()
    .optional()
    .refine((value) => !value || Number.isInteger(Number(value)), 'must be a whole number')
    .refine((value) => !value || Number(value) > 0, 'must be greater than zero'),
  unitPrice: z
    .string()
    .optional()
    .refine((value) => !value || Number.isFinite(Number(value)), 'must be a number')
    .refine((value) => !value || Number(value) >= 0, 'must not be negative'),
  unitType: z.string().trim().max(50).optional(),
});

const EMPTY = { assetName: '', specification: '', quantity: '', unitPrice: '', unitType: '' };

/** Create and edit share one form: the fields and the rules are identical. */
function ContractItemFormDialog({ open, onOpenChange, item, onSave, loading }) {
  const { t } = useTranslation();
  const editing = Boolean(item);

  const { form, submit } = useZodForm({
    schema: itemSchema,
    defaultValues: EMPTY,
    onSubmit: async (values) => {
      // Cleared fields are sent as `null` on edit so the server actually clears
      // them, and omitted on create so the columns take their own defaults.
      const blank = editing ? null : undefined;

      await onSave({
        assetName: values.assetName,
        specification: values.specification || blank,
        quantity: values.quantity ? Number(values.quantity) : blank,
        unitPrice: parseMoney(values.unitPrice) ?? blank,
        unitType: values.unitType || blank,
      });
    },
    // A validation failure lands on the field it names; anything else (a
    // `CONFLICT`, a `FORBIDDEN`) has no field to attach to and is toasted.
    onError: (error) => toast.fromError(error),
  });

  const {
    register,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  useEffect(() => {
    if (!open) return;

    reset(
      item
        ? {
            assetName: item.assetName,
            specification: item.specification ?? '',
            quantity: String(item.quantity ?? ''),
            unitPrice: String(item.unitPrice ?? ''),
            unitType: item.unitType ?? '',
          }
        : EMPTY
    );
  }, [open, item, reset]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(editing ? 'procurement.items.editLineItem' : 'procurement.items.addLineItem')}
      description={t('procurement.items.lineItemDescription')}
      submitLabel={t(editing ? 'common.actions.saveChanges' : 'procurement.items.addItem')}
      onSubmit={submit}
      loading={isSubmitting || loading}
      error={errors.root?.server}
    >
      <Field label={t('procurement.items.itemName')} error={errors.assetName?.message} required>
        {(fieldProps) => <Input {...fieldProps} {...register('assetName')} />}
      </Field>
      <Field label={t('procurement.items.specification')} error={errors.specification?.message}>
        {(fieldProps) => <Textarea {...fieldProps} {...register('specification')} rows={2} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label={t('procurement.items.quantity')}
          error={errors.quantity?.message}
          hint={t('procurement.items.quantityHint')}
        >
          {(fieldProps) => (
            <Input {...fieldProps} {...register('quantity')} type="number" min="1" step="1" />
          )}
        </Field>
        {/* "Unit" alone was ambiguous three ways here — against Quantity beside
            it, against "Unit price" beside that, and against the Asset Units
            registered from this line further down the same screen. It is the
            unit of measure the quantity is counted in, and now says so. */}
        <Field
          label={t('procurement.items.unitOfMeasure')}
          error={errors.unitType?.message}
          hint={t('procurement.items.unitOfMeasureHint')}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              {...register('unitType')}
              placeholder={t('procurement.items.unitOfMeasurePlaceholder')}
            />
          )}
        </Field>
        <Field label={t('procurement.items.unitPrice')} error={errors.unitPrice?.message}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              {...register('unitPrice')}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
            />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

export function ContractItemsPanel({ contractId }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const canCreateAsset = usePermission('asset:create');
  const canCreateUnit = usePermission('asset-unit:create');
  // Both, because the endpoint creates an Asset AND its units (`DEC-010`).
  // Offering the action on half the permissions would only produce a 403.
  const canAddAsset = canCreateAsset && canCreateUnit;

  const [creating, setCreating] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItemId, setViewingItemId] = useState(null);
  const [addingAssetFor, setAddingAssetFor] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const itemsKey = queryKeys.contracts.sub(contractId, 'items');

  const query = useQuery({
    queryKey: itemsKey,
    queryFn: () => contractsApi.listItems(contractId),
  });

  const refreshItems = () => queryClient.invalidateQueries({ queryKey: itemsKey });

  const create = useMutation({
    mutationFn: (body) => contractsApi.createItem(contractId, body),
    onSuccess: async () => {
      await refreshItems();
      setCreating(false);
      toast.success('Line item added');
    },
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }) => contractItemsApi.update(id, body),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        refreshItems(),
        queryClient.invalidateQueries({ queryKey: queryKeys.contractItems.detail(variables.id) }),
      ]);
      setEditingItem(null);
      toast.success('Line item updated');
    },
  });

  const remove = useMutation({
    mutationFn: (id) => contractItemsApi.remove(id),
    onSuccess: async () => {
      await refreshItems();
      setPendingDelete(null);
      toast.success('Line item deleted');
    },
    // A `CONFLICT` here is the traceability rule doing its job (REQ-PROC-006),
    // so it is shown and the dialog stays open.
    onError: (error) => toast.fromError(error),
  });

  const columns = [
    {
      accessorKey: 'assetName',
      header: t('procurement.items.item'),
      cell: ({ row }) => (
        <button
          type="button"
          className="text-left hover:underline"
          onClick={() => setViewingItemId(row.original.id)}
        >
          {row.original.assetName}
        </button>
      ),
    },
    {
      id: 'quantity',
      header: t('procurement.items.quantity'),
      meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
      cell: ({ row }) => formatQuantity(row.original.quantity, row.original.unitType) || '—',
    },
    {
      id: 'unitPrice',
      header: t('procurement.items.unitPrice'),
      meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
      cell: ({ row }) => formatMoney(row.original.unitPrice) || '—',
    },
    {
      id: 'totalValue',
      header: t('procurement.items.total'),
      meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
      cell: ({ row }) => formatMoney(row.original.totalValue) || '—',
    },
    {
      id: 'actions',
      header: '',
      meta: { cellClassName: 'text-right whitespace-nowrap' },
      cell: ({ row }) => (
        <>
          {canAddAsset ? (
            <Button size="sm" variant="ghost" onClick={() => setAddingAssetFor(row.original)}>
              Add asset
            </Button>
          ) : null}
          <Can code="contract-item:update">
            <Button size="sm" variant="ghost" onClick={() => setEditingItem(row.original)}>
              Edit
            </Button>
          </Can>
          <Can code="contract-item:delete">
            <Button size="sm" variant="ghost" onClick={() => setPendingDelete(row.original)}>
              Delete
            </Button>
          </Can>
        </>
      ),
    },
  ];

  return (
    <SectionCard
      title={t('procurement.lineItems.title')}
      description={t('procurement.lineItems.description')}
      actions={
        <Can code="contract-item:create">
          <Button size="sm" onClick={() => setCreating(true)}>
            Add line item
          </Button>
        </Can>
      }
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('procurement.lineItems.empty')}
        emptyDescription={t('procurement.lineItems.emptyDescription')}
      />

      <ContractItemFormDialog
        open={creating}
        onOpenChange={setCreating}
        item={null}
        loading={create.isPending}
        onSave={(body) => create.mutateAsync(body)}
      />

      <ContractItemFormDialog
        open={Boolean(editingItem)}
        onOpenChange={(open) => !open && setEditingItem(null)}
        item={editingItem}
        loading={update.isPending}
        onSave={(body) => update.mutateAsync({ id: editingItem.id, ...body })}
      />

      <ContractItemDetailDialog
        itemId={viewingItemId}
        open={Boolean(viewingItemId)}
        onOpenChange={(open) => !open && setViewingItemId(null)}
      />

      <AddAssetDialog
        item={addingAssetFor}
        open={Boolean(addingAssetFor)}
        onOpenChange={(open) => !open && setAddingAssetFor(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('procurement.lineItems.deleteTitle')}
        description={
          'This removes the row permanently — contract items have no inactive state. ' +
          'It is refused if asset units were already procured through it.'
        }
        confirmLabel={t('common.actions.delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(pendingDelete.id)}
      />
    </SectionCard>
  );
}
