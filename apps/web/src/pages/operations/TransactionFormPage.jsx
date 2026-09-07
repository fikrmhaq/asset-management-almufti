import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useZodForm } from '@/lib/forms/useZodForm';
import { useUnsavedChanges } from '@/lib/forms/useUnsavedChanges';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormErrorSummary } from '@/components/form/field';
import { FormPage, SectionCard } from '@/components/patterns/page';
import { UnitPicker } from '@/components/operations/UnitPicker';
import {
  useContractOptions,
  useInstitutionOptions,
  useSupplierOptions,
  useTransactionTypeOptions,
} from './referenceOptions';
import { transactions } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Transaction create — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §20.5;
 * REQ-TXN-001–005, REQ-TXN-008/009.
 *
 * The header AND its items are one request (`DEC-016`): there is no PATCH and no
 * item endpoint, so creation is the only moment a transaction's composition can
 * be set. At least one unit is required — a transaction naming none would be
 * traceable to no asset (REQ-TXN-004, REQ-TXN-010).
 *
 * Supplier and contract are always offered, with a hint (`DEC-045`).
 * `07-ui.md` §5.6 wants them shown only for procurement-originated types, but
 * nothing in `ref.transaction_types` marks a type as such (`GAP-009`), so the
 * condition cannot be evaluated and is not faked.
 *
 * Units may be in ANY lifecycle state here, unlike a borrowing (`DEC-041`): a
 * transaction records something that happened to a unit, whatever state it is in.
 */

const transactionSchema = z.object({
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'is required'),
  transactionTypeId: z.string().min(1, 'is required'),
  description: z.string().trim().max(5000).optional(),
  supplierId: z.string().optional(),
  contractId: z.string().optional(),
  institutionId: z.string().optional(),
  items: z
    .array(z.object({ assetUnitId: z.string(), notes: z.string().optional() }))
    .min(1, 'add at least one asset unit')
    .max(500, 'must not exceed 500 units'),
});

export function TransactionFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = transactions.useCreate();

  const types = useTransactionTypeOptions();
  const suppliers = useSupplierOptions();
  const contracts = useContractOptions();
  const institutions = useInstitutionOptions();

  /** The chosen units, with the metadata needed to show them back. */
  const [rows, setRows] = useState([]);
  const [picking, setPicking] = useState(false);

  const { form, submit } = useZodForm({
    schema: transactionSchema,
    defaultValues: {
      transactionDate: '',
      transactionTypeId: '',
      description: '',
      supplierId: '',
      contractId: '',
      institutionId: '',
      items: [],
    },
    onSubmit: async (values) => {
      const created = await create.mutateAsync({
        transactionDate: values.transactionDate,
        transactionTypeId: Number(values.transactionTypeId),
        description: values.description || undefined,
        supplierId: values.supplierId || undefined,
        contractId: values.contractId || undefined,
        institutionId: values.institutionId || undefined,
        items: values.items.map((item) => ({
          assetUnitId: item.assetUnitId,
          notes: item.notes || undefined,
        })),
      });

      form.reset(values);
      navigate(`/operations/transactions/${created.id}`);
    },
  });

  const { register, setValue, watch, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  const blocker = useUnsavedChanges((isDirty || rows.length > 0) && !isSubmitting);

  /** The displayed rows and the submitted `items` are kept in step here. */
  const applyRows = (next) => {
    setRows(next);
    setValue(
      'items',
      next.map((row) => ({ assetUnitId: row.id, notes: row.notes ?? '' })),
      { shouldValidate: true, shouldDirty: true }
    );
  };

  const select = (name, options, placeholder) => (fieldProps) => {
    const { invalid, ...domProps } = fieldProps;

    return (
      <select
        {...domProps}
        {...register(name)}
        aria-invalid={invalid || undefined}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm aria-[invalid=true]:border-destructive"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  };

  return (
    <>
      <FormPage
        title={t('operations.transactions.newTitle')}
        description={t('operations.transactions.newDescription')}
        onSubmit={submit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/operations/transactions')}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Create transaction
            </Button>
          </>
        }
      >
        <SectionCard title={t('operations.transactions.section')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormErrorSummary error={errors.root?.server} />
            </div>

            <Field
              label={t('operations.transactions.transactionDate')}
              error={errors.transactionDate?.message}
              required
            >
              {(fieldProps) => (
                <DatePicker
                  {...fieldProps}
                  value={watch('transactionDate')}
                  onChange={(value) =>
                    setValue('transactionDate', value ?? '', {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  placeholder={t('operations.transactions.transactionDate')}
                />
              )}
            </Field>

            {types.allowed ? (
              <Field
                label={t('operations.transactions.type')}
                error={errors.transactionTypeId?.message}
                required
              >
                {select('transactionTypeId', types.options, 'Select a type')}
              </Field>
            ) : null}

            {suppliers.allowed ? (
              <Field
                label={t('operations.transactions.supplier')}
                error={errors.supplierId?.message}
                hint={t('operations.transactions.procurementOnlyHint')}
              >
                {select('supplierId', suppliers.options, 'No supplier')}
              </Field>
            ) : null}

            {contracts.allowed ? (
              <Field
                label={t('operations.transactions.contract')}
                error={errors.contractId?.message}
                hint={t('operations.transactions.procurementOnlyHint')}
              >
                {select('contractId', contracts.options, 'No contract')}
              </Field>
            ) : null}

            {institutions.allowed ? (
              <Field
                label={t('common.fields.institution')}
                error={errors.institutionId?.message}
                hint={t('operations.transactions.institutionHint')}
              >
                {select('institutionId', institutions.options, 'Default to my institution')}
              </Field>
            ) : null}

            <Field
              label={t('common.fields.description')}
              error={errors.description?.message}
              className="sm:col-span-2"
            >
              {(fieldProps) => <Textarea {...fieldProps} {...register('description')} />}
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          title={t('operations.transactions.affectedUnits')}
          description={t('operations.transactions.affectedUnitsDescription')}
          actions={
            <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}>
              Add units
            </Button>
          }
        >
          <div className="space-y-3">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No units yet. At least one is required.
              </p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">{row.id.slice(0, 8)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.asset?.name ?? row.description ?? '—'}
                      </span>
                    </span>

                    <StatusBadge value={row.lifecycleState} />

                    <Input
                      aria-label={`Note for unit ${row.id.slice(0, 8)}`}
                      placeholder={t('operations.transactions.notePlaceholder')}
                      value={row.notes ?? ''}
                      onChange={(event) =>
                        applyRows(
                          rows.map((entry) =>
                            entry.id === row.id ? { ...entry, notes: event.target.value } : entry
                          )
                        )
                      }
                      className="max-w-xs flex-1"
                    />

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => applyRows(rows.filter((entry) => entry.id !== row.id))}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {errors.items?.message ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.items.message}
              </p>
            ) : null}
          </div>
        </SectionCard>
      </FormPage>

      <UnitPicker
        open={picking}
        onOpenChange={setPicking}
        title={t('operations.transactions.addUnits')}
        multiple
        excludeUnitIds={rows.map((row) => row.id)}
        onSelect={(units) => applyRows([...rows, ...units.map((unit) => ({ ...unit, notes: '' }))])}
      />

      <ConfirmDialog
        open={blocker?.state === 'blocked'}
        onOpenChange={(open) => !open && blocker?.reset?.()}
        title={t('operations.transactions.discardTitle')}
        description={t('operations.transactions.discardDescription')}
        confirmLabel={t('operations.transactions.discard')}
        destructive
        onConfirm={() => blocker?.proceed?.()}
      />
    </>
  );
}

export { transactionSchema };
