import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { vendorsApi } from '@/api/procurement';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Field, FormErrorSummary } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { DetailPage, DetailTabs, SectionCard } from '@/components/patterns/page';
import { vendors } from '../procurement/resources';
import { useTranslation } from 'react-i18next';

/**
 * Vendor detail — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §19.2;
 * REQ-VENDOR-001/002/004.
 *
 * Details plus Assets. The Assets tab is guarded by `asset:read`, not
 * `vendor:read`, because that is what the endpoint itself requires — and its
 * results are organization-scoped even though vendors are global (`DEC-007`).
 * Without the permission the tab is absent rather than disabled (`DEC-032`).
 */

const editSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  contactInfo: z.string().trim().max(5000).optional(),
  address: z.string().trim().max(5000).optional(),
});

/** Assets attributed to this vendor — REQ-VENDOR-004. */
function AssetsTab({ vendorId }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.vendors.sub(vendorId, 'assets'),
    queryFn: () => vendorsApi.assets(vendorId),
  });

  const columns = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <Link to={`/assets/${row.original.id}`} className="hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      id: 'classification',
      header: 'Classification',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.classificationId}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <SectionCard
      title={t('operations.vendors.assets')}
      description={t('operations.vendors.assetsDescription')}
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('operations.vendors.noAssets')}
        emptyDescription={t('operations.vendors.noAssetsDescription')}
      />
    </SectionCard>
  );
}

export function VendorDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = vendors.useDetail(id);
  const update = vendors.useUpdate();
  const setActive = vendors.useSetActive();
  const canUpdate = usePermission('vendor:update');
  const canReadAssets = usePermission('asset:read');
  const [confirming, setConfirming] = useState(false);

  const vendor = query.data;

  const { form, submit } = useZodForm({
    schema: editSchema,
    defaultValues: { name: '', contactInfo: '', address: '' },
    onSubmit: (values) =>
      update.mutateAsync({
        id,
        name: values.name,
        contactInfo: values.contactInfo || null,
        address: values.address || null,
      }),
  });

  const { register, reset, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  useEffect(() => {
    if (vendor) {
      reset({
        name: vendor.name,
        contactInfo: vendor.contactInfo ?? '',
        address: vendor.address ?? '',
      });
    }
  }, [vendor, reset]);

  if (query.isLoading) return <LoadingState variant="detail" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const detailsTab = (
    <SectionCard title={t('operations.vendors.details')}>
      <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
        <FormErrorSummary error={errors.root?.server} />

        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} disabled={!canUpdate} />}
        </Field>
        <Field
          label={t('operations.vendors.contactInformation')}
          error={errors.contactInfo?.message}
        >
          {(fieldProps) => (
            <Textarea {...fieldProps} {...register('contactInfo')} rows={2} disabled={!canUpdate} />
          )}
        </Field>
        <Field label={t('operations.vendors.address')} error={errors.address?.message}>
          {(fieldProps) => (
            <Textarea {...fieldProps} {...register('address')} rows={2} disabled={!canUpdate} />
          )}
        </Field>

        <Can code="vendor:update">
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
      title={vendor.name}
      badge={<StatusBadge value={vendor.isActive ? 'active' : 'inactive'} />}
      actions={
        <Can code="vendor:deactivate">
          <Button
            variant={vendor.isActive ? 'outline' : 'default'}
            onClick={() => setConfirming(true)}
          >
            {vendor.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        </Can>
      }
    >
      <DetailTabs
        tabs={[
          { value: 'details', label: 'Details', content: detailsTab },
          ...(canReadAssets
            ? [{ value: 'assets', label: 'Assets', content: <AssetsTab vendorId={id} /> }]
            : []),
        ]}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={vendor.isActive ? 'Deactivate this vendor?' : 'Reactivate this vendor?'}
        description={
          vendor.isActive
            ? t('operations.vendors.deactivateActive')
            : t('operations.vendors.deactivateInactive')
        }
        confirmLabel={vendor.isActive ? 'Deactivate' : 'Reactivate'}
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive.mutateAsync({ id, active: !vendor.isActive }).catch(() => undefined);
          setConfirming(false);
        }}
      />
    </DetailPage>
  );
}
