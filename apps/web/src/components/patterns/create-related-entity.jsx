import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { Combobox } from '@/components/ui/combobox';
import { FormDialog } from './form-dialog';

/**
 * Choose a related record — or create the missing one without losing this form.
 *
 * The dead end this removes: a user fills in half a contract, reaches "Contract
 * type", finds the one they need does not exist, and has to abandon the form,
 * navigate to reference data, create it, come back, and type everything again.
 * `07-ui.md` has no screen for that journey because it is not a feature; it is
 * an accident of every reference list being its own page.
 *
 * PARENT FORM STATE IS SAFE BY CONSTRUCTION. The dialog runs its own React Hook
 * Form instance over its own schema. Nothing here reaches into the parent form,
 * so there is nothing for a failed creation to corrupt — the parent simply never
 * re-rendered from this.
 *
 * PERMISSIONS. The create affordance is gated on a permission code through the
 * SAME `usePermission` the nav and the route guards use — not a second
 * mechanism, and not a prop the caller can spoof with a boolean. It is HIDDEN,
 * not disabled (`07-ui.md` §6): a user who may read measurement units but not
 * create them still picks from the list and is never shown a door that is
 * locked. With no `permission` prop the affordance does not appear at all, which
 * fails closed.
 *
 * The server remains authoritative. `onCreate` is the caller's own mutation —
 * normally `useCreate()` from `createResourceHooks`, which already invalidates
 * the resource's key prefix, so the option list refreshes through the existing
 * cache rather than through a second one kept here. Nothing is inserted
 * optimistically: the new record is selected only after the server returns it.
 *
 * @param {object} props
 * @param {{value: string, label: string}[]} props.options
 * @param {string|null} props.value
 * @param {(value: string|null) => void} props.onChange
 * @param {string} [props.permission] e.g. `measurement-unit:create`
 * @param {string} [props.createLabel] the affordance's text
 * @param {import('zod').ZodType} props.schema validates the dialog's own fields
 * @param {(form: object) => React.ReactNode} props.children the dialog's fields
 * @param {(values: object) => Promise<object>} props.onCreate
 *   Must RESOLVE WITH THE CREATED RECORD — that is what gets selected.
 * @param {(entity: object) => {value: string, label: string}} [props.toOption]
 */
export function CreateRelatedEntity({
  options = [],
  value,
  onChange,
  onSearchChange,
  loading = false,
  disabled = false,
  invalid = false,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  className,
  permission,
  createLabel,
  dialogTitle,
  dialogDescription,
  submitLabel,
  dialogSize,
  schema,
  defaultValues,
  onCreate,
  toOption = (entity) => ({ value: entity.id, label: entity.name }),
  children,
  ...triggerProps
}) {
  const { t } = useTranslation();
  const canCreate = usePermission(permission);
  const [open, setOpen] = useState(false);

  /**
   * The record just created, held only until the invalidated list query comes
   * back carrying it.
   *
   * This is NOT a second cache. Without it there is a visible gap between "the
   * server confirmed the new supplier" and "the refetched options contain it",
   * during which the field the user just filled would appear empty and look
   * like the creation failed.
   */
  const [pending, setPending] = useState(null);

  const mergedOptions =
    pending && !options.some((option) => option.value === pending.value)
      ? [pending, ...options]
      : options;

  // Once the real list carries it, stop shadowing.
  useEffect(() => {
    if (pending && options.some((option) => option.value === pending.value)) setPending(null);
  }, [options, pending]);

  const { form, submit } = useZodForm({
    schema,
    defaultValues,
    onSubmit: async (values) => {
      const created = await onCreate(values);
      // Defensive: a caller whose mutation resolves with nothing would
      // otherwise blank the field it was meant to fill.
      if (!created) return;

      const option = toOption(created);
      setPending(option);
      onChange?.(option.value);
      setOpen(false);
      form.reset(defaultValues);
    },
    // Field-level failures are mapped onto the dialog's own fields by
    // `useZodForm`; anything else surfaces above them, and the dialog STAYS
    // OPEN so the user keeps what they typed.
    onError: (error) => form.setError('root.server', { type: 'server', message: error.message }),
  });

  const close = (next) => {
    setOpen(next);
    if (!next) form.reset(defaultValues);
  };

  return (
    <>
      <Combobox
        options={mergedOptions}
        value={value}
        onChange={onChange}
        onSearchChange={onSearchChange}
        loading={loading}
        disabled={disabled}
        invalid={invalid}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
        className={className}
        {...triggerProps}
        footer={
          canCreate
            ? ({ close: closePopover }) => (
                <button
                  type="button"
                  onClick={() => {
                    // The popover must go first: leaving it mounted would put a
                    // dialog inside a popover, and the two would fight over
                    // focus and over which one Escape belongs to.
                    closePopover();
                    setOpen(true);
                  }}
                  className={
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium ' +
                    'text-brand-700 transition-colors hover:bg-brand-50 ' +
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                  }
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {createLabel ?? t('patterns.createRelated.action')}
                </button>
              )
            : undefined
        }
      />

      <FormDialog
        open={open}
        onOpenChange={close}
        title={dialogTitle ?? createLabel ?? t('patterns.createRelated.action')}
        description={dialogDescription}
        submitLabel={submitLabel ?? t('common.actions.create')}
        size={dialogSize}
        onSubmit={submit}
        loading={form.formState.isSubmitting}
        error={form.formState.errors.root?.server}
      >
        {children?.(form)}
      </FormDialog>
    </>
  );
}
