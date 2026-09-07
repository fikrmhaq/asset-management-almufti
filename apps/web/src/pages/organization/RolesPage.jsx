import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Can } from '@/auth/guards';
import { useListParams } from '@/hooks/useListParams';
import { useZodForm } from '@/lib/forms/useZodForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox, CheckboxField } from '@/components/ui/checkbox';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { ListPage } from '@/components/patterns/page';
import { roles } from './resources';

/**
 * Roles — `07-ui.md` §5.1; REQ-ROLE-001/008.
 *
 * `isSystemWide` lifts organization scope (REQ-AUTHZ-005); it grants nothing by
 * itself. Permissions are assigned on the detail page, not here.
 */

const createSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(50),
  isSystemWide: z.boolean().default(false),
});

export function RolesPage() {
  const { t } = useTranslation();
  // `GET /roles` documents no filters (`06-api.md` §3.4), so this list has a
  // sort and a page but no filter toolbar.
  const { params, setPage, setSort } = useListParams();
  const query = roles.useList(params);
  const create = roles.useCreate();
  const [creating, setCreating] = useState(false);

  const { form, submit } = useZodForm({
    schema: createSchema,
    defaultValues: { name: '', isSystemWide: false },
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
        <Link to={`/organization/roles/${row.original.id}`} className="hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      id: 'scope',
      header: t('organization.roles.scope'),
      cell: ({ row }) =>
        row.original.isSystemWide ? (
          <Badge variant="warning">{t('organization.roles.systemWide')}</Badge>
        ) : (
          <Badge variant="neutral">{t('organization.roles.institutionScoped')}</Badge>
        ),
    },
    {
      id: 'permissions',
      header: t('organization.roles.permissions'),
      cell: ({ row }) => row.original.permissions?.length ?? 0,
    },
  ];

  return (
    <ListPage
      title={t('organization.roles.title')}
      description={t('organization.roles.description')}
      actions={
        <Can code="role:create">
          <Button onClick={() => setCreating(true)}>{t('organization.roles.new')}</Button>
        </Can>
      }
      meta={query.data?.meta}
      onPageChange={setPage}
      filters={undefined}
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
        emptyTitle={t('organization.roles.empty')}
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('organization.roles.new')}
        description={t('organization.roles.newDescription')}
        submitLabel={t('common.actions.create')}
        onSubmit={submit}
        loading={isSubmitting}
        error={errors.root?.server}
      >
        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
        </Field>

        {/* The rule identifier that used to close this sentence was an
            engineering reference an administrator cannot look up; what the
            setting does is said in full instead. */}
        <CheckboxField
          label={t('organization.roles.systemWide')}
          description={t('organization.roles.systemWideHint')}
        >
          <Checkbox {...register('isSystemWide')} />
        </CheckboxField>
      </FormDialog>
    </ListPage>
  );
}

export { createSchema as roleSchema };
