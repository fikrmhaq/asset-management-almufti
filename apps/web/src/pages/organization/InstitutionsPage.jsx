import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { usePermission } from '@/auth/useSession';
import { useListParams } from '@/hooks/useListParams';
import { useZodForm } from '@/lib/forms/useZodForm';
import { Can } from '@/auth/guards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SearchFilter, StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { institutions } from './resources';

/**
 * Institutions — `07-ui.md` §5.1; REQ-ORG-001/002.
 */

const institutionSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  code: z.string().trim().min(1, 'is required').max(50),
  address: z.string().trim().min(1, 'is required').max(5000),
});

export function InstitutionsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = institutions.useList(params);
  const create = institutions.useCreate();
  const canCreate = usePermission('institution:create');
  const [creating, setCreating] = useState(false);

  const { form, submit } = useZodForm({
    schema: institutionSchema,
    defaultValues: { name: '', code: '', address: '' },
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
      accessorKey: 'name',
      header: t('common.fields.name'),
      meta: { sortField: 'name' },
      cell: ({ row }) => (
        <Link to={`/organization/institutions/${row.original.id}`} className="hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'code',
      header: t('organization.institutions.code'),
      meta: { sortField: 'code' },
    },
    { accessorKey: 'address', header: t('organization.institutions.address') },
    {
      id: 'status',
      header: t('common.fields.status'),
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <ListPage
      title={t('organization.institutions.title')}
      description={t('organization.institutions.description')}
      actions={
        <Can code="institution:create">
          <Button onClick={() => setCreating(true)}>{t('organization.institutions.new')}</Button>
        </Can>
      }
      filters={
        <>
          <SearchFilter
            value={params.q ?? ''}
            onChange={(q) => setParams({ q })}
            placeholder={t('organization.institutions.searchPlaceholder')}
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
        emptyTitle={t('organization.institutions.empty')}
        // Two different emptinesses: one the reader can do something about, one
        // they cannot.
        emptyDescription={canCreate ? t('common.states.createFirst') : t('common.states.noMatches')}
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('organization.institutions.new')}
        submitLabel={t('common.actions.create')}
        onSubmit={submit}
        loading={isSubmitting}
        error={errors.root?.server}
      >
        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
        </Field>
        <Field
          label={t('organization.institutions.code')}
          error={errors.code?.message}
          hint={t('organization.institutions.codeHint')}
          required
        >
          {(fieldProps) => <Input {...fieldProps} {...register('code')} />}
        </Field>
        <Field
          label={t('organization.institutions.address')}
          error={errors.address?.message}
          required
        >
          {(fieldProps) => <Input {...fieldProps} {...register('address')} />}
        </Field>
      </FormDialog>
    </ListPage>
  );
}

export { institutionSchema };
