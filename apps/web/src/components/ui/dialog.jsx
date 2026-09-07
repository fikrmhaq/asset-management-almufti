import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * Dialog — `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * For focused interactions only. Anything with more than about four fields is a
 * full page, not a modal (`07-ui.md` §4.3); the classification picker (§4.5) is
 * the motivating in-scope use.
 *
 * Radix supplies focus trapping, restore-on-close, `Esc`, and the ARIA wiring
 * (`07-ui.md` §8), which is why this is a thin wrapper rather than a custom
 * overlay.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay({ className, ...props }) {
  return (
    <DialogPrimitive.Overlay
      // Neutral-900 rather than pure black, and no blur: a blurred backdrop
      // costs a compositing layer on every open and makes the page behind
      // unreadable, when the point is only to push it back a step.
      className={cn('fixed inset-0 z-50 bg-neutral-900/50', className)}
      {...props}
    />
  );
}

/**
 * Widths, because content varies and one fixed width serves none of it well.
 *
 * `md` is the previous fixed `max-w-lg`, so every existing caller is unchanged.
 */
const DIALOG_SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function DialogContent({ className, children, showClose = true, size = 'md', ...props }) {
  const { t } = useTranslation();

  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] ' +
            '-translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border ' +
            'border-border bg-background p-6 shadow-lg',
          DIALOG_SIZES[size] ?? DIALOG_SIZES.md,
          className
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className={
              'absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center ' +
              'rounded-md text-muted-foreground transition-colors hover:bg-neutral-100 ' +
              'hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 ' +
              'focus-visible:outline-ring'
            }
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('common.actions.close')}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

/**
 * The action area.
 *
 * `flex-col-reverse` on narrow screens is deliberate: the primary action is
 * last in the DOM (so it is last in the tab order, after cancel) but appears
 * first on a stacked layout, where the thumb reaches the bottom of the dialog.
 * A rule above it separates the decision from the content it is about.
 */
export function DialogFooter({ className, ...props }) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      // Padded away from the close control so a long title cannot run under it.
      className={cn('pr-8 text-base leading-tight font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
