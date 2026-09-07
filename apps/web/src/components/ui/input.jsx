import * as LabelPrimitive from '@radix-ui/react-label';

import { cn } from '@/lib/utils';

/**
 * Input, Textarea and Label — `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * `invalid` drives both the border and `aria-invalid`, so a validation failure
 * is announced to a screen reader rather than only coloured red.
 *
 * Both controls stay uncontrolled and prop-transparent: React Hook Form's
 * `register()` spreads `name`, `onChange`, `onBlur` and `ref` straight through,
 * and `Field` supplies `id` and `aria-describedby`. Nothing here intercepts any
 * of them — no floating label, no wrapper that would need a `Controller`.
 *
 * STATES. Four have to be told apart at a glance in a long data-entry session:
 *
 *   rest      hairline border on white
 *   focus     brand border, plus the global 2px focus ring
 *   invalid   destructive border, and the ring turns destructive too — the
 *             ring is what the eye follows on tab, so leaving it brand-blue
 *             would say "fine" about a field that is not
 *   disabled   grey field, greyed text
 *
 * `read-only` is styled like disabled but stays focusable and copyable, which
 * is what the derived-field pattern needs: a value the user may read and copy
 * but not author.
 */

const fieldClasses =
  'flex w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs ' +
  'transition-colors placeholder:text-neutral-400 ' +
  'focus-visible:border-brand-500 ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-neutral-50 disabled:text-muted-foreground ' +
  'read-only:bg-neutral-50 read-only:text-muted-foreground ' +
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive';

export function Input({ className, type = 'text', invalid = false, ...props }) {
  return (
    <input
      type={type}
      className={cn(fieldClasses, 'h-9 py-2', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Textarea({ className, invalid = false, rows = 4, ...props }) {
  return (
    <textarea
      rows={rows}
      className={cn(fieldClasses, 'min-h-20 resize-y py-2', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Label({ className, required = false, children, ...props }) {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm leading-none font-medium text-foreground', className)}
      {...props}
    >
      {children}
      {/* Colour alone does not mark a required field: the asterisk is the
          signal and the colour only reinforces it. It is `aria-hidden`
          because `Field` already sets `required` on the control itself. */}
      {required ? (
        <span className="ml-0.5 text-destructive" aria-hidden="true">
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
}
