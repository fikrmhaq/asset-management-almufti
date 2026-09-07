import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Alert — contextual explanation, in place, about the thing next to it.
 *
 * This is NOT a notification system. A mutation's outcome is a toast
 * (`ui/toast.jsx`); a failed request that replaces a whole region is an
 * `ErrorState`; a rejected field is `Field`'s own message. What was missing is
 * the quiet middle case: text that explains WHY the interface is behaving the
 * way it is — why a value filled itself in, why a control is unavailable until
 * something else is chosen, what a workflow will not allow.
 *
 * NOT COLOUR ALONE. Each variant carries its own icon as well as its own tint
 * and border, so the four are distinguishable without hue. The icons are chosen
 * to be different SHAPES — circle, triangle, circle-with-tick — rather than four
 * recolourings of one glyph.
 *
 * Only `error` gets `role="alert"`. The others are static page furniture that is
 * present from first paint, and announcing them on every render would talk over
 * whatever the user was actually doing. An error appearing IS a change worth
 * interrupting for.
 */
const alertVariants = cva('flex gap-2.5 rounded-md border text-sm', {
  variants: {
    variant: {
      info: 'border-brand-200 bg-brand-50 text-brand-900',
      success: 'border-success-200 bg-success-50 text-success-700',
      warning: 'border-warning-200 bg-warning-50 text-warning-foreground',
      error: 'border-danger-200 bg-danger-50 text-danger-700',
    },
    size: {
      /** A single explanatory line under a control. */
      sm: 'items-center px-2.5 py-1.5 text-xs',
      /** A paragraph at the top of a form or a section. */
      md: 'items-start p-3',
    },
  },
  defaultVariants: { variant: 'info', size: 'md' },
});

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

const ICON_TONE = {
  info: 'text-brand-600',
  success: 'text-success-600',
  warning: 'text-warning-600',
  error: 'text-danger-600',
};

/**
 * @param {object} props
 * @param {'info'|'success'|'warning'|'error'} [props.variant]
 * @param {'sm'|'md'} [props.size]
 * @param {React.ReactNode} [props.title] a heading above the body, `md` only
 * @param {boolean} [props.icon] set false to drop the glyph — do this only where
 *   something else already carries the meaning non-visually
 */
export function Alert({
  variant = 'info',
  size = 'md',
  title,
  icon = true,
  className,
  children,
  ...props
}) {
  const Icon = ICONS[variant] ?? Info;

  return (
    <div
      role={variant === 'error' ? 'alert' : undefined}
      className={cn(alertVariants({ variant, size }), className)}
      {...props}
    >
      {icon ? (
        <Icon
          className={cn(
            'shrink-0',
            ICON_TONE[variant],
            size === 'sm' ? 'h-3.5 w-3.5' : 'mt-0.5 h-4 w-4'
          )}
          aria-hidden="true"
        />
      ) : null}
      <div className="min-w-0 space-y-1">
        {title && size === 'md' ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className="[&_a]:underline [&_a]:underline-offset-2">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
