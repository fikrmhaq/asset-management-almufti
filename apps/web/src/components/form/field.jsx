import { useId } from 'react';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/input';

/**
 * Form field wrapper — `IMPLEMENTATION_PLAN.md` §15.6.
 *
 * Owns the label/description/error wiring that every field needs and that is
 * easy to get subtly wrong: the label's `htmlFor`, `aria-describedby` pointing at
 * both the hint and the message, and `aria-invalid` on the control itself.
 *
 * Children are a render function receiving those ids and the invalid flag, so
 * this works with a plain `<Input>`, a `<Combobox>` or a `<DatePicker>` without
 * knowing anything about them.
 */
export function Field({ label, error, hint, required = false, className, children }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const invalid = Boolean(error);

  const describedBy = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      ) : null}

      {children({
        id,
        invalid,
        'aria-describedby': describedBy || undefined,
      })}

      {hint && !invalid ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {invalid ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Errors the server reported that belong to no single field — a cross-field
 * rule, or a `CONFLICT`. Rendered above the form so they cannot be missed.
 */
export function FormErrorSummary({ error, className }) {
  if (!error?.message) return null;

  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive',
        className
      )}
    >
      {error.message}
    </div>
  );
}
