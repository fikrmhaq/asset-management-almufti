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
import { suppliers } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Suppliers — `07-ui.md` §5.5, `IMPLEMENTATION_PLAN.md` §19.1;
 * REQ-SUPPLIER-001/002.
 *
 * A supplier is the party a Contract is executed with — distinct from a Vendor,
 * which is the manufacturer behind an asset (`03-domain.md` §4.14).
 *
 * Three fields, so the create form is a dialog rather than a page (`07-ui.md`
 * §4.3, `DEC-029`); only the Contract form is large enough to earn a route
 * (`DEC-033`).
 *
 * No institution filter: suppliers are a global list with no `institution_id`
 * (`DEC-007`), so there is nothing to scope them by.
 */

const supplierSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  address: z.string().trim().max(5000).optional(),
  contactInfo: z.string().trim().max(5000).optional(),
});

export function SuppliersPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = suppliers.useList(params);
  const create = suppliers.useCreate();
  const canCreate = usePermission('supplier:create');
  const [creating, setCreating] = useState(false);

  const { form, submit } = useZodForm({
    schema: supplierSchema,
    defaultValues: { name: '', address: '', contactInfo: '' },
    onSubmit: async (values) => {
      await create.mutateAsync({
        name: values.name,
        address: values.address || undefined,
        contactInfo: values.contactInfo || undefined,
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
        <Link to={`/procurement/suppliers/${row.original.id}`} className="hover:underline">
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
      title={t('procurement.suppliers.title')}
      description={t('procurement.suppliers.description')}
      actions={
        <Can code="supplier:create">
          <Button onClick={() => setCreating(true)}>New supplier</Button>
        </Can>
      }
      filters={
        <>
          <SearchFilter
            value={params.q ?? ''}
            onChange={(q) => setParams({ q })}
            placeholder={t('procurement.suppliers.searchPlaceholder')}
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
        emptyTitle={t('procurement.suppliers.empty')}
        emptyDescription={
          canCreate ? 'Create the first one to get started.' : 'Nothing matches these filters.'
        }
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('procurement.suppliers.newTitle')}
        submitLabel={t('common.actions.create')}
        onSubmit={submit}
        loading={isSubmitting}
        error={errors.root?.server}
      >
        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
        </Field>
        <Field
          label={t('procurement.suppliers.contactInformation')}
          error={errors.contactInfo?.message}
        >
          {(fieldProps) => <Textarea {...fieldProps} {...register('contactInfo')} rows={2} />}
        </Field>
        <Field label={t('procurement.suppliers.address')} error={errors.address?.message}>
          {(fieldProps) => <Textarea {...fieldProps} {...register('address')} rows={2} />}
        </Field>
      </FormDialog>
    </ListPage>
  );
}

export { supplierSchema };
