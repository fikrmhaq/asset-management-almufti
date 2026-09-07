import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormErrorSummary } from '@/components/form/field';

/**
 * A create/edit form in a dialog — `IMPLEMENTATION_PLAN.md` §17.
 *
 * `07-ui.md` §4.3 prefers a full page for anything beyond about four fields, and
 * §5.1 defines only List and Detail/Edit routes for the organization resources —
 * no `/new` route to put a full page on. These forms are short (an institution
 * is three fields, a department two, a role two), so a dialog is the right shape
 * and no route needs inventing.
 *
 * Submission never closes optimistically: the caller closes on success, because
 * the server can legitimately reject with a `CONFLICT` and closing first would
 * hide it (§4.3).
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  cancelLabel,
  onSubmit,
  loading = false,
  error,
  children,
  className,
  size,
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size} className={className}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <FormErrorSummary error={error} />

          <div className="space-y-4">{children}</div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {cancelLabel ?? t('common.actions.cancel')}
            </Button>
            <Button type="submit" loading={loading}>
              {submitLabel ?? t('common.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
