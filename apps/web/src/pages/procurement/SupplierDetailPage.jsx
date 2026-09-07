import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';

import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/numbers';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Field, FormErrorSummary } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { DetailPage, DetailTabs, SectionCard } from '@/components/patterns/page';
import { contracts, suppliers } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Supplier detail — `07-ui.md` §5.5, `IMPLEMENTATION_PLAN.md` §19.1;
 * REQ-SUPPLIER-001/002/003.
 *
 * Details plus Contracts (`DEC-040`). The Contracts tab is the only place
 * REQ-SUPPLIER-003 — "suppliers MAY be associated with procurement contracts" —
 * is visible, and it is hidden outright without `contract:read` (`DEC-032`).
 *
 * Status is not a field on the form: it is a guarded transition with its own
 * endpoint and permission (`06-api.md` §1.7), so it sits in the header behind a
 * confirm dialog (§4.4).
 */

const editSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  address: z.string().trim().max(5000).optional(),
  contactInfo: z.string().trim().max(5000).optional(),
});

/** Contracts executed with this supplier — `GET /contracts?supplierId=`. */
function ContractsTab({ supplierId }) {
  const { t } = useTranslation();
  const query = contracts.useList({ supplierId, pageSize: 20 });

  const columns = [
    {
      accessorKey: 'contractNumber',
      header: 'Contract number',
      cell: ({ row }) => (
        <Link to={`/procurement/contracts/${row.original.id}`} className="hover:underline">
          {row.original.contractNumber}
        </Link>
      ),
    },
    {
      id: 'contractDate',
      header: 'Date',
      cell: ({ row }) => formatDate(row.original.contractDate),
    },
    {
      id: 'contractValue',
      header: 'Value',
      meta: { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' },
      cell: ({ row }) => formatMoney(row.original.contractValue),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <SectionCard
      title={t('procurement.suppliers.contracts')}
      description={t('procurement.suppliers.contractsDescription')}
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('procurement.suppliers.noContracts')}
        emptyDescription={t('procurement.suppliers.noContractsDescription')}
      />
    </SectionCard>
  );
}

export function SupplierDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = suppliers.useDetail(id);
  const update = suppliers.useUpdate();
  const setActive = suppliers.useSetActive();
  const canUpdate = usePermission('supplier:update');
  const canReadContracts = usePermission('contract:read');
  const [confirming, setConfirming] = useState(false);

  const supplier = query.data;

  const { form, submit } = useZodForm({
    schema: editSchema,
    defaultValues: { name: '', address: '', contactInfo: '' },
    onSubmit: (values) =>
      update.mutateAsync({
        id,
        name: values.name,
        address: values.address || null,
        contactInfo: values.contactInfo || null,
      }),
  });

  const { register, reset, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  // Re-populated after a save too, so `isDirty` returns to false rather than
  // staying stuck on.
  useEffect(() => {
    if (supplier) {
      reset({
        name: supplier.name,
        address: supplier.address ?? '',
        contactInfo: supplier.contactInfo ?? '',
      });
    }
  }, [supplier, reset]);

  if (query.isLoading) return <LoadingState variant="detail" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const detailsTab = (
    <SectionCard title={t('procurement.suppliers.details')}>
      <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
        <FormErrorSummary error={errors.root?.server} />

        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} disabled={!canUpdate} />}
        </Field>
        <Field
          label={t('procurement.suppliers.contactInformation')}
          error={errors.contactInfo?.message}
        >
          {(fieldProps) => (
            <Textarea {...fieldProps} {...register('contactInfo')} rows={2} disabled={!canUpdate} />
          )}
        </Field>
        <Field label={t('procurement.suppliers.address')} error={errors.address?.message}>
          {(fieldProps) => (
            <Textarea {...fieldProps} {...register('address')} rows={2} disabled={!canUpdate} />
          )}
        </Field>

        <Can code="supplier:update">
          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        </Can>
      </form>
    </SectionCard>
  );

  return (
    <DetailPage
      title={supplier.name}
      badge={<StatusBadge value={supplier.isActive ? 'active' : 'inactive'} />}
      actions={
        <Can code="supplier:deactivate">
          <Button
            variant={supplier.isActive ? 'outline' : 'default'}
            onClick={() => setConfirming(true)}
          >
            {supplier.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        </Can>
      }
    >
      <DetailTabs
        tabs={[
          { value: 'details', label: 'Details', content: detailsTab },
          ...(canReadContracts
            ? [
                {
                  value: 'contracts',
                  label: 'Contracts',
                  content: <ContractsTab supplierId={id} />,
                },
              ]
            : []),
        ]}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={supplier.isActive ? 'Deactivate this supplier?' : 'Reactivate this supplier?'}
        description={
          supplier.isActive
            ? 'Existing contracts keep referencing it; only new ones lose it as a choice.'
            : 'It becomes selectable again on new contracts.'
        }
        confirmLabel={supplier.isActive ? 'Deactivate' : 'Reactivate'}
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive.mutateAsync({ id, active: !supplier.isActive }).catch(() => undefined);
          setConfirming(false);
        }}
      />
    </DetailPage>
  );
}
