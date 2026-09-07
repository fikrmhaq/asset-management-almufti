import { z } from 'zod';

import { Input, Textarea } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/form/field';
import { useInstitutionOptions, useUserOptions } from './referenceOptions';
import { useTranslation } from 'react-i18next';

/**
 * The borrowing header fields — `IMPLEMENTATION_PLAN.md` §20.2, §20.3;
 * REQ-BORROW-001–005.
 *
 * One definition, used by the create page and by the inline DRAFT editor on the
 * detail page (`DEC-042`). Two copies of seven fields and their validation would
 * drift the first time a rule changed.
 *
 * `borrowerName` and `borrowerContact` are both required because both columns
 * are NOT NULL (`04-data-model.md` §5.5.1): REQ-BORROW-002 wants the record to
 * identify who holds the item, and a name with no way to reach them does not.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'is required');

export const borrowingSchema = z
  .object({
    borrowerName: z.string().trim().min(1, 'is required').max(255),
    borrowerContact: z.string().trim().min(1, 'is required').max(5000),
    borrowDate: isoDate,
    expectedReturnDate: isoDate,
    responsiblePersonId: z.string().optional(),
    institutionId: z.string().optional(),
    description: z.string().trim().max(5000).optional(),
  })
  // Mirrors `chk_borrowings_return_after_borrow` (`04-data-model.md` §5.5.1), so
  // the impossible date range is caught before the request rather than after.
  .refine((values) => values.expectedReturnDate >= values.borrowDate, {
    path: ['expectedReturnDate'],
    message: 'must be on or after the borrow date',
  });

export const emptyBorrowing = {
  borrowerName: '',
  borrowerContact: '',
  borrowDate: '',
  expectedReturnDate: '',
  responsiblePersonId: '',
  institutionId: '',
  description: '',
};

/** Form values → request body. Blank optional fields are omitted, not nulled. */
export function toBorrowingBody(values) {
  return {
    borrowerName: values.borrowerName,
    borrowerContact: values.borrowerContact,
    borrowDate: values.borrowDate,
    expectedReturnDate: values.expectedReturnDate,
    responsiblePersonId: values.responsiblePersonId || undefined,
    institutionId: values.institutionId || undefined,
    description: values.description || undefined,
  };
}

export function BorrowingFields({ form, disabled = false, institutionRequired = false }) {
  const { t } = useTranslation();
  const { register, setValue, watch, formState } = form;
  const { errors } = formState;

  const users = useUserOptions();
  const institutions = useInstitutionOptions();

  const setDate = (name) => (value) =>
    setValue(name, value ?? '', { shouldValidate: true, shouldDirty: true });

  const select = (name, options, placeholder) => (fieldProps) => {
    const { invalid, ...domProps } = fieldProps;

    return (
      <select
        {...domProps}
        {...register(name)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm aria-[invalid=true]:border-destructive disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label={t('operations.borrowings.borrower')}
        error={errors.borrowerName?.message}
        required
      >
        {(fieldProps) => (
          <Input {...fieldProps} {...register('borrowerName')} disabled={disabled} />
        )}
      </Field>

      <Field
        label={t('operations.borrowings.borrowerContact')}
        error={errors.borrowerContact?.message}
        hint={t('operations.borrowings.borrowerContactHint')}
        required
      >
        {(fieldProps) => (
          <Input {...fieldProps} {...register('borrowerContact')} disabled={disabled} />
        )}
      </Field>

      <Field
        label={t('operations.borrowings.borrowDate')}
        error={errors.borrowDate?.message}
        required
      >
        {(fieldProps) => (
          <DatePicker
            {...fieldProps}
            value={watch('borrowDate')}
            onChange={setDate('borrowDate')}
            disabled={disabled}
            placeholder={t('operations.borrowings.borrowDate')}
          />
        )}
      </Field>

      <Field
        label={t('operations.borrowings.expectedReturn')}
        error={errors.expectedReturnDate?.message}
        required
      >
        {(fieldProps) => (
          <DatePicker
            {...fieldProps}
            value={watch('expectedReturnDate')}
            onChange={setDate('expectedReturnDate')}
            disabled={disabled}
            placeholder={t('operations.borrowings.expectedReturn')}
            // The schema already refuses a return before the borrow date, as
            // does `chk_borrowings_return_after_borrow`. This stops the calendar
            // OFFERING those days at all, so the rule is visible before the
            // submit rather than only after it. It does not replace either check.
            min={watch('borrowDate') || undefined}
          />
        )}
      </Field>

      {users.allowed ? (
        <Field
          label={t('operations.borrowings.responsiblePerson')}
          error={errors.responsiblePersonId?.message}
          hint={t('operations.borrowings.responsiblePersonHint')}
        >
          {select('responsiblePersonId', users.options, 'No responsible person')}
        </Field>
      ) : null}

      {institutions.allowed ? (
        <Field
          label={t('common.fields.institution')}
          error={errors.institutionId?.message}
          hint={
            institutionRequired
              ? 'Required: your role is not scoped to one institution.'
              : 'Defaults to your own.'
          }
          required={institutionRequired}
        >
          {select(
            'institutionId',
            institutions.options,
            institutionRequired ? 'Select an institution' : 'Default to my institution'
          )}
        </Field>
      ) : null}

      <Field
        label={t('common.fields.description')}
        error={errors.description?.message}
        className="sm:col-span-2"
      >
        {(fieldProps) => (
          <Textarea {...fieldProps} {...register('description')} disabled={disabled} />
        )}
      </Field>
    </div>
  );
}
