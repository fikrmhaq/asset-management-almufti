import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { normalizeError } from '@/api/errors';

/**
 * Form infrastructure — `IMPLEMENTATION_PLAN.md` §15.6, `07-ui.md` §4.3.
 *
 * React Hook Form with a Zod schema shaped identically to the API's request
 * body, so client-side and server-side validation cannot disagree. The client
 * schema is a convenience that catches mistakes early; the server remains
 * authoritative (`IMPLEMENTATION_PLAN.md` §32).
 */

/**
 * Applies a `VALIDATION_ERROR` response onto the form.
 *
 * `06-api.md` §1.4 gives `details[].field`, which maps directly onto a form
 * field — so a server rejection highlights the offending input rather than
 * showing a generic banner (`07-ui.md` §4.3).
 *
 * A field the form does not have (a cross-field rule, say) would otherwise be
 * lost, so anything unmatched is attached to the form root and displayed above
 * the fields.
 *
 * @returns {boolean} whether the error was a validation failure and was applied
 */
export function applyServerErrors(error, form, { fields } = {}) {
  const normalized = normalizeError(error);
  if (!normalized.isValidation) return false;

  const known = fields ?? Object.keys(form.getValues() ?? {});
  const unmatched = [];

  for (const detail of normalized.details) {
    if (detail?.field && known.includes(detail.field)) {
      form.setError(detail.field, { type: 'server', message: detail.issue });
    } else if (detail?.issue) {
      unmatched.push(detail.field ? `${detail.field}: ${detail.issue}` : detail.issue);
    }
  }

  if (unmatched.length > 0 || normalized.details.length === 0) {
    form.setError('root.server', {
      type: 'server',
      message: unmatched.length > 0 ? unmatched.join('; ') : normalized.message,
    });
  }

  return true;
}

/**
 * `useForm` wired to a Zod schema, plus a submit wrapper that routes server
 * validation errors back onto the fields.
 *
 * @param {{schema: import('zod').ZodType, defaultValues?: object,
 *          onSubmit: (values: object) => Promise<unknown>,
 *          onError?: (error: unknown) => void}} options
 */
export function useZodForm({ schema, defaultValues, onSubmit, onError, ...formOptions }) {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues,
    // Validate on blur rather than on every keystroke: an error appearing under a
    // field the user is still typing into is noise, not help.
    mode: 'onBlur',
    ...formOptions,
  });

  const submit = useCallback(
    (event) =>
      form.handleSubmit(async (values) => {
        form.clearErrors('root.server');

        try {
          return await onSubmit(values);
        } catch (error) {
          if (!applyServerErrors(error, form)) onError?.(error);
          return undefined;
        }
      })(event),
    [form, onSubmit, onError]
  );

  return { form, submit };
}
