import { useId } from 'react';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/states';

/**
 * A value the SYSTEM determines, shown where a form field would be.
 *
 * The motivating case is Transaction → Contract → Supplier: once a contract is
 * chosen, its supplier is decided, and asking the user to pick one again invites
 * a mismatch the domain does not allow. (The Contract/Supplier wiring itself
 * belongs to the Operations module, not here.)
 *
 * DELIBERATELY NOT A DISABLED INPUT. A greyed-out `<input disabled>` says "you
 * are not allowed to touch this", which is wrong twice over: it implies a
 * permission problem, and it makes the text unselectable in several browsers
 * when the whole point is that the user should be able to read and copy it. This
 * renders the value as TEXT on a muted surface — selectable, copyable, never
 * focus-trapping, and never submitted, because there is no control here to
 * submit. The form still sends whatever the parent put in its own state.
 *
 * The lock glyph and the explanation are the two channels that say "derived".
 * Neither is colour.
 *
 * @param {object} props
 * @param {React.ReactNode} props.label
 * @param {React.ReactNode} [props.value] the derived value; omit while unknown
 * @param {React.ReactNode} [props.explanation]
 *   WHY this filled itself in — "Determined by the selected contract." Rendered
 *   as a quiet inline `Alert`, because the user did not ask for this value and
 *   is owed a reason for it.
 * @param {boolean} [props.loading] the source is chosen but the value is in flight
 * @param {React.ReactNode} [props.emptyLabel]
 *   Shown when there is nothing to derive from yet — a prompt, not an error.
 */
export function DerivedField({
  label,
  value,
  explanation,
  loading = false,
  emptyLabel,
  className,
  id,
}) {
  const { t } = useTranslation();
  const generatedId = useId();
  const valueId = id ?? generatedId;
  const hasValue = value !== null && value !== undefined && value !== '';

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* A `<span>`, not a `<label>`: there is no form control here to label,
          and a `<label>` pointing at nothing is a promise to assistive
          technology that the markup does not keep. The association is made
          with `aria-labelledby` below instead. */}
      {label ? (
        <span
          id={`${valueId}-label`}
          className="block text-sm leading-none font-medium text-foreground"
        >
          {label}
        </span>
      ) : null}

      {/*
        `aria-readonly` rather than `aria-disabled`: the distinction matters to a
        screen-reader user. Disabled means "not available to you"; read-only
        means "available, but not yours to set".
      */}
      <div
        id={valueId}
        aria-labelledby={label ? `${valueId}-label` : undefined}
        aria-readonly="true"
        aria-busy={loading || undefined}
        className={cn(
          'flex min-h-9 items-center gap-2 rounded-md border border-border bg-neutral-50 px-3 py-2 text-sm',
          !hasValue && !loading && 'text-muted-foreground'
        )}
      >
        <Lock className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden="true" />
        {loading ? (
          <Skeleton className="h-4 w-40" />
        ) : (
          <span className="min-w-0 break-words">
            {hasValue ? value : (emptyLabel ?? t('patterns.derived.pending'))}
          </span>
        )}
      </div>

      {explanation ? (
        <Alert variant="info" size="sm">
          {explanation}
        </Alert>
      ) : null}
    </div>
  );
}
