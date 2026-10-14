import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Field, FormErrorSummary } from '@/components/form/field';
import { DetailPage, DetailTabs, SectionCard } from '@/components/patterns/page';
import { InventoryCodeFormatBuilder } from '@/components/organization/InventoryCodeFormatBuilder';
import { TeacherStorageRoomPanel } from '@/components/organization/TeacherStorageRoomPanel';
import { institutions } from './resources';

/**
 * Institution detail/edit — `07-ui.md` §5.1, `IMPLEMENTATION_PLAN.md` §17.1.
 *
 * Status is not a field on this form. It is a guarded transition with its own
 * endpoint and its own permission (`06-api.md` §1.7), so it lives in the header
 * behind a confirm dialog (`07-ui.md` §4.4).
 *
 * Tabbed since Phase 25 (`CR-006`). The inventory code format is a different
 * kind of decision from the institution's own details — it governs every unit
 * registered afterwards — and it carries its own permissions, so it gets its own
 * panel rather than being appended to this form.
 */

const editSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  code: z.string().trim().min(1, 'is required').max(50),
  address: z.string().trim().min(1, 'is required').max(5000),
});

export function InstitutionDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = institutions.useDetail(id);
  const update = institutions.useUpdate();
  const setActive = institutions.useSetActive();
  const canUpdate = usePermission('institution:update');
  /**
   * A separate authority from editing the institution — `CR-006`. A caller may
   * hold either without the other, in both directions: `institution:update` is
   * system-wide-only (`BR-015`) while this one is not.
   */
  const canReadFormat = usePermission('inventory-code-format:read');
  // REQ-REQUEST-023: its own authority too.
  const canReadStorageRoom = usePermission('teacher-storage-room:read');
  const [confirming, setConfirming] = useState(false);

  const institution = query.data;

  const { form, submit } = useZodForm({
    schema: editSchema,
    defaultValues: { name: '', code: '', address: '' },
    onSubmit: (values) => update.mutateAsync({ id, ...values }),
  });

  const { register, reset, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  // The form is populated once the record arrives, and re-populated after a save
  // so `isDirty` returns to false rather than staying stuck on.
  useEffect(() => {
    if (institution) {
      reset({
        name: institution.name,
        code: institution.code,
        address: institution.address ?? '',
      });
    }
  }, [institution, reset]);

  if (query.isLoading) return <LoadingState variant="form" rows={4} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const details = (
    <SectionCard title={t('organization.institutions.details')}>
      <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
        <FormErrorSummary error={errors.root?.server} />

        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} disabled={!canUpdate} />}
        </Field>
        <Field label={t('organization.institutions.code')} error={errors.code?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('code')} disabled={!canUpdate} />}
        </Field>
        <Field
          label={t('organization.institutions.address')}
          error={errors.address?.message}
          required
        >
          {(fieldProps) => <Input {...fieldProps} {...register('address')} disabled={!canUpdate} />}
        </Field>

        <Can code="institution:update">
          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              {t('common.actions.saveChanges')}
            </Button>
          </div>
        </Can>
      </form>
    </SectionCard>
  );

  const tabs = [
    { value: 'details', label: t('organization.institutions.details'), content: details },
    // Absent, not disabled, for a caller who cannot read it (`07-ui.md` §6).
    ...(canReadFormat
      ? [
          {
            value: 'inventory-code',
            label: t('organization.inventoryCodeFormat.tab'),
            content: <InventoryCodeFormatBuilder institutionId={id} />,
          },
        ]
      : []),
    ...(canReadStorageRoom
      ? [
          {
            value: 'teacher-storage-room',
            label: t('organization.teacherStorageRoom.tab'),
            content: <TeacherStorageRoomPanel institutionId={id} />,
          },
        ]
      : []),
  ];

  return (
    <DetailPage
      title={institution.name}
      description={t('organization.institutions.codeLabel', { code: institution.code })}
      badge={<StatusBadge value={institution.isActive ? 'active' : 'inactive'} />}
      actions={
        <Can code="institution:deactivate">
          <Button
            variant={institution.isActive ? 'outline' : 'default'}
            onClick={() => setConfirming(true)}
          >
            {institution.isActive ? t('common.actions.deactivate') : t('common.actions.reactivate')}
          </Button>
        </Can>
      }
    >
      <DetailTabs tabs={tabs} />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          institution.isActive
            ? t('organization.institutions.deactivateTitle')
            : t('organization.institutions.reactivateTitle')
        }
        description={
          institution.isActive
            ? t('organization.institutions.deactivateDescription')
            : t('organization.institutions.reactivateDescription')
        }
        confirmLabel={
          institution.isActive ? t('common.actions.deactivate') : t('common.actions.reactivate')
        }
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive.mutateAsync({ id, active: !institution.isActive }).catch(() => undefined);
          setConfirming(false);
        }}
      />
    </DetailPage>
  );
}
