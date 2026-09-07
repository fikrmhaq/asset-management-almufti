import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useZodForm } from '@/lib/forms/useZodForm';
import { useUnsavedChanges } from '@/lib/forms/useUnsavedChanges';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Field, FormErrorSummary } from '@/components/form/field';
import { FormPage, SectionCard } from '@/components/patterns/page';
import { ClassificationField } from '@/components/reference/ClassificationPicker';
import { useVendorOptions } from '../procurement/referenceOptions';
import { useContractOptions } from '../operations/referenceOptions';
import { institutions } from '../organization/resources';
import { assets } from './resources';

/**
 * Asset create/edit — `07-ui.md` §5.3, `IMPLEMENTATION_PLAN.md` §18.2;
 * REQ-ASSET-001/004.
 *
 * A full page rather than a modal (§4.3): the classification picker alone needs
 * the room.
 *
 * The classification must be a LEAF (`BR-011`, REQ-CLASS-009), which the picker
 * enforces by only returning leaves as selections — and the server enforces
 * again.
 *
 * `contractId` IS present, added in the procurement revision. It was previously
 * absent on the reading of `07-ui.md` §5.3 that the procurement line is set once
 * — but `POST /assets` and `PATCH /assets/:id` have accepted the field since
 * Phase 5, and the only path that ever set it was the procurement flow (§5.5,
 * `POST /contract-items/:id/assets`). So an asset registered from the asset
 * module could never be attached to the contract it was actually bought under,
 * which REQ-ASSET-011 expects wherever a procurement record exists.
 *
 * Editable on edit, not create-only: correcting a wrong contract is exactly the
 * case the field is needed for. The server refuses a change that would
 * contradict units already traced to another contract's items (REQ-PROC-006),
 * so this cannot quietly break the traceability it exists to serve.
 *
 * Not filtered by the selected institution: `contracts.institution_id` is
 * nullable and the API enforces no such rule, so filtering here would hide valid
 * contracts on a rule the server does not share.
 *
 * `vendorId` IS present, added in Phase 16 (`GAP-007`). REQ-VENDOR-003 lets any
 * asset name a vendor and `POST /assets` has accepted the field since Phase 5,
 * but until now the only path that set it was the procurement flow — so a
 * donated, self-constructed or migrated asset could never be attributed to its
 * manufacturer, and REQ-VENDOR-004's vendor→assets view was incomplete by
 * construction rather than by data.
 *
 * Attribute values are NOT edited here: they depend on the classification and
 * are replaced as a whole set against an asset that already exists
 * (`PUT /assets/:id/attribute-values`). They are on the detail page's own tab.
 */

const assetSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  classificationId: z.string().trim().length(12, 'select a classification'),
  institutionId: z.string().optional(),
  vendorId: z.string().optional(),
  contractId: z.string().optional(),
  description: z.string().trim().max(5000).optional(),
});

export function AssetFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const detail = assets.useDetail(id, { enabled: editing });
  const create = assets.useCreate();
  const update = assets.useUpdate();
  const institutionList = institutions.useList({ pageSize: 100, status: 'active' });
  const vendors = useVendorOptions();
  const contracts = useContractOptions();

  const [classification, setClassification] = useState(null);

  const { form, submit } = useZodForm({
    schema: assetSchema,
    defaultValues: {
      name: '',
      classificationId: '',
      institutionId: '',
      vendorId: '',
      contractId: '',
      description: '',
    },
    onSubmit: async (values) => {
      const body = {
        ...values,
        institutionId: values.institutionId || undefined,
        // Cleared on edit means "no vendor"; omitted on create means the same.
        vendorId: values.vendorId || (editing ? null : undefined),
        // Same rule for the procurement line — clearing it on edit is how an
        // asset entered against the wrong contract gets corrected back to
        // REQ-ASSET-011's documented no-procurement-record case.
        contractId: values.contractId || (editing ? null : undefined),
        description: values.description || undefined,
      };

      const saved = editing
        ? await update.mutateAsync({ id, ...body })
        : await create.mutateAsync(body);

      // Reset before navigating, or the unsaved-changes blocker fires on the
      // way out of a form that was just saved successfully.
      form.reset(values);
      navigate(`/assets/${saved?.id ?? id}`);
    },
  });

  const { register, reset, setValue, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  const blocker = useUnsavedChanges(isDirty && !isSubmitting);

  useEffect(() => {
    if (editing && detail.data) {
      reset({
        name: detail.data.name,
        classificationId: detail.data.classificationId,
        institutionId: detail.data.institutionId ?? '',
        vendorId: detail.data.vendorId ?? '',
        contractId: detail.data.contractId ?? '',
        description: detail.data.description ?? '',
      });
      setClassification({
        id: detail.data.classificationId,
        name: detail.data.classification?.name ?? detail.data.classificationId,
      });
    }
  }, [editing, detail.data, reset]);

  /**
   * The option list is one page of contracts (§19.3's `pageSize: 100`). An asset
   * already pointing at a contract outside that page would otherwise render as
   * "No contract" while still holding one — so the asset's own contract is
   * prepended when the list does not already carry it. The detail response
   * resolves it to a contract number (REQ-ASSET-011), so it is nameable.
   */
  const contractOptions =
    detail.data?.contractId && !contracts.labels.has(detail.data.contractId)
      ? [
          {
            value: detail.data.contractId,
            label: detail.data.contract?.contractNumber ?? detail.data.contractId,
          },
          ...contracts.options,
        ]
      : contracts.options;

  if (editing && detail.isLoading) return <LoadingState variant="form" />;
  if (editing && detail.isError) {
    return <ErrorState error={detail.error} onRetry={detail.refetch} />;
  }

  return (
    <>
      <FormPage
        title={editing ? t('assets.form.editTitle') : t('assets.form.newTitle')}
        description={editing ? t('assets.form.editDescription') : t('assets.form.newDescription')}
        onSubmit={submit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(editing ? `/assets/${id}` : '/assets')}
            >
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? t('common.actions.saveChanges') : t('assets.form.create')}
            </Button>
          </>
        }
      >
        <SectionCard title={t('assets.form.section')}>
          <div className="space-y-4">
            <FormErrorSummary error={errors.root?.server} />

            <Field label={t('common.fields.name')} error={errors.name?.message} required>
              {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
            </Field>

            <Field
              label={t('common.fields.classification')}
              error={errors.classificationId?.message}
              /* The requirement id is gone from this hint: an engineering
                 reference is not something a school administrator reads. */
              hint={t('assets.form.classificationHint')}
              required
            >
              {(fieldProps) => (
                <ClassificationField
                  id={fieldProps.id}
                  invalid={fieldProps.invalid}
                  value={classification}
                  onChange={(node) => {
                    setClassification(node);
                    setValue('classificationId', node?.id ?? '', {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                  }}
                />
              )}
            </Field>

            <Field label={t('common.fields.institution')} error={errors.institutionId?.message}>
              {/* `invalid` is pulled out and re-applied as `aria-invalid`:
                  spreading it onto a `<select>` put a non-standard boolean on a
                  DOM node, which React warns about. This is the same shape the
                  vendor field below already used correctly.

                  Still a native `<select>` rather than the Radix one, because
                  the shared `Select` renders a button and the existing tests
                  drive this field with `selectOptions`. Converting it would
                  mean rewriting those interactions — see the report. */}
              {({ invalid, ...fieldProps }) => (
                <select
                  {...fieldProps}
                  {...register('institutionId')}
                  aria-invalid={invalid || undefined}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors hover:border-border-strong focus-visible:border-brand-500 disabled:cursor-not-allowed disabled:bg-neutral-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive"
                >
                  <option value="">{t('assets.form.institutionDefault')}</option>
                  {(institutionList.data?.data ?? []).map((institution) => (
                    <option key={institution.id} value={institution.id}>
                      {institution.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {/* REQ-VENDOR-003 — hidden without `vendor:read`, like every other
                reference selector (`07-ui.md` §6). */}
            {vendors.allowed ? (
              <Field
                label={t('assets.form.vendor')}
                error={errors.vendorId?.message}
                hint={t('assets.form.vendorHint')}
              >
                {({ invalid, ...fieldProps }) => (
                  <select
                    {...fieldProps}
                    {...register('vendorId')}
                    aria-invalid={invalid || undefined}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors hover:border-border-strong focus-visible:border-brand-500 disabled:cursor-not-allowed disabled:bg-neutral-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive"
                  >
                    <option value="">{t('assets.form.noVendor')}</option>
                    {vendors.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null}

            {/* REQ-ASSET-011 — the procurement line. Hidden without
                `contract:read`, like every other reference selector
                (`07-ui.md` §6). Left blank for a donated, self-constructed or
                migrated asset, which is the documented exception, not a gap. */}
            {contracts.allowed ? (
              <Field
                label={t('assets.form.contract')}
                error={errors.contractId?.message}
                hint={t('assets.form.contractHint')}
              >
                {({ invalid, ...fieldProps }) => (
                  <select
                    {...fieldProps}
                    {...register('contractId')}
                    aria-invalid={invalid || undefined}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors hover:border-border-strong focus-visible:border-brand-500 disabled:cursor-not-allowed disabled:bg-neutral-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive"
                  >
                    <option value="">{t('assets.form.noContract')}</option>
                    {contractOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null}

            <Field label={t('common.fields.description')} error={errors.description?.message}>
              {(fieldProps) => <Textarea {...fieldProps} {...register('description')} />}
            </Field>
          </div>
        </SectionCard>
      </FormPage>

      {/* Dirty-form handling — `IMPLEMENTATION_PLAN.md` §15.6. */}
      <ConfirmDialog
        open={blocker?.state === 'blocked'}
        onOpenChange={(open) => !open && blocker?.reset?.()}
        title={t('assets.form.discardTitle')}
        description={t('assets.form.discardDescription')}
        confirmLabel={t('assets.form.discard')}
        destructive
        onConfirm={() => blocker?.proceed?.()}
      />
    </>
  );
}

export { assetSchema };
