import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';

import { useZodForm } from '@/lib/forms/useZodForm';
import { useUnsavedChanges } from '@/lib/forms/useUnsavedChanges';
import { parseMoney } from '@/lib/numbers';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Field, FormErrorSummary } from '@/components/form/field';
import { FormPage, SectionCard } from '@/components/patterns/page';
import { CreateRelatedEntity } from '@/components/patterns/create-related-entity';
import { LOOKUP_RESOURCES } from '../organization/resources';
import {
  useAccountCodeOptions,
  useContractTypeOptions,
  useFundingSourceOptions,
  useInstitutionOptions,
  useSupplierOptions,
} from './referenceOptions';
import { contracts, suppliers } from './resources';
import { useTranslation } from 'react-i18next';

/** The lookup hooks these selectors create through, found once by key. */
const lookupHooks = (key) => LOOKUP_RESOURCES.find((resource) => resource.key === key).hooks;
const contractTypeHooks = lookupHooks('contract-types');
const fundingSourceHooks = lookupHooks('funding-sources');

/**
 * Contract create/edit — `07-ui.md` §5.5, `IMPLEMENTATION_PLAN.md` §19.3;
 * REQ-PROC-002/003/007/008.
 *
 * A full page on its own route rather than a dialog (`DEC-033`): eleven fields,
 * including a date picker, a money field and four reference selectors, is what
 * `07-ui.md` §4.3 was written for.
 *
 * Each reference selector is hidden when the caller cannot read that resource —
 * `contract:create` does not imply `supplier:read` (`07-ui.md` §6). Every one of
 * them is optional in the API, so a hidden selector never blocks the form.
 *
 * Dates cross the boundary as `YYYY-MM-DD` strings, never `Date` objects
 * (`DEC-023`), because the columns are SQL `DATE`.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date')
  .optional()
  .or(z.literal(''));

const money = z
  .string()
  .optional()
  .refine((value) => !value || Number.isFinite(Number(value)), 'must be a number')
  .refine((value) => !value || Number(value) >= 0, 'must not be negative');

const contractSchema = z.object({
  contractNumber: z.string().trim().min(1, 'is required').max(150),
  supplierId: z.string().optional(),
  contractTypeId: z.string().optional(),
  contractDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'is required'),
  fundingSourceId: z.string().optional(),
  contractValue: money,
  receivingDocument: z.string().trim().max(255).optional(),
  receivingDate: isoDate,
  institutionId: z.string().optional(),
  accountCode: z.string().optional(),
  notes: z.string().trim().max(5000).optional(),
});

const EMPTY = {
  contractNumber: '',
  supplierId: '',
  contractTypeId: '',
  contractDate: '',
  fundingSourceId: '',
  contractValue: '',
  receivingDocument: '',
  receivingDate: '',
  institutionId: '',
  accountCode: '',
  notes: '',
};

/**
 * The dialog schemas for the three selectors that can create their own records.
 *
 * They mirror the schemas the reference screens use, because the server is the
 * same either way — `LookupsPage`'s name rule and `SuppliersPage`'s supplier
 * rule. Duplicating them here rather than importing keeps this form independent
 * of another screen's internals; they are three lines each.
 */
const lookupNameSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(250),
});

const supplierSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  address: z.string().trim().max(5000).optional(),
  contactInfo: z.string().trim().max(5000).optional(),
});

/**
 * Keeps the record's OWN current value selectable when it falls outside the
 * reference page that was loaded.
 *
 * Editing a contract must not silently drop its supplier just because that
 * supplier sorted past the first hundred. This did the same job as the old
 * select's `extra` prop.
 */
function withCurrent(options, current) {
  if (!current || options.some((option) => option.value === current.value)) return options;
  return [current, ...options];
}

/**
 * A reference `<select>`, matching the one the asset form already uses.
 *
 * Still used by the account-code and institution fields. Account codes are
 * keyed by a `CHAR(12)` natural key and labelled `code — name`, and neither
 * they nor institutions are records a user would sensibly create mid-contract,
 * so neither gains anything from the picker treatment.
 *
 * `extra` keeps the record's OWN current value selectable when it falls outside
 * the reference page that was loaded — editing a contract must not silently drop
 * a value just because it sorted past the first hundred.
 */
function ReferenceSelect({ fieldProps, registration, options, extra, placeholder, disabled }) {
  // `invalid` is the `Field` contract, not a DOM attribute — it becomes
  // `aria-invalid` rather than being spread onto the element.
  const { invalid, ...domProps } = fieldProps;

  const merged =
    extra && !options.some((option) => option.value === extra.value)
      ? [extra, ...options]
      : options;

  return (
    <select
      {...domProps}
      {...registration}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm aria-[invalid=true]:border-destructive disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {merged.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ContractFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const detail = contracts.useDetail(id, { enabled: editing });
  const create = contracts.useCreate();
  const update = contracts.useUpdate();

  const supplierOptions = useSupplierOptions();
  const contractTypes = useContractTypeOptions();
  const fundingSources = useFundingSourceOptions();

  // Creation goes through each resource's OWN mutation hook, which already
  // invalidates its key prefix — so the refreshed option list arrives through
  // the existing cache rather than a second one kept here.
  const createSupplier = suppliers.useCreate();
  const createContractType = contractTypeHooks.useCreate();
  const createFundingSource = fundingSourceHooks.useCreate();
  const accountCodes = useAccountCodeOptions();
  const institutions = useInstitutionOptions();

  const { form, submit } = useZodForm({
    schema: contractSchema,
    defaultValues: EMPTY,
    onSubmit: async (values) => {
      const common = {
        contractNumber: values.contractNumber,
        contractDate: values.contractDate,
      };

      const saved = editing
        ? await update.mutateAsync({
            id,
            ...common,
            supplierId: values.supplierId || null,
            contractTypeId: values.contractTypeId ? Number(values.contractTypeId) : null,
            fundingSourceId: values.fundingSourceId ? Number(values.fundingSourceId) : null,
            contractValue: parseMoney(values.contractValue) ?? null,
            receivingDocument: values.receivingDocument || null,
            receivingDate: values.receivingDate || null,
            accountCode: values.accountCode || null,
            notes: values.notes || null,
            // Omitted rather than nulled when blank: a scoped caller cannot
            // assign `null`, and the server would answer VALIDATION_ERROR
            // (`BR-007`). Clearing an institution is not an operation the API
            // offers a scoped user.
            ...(values.institutionId ? { institutionId: values.institutionId } : {}),
          })
        : await create.mutateAsync({
            ...common,
            supplierId: values.supplierId || undefined,
            contractTypeId: values.contractTypeId ? Number(values.contractTypeId) : undefined,
            fundingSourceId: values.fundingSourceId ? Number(values.fundingSourceId) : undefined,
            contractValue: parseMoney(values.contractValue),
            receivingDocument: values.receivingDocument || undefined,
            receivingDate: values.receivingDate || undefined,
            accountCode: values.accountCode || undefined,
            notes: values.notes || undefined,
            // Left out so the server applies the caller's own scope (`DEC-011`).
            ...(values.institutionId ? { institutionId: values.institutionId } : {}),
          });

      // Reset before navigating, or the unsaved-changes blocker fires on the way
      // out of a form that was just saved successfully.
      form.reset(values);
      navigate(`/procurement/contracts/${saved?.id ?? id}`);
    },
  });

  const { register, reset, setValue, watch, formState } = form;

  /** A reference chosen from a picker writes the same string the select did. */
  const setReference = (name, next) =>
    setValue(name, next ?? '', { shouldValidate: true, shouldDirty: true });
  const { errors, isSubmitting, isDirty } = formState;

  const blocker = useUnsavedChanges(isDirty && !isSubmitting);
  const contract = detail.data;

  useEffect(() => {
    if (editing && contract) {
      reset({
        contractNumber: contract.contractNumber,
        supplierId: contract.supplierId ?? '',
        contractTypeId: contract.contractTypeId ? String(contract.contractTypeId) : '',
        contractDate: contract.contractDate ?? '',
        fundingSourceId: contract.fundingSourceId ? String(contract.fundingSourceId) : '',
        contractValue: String(contract.contractValue ?? ''),
        receivingDocument: contract.receivingDocument ?? '',
        receivingDate: contract.receivingDate ?? '',
        institutionId: contract.institutionId ?? '',
        accountCode: contract.accountCode ?? '',
        notes: contract.notes ?? '',
      });
    }
  }, [editing, contract, reset]);

  if (editing && detail.isLoading) return <LoadingState variant="form" rows={6} />;
  if (editing && detail.isError) {
    return <ErrorState error={detail.error} onRetry={detail.refetch} />;
  }

  const setDate = (name) => (value) =>
    setValue(name, value ?? '', { shouldValidate: true, shouldDirty: true });

  return (
    <>
      <FormPage
        title={editing ? t('procurement.form.editTitle') : t('procurement.form.newTitle')}
        description={
          editing ? t('procurement.form.editDescription') : t('procurement.form.newDescription')
        }
        onSubmit={submit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                navigate(editing ? `/procurement/contracts/${id}` : '/procurement/contracts')
              }
            >
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? t('common.actions.saveChanges') : t('procurement.form.create')}
            </Button>
          </>
        }
      >
        <SectionCard title={t('procurement.form.section')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormErrorSummary error={errors.root?.server} />
            </div>

            <Field
              label={t('procurement.detail.contractNumber')}
              error={errors.contractNumber?.message}
              required
            >
              {(fieldProps) => <Input {...fieldProps} {...register('contractNumber')} />}
            </Field>

            <Field
              label={t('procurement.detail.contractDate')}
              error={errors.contractDate?.message}
              required
            >
              {(fieldProps) => (
                <DatePicker
                  {...fieldProps}
                  value={watch('contractDate')}
                  onChange={setDate('contractDate')}
                />
              )}
            </Field>

            {/*
              THE DEAD END THIS REMOVES. A user filling in a contract who finds
              their supplier or contract type missing used to have to abandon
              the form, go to another module, create the record, come back and
              retype everything. `07-ui.md` has no screen for that journey
              because it is not a feature — it is an accident of every reference
              list living on its own page.

              The create affordance is permission-gated through the same
              `usePermission` the nav uses, and hidden rather than disabled: a
              caller who may read suppliers but not create them still picks from
              the list and is never shown a locked door.
            */}
            {supplierOptions.allowed ? (
              <Field label={t('procurement.detail.supplier')} error={errors.supplierId?.message}>
                {({ invalid, id }) => (
                  <CreateRelatedEntity
                    id={id}
                    invalid={invalid}
                    options={withCurrent(
                      supplierOptions.options,
                      contract?.supplier && {
                        value: contract.supplier.id,
                        label: contract.supplier.name,
                      }
                    )}
                    value={watch('supplierId') || null}
                    onChange={(next) => setReference('supplierId', next)}
                    placeholder={t('procurement.form.noSupplier')}
                    loading={supplierOptions.isLoading}
                    permission="supplier:create"
                    createLabel={t('procurement.form.createSupplier')}
                    dialogDescription={t('procurement.form.createSupplierDescription')}
                    schema={supplierSchema}
                    defaultValues={{ name: '', address: '', contactInfo: '' }}
                    onCreate={(values) =>
                      createSupplier.mutateAsync({
                        name: values.name,
                        address: values.address || undefined,
                        contactInfo: values.contactInfo || undefined,
                      })
                    }
                  >
                    {(dialogForm) => (
                      <>
                        <Field
                          label={t('common.fields.name')}
                          error={dialogForm.formState.errors.name?.message}
                          required
                        >
                          {({ invalid: bad, ...props }) => (
                            <Input
                              {...props}
                              {...dialogForm.register('name')}
                              aria-invalid={bad || undefined}
                            />
                          )}
                        </Field>
                        <Field
                          label={t('procurement.suppliers.address')}
                          error={dialogForm.formState.errors.address?.message}
                        >
                          {({ invalid: bad, ...props }) => (
                            <Input
                              {...props}
                              {...dialogForm.register('address')}
                              aria-invalid={bad || undefined}
                            />
                          )}
                        </Field>
                        <Field
                          label={t('procurement.suppliers.contactInformation')}
                          error={dialogForm.formState.errors.contactInfo?.message}
                        >
                          {({ invalid: bad, ...props }) => (
                            <Input
                              {...props}
                              {...dialogForm.register('contactInfo')}
                              aria-invalid={bad || undefined}
                            />
                          )}
                        </Field>
                      </>
                    )}
                  </CreateRelatedEntity>
                )}
              </Field>
            ) : null}

            {contractTypes.allowed ? (
              <Field
                label={t('procurement.detail.contractType')}
                error={errors.contractTypeId?.message}
              >
                {({ invalid, id }) => (
                  <CreateRelatedEntity
                    id={id}
                    invalid={invalid}
                    options={withCurrent(
                      contractTypes.options,
                      contract?.contractType && {
                        value: String(contract.contractType.id),
                        label: contract.contractType.name,
                      }
                    )}
                    value={watch('contractTypeId') || null}
                    onChange={(next) => setReference('contractTypeId', next)}
                    placeholder={t('procurement.form.noType')}
                    loading={contractTypes.isLoading}
                    permission="contract-type:create"
                    createLabel={t('procurement.form.createContractType')}
                    schema={lookupNameSchema}
                    defaultValues={{ name: '' }}
                    onCreate={(values) => createContractType.mutateAsync(values)}
                    toOption={(entity) => ({ value: String(entity.id), label: entity.name })}
                  >
                    {(dialogForm) => (
                      <Field
                        label={t('common.fields.name')}
                        error={dialogForm.formState.errors.name?.message}
                        required
                      >
                        {({ invalid: bad, ...props }) => (
                          <Input
                            {...props}
                            {...dialogForm.register('name')}
                            aria-invalid={bad || undefined}
                          />
                        )}
                      </Field>
                    )}
                  </CreateRelatedEntity>
                )}
              </Field>
            ) : null}

            <Field
              label={t('procurement.detail.contractValue')}
              error={errors.contractValue?.message}
              hint={t('procurement.form.valueHint')}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...register('contractValue')}
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                />
              )}
            </Field>

            {fundingSources.allowed ? (
              <Field
                label={t('procurement.detail.fundingSource')}
                error={errors.fundingSourceId?.message}
              >
                {({ invalid, id }) => (
                  <CreateRelatedEntity
                    id={id}
                    invalid={invalid}
                    options={withCurrent(
                      fundingSources.options,
                      contract?.fundingSource && {
                        value: String(contract.fundingSource.id),
                        label: contract.fundingSource.name,
                      }
                    )}
                    value={watch('fundingSourceId') || null}
                    onChange={(next) => setReference('fundingSourceId', next)}
                    placeholder={t('procurement.form.noFundingSource')}
                    loading={fundingSources.isLoading}
                    permission="funding-source:create"
                    createLabel={t('procurement.form.createFundingSource')}
                    schema={lookupNameSchema}
                    defaultValues={{ name: '' }}
                    onCreate={(values) => createFundingSource.mutateAsync(values)}
                    toOption={(entity) => ({ value: String(entity.id), label: entity.name })}
                  >
                    {(dialogForm) => (
                      <Field
                        label={t('common.fields.name')}
                        error={dialogForm.formState.errors.name?.message}
                        required
                      >
                        {({ invalid: bad, ...props }) => (
                          <Input
                            {...props}
                            {...dialogForm.register('name')}
                            aria-invalid={bad || undefined}
                          />
                        )}
                      </Field>
                    )}
                  </CreateRelatedEntity>
                )}
              </Field>
            ) : null}

            {accountCodes.allowed ? (
              <Field
                label={t('procurement.detail.accountCode')}
                error={errors.accountCode?.message}
              >
                {(fieldProps) => (
                  <ReferenceSelect
                    fieldProps={fieldProps}
                    registration={register('accountCode')}
                    options={accountCodes.options}
                    extra={
                      contract?.accountCode
                        ? { value: contract.accountCode, label: contract.accountCode }
                        : undefined
                    }
                    placeholder={t('procurement.form.noAccountCode')}
                  />
                )}
              </Field>
            ) : null}

            {institutions.allowed ? (
              <Field
                label={t('common.fields.institution')}
                error={errors.institutionId?.message}
                hint={t('procurement.form.institutionHint')}
              >
                {(fieldProps) => (
                  <ReferenceSelect
                    fieldProps={fieldProps}
                    registration={register('institutionId')}
                    options={institutions.options}
                    extra={
                      contract?.institution
                        ? { value: contract.institution.id, label: contract.institution.name }
                        : undefined
                    }
                    placeholder={t('procurement.form.institutionDefault')}
                  />
                )}
              </Field>
            ) : null}

            <Field
              label={t('procurement.detail.receivingDocument')}
              error={errors.receivingDocument?.message}
            >
              {(fieldProps) => <Input {...fieldProps} {...register('receivingDocument')} />}
            </Field>

            <Field
              label={t('procurement.detail.receivingDate')}
              error={errors.receivingDate?.message}
            >
              {(fieldProps) => (
                <DatePicker
                  {...fieldProps}
                  value={watch('receivingDate')}
                  onChange={setDate('receivingDate')}
                  placeholder={t('procurement.form.notReceived')}
                />
              )}
            </Field>

            <Field
              label={t('common.fields.notes')}
              error={errors.notes?.message}
              className="sm:col-span-2"
            >
              {(fieldProps) => <Textarea {...fieldProps} {...register('notes')} />}
            </Field>
          </div>
        </SectionCard>
      </FormPage>

      {/* Dirty-form handling — `IMPLEMENTATION_PLAN.md` §15.6. */}
      <ConfirmDialog
        open={blocker?.state === 'blocked'}
        onOpenChange={(open) => !open && blocker?.reset?.()}
        title={t('procurement.form.discardTitle')}
        description={t('procurement.form.discardDescription')}
        confirmLabel={t('procurement.form.discard')}
        destructive
        onConfirm={() => blocker?.proceed?.()}
      />
    </>
  );
}

export { contractSchema };
