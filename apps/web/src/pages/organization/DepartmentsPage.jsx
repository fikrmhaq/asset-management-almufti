import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Can } from '@/auth/guards';
import { useSession } from '@/auth/useSession';
import { useListParams } from '@/hooks/useListParams';
import { useZodForm } from '@/lib/forms/useZodForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { useInstitutionOptions } from '../procurement/referenceOptions';
import { departments } from './resources';

/**
 * Departments — `07-ui.md` §5.1; REQ-ORG-003.
 *
 * INSTITUTION-SCOPED since Phase 20 (`CR-003`). A department belongs to one
 * institution, and its `code` is unique only within it — two institutions may
 * each run a `TKJ`. Organizational responsibility for a physical item is still
 * expressed on `asset_units.department_id`, one unit at a time.
 *
 * The list shows only the caller's own institution unless their role lifts
 * organization scope (`BR-007`), which is enforced server-side.
 */

const createSchema = z.object({
  code: z.string().trim().min(1, 'is required').max(8),
  name: z.string().trim().min(1, 'is required').max(75),
  /**
   * Optional here, and REQUIRED IN PRACTICE for a system-wide caller — see the
   * refinement below and the field itself.
   *
   * `POST /departments` has always accepted it (`06-api.md` §3.2): a scoped
   * caller gets their own institution from `defaultInstitutionFor`, and a
   * system-wide caller names one or creates an UNASSIGNED department. The form
   * never offered the choice, so a system administrator could only ever produce
   * the unassigned kind.
   */
  institutionId: z.string().optional(),
});

export function DepartmentsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = departments.useList(params);
  const create = departments.useCreate();
  const [creating, setCreating] = useState(false);
  const { user } = useSession();
  const institutions = useInstitutionOptions();

  /**
   * A caller with no institution of their own has nothing to default to, so
   * omitting the field would create a department that can never hold an asset
   * unit — and `institutionId` is not updatable (`CR-003` OPEN-6), so it could
   * never be repaired either. The requirement is enforced in the schema rather
   * than left to the hint, because that dead end is silent.
   */
  const institutionRequired = !user?.institutionId;

  const { form, submit } = useZodForm({
    schema: institutionRequired
      ? createSchema.refine((values) => Boolean(values.institutionId), {
          path: ['institutionId'],
          message: 'is required: your role is not scoped to one institution',
        })
      : createSchema,
    defaultValues: { code: '', name: '', institutionId: '' },
    onSubmit: async (values) => {
      await create.mutateAsync({
        code: values.code,
        name: values.name,
        // Omitted, never sent empty: absent means "use my own institution",
        // which is what a scoped caller wants and what the server applies.
        institutionId: values.institutionId || undefined,
      });
      setCreating(false);
      form.reset();
    },
  });

  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  const columns = [
    {
      accessorKey: 'code',
      header: t('organization.departments.code'),
      meta: { sortField: 'code' },
      cell: ({ row }) => (
        <Link
          to={`/organization/departments/${row.original.id}`}
          className="font-mono text-xs hover:underline"
        >
          {row.original.code}
        </Link>
      ),
    },
    { accessorKey: 'name', header: t('common.fields.name'), meta: { sortField: 'name' } },
    {
      id: 'status',
      header: t('common.fields.status'),
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <ListPage
      title={t('organization.departments.title')}
      description={t('organization.departments.description')}
      actions={
        <Can code="department:create">
          <Button onClick={() => setCreating(true)}>{t('organization.departments.new')}</Button>
        </Can>
      }
      filters={
        <StatusFilter value={params.status ?? 'all'} onChange={(status) => setParams({ status })} />
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
        emptyTitle={t('organization.departments.empty')}
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('organization.departments.new')}
        submitLabel={t('common.actions.create')}
        onSubmit={submit}
        loading={isSubmitting}
        error={errors.root?.server}
      >
        <Field
          label={t('organization.departments.code')}
          error={errors.code?.message}
          hint={t('organization.departments.codeHint')}
          required
        >
          {(fieldProps) => <Input {...fieldProps} {...register('code')} />}
        </Field>
        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
        </Field>

        {/*
          Shown only to a caller who can read institutions. An institution-scoped
          administrator has exactly one and the server applies it, so offering a
          picker would be a question with one answer — and `CR-003` is explicit
          that such a role should not be handed the whole institution list to
          make a control work.

          A system-wide caller sees it and must answer: they have no institution
          to default to, and the alternative is a department that can hold
          nothing and cannot be repaired afterwards.
        */}
        {institutions.allowed ? (
          <Field
            label={t('common.fields.institution')}
            error={errors.institutionId?.message}
            hint={t(
              institutionRequired
                ? 'organization.departments.institutionRequiredHint'
                : 'organization.departments.institutionDefaultHint'
            )}
            required={institutionRequired}
          >
            {({ invalid, ...fieldProps }) => (
              <select
                {...fieldProps}
                {...register('institutionId')}
                aria-invalid={invalid || undefined}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm aria-[invalid=true]:border-destructive"
              >
                <option value="">
                  {t(
                    institutionRequired
                      ? 'organization.departments.selectInstitution'
                      : 'organization.departments.defaultInstitution'
                  )}
                </option>
                {institutions.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </FormDialog>
    </ListPage>
  );
}
