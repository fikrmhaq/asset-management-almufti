import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Button — `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * `destructive` is reserved for actions with no undo (`07-ui.md` §4.4); a
 * deactivate is `outline` plus a confirm dialog, not a red button.
 *
 * `asChild` renders the styling onto a child element — a `<Link>`, usually — so
 * a navigation control looks like a button without nesting an anchor inside one.
 *
 * HIERARCHY. `outline` and `ghost` are the workhorses — 36 and 19 uses against a
 * single `destructive` — and that is the intended shape: one filled blue action
 * per screen, everything else neutral. The variants below are tuned so `outline`
 * reads as a real control on its own rather than as a disabled primary, because
 * that is what most of the application is actually made of.
 *
 * Filled variants use `--color-primary` (`brand-600`), not the raw logo blue:
 * #008FD7 carries white text at 3.56:1 and fails AA. See `index.css`.
 *
 * Elevation is one hairline shadow on filled controls and none on the rest.
 * A row of admin buttons with real drop shadows reads as a toolbar of cards.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium ' +
    'transition-colors disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  {
    variants: {
      variant: {
        // `bg-primary` is load-bearing: a caller passing `bg-transparent`
        // relies on `twMerge` recognising and dropping it (see `ui.test.jsx`).
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-brand-800',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-danger-700 active:bg-danger-700',
        outline:
          'border border-input bg-background text-foreground shadow-xs hover:border-border-strong hover:bg-neutral-50 active:bg-neutral-100',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-neutral-200 active:bg-neutral-300',
        ghost: 'text-neutral-700 hover:bg-neutral-100 hover:text-foreground active:bg-neutral-200',
        link: 'text-primary underline-offset-4 hover:text-brand-700 hover:underline',
      },
      size: {
        default: 'h-9 px-3.5 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      // A loading button must not be pressable twice: mutations are not
      // optimistic (`07-ui.md` §4.3), so the window between click and response
      // is real and a second submit would be a second write.
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {/* `Slot` merges props onto exactly ONE child, so `asChild` must pass the
          caller's element straight through — adding a spinner beside it would
          give Slot two children and throw. A link styled as a button has no
          loading state anyway. */}
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {children}
        </>
      )}
    </Component>
  );
}

export { buttonVariants };
