import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Can } from '@/auth/guards';
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
});

export function DepartmentsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = departments.useList(params);
  const create = departments.useCreate();
  const [creating, setCreating] = useState(false);

  const { form, submit } = useZodForm({
    schema: createSchema,
    defaultValues: { code: '', name: '' },
    onSubmit: async (values) => {
      await create.mutateAsync(values);
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
      </FormDialog>
    </ListPage>
  );
}
