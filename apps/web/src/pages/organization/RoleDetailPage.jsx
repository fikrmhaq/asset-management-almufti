import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { permissionsApi, rolesApi } from '@/api/organization';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { invalidateResources } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Checkbox, CheckboxField } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field, FormErrorSummary } from '@/components/form/field';
import { DetailPage, DetailTabs, SectionCard } from '@/components/patterns/page';
import { PermissionChecklist } from '@/components/reference/PermissionChecklist';
import { roles } from './resources';

/**
 * Role detail — `07-ui.md` §5.1, `IMPLEMENTATION_PLAN.md` §17.4;
 * REQ-ROLE-003/007/008.
 *
 * The permission checklist is grouped by the `group` the API returns with each
 * code, which is the same grouping `06-api.md` §1.3 uses — a flat list of 100+
 * codes is unusable.
 *
 * The system-wide rule is shown before it is enforced: while `isSystemWide` is
 * false, the codes that require it are disabled and labelled. The server still
 * rejects the combination with `CONFLICT`, and that rejection surfaces here too.
 */

const editSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(50),
  isSystemWide: z.boolean(),
  isInstitutionAssignable: z.boolean(),
  isPicScoped: z.boolean(),
});

function DetailsTab({ id, role }) {
  const { t } = useTranslation();
  const update = roles.useUpdate();
  const canUpdate = usePermission('role:update');

  const { form, submit } = useZodForm({
    schema: editSchema,
    defaultValues: {
      name: '',
      isSystemWide: false,
      isInstitutionAssignable: false,
      isPicScoped: false,
    },
    onSubmit: (values) => update.mutateAsync({ id, ...values }),
  });

  const { register, reset, watch, setValue, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  useEffect(() => {
    reset({
      name: role.name,
      isSystemWide: role.isSystemWide,
      isInstitutionAssignable: role.isInstitutionAssignable,
      isPicScoped: role.isPicScoped,
    });
  }, [role, reset]);

  // `BR-022`: the two are mutually exclusive, and the API and a database
  // constraint both refuse the combination. Watching lets the control disable
  // itself as soon as system-wide is ticked, rather than letting the user
  // compose a state the server will reject.
  const isSystemWide = watch('isSystemWide');

  useEffect(() => {
    if (!isSystemWide) return;
    setValue('isInstitutionAssignable', false, { shouldDirty: true });
    // `BR-023` likewise: reaching every institution and reaching only your own
    // departments are opposites, refused by the API and by a database CHECK.
    setValue('isPicScoped', false, { shouldDirty: true });
  }, [isSystemWide, setValue]);

  return (
    <SectionCard title={t('organization.roles.details')}>
      <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
        <FormErrorSummary error={errors.root?.server} />

        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} disabled={!canUpdate} />}
        </Field>

        <CheckboxField
          label={t('organization.roles.systemWide')}
          description={t('organization.roles.systemWideEditHint')}
        >
          <Checkbox {...register('isSystemWide')} disabled={!canUpdate} />
        </CheckboxField>

        {/* The warning sits at the control, not in a help page. Ticking this
            grants the role's permissions to every institution administrator:
            whoever creates a user chooses its password and can sign in as it, so
            any role they can assign, they can become (`BR-022`). A setting that
            consequential has to state its consequence where the decision is
            made. */}
        <CheckboxField
          label={t('organization.roles.institutionAssignable')}
          description={
            isSystemWide
              ? t('organization.roles.institutionAssignableBlocked')
              : t('organization.roles.institutionAssignableHint')
          }
        >
          <Checkbox
            {...register('isInstitutionAssignable')}
            disabled={!canUpdate || isSystemWide}
          />
        </CheckboxField>

        {watch('isInstitutionAssignable') ? (
          <Alert variant="warning">{t('organization.roles.institutionAssignableWarning')}</Alert>
        ) : null}

        {/*
          The third scope tier — Phase 22 (`CR-003`), REQ-ROLE-011.

          It NARROWS, and it narrows only when every one of a user's roles
          carries it: holding any ordinary role alongside restores institution
          reach. Said at the control, because a flag that silently does nothing
          for half the people it is applied to is worse than one that does
          nothing at all.
        */}
        <CheckboxField
          label={t('organization.roles.picScoped')}
          description={
            isSystemWide
              ? t('organization.roles.picScopedBlocked')
              : t('organization.roles.picScopedHint')
          }
        >
          <Checkbox {...register('isPicScoped')} disabled={!canUpdate || isSystemWide} />
        </CheckboxField>

        {watch('isPicScoped') ? (
          <Alert variant="warning">{t('organization.roles.picScopedWarning')}</Alert>
        ) : null}

        <Can code="role:update">
          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              {t('common.actions.saveChanges')}
            </Button>
          </div>
        </Can>
      </form>
    </SectionCard>
  );
}

function PermissionsTab({ id, role }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canUpdate = usePermission('role-permission:update');
  const [selected, setSelected] = useState(null);

  const catalog = useQuery({
    queryKey: queryKeys.permissions.lists(),
    queryFn: permissionsApi.list,
  });

  const granted = useQuery({
    queryKey: queryKeys.roles.sub(id, 'permissions'),
    queryFn: () => rolesApi.listPermissions(id),
  });

  const save = useMutation({
    mutationFn: (codes) => rolesApi.replacePermissions(id, codes),
    onSuccess: async () => {
      await invalidateResources(queryClient, queryKeys.roles);
      await queryClient.invalidateQueries({ queryKey: queryKeys.roles.sub(id, 'permissions') });
      toast.success(t('organization.roles.permissionsUpdated'));
    },
    // A `CONFLICT` here is the server refusing the combination; its message says so.
    onError: (error) => toast.fromError(error),
  });

  // The server's set is the starting point; edits are local until saved.
  const grantedCodes = granted.data?.map((entry) => entry.code ?? entry) ?? [];
  const current = selected ?? grantedCodes;
  const dirty = selected !== null && selected.join() !== grantedCodes.join();

  if (catalog.isLoading || granted.isLoading) return <LoadingState variant="list" rows={6} />;
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={catalog.refetch} />;
  if (granted.isError) return <ErrorState error={granted.error} onRetry={granted.refetch} />;

  return (
    <SectionCard
      title={t('organization.roles.permissions')}
      description={t('organization.roles.permissionsGranted', {
        granted: current.length,
        total: catalog.data?.length ?? 0,
      })}
      actions={
        <Can code="role-permission:update">
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(current)}>
            {t('organization.roles.savePermissions')}
          </Button>
        </Can>
      }
    >
      <PermissionChecklist
        permissions={catalog.data ?? []}
        selected={current}
        onChange={setSelected}
        isSystemWide={role.isSystemWide}
        isPicScoped={role.isPicScoped}
        disabled={!canUpdate}
      />
    </SectionCard>
  );
}

export function RoleDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const query = roles.useDetail(id);
  const remove = roles.useRemove();
  const [confirming, setConfirming] = useState(false);

  const role = query.data;

  if (query.isLoading) return <LoadingState variant="form" rows={4} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <DetailPage
      title={role.name}
      badge={
        role.isSystemWide ? (
          <Badge variant="warning">{t('organization.roles.systemWide')}</Badge>
        ) : (
          <Badge variant="neutral">{t('organization.roles.institutionScoped')}</Badge>
        )
      }
      actions={
        <Can code="role:delete">
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            {t('organization.roles.delete')}
          </Button>
        </Can>
      }
    >
      <DetailTabs
        tabs={[
          {
            value: 'details',
            label: t('organization.roles.details'),
            content: <DetailsTab id={id} role={role} />,
          },
          {
            value: 'permissions',
            label: t('organization.roles.permissions'),
            content: <PermissionsTab id={id} role={role} />,
          },
        ]}
      />

      {/* A hard delete, unlike most resources — `ref.roles` has no status column.
          The server blocks it with `CONFLICT` while any user still holds it. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('organization.roles.deleteTitle')}
        description={t('organization.roles.deleteDescription')}
        confirmLabel={t('common.actions.delete')}
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(id);
            setConfirming(false);
            navigate('/organization/roles');
          } catch {
            setConfirming(false);
          }
        }}
      />
    </DetailPage>
  );
}
