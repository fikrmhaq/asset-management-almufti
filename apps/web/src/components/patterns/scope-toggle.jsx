import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * Direct contents versus everything inside — the reusable form of the control
 * the Locations detail page already has.
 *
 * The distinction is the whole point of the revision that introduced it: viewing
 * a building must be able to show the units in its rooms WITHOUT claiming they
 * are in the lobby. `all` widens to descendants at any depth; `direct` narrows
 * to records whose location is exactly this one. Neither value counts levels,
 * and nothing here knows how deep the hierarchy goes.
 *
 * The stored location of a record never changes with this control. It is a
 * question about the view, not an edit — which is why it is a toggle beside the
 * data rather than anything that looks like a form field.
 *
 * A segmented pair of `aria-pressed` buttons, matching `LanguageSwitcher`: two
 * options that act immediately, exactly one of which is on. The pressed state is
 * carried by `aria-pressed` and by weight as well as by fill, so it is not
 * announced only to sighted users nor signalled only by colour.
 *
 * @param {object} props
 * @param {'all'|'direct'} props.value
 * @param {(value: 'all'|'direct') => void} props.onChange
 * @param {{all?: React.ReactNode, direct?: React.ReactNode}} [props.labels]
 *   Override where a module has better words than "Everything inside" — the
 *   Locations page says "Here only" for `direct`, and a future Assets page may
 *   want something else again.
 */
export function DirectVsDescendantToggle({ value = 'all', onChange, labels, label, className }) {
  const { t } = useTranslation();

  const options = [
    { value: 'all', label: labels?.all ?? t('patterns.scope.all') },
    { value: 'direct', label: labels?.direct ?? t('patterns.scope.direct') },
  ];

  return (
    <div
      role="group"
      aria-label={label ?? t('patterns.scope.label')}
      className={cn('inline-flex overflow-hidden rounded-md border border-border', className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange?.(option.value)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              index > 0 && 'border-l border-border',
              selected
                ? 'bg-brand-50 font-semibold text-brand-700'
                : 'bg-background text-muted-foreground hover:bg-neutral-50 hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
