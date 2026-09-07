import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

/**
 * Confirm dialog — `07-ui.md` §4.4, `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * Used ONLY for the deactivate/reactivate action endpoints and other named
 * actions with no undo — `Borrowing.return`, `Transaction` create. Never as a
 * substitute for a form page.
 *
 * Built on Radix `AlertDialog` rather than `Dialog`: an alert dialog takes focus
 * to the confirm action and cannot be dismissed by clicking the overlay, which
 * is the correct behaviour for a decision the user must actually make.
 *
 * A DESTRUCTIVE confirm gets a warning icon as well as a red button. This is the
 * one place in the application where colour alone was carrying the weight of an
 * irreversible decision, and the icon is the second channel — a reader who
 * cannot separate red from blue still sees that this dialog is not like the
 * others.
 */

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = false,
  loading = false,
}) {
  const { t } = useTranslation();

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-neutral-900/50" />
        <AlertDialogPrimitive.Content
          className={
            'fixed top-1/2 left-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-md ' +
            '-translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border ' +
            'bg-background p-6 shadow-lg'
          }
        >
          <div className="flex gap-3">
            {destructive ? (
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger-50"
              >
                <AlertTriangle className="h-4.5 w-4.5 text-danger-600" />
              </span>
            ) : null}

            <div className="min-w-0 space-y-1.5">
              <AlertDialogPrimitive.Title className="text-base leading-tight font-semibold text-foreground">
                {title}
              </AlertDialogPrimitive.Title>

              {description ? (
                <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">
                  {description}
                </AlertDialogPrimitive.Description>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel
              className={cn(buttonVariants({ variant: 'outline' }))}
              disabled={loading}
            >
              {cancelLabel ?? t('common.actions.cancel')}
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              className={cn(buttonVariants({ variant: destructive ? 'destructive' : 'default' }))}
              // Not auto-closed: the caller closes it once the server has
              // answered, because the action can legitimately be rejected
              // (`07-ui.md` §4.3).
              onClick={(event) => {
                event.preventDefault();
                onConfirm?.();
              }}
              disabled={loading}
              aria-busy={loading || undefined}
            >
              {confirmLabel ?? t('common.actions.confirm')}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
