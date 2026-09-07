import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { DetailTabs, ListPage, SectionCard } from '@/components/patterns/page';
import { categories, LOOKUP_RESOURCES } from '../organization/resources';

/**
 * Reference lookups — `07-ui.md` §5.2.
 *
 * ONE tabbed page, not five near-identical screens: the five editable lookups
 * share an identifier and a name and nothing else, which is exactly why
 * `06-api.md` §4.4 groups them and §5.2 puts them behind tabs.
 *
 * Categories are a sixth tab and are READ-ONLY: `06-api.md` §4.2 exposes list
 * and detail only, so this tab shows the data without any create, edit or delete
 * affordance.
 *
 * NAMING. Each tab's words come from `reference.lookups.types.<key>` rather than
 * from lower-casing an English heading, because "Measurement units" →
 * "measurement unit" is an English rule that does not survive translation.
 */

const lookupSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(250),
});

/** Account codes — the code IS the key: supplied on create, never edited. */
const naturalKeySchema = lookupSchema.extend({
  code: z.string().trim().min(1, 'is required').max(12),
});

/**
 * Funding sources — a business abbreviation beside the generated key (`CR-007`,
 * REQ-REF-007).
 *
 * The character class mirrors `chk_funding_sources_code_url_safe` and the
 * server's own schema: this value may be carried into an inventory code, and
 * that code travels in the address a scanned label resolves to (REQ-UNIT-011).
 */
const businessCodeSchema = lookupSchema.extend({
  code: z
    .string()
    .trim()
    .min(1, 'is required')
    .max(8)
    .regex(/^[A-Za-z0-9._-]+$/, 'must use only letters, digits, hyphen, underscore or dot'),
});

/** Creating: the code is required wherever the resource has one. */
const createSchemaFor = ({ naturalKey, businessCode }) => {
  if (naturalKey) return naturalKeySchema;
  if (businessCode) return businessCodeSchema;
  return lookupSchema;
};

/**
 * Editing: the same, except that a natural key cannot be edited at all — it is
 * the row's identity, and the server's update body does not accept it.
 */
const editSchemaFor = ({ naturalKey, businessCode }) =>
  !naturalKey && businessCode ? businessCodeSchema : lookupSchema;

function LookupTab({ resource }) {
  const { t } = useTranslation();
  const { hooks, permission, keyField, naturalKey, businessCode } = resource;
  const words = (part) => t(`reference.lookups.types.${resource.key}.${part}`);

  const query = hooks.useList({ pageSize: 100 });
  const create = hooks.useCreate();
  const update = hooks.useUpdate();
  const remove = hooks.useRemove();
  const canCreate = usePermission(`${permission}:create`);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const emptyValues = naturalKey || businessCode ? { code: '', name: '' } : { name: '' };

  const { form, submit } = useZodForm({
    schema: createSchemaFor(resource),
    defaultValues: emptyValues,
    onSubmit: async (values) => {
      await create.mutateAsync(values);
      setCreating(false);
      form.reset();
    },
  });

  /**
   * A second form rather than one reused for both. They differ in their schema
   * — a natural key is creatable but not editable — and sharing one would mean
   * resetting a dialog's values from whichever row was last opened.
   */
  const { form: editForm, submit: submitEdit } = useZodForm({
    schema: editSchemaFor(resource),
    defaultValues: emptyValues,
    onSubmit: async (values) => {
      await update.mutateAsync({ id: editing[keyField], ...values });
      setEditing(null);
    },
  });

  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  const openEdit = (row) => {
    setEditing(row);
    editForm.reset(
      businessCode && !naturalKey ? { name: row.name, code: row.code ?? '' } : { name: row.name }
    );
  };

  const columns = [
    {
      id: 'key',
      header: naturalKey ? t('reference.lookups.code') : t('reference.lookups.id'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original[keyField]}</span>,
    },
    { accessorKey: 'name', header: t('common.fields.name') },
    /**
     * Its own column, and a row without one is FLAGGED rather than left blank —
     * a funding source with no code cannot be used by an inventory code format
     * that includes it, and a registration relying on it is refused (§5.2).
     * Blank would read as "nothing to see here", which is the opposite.
     */
    ...(businessCode && !naturalKey
      ? [
          {
            id: 'code',
            header: t('reference.lookups.code'),
            cell: ({ row }) =>
              row.original.code ? (
                <span className="font-mono text-xs">{row.original.code}</span>
              ) : (
                <span className="text-xs text-amber-600 dark:text-amber-500">
                  {t('reference.lookups.codeMissing')}
                </span>
              ),
          },
        ]
      : []),
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Can code={`${permission}:update`}>
            <Button variant="ghost" size="sm" onClick={() => openEdit(row.original)}>
              {t('common.actions.edit')}
            </Button>
          </Can>
          <Can code={`${permission}:delete`}>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row.original)}>
              {t('common.actions.delete')}
            </Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    /* No title: the selected tab already names this list, and repeating it
       inside the panel is a heading that says nothing the reader did not just
       click. The card is here for the surface and the create action. */
    <SectionCard
      actions={
        canCreate ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            {t('reference.lookups.new', { name: words('singular') })}
          </Button>
        ) : null
      }
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('reference.lookups.empty', { name: words('plural') })}
        emptyDescription={t('reference.lookups.emptyDescription')}
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('reference.lookups.new', { name: words('singular') })}
        submitLabel={t('common.actions.create')}
        onSubmit={submit}
        loading={isSubmitting}
        error={errors.root?.server}
      >
        {naturalKey || businessCode ? (
          <Field
            label={t('reference.lookups.code')}
            error={errors.code?.message}
            hint={t(naturalKey ? 'reference.lookups.codeHint' : 'reference.lookups.businessCodeHint')}
            required
          >
            {(fieldProps) => <Input {...fieldProps} {...register('code')} />}
          </Field>
        ) : null}
        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
        </Field>
      </FormDialog>

      {/*
        Editing — `06-api.md` §4.4 exposes `PATCH` on every one of these, and the
        funding source code is the reason it is reachable: a row created before
        the column existed has no code, and assigning one is an administrator's
        decision that no migration could make for them (`CR-007`).
      */}
      <FormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={t('reference.lookups.edit', { name: words('singular') })}
        submitLabel={t('common.actions.save')}
        onSubmit={submitEdit}
        loading={editForm.formState.isSubmitting}
        error={editForm.formState.errors.root?.server}
      >
        {businessCode && !naturalKey ? (
          <Field
            label={t('reference.lookups.code')}
            error={editForm.formState.errors.code?.message}
            hint={t('reference.lookups.businessCodeHint')}
            required
          >
            {(fieldProps) => <Input {...fieldProps} {...editForm.register('code')} />}
          </Field>
        ) : null}
        <Field
          label={t('common.fields.name')}
          error={editForm.formState.errors.name?.message}
          required
        >
          {(fieldProps) => <Input {...fieldProps} {...editForm.register('name')} />}
        </Field>
      </FormDialog>

      {/* A hard delete: these tables have no status column. The server refuses
          with `CONFLICT` when the row is referenced (`06-api.md` §4.4). */}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('reference.lookups.deleteTitle', { name: words('singular') })}
        description={t('reference.lookups.deleteDescription')}
        confirmLabel={t('common.actions.delete')}
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync(pendingDelete[keyField]).catch(() => undefined);
          setPendingDelete(null);
        }}
      />
    </SectionCard>
  );
}

/**
 * Categories — read-only.
 *
 * Deliberately has no action column and no create button: `06-api.md` §4.2
 * exposes no write endpoint, so offering one would promise something the server
 * refuses. The note says why, in place, rather than leaving the reader to
 * conclude the buttons failed to load.
 */
function CategoriesTab() {
  const { t } = useTranslation();
  const query = categories.useList({ pageSize: 100 });

  const columns = [
    {
      id: 'id',
      header: t('reference.lookups.id'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span>,
    },
    { accessorKey: 'name', header: t('common.fields.name') },
  ];

  return (
    <SectionCard>
      <div className="space-y-4">
        <Alert variant="info" size="sm">
          {t('reference.lookups.categories.note')}
        </Alert>

        <DataTable
          columns={columns}
          data={query.data?.data ?? []}
          isLoading={query.isLoading}
          error={query.error}
          onRetry={query.refetch}
          emptyTitle={t('reference.lookups.categories.empty')}
        />
      </div>
    </SectionCard>
  );
}

export function LookupsPage() {
  const { t } = useTranslation();

  const tabs = [
    ...LOOKUP_RESOURCES.map((resource) => ({
      value: resource.key,
      label: t(`reference.lookups.types.${resource.key}.tab`),
      content: <LookupTab resource={resource} />,
    })),
    {
      value: 'categories',
      label: t('reference.lookups.categories.tab'),
      content: <CategoriesTab />,
    },
  ];

  return (
    /* The tab strip belongs on the canvas, with each tab's own panel below it —
       the same arrangement the detail pages use. Left inside the list panel it
       sat flush against the border with nothing to separate the two. */
    <ListPage
      title={t('reference.lookups.title')}
      description={t('reference.lookups.description')}
      surface={false}
    >
      <DetailTabs tabs={tabs} />
    </ListPage>
  );
}
