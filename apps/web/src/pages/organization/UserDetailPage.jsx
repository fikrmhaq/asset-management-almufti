import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { z } from 'zod';

import { usersApi } from '@/api/organization';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { invalidateResources } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Combobox } from '@/components/ui/combobox';
import { NativeSelect } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field, FormErrorSummary } from '@/components/form/field';
import { DetailPage, DetailTabs, SectionCard } from '@/components/patterns/page';
import { institutions, roles as rolesResource, users } from './resources';

/**
 * User detail — `07-ui.md` §5.1, `IMPLEMENTATION_PLAN.md` §17.3;
 * REQ-USER-001, REQ-ROLE-002.
 *
 * Two tabs, because role assignment is its own resource with its own permissions
 * (`user-role:create` / `user-role:delete`) — a caller may edit a profile without
 * being allowed to grant roles.
 *
 * `username` is absent from the edit form on purpose: it is the login identifier
 * and appears in audit records, so renaming it would rewrite who did what. The
 * API rejects it too.
 */

const editSchema = z.object({
  firstName: z.string().trim().min(1, 'is required').max(150),
  lastName: z.string().trim().min(1, 'is required').max(150),
  contactInfo: z.string().trim().max(500).optional(),
  institutionId: z.string().optional(),
});

function ProfileTab({ id, user }) {
  const { t } = useTranslation();
  const update = users.useUpdate();
  const canUpdate = usePermission('user:update');
  const institutionList = institutions.useList({ pageSize: 100, status: 'active' });

  const { form, submit } = useZodForm({
    schema: editSchema,
    defaultValues: { firstName: '', lastName: '', contactInfo: '', institutionId: '' },
    onSubmit: (values) =>
      update.mutateAsync({
        id,
        ...values,
        contactInfo: values.contactInfo || null,
        institutionId: values.institutionId || null,
      }),
  });

  const { register, reset, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  useEffect(() => {
    reset({
      firstName: user.firstName,
      lastName: user.lastName,
      contactInfo: user.contactInfo ?? '',
      institutionId: user.institutionId ?? '',
    });
  }, [user, reset]);

  return (
    <SectionCard title={t('organization.users.profile')}>
      <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
        <FormErrorSummary error={errors.root?.server} />

        <Field label={t('organization.users.username')} hint={t('organization.users.usernameHint')}>
          {(fieldProps) => <Input {...fieldProps} value={user.username} readOnly disabled />}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('organization.users.firstName')}
            error={errors.firstName?.message}
            required
          >
            {(fieldProps) => (
              <Input {...fieldProps} {...register('firstName')} disabled={!canUpdate} />
            )}
          </Field>
          <Field label={t('organization.users.lastName')} error={errors.lastName?.message} required>
            {(fieldProps) => (
              <Input {...fieldProps} {...register('lastName')} disabled={!canUpdate} />
            )}
          </Field>
        </div>

        <Field label={t('organization.users.contactInfo')} error={errors.contactInfo?.message}>
          {(fieldProps) => (
            <Input {...fieldProps} {...register('contactInfo')} disabled={!canUpdate} />
          )}
        </Field>

        <Field label={t('common.fields.institution')} error={errors.institutionId?.message}>
          {/* `NativeSelect` keeps `invalid` off the DOM — spreading it onto a
              plain `<select>` is what React was warning about here. */}
          {(fieldProps) => (
            <NativeSelect {...fieldProps} {...register('institutionId')} disabled={!canUpdate}>
              <option value="">{t('organization.users.noInstitution')}</option>
              {(institutionList.data?.data ?? []).map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        <Can code="user:update">
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

function RolesTab({ id, user }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const roleList = rolesResource.useList({ pageSize: 100 });
  const canAssign = usePermission('user-role:create');
  const [selectedRole, setSelectedRole] = useState(null);

  const refresh = () => invalidateResources(queryClient, queryKeys.users);

  const assign = useMutation({
    mutationFn: (roleId) => usersApi.assignRole(id, roleId),
    onSuccess: async () => {
      await refresh();
      setSelectedRole(null);
      toast.success(t('organization.users.roleAssigned'));
    },
    onError: (error) => toast.fromError(error),
  });

  const unassign = useMutation({
    mutationFn: (roleId) => usersApi.removeRole(id, roleId),
    onSuccess: async () => {
      await refresh();
      toast.success(t('organization.users.roleRemoved'));
    },
    onError: (error) => toast.fromError(error),
  });

  const assigned = user.roles ?? [];
  const assignedIds = new Set(assigned.map((role) => role.id));
  const available = (roleList.data?.data ?? [])
    .filter((role) => !assignedIds.has(role.id))
    .map((role) => ({ value: role.id, label: role.name }));

  return (
    <SectionCard
      title={t('organization.users.roles')}
      description={t('organization.users.rolesDescription')}
    >
      <div className="space-y-4">
        {assigned.length === 0 ? (
          <EmptyState
            title={t('organization.users.noRoles')}
            description={t('organization.users.noRolesDescription')}
          />
        ) : (
          <ul className="space-y-2">
            {assigned.map((role) => (
              <li
                key={role.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium">{role.name}</span>
                  {role.isSystemWide ? (
                    <Badge variant="warning">{t('organization.roles.systemWide')}</Badge>
                  ) : null}
                </span>
                <Can code="user-role:delete">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('organization.users.removeRole', { name: role.name })}
                    loading={unassign.isPending && unassign.variables === role.id}
                    onClick={() => unassign.mutate(role.id)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Can>
              </li>
            ))}
          </ul>
        )}

        {canAssign ? (
          <div className="flex items-end gap-2">
            <div className="w-64">
              <Combobox
                options={available}
                value={selectedRole}
                onChange={setSelectedRole}
                placeholder={t('organization.users.selectRole')}
                emptyMessage={t('organization.users.noFurtherRoles')}
              />
            </div>
            <Button
              disabled={!selectedRole}
              loading={assign.isPending}
              onClick={() => assign.mutate(selectedRole)}
            >
              {t('organization.users.assignRole')}
            </Button>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

export function UserDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = users.useDetail(id);
  const setActive = users.useSetActive();
  const [confirming, setConfirming] = useState(false);

  const user = query.data;

  if (query.isLoading) return <LoadingState variant="form" rows={4} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <DetailPage
      title={`${user.firstName} ${user.lastName}`}
      description={user.username}
      badge={<StatusBadge value={user.isActive ? 'active' : 'inactive'} />}
      actions={
        <Can code="user:deactivate">
          <Button
            variant={user.isActive ? 'outline' : 'default'}
            onClick={() => setConfirming(true)}
          >
            {user.isActive ? t('common.actions.deactivate') : t('common.actions.reactivate')}
          </Button>
        </Can>
      }
    >
      <DetailTabs
        tabs={[
          {
            value: 'profile',
            label: t('organization.users.profile'),
            content: <ProfileTab id={id} user={user} />,
          },
          {
            value: 'roles',
            label: t('organization.users.roles'),
            content: <RolesTab id={id} user={user} />,
          },
        ]}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          user.isActive
            ? t('organization.users.deactivateTitle')
            : t('organization.users.reactivateTitle')
        }
        description={
          user.isActive
            ? t('organization.users.deactivateDescription')
            : t('organization.users.reactivateDescription')
        }
        confirmLabel={
          user.isActive ? t('common.actions.deactivate') : t('common.actions.reactivate')
        }
        destructive={user.isActive}
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive.mutateAsync({ id, active: !user.isActive }).catch(() => undefined);
          setConfirming(false);
        }}
      />
    </DetailPage>
  );
}
