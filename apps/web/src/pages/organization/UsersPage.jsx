import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Can } from '@/auth/guards';
import { useListParams } from '@/hooks/useListParams';
import { useZodForm } from '@/lib/forms/useZodForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/select';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SearchFilter, SelectFilter, StatusFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { institutions, users } from './resources';

/**
 * Users — `07-ui.md` §5.1; REQ-USER-001/002.
 *
 * The password is set here, at creation, and never again through this UI: the
 * API has no password-change endpoint and no requirement asks for one.
 * `PATCH /users/:id` deliberately excludes both `username` and `password`.
 */

/** Mirrors `06-api.md` §3.3's own schema, including the 12-character floor. */
const createSchema = z.object({
  username: z.string().trim().min(1, 'is required').max(25),
  password: z.string().min(12, 'must be at least 12 characters'),
  firstName: z.string().trim().min(1, 'is required').max(150),
  lastName: z.string().trim().min(1, 'is required').max(150),
  contactInfo: z.string().trim().max(500).optional(),
  // `''` is what the select holds for "no institution", and it is also what the
  // field defaults to when the select is not rendered at all — a caller without
  // `institution:read` gets no options, so the control is hidden (`07-ui.md`
  // §6). Without the empty-string branch that default failed the UUID check on
  // a field nothing displayed, so the dialog refused to submit and gave no
  // reason. The submit handler maps `''` to `undefined`, and the API then
  // defaults the new user's institution to the caller's own (BR-007).
  institutionId: z.string().uuid('must be a UUID').optional().or(z.literal('')),
});

export function UsersPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const query = users.useList(params);
  const create = users.useCreate();
  const [creating, setCreating] = useState(false);

  // Only to label and filter by institution; a caller without `institution:read`
  // simply does not get the filter.
  const institutionList = institutions.useList({ pageSize: 100, status: 'active' });
  const institutionOptions = (institutionList.data?.data ?? []).map((institution) => ({
    value: institution.id,
    label: institution.name,
  }));

  const { form, submit } = useZodForm({
    schema: createSchema,
    defaultValues: {
      username: '',
      password: '',
      firstName: '',
      lastName: '',
      contactInfo: '',
      institutionId: '',
    },
    onSubmit: async (values) => {
      await create.mutateAsync({
        ...values,
        contactInfo: values.contactInfo || undefined,
        institutionId: values.institutionId || undefined,
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
      accessorKey: 'username',
      header: t('organization.users.username'),
      meta: { sortField: 'username' },
      cell: ({ row }) => (
        <Link to={`/organization/users/${row.original.id}`} className="hover:underline">
          {row.original.username}
        </Link>
      ),
    },
    {
      id: 'name',
      header: t('common.fields.name'),
      cell: ({ row }) => `${row.original.firstName} ${row.original.lastName}`,
    },
    {
      id: 'roles',
      header: t('organization.users.roles'),
      cell: ({ row }) =>
        row.original.roles?.length ? (
          row.original.roles.map((role) => role.name).join(', ')
        ) : (
          <span className="text-muted-foreground">{t('common.states.none')}</span>
        ),
    },
    {
      id: 'status',
      header: t('common.fields.status'),
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <ListPage
      title={t('organization.users.title')}
      description={t('organization.users.description')}
      actions={
        <Can code="user:create">
          <Button onClick={() => setCreating(true)}>{t('organization.users.new')}</Button>
        </Can>
      }
      filters={
        <>
          <SearchFilter
            value={params.q ?? ''}
            onChange={(q) => setParams({ q })}
            placeholder={t('organization.users.searchPlaceholder')}
          />
          {institutionOptions.length > 0 ? (
            <SelectFilter
              id="filter-institution"
              label={t('common.fields.institution')}
              value={params.institutionId ?? 'all'}
              options={institutionOptions}
              onChange={(institutionId) => setParams({ institutionId })}
            />
          ) : null}
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
        emptyTitle={t('organization.users.empty')}
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('organization.users.new')}
        description={t('organization.users.newDescription')}
        submitLabel={t('common.actions.create')}
        onSubmit={submit}
        loading={isSubmitting}
        error={errors.root?.server}
        className="max-w-xl"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('organization.users.username')} error={errors.username?.message} required>
            {(fieldProps) => <Input {...fieldProps} {...register('username')} autoComplete="off" />}
          </Field>
          <Field
            label={t('organization.users.password')}
            error={errors.password?.message}
            hint={t('organization.users.passwordHint')}
            required
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...register('password')}
                type="password"
                autoComplete="new-password"
              />
            )}
          </Field>
          <Field
            label={t('organization.users.firstName')}
            error={errors.firstName?.message}
            required
          >
            {(fieldProps) => <Input {...fieldProps} {...register('firstName')} />}
          </Field>
          <Field label={t('organization.users.lastName')} error={errors.lastName?.message} required>
            {(fieldProps) => <Input {...fieldProps} {...register('lastName')} />}
          </Field>
        </div>

        <Field label={t('organization.users.contactInfo')} error={errors.contactInfo?.message}>
          {(fieldProps) => <Input {...fieldProps} {...register('contactInfo')} />}
        </Field>

        {institutionOptions.length > 0 ? (
          <Field
            label={t('common.fields.institution')}
            error={errors.institutionId?.message}
            hint={t('organization.users.institutionHint')}
          >
            {/* `NativeSelect` takes `invalid` as a prop instead of letting it be
                spread onto the element, which is what React was warning about
                here. Still a native select: the existing tests drive it with
                `selectOptions`, and it now matches the shared select's own
                appearance. */}
            {(fieldProps) => (
              <NativeSelect {...fieldProps} {...register('institutionId')}>
                <option value="">{t('organization.users.noInstitution')}</option>
                {institutionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}
      </FormDialog>
    </ListPage>
  );
}
