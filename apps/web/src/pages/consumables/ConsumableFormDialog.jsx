import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { lookupApis } from '@/api/reference';
import { Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';

/**
 * Create or edit a consumable's master — `IMPLEMENTATION_PLAN.md` §73. A name,
 * one existing measurement unit (`ref.measurement_units`; no conversion) and an
 * optional description. No inventory code: a consumable has none. Once stock
 * has moved, the server keeps the unit (`unitLocked` says so here).
 */
const fieldError = (error, name) =>
  error?.fieldErrors?.[name] ?? error?.fieldErrors?.[`body.${name}`] ?? null;

export function ConsumableFormDialog({
  title,
  submitLabel,
  mutation,
  onOpenChange,
  initial,
  unitLocked = false,
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    measurementUnitId: initial?.measurementUnitId ?? '',
    description: initial?.description ?? '',
  });
  const [clientError, setClientError] = useState({});

  const units = useQuery({
    queryKey: ['measurement-units', 'options'],
    queryFn: () => lookupApis['measurement-units'].list({ pageSize: 100 }),
    staleTime: 60_000,
  });

  const errorFor = (name) => clientError[name] ?? fieldError(mutation.error, name);

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={title}
      description={t('consumables.formDescription')}
      submitLabel={submitLabel}
      loading={mutation.isPending}
      error={mutation.error}
      onSubmit={(event) => {
        event.preventDefault();
        const next = {};
        if (!form.name.trim()) next.name = t('consumables.errors.required');
        if (!form.measurementUnitId) next.measurementUnitId = t('consumables.errors.required');
        setClientError(next);
        if (Object.keys(next).length) return;
        mutation.mutate({
          name: form.name.trim(),
          ...(unitLocked ? {} : { measurementUnitId: form.measurementUnitId }),
          description: form.description.trim() || null,
        });
      }}
    >
      <Field label={t('consumables.fields.name')} error={errorFor('name')} required>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            maxLength={255}
            value={form.name}
            onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
          />
        )}
      </Field>
      <Field
        label={t('consumables.fields.unit')}
        hint={unitLocked ? t('consumables.unitLocked') : t('consumables.unitHint')}
        error={errorFor('measurementUnitId')}
        required
      >
        {(fieldProps) => (
          <NativeSelect
            {...fieldProps}
            disabled={unitLocked}
            value={form.measurementUnitId}
            onChange={(event) => setForm((f) => ({ ...f, measurementUnitId: event.target.value }))}
          >
            <option value="">{t('consumables.chooseUnit')}</option>
            {(units.data?.data ?? []).map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label={t('consumables.fields.description')} error={errorFor('description')}>
        {(fieldProps) => (
          <Textarea
            {...fieldProps}
            rows={2}
            maxLength={5000}
            value={form.description}
            onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
          />
        )}
      </Field>
    </FormDialog>
  );
}
