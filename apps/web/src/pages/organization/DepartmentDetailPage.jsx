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
import { DetailPage, SectionCard } from '@/components/patterns/page';
import { PicPanel } from '@/components/patterns/pic-panel';
import { PositionAssignmentsPanel } from '@/components/organization/PositionAssignmentsPanel';
import { departmentsApi } from '@/api/organization';
import { departments } from './resources';

/**
 * Department detail/edit — `07-ui.md` §5.1, `IMPLEMENTATION_PLAN.md` §17.2.
 *
 * The code is editable since Phase 20 (`CR-003`) — it is a label, not the key,
 * and uniqueness is only `(institution, code)`. The INSTITUTION is not: moving a
 * department would invalidate every asset unit assigned to it at once, so it is
 * shown read-only and the API refuses the field outright.
 */

const editSchema = z.object({
  code: z.string().trim().min(1, 'is required').max(8),
  name: z.string().trim().min(1, 'is required').max(75),
});

export function DepartmentDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = departments.useDetail(id);
  const update = departments.useUpdate();
  const setActive = departments.useSetActive();
  const canUpdate = usePermission('department:update');
  const [confirming, setConfirming] = useState(false);

  const department = query.data;

  const { form, submit } = useZodForm({
    schema: editSchema,
    defaultValues: { code: '', name: '' },
    onSubmit: (values) => update.mutateAsync({ id, ...values }),
  });

  const { register, reset, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  useEffect(() => {
    if (department) reset({ code: department.code, name: department.name });
  }, [department, reset]);

  if (query.isLoading) return <LoadingState variant="form" rows={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <DetailPage
      title={department.name}
      description={t('organization.departments.codeLabel', { code: department.code })}
      badge={<StatusBadge value={department.isActive ? 'active' : 'inactive'} />}
      actions={
        <Can code="department:deactivate">
          <Button
            variant={department.isActive ? 'outline' : 'default'}
            onClick={() => setConfirming(true)}
          >
            {department.isActive ? t('common.actions.deactivate') : t('common.actions.reactivate')}
          </Button>
        </Can>
      }
    >
      <SectionCard title={t('organization.departments.details')}>
        <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
          <FormErrorSummary error={errors.root?.server} />

          <Field
            label={t('organization.departments.code')}
            error={errors.code?.message}
            hint={t('organization.departments.codeHint')}
            required
          >
            {(fieldProps) => <Input {...fieldProps} {...register('code')} disabled={!canUpdate} />}
          </Field>
          <Field label={t('common.fields.name')} error={errors.name?.message} required>
            {(fieldProps) => <Input {...fieldProps} {...register('name')} disabled={!canUpdate} />}
          </Field>
          {/*
            Read-only on purpose (`CR-003` OPEN-6). A department that landed in
            the wrong institution is deactivated and recreated, because moving it
            would strip the department from every unit already assigned to it.
          */}
          <Field
            label={t('common.fields.institution')}
            hint={t('organization.departments.institutionReadOnlyHint')}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                value={department.institution?.name ?? t('organization.departments.noInstitution')}
                readOnly
                disabled
              />
            )}
          </Field>

          <Can code="department:update">
            <div className="flex justify-end">
              <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                {t('common.actions.saveChanges')}
              </Button>
            </div>
          </Can>
        </form>
      </SectionCard>

      {/*
        Phase 21 (`CR-003`). Guarded by `department-pic:*` inside the panel, not
        by `department:update` — naming a department and deciding who is
        responsible for it are different authorities.
      */}
      <PicPanel
        resource={departmentsApi}
        recordId={id}
        institutionId={department.institutionId}
        currentPic={department.currentPic}
        permissionPrefix="department-pic"
      />

      {/*
        Phase 35 (`CR-014`). The school positions held for this department — a
        separate section from the person in charge above, never merged with it:
        a position grants nothing and never touches a PIC record (`BR-028`).
      */}
      <PositionAssignmentsPanel
        mode="department"
        departmentId={id}
        institutionId={department.institutionId}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          department.isActive
            ? t('organization.departments.deactivateTitle')
            : t('organization.departments.reactivateTitle')
        }
        description={
          department.isActive
            ? t('organization.departments.deactivateDescription')
            : t('organization.departments.reactivateDescription')
        }
        confirmLabel={
          department.isActive ? t('common.actions.deactivate') : t('common.actions.reactivate')
        }
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive.mutateAsync({ id, active: !department.isActive }).catch(() => undefined);
          setConfirming(false);
        }}
      />
    </DetailPage>
  );
}
