import { useState } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useListParams } from '@/hooks/useListParams';
import { useZodForm } from '@/lib/forms/useZodForm';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SearchFilter, StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { vendors } from '../procurement/resources';
import { useTranslation } from 'react-i18next';

/**
 * Vendors — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §19.2; REQ-VENDOR-001/002.
 *
 * A vendor is the manufacturer or brand behind an asset (`03-domain.md` §4.14),
 * distinct from a Supplier, which is the party a contract is executed with.
 *
 * Filed under Operations in the navigation, as `07-ui.md` §5.6 has it, but built
 * in Phase 13 with the rest of procurement (`DEC-034`) — the frontend
 * counterpart of `DEC-008`.
 *
 * Global list, no institution filter (`DEC-007`).
 */

const vendorSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  contactInfo: z.string().trim().max(5000).optional(),
  address: z.string().trim().max(5000).optional(),
});

export function VendorsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = vendors.useList(params);
  const create = vendors.useCreate();
  const canCreate = usePermission('vendor:create');
  const [creating, setCreating] = useState(false);

  const { form, submit } = useZodForm({
    schema: vendorSchema,
    defaultValues: { name: '', contactInfo: '', address: '' },
    onSubmit: async (values) => {
      await create.mutateAsync({
        name: values.name,
        contactInfo: values.contactInfo || undefined,
        address: values.address || undefined,
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
      accessorKey: 'name',
      header: 'Name',
      meta: { sortField: 'name' },
      cell: ({ row }) => (
        <Link to={`/operations/vendors/${row.original.id}`} className="hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { accessorKey: 'contactInfo', header: 'Contact' },
    { accessorKey: 'address', header: 'Address' },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <ListPage
      title={t('operations.vendors.title')}
      description={t('operations.vendors.description')}
      actions={
        <Can code="vendor:create">
          <Button onClick={() => setCreating(true)}>New vendor</Button>
        </Can>
      }
      filters={
        <>
          <SearchFilter
            value={params.q ?? ''}
            onChange={(q) => setParams({ q })}
            placeholder={t('operations.vendors.searchPlaceholder')}
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
        emptyTitle={t('operations.vendors.empty')}
        emptyDescription={
          canCreate ? 'Create the first one to get started.' : 'Nothing matches these filters.'
        }
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('operations.vendors.newTitle')}
        submitLabel={t('common.actions.create')}
        onSubmit={submit}
        loading={isSubmitting}
        error={errors.root?.server}
      >
        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
        </Field>
        <Field
          label={t('operations.vendors.contactInformation')}
          error={errors.contactInfo?.message}
        >
          {(fieldProps) => <Textarea {...fieldProps} {...register('contactInfo')} rows={2} />}
        </Field>
        <Field label={t('operations.vendors.address')} error={errors.address?.message}>
          {(fieldProps) => <Textarea {...fieldProps} {...register('address')} rows={2} />}
        </Field>
      </FormDialog>
    </ListPage>
  );
}

export { vendorSchema };
