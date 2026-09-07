import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

import { normalizeError } from '@/api/errors';
import { t } from '@/i18n';

/**
 * Toasts — `07-ui.md` §7, `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * Mount `<Toaster />` once, at the application root.
 *
 * `toast.fromError` is the reason this file exists rather than importing sonner
 * directly everywhere: the API's `message` is already written to be shown to
 * users (REQ-VAL-006), so every failure toast shows it instead of generic copy,
 * and every screen does that the same way.
 */

export function Toaster(props) {
  return <SonnerToaster position="top-right" closeButton richColors {...props} />;
}

export const toast = {
  success: (message, options) => sonnerToast.success(message, options),
  info: (message, options) => sonnerToast.message(message, options),
  warning: (message, options) => sonnerToast.warning(message, options),
  error: (message, options) => sonnerToast.error(message, options),

  /**
   * Reports a failed mutation.
   *
   * A `VALIDATION_ERROR` is deliberately quiet by default: those are shown
   * inline against the offending field (`07-ui.md` §4.3), and a toast repeating
   * them would be noise on top of the real feedback.
   */
  fromError: (error, { fallback, includeValidation = false } = {}) => {
    const normalized = normalizeError(error);

    if (normalized.isValidation && !includeValidation) return null;

    return sonnerToast.error(normalized.message || fallback || t('common.errors.requestFailed'));
  },
};
