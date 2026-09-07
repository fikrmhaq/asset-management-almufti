import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { classificationsApi } from '@/api/reference';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useListParams } from '@/hooks/useListParams';
import { useZodForm } from '@/lib/forms/useZodForm';
import { queryKeys } from '@/lib/queryKeys';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Checkbox, CheckboxField } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { NativeSelect } from '@/components/ui/select';
import { Field } from '@/components/form/field';
import { CreateRelatedEntity } from '@/components/patterns/create-related-entity';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SelectFilter, StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { ClassificationField } from '@/components/reference/ClassificationPicker';
import { attributeDefinitions } from '../organization/resources';
import { LOOKUP_RESOURCES } from '../organization/resources';

/**
 * Attribute definitions — `07-ui.md` §5.2.
 *
 * A definition is scoped to one classification and one of ASSET / ASSET_UNIT,
 * and neither can be changed afterwards — values already stored against it would
 * become meaningless, and the API rejects the move.
 *
 * SCOPED BY CLASSIFICATION. `07-ui.md` §5.2 describes this screen as scoped by
 * classification, and `06-api.md` §4.3 already documents `classificationId` as a
 * filter. It is the shared picker on the filter bar rather than a fourth
 * drill-down of its own, which is also what makes the stored classification
 * legible: the list itself carries only the twelve-character code.
 *
 * SELECTION is a documented attribute type and is offered here, but the data
 * model has nowhere to store an option list. So the form provides NO options
 * editor and says so plainly. Hiding the type would misrepresent what the API
 * accepts; inventing storage would be a data-model change requiring approval.
 */

const ATTRIBUTE_TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECTION', 'REFERENCE'];
const SCOPES = ['ASSET', 'ASSET_UNIT'];

/** The measurement-unit hooks this form both reads and creates through. */
const measurementUnitResource = LOOKUP_RESOURCES.find(
  (resource) => resource.key === 'measurement-units'
);

const createSchema = z
  .object({
    classificationId: z.string().trim().length(12, 'select a classification'),
    name: z.string().trim().min(1, 'is required').max(100),
    attributeType: z.enum(ATTRIBUTE_TYPES),
    scope: z.enum(SCOPES),
    isRequired: z.boolean().default(false),
    usesMeasurementUnit: z.boolean().default(false),
    measurementUnitId: z.string().optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((body) => !body.usesMeasurementUnit || body.attributeType === 'NUMBER', {
    path: ['usesMeasurementUnit'],
    message: 'only a NUMBER attribute can carry a measurement unit',
  });

/**
 * Editing — `07-ui.md` §5.2 calls this screen List/Edit.
 *
 * The classification and the scope are absent on purpose: `PATCH
 * /attribute-definitions/:id` rejects both, because each decides which values
 * are valid and changing one would silently invalidate every value already
 * stored against the definition. Everything else the endpoint accepts is here.
 */
const editSchema = createSchema
  .innerType()
  .omit({ classificationId: true })
  .refine((body) => !body.usesMeasurementUnit || body.attributeType === 'NUMBER', {
    path: ['usesMeasurementUnit'],
    message: 'only a NUMBER attribute can carry a measurement unit',
  });

/** A name is all the server requires of a measurement unit (`06-api.md` §4.4). */
const measurementUnitSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(250),
});

/**
 * The fields create and edit share.
 *
 * `scopeField` is passed in rather than rendered here: creating chooses a scope,
 * editing shows the one it already has and cannot change it, and both sit beside
 * the type in the same two-column row.
 */
function DefinitionFields({ form, units, scopeField }) {
  const { t } = useTranslation();
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = form;

  const attributeType = watch('attributeType');
  const usesMeasurementUnit = watch('usesMeasurementUnit');

  return (
    <>
      <Field label={t('common.fields.name')} error={errors.name?.message} required>
        {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Native `<select>` on purpose: the type and scope are short, fixed
            enumerations that the existing tests drive with `selectOptions`,
            and `NativeSelect` gives them the shared select's own appearance
            without inventing a second interaction model for them. */}
        <Field
          label={t('reference.attributeDefinitions.form.type')}
          error={errors.attributeType?.message}
          required
        >
          {(fieldProps) => (
            <NativeSelect {...fieldProps} {...register('attributeType')}>
              {ATTRIBUTE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`enums.attributeType.${type}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        {scopeField}
      </div>

      {/* The missing option-list storage, made visible rather than papered
          over. `role="note"` is what the test reads it back through. */}
      {attributeType === 'SELECTION' ? (
        <Alert variant="info" role="note">
          {t('reference.attributeDefinitions.form.selectionNote')}
        </Alert>
      ) : null}

      <CheckboxField label={t('reference.attributeDefinitions.form.required')}>
        <Checkbox {...register('isRequired')} />
      </CheckboxField>

      {attributeType === 'NUMBER' ? (
        <>
          <CheckboxField label={t('reference.attributeDefinitions.form.usesUnit')}>
            <Checkbox {...register('usesMeasurementUnit')} />
          </CheckboxField>

          {usesMeasurementUnit && units.canRead ? (
            <Field
              label={t('reference.attributeDefinitions.form.measurementUnit')}
              error={errors.measurementUnitId?.message}
            >
              {({ invalid, id }) => (
                /* The dead end this removes: reaching "Measurement unit",
                   finding that "kilogram" does not exist, and having to
                   abandon a half-filled definition to go and create it.
                   Permission-gated through the same `usePermission` the nav
                   uses, and hidden rather than disabled (`07-ui.md` §6). */
                <CreateRelatedEntity
                  id={id}
                  invalid={invalid}
                  options={units.options}
                  value={watch('measurementUnitId') || null}
                  onChange={(next) =>
                    setValue('measurementUnitId', next ?? '', { shouldValidate: true })
                  }
                  placeholder={t('reference.attributeDefinitions.form.noUnit')}
                  loading={units.isLoading}
                  permission="measurement-unit:create"
                  createLabel={t('reference.attributeDefinitions.form.createUnit')}
                  dialogDescription={t('reference.attributeDefinitions.form.createUnitDescription')}
                  schema={measurementUnitSchema}
                  defaultValues={{ name: '' }}
                  onCreate={(values) => units.create.mutateAsync({ name: values.name })}
                  toOption={(unit) => ({ value: String(unit.id), label: unit.name })}
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
        </>
      ) : null}

      <Field label={t('common.fields.description')} error={errors.description?.message}>
        {(fieldProps) => <Input {...fieldProps} {...register('description')} />}
      </Field>
    </>
  );
}

/**
 * Edit one definition.
 *
 * Mounted fresh per definition (keyed on its id by the caller), so the form
 * starts from that record without a reset effect watching for a prop change.
 *
 * The classification and the scope are shown, not hidden: they are what the
 * definition MEANS, and a form that omitted them would leave the reader unsure
 * which record they were editing. They are read-only because the server refuses
 * to move them.
 */
function EditDefinitionDialog({ definition, onOpenChange, units }) {
  const { t } = useTranslation();
  const update = attributeDefinitions.useUpdate();

  const { form, submit } = useZodForm({
    schema: editSchema,
    defaultValues: {
      name: definition.name,
      attributeType: definition.attributeType,
      scope: definition.scope,
      isRequired: definition.isRequired,
      usesMeasurementUnit: definition.usesMeasurementUnit ?? false,
      measurementUnitId: definition.measurementUnitId ?? '',
      description: definition.description ?? '',
    },
    onSubmit: async (values) => {
      await update.mutateAsync({
        id: definition.id,
        name: values.name,
        attributeType: values.attributeType,
        isRequired: values.isRequired,
        usesMeasurementUnit: values.usesMeasurementUnit,
        // `null` rather than omitted: clearing the unit is a real edit, and the
        // endpoint distinguishes "unchanged" from "cleared".
        measurementUnitId: values.usesMeasurementUnit ? values.measurementUnitId || null : null,
        description: values.description || null,
      });
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t('reference.attributeDefinitions.form.editTitle')}
      description={t('reference.attributeDefinitions.form.editDescription')}
      submitLabel={t('common.actions.saveChanges')}
      onSubmit={submit}
      loading={form.formState.isSubmitting}
      error={form.formState.errors.root?.server}
      className="max-w-xl"
    >
      <Field
        label={t('common.fields.classification')}
        hint={t('reference.attributeDefinitions.form.fixedHint')}
      >
        {(fieldProps) => (
          <Input {...fieldProps} value={definition.classificationId} readOnly disabled />
        )}
      </Field>

      <DefinitionFields
        form={form}
        units={units}
        scopeField={
          <Field label={t('reference.attributeDefinitions.form.scope')}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                value={t(`enums.attributeScope.${definition.scope}`)}
                readOnly
                disabled
              />
            )}
          </Field>
        }
      />
    </FormDialog>
  );
}

export function AttributeDefinitionsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = attributeDefinitions.useList(params);
  const create = attributeDefinitions.useCreate();
  const setActive = attributeDefinitions.useSetActive();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [classification, setClassification] = useState(null);
  /** The filter's own selection, kept so the bar can show a name, not a code. */
  const [filterClassification, setFilterClassification] = useState(null);

  /**
   * The filter lives in the URL (`07-ui.md` §4.1), so a filtered view can be
   * shared as a link — and a link carries the code, not the node the picker
   * returned. This resolves the name for exactly that case: it is skipped
   * entirely while the picker's own selection is still in hand, and the code
   * shows in the meantime rather than a blank.
   */
  const filterId = params.classificationId ?? '';
  const filterFallback = useQuery({
    queryKey: queryKeys.classifications.detail(filterId),
    queryFn: () => classificationsApi.get(filterId),
    enabled: Boolean(filterId) && !filterClassification,
  });
  const filterValue = filterId
    ? (filterClassification ?? filterFallback.data ?? { id: filterId })
    : null;

  /**
   * Measurement units are their own resource behind their own permission —
   * `attribute-definition:create` does not imply `measurement-unit:read`
   * (`07-ui.md` §6). The selector is hidden rather than disabled when it is
   * missing, and the field is optional, so hiding it never blocks the form.
   */
  const canReadUnits = usePermission('measurement-unit:read');
  const measurementUnits = measurementUnitResource.hooks.useList(
    { pageSize: 100 },
    { enabled: canReadUnits }
  );
  const createMeasurementUnit = measurementUnitResource.hooks.useCreate();

  /** Everything the unit selector needs, loaded once and shared by both forms. */
  const units = {
    canRead: canReadUnits,
    isLoading: measurementUnits.isLoading,
    create: createMeasurementUnit,
    options: (measurementUnits.data?.data ?? []).map((unit) => ({
      value: String(unit.id),
      label: unit.name,
    })),
  };

  const { form, submit } = useZodForm({
    schema: createSchema,
    defaultValues: {
      classificationId: '',
      name: '',
      attributeType: 'TEXT',
      scope: 'ASSET',
      isRequired: false,
      usesMeasurementUnit: false,
      measurementUnitId: '',
      description: '',
    },
    onSubmit: async (values) => {
      await create.mutateAsync({
        ...values,
        measurementUnitId: values.usesMeasurementUnit ? values.measurementUnitId : undefined,
        description: values.description || undefined,
      });
      setCreating(false);
      form.reset();
      setClassification(null);
    },
  });

  // `watch` moved into `DefinitionFields` with the fields that read it; the
  // page still needs `setValue` for the classification picker.
  const {
    register,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const columns = [
    { accessorKey: 'name', header: t('common.fields.name'), meta: { sortField: 'name' } },
    {
      id: 'classification',
      header: t('reference.attributeDefinitions.columns.classification'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.classificationId}</span>,
    },
    {
      id: 'type',
      header: t('reference.attributeDefinitions.columns.type'),
      cell: ({ row }) => (
        <Badge variant="neutral">{t(`enums.attributeType.${row.original.attributeType}`)}</Badge>
      ),
    },
    {
      id: 'scope',
      header: t('reference.attributeDefinitions.columns.scope'),
      cell: ({ row }) => (
        <Badge variant="outline">{t(`enums.attributeScope.${row.original.scope}`)}</Badge>
      ),
    },
    {
      id: 'required',
      header: t('reference.attributeDefinitions.columns.required'),
      cell: ({ row }) =>
        row.original.isRequired
          ? t('reference.attributeDefinitions.yes')
          : t('reference.attributeDefinitions.no'),
    },
    {
      id: 'status',
      header: t('common.fields.status'),
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Can code="attribute-definition:update">
            <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)}>
              {t('common.actions.edit')}
            </Button>
          </Can>
          <Can code="attribute-definition:deactivate">
            <Button variant="ghost" size="sm" onClick={() => setPendingStatus(row.original)}>
              {row.original.isActive
                ? t('common.actions.deactivate')
                : t('common.actions.reactivate')}
            </Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    <ListPage
      title={t('reference.attributeDefinitions.title')}
      description={t('reference.attributeDefinitions.description')}
      actions={
        <Can code="attribute-definition:create">
          <Button onClick={() => setCreating(true)}>
            {t('reference.attributeDefinitions.new')}
          </Button>
        </Can>
      }
      filters={
        <>
          {/* §5.2's "scoped by classification", through the one picker rather
              than a flat list of fourteen thousand codes (`07-ui.md` §4.5). */}
          <div className="space-y-1.5">
            <Label htmlFor="filter-classification">
              {t('reference.attributeDefinitions.filters.classification')}
            </Label>
            <div className="flex items-center gap-2">
              <ClassificationField
                id="filter-classification"
                value={filterValue}
                placeholder={t('reference.attributeDefinitions.filters.anyClassification')}
                onChange={(node) => {
                  setFilterClassification(node);
                  setParams({ classificationId: node?.id ?? '' });
                }}
                className="w-64"
              />
              {filterId ? (
                /* The visible word is inside the accessible name, so speech
                   input and the screen reader are naming the same control. */
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('reference.attributeDefinitions.filters.clearClassification')}
                  onClick={() => {
                    setFilterClassification(null);
                    setParams({ classificationId: '' });
                  }}
                >
                  {t('common.actions.clear')}
                </Button>
              ) : null}
            </div>
          </div>

          <SelectFilter
            id="filter-scope"
            label={t('reference.attributeDefinitions.filters.scope')}
            value={params.scope ?? 'all'}
            options={SCOPES.map((scope) => ({
              value: scope,
              label: t(`enums.attributeScope.${scope}`),
            }))}
            onChange={(scope) => setParams({ scope })}
            width="w-44"
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
        emptyTitle={t('reference.attributeDefinitions.empty')}
        emptyDescription={t('reference.attributeDefinitions.emptyDescription')}
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('reference.attributeDefinitions.form.title')}
        description={t('reference.attributeDefinitions.form.description')}
        submitLabel={t('common.actions.create')}
        onSubmit={submit}
        loading={isSubmitting}
        error={errors.root?.server}
        className="max-w-xl"
      >
        <Field
          label={t('common.fields.classification')}
          error={errors.classificationId?.message}
          required
        >
          {(fieldProps) => (
            <ClassificationField
              id={fieldProps.id}
              invalid={fieldProps.invalid}
              value={classification}
              onChange={(node) => {
                setClassification(node);
                setValue('classificationId', node?.id ?? '', { shouldValidate: true });
              }}
            />
          )}
        </Field>

        <DefinitionFields
          form={form}
          units={units}
          scopeField={
            <Field
              label={t('reference.attributeDefinitions.form.scope')}
              error={errors.scope?.message}
              required
            >
              {(fieldProps) => (
                <NativeSelect {...fieldProps} {...register('scope')}>
                  {SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {t(`enums.attributeScope.${scope}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          }
        />
      </FormDialog>

      {/* Keyed on the record, so each definition opens a form of its own rather
          than one form reset from the outside. */}
      {editing ? (
        <EditDefinitionDialog
          key={editing.id}
          definition={editing}
          units={units}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        onOpenChange={(open) => !open && setPendingStatus(null)}
        title={
          pendingStatus?.isActive
            ? t('reference.attributeDefinitions.deactivate.title')
            : t('reference.attributeDefinitions.deactivate.reactivateTitle')
        }
        description={
          pendingStatus?.isActive
            ? t('reference.attributeDefinitions.deactivate.description')
            : t('reference.attributeDefinitions.deactivate.reactivateDescription')
        }
        confirmLabel={
          pendingStatus?.isActive ? t('common.actions.deactivate') : t('common.actions.reactivate')
        }
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive
            .mutateAsync({ id: pendingStatus.id, active: !pendingStatus.isActive })
            .catch(() => undefined);
          setPendingStatus(null);
        }}
      />
    </ListPage>
  );
}

export { ATTRIBUTE_TYPES, SCOPES };
