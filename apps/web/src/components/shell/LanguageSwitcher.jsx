import { useTranslation } from 'react-i18next';

import { changeLanguage, LANGUAGES } from '@/i18n';
import { cn } from '@/lib/utils';

/**
 * English ↔ Bahasa Indonesia — `07-ui.md` §1.3.
 *
 * A two-state segmented control rather than a dropdown: there are exactly two
 * languages, and a `<select>` for two options costs a click to discover what a
 * pair of visible buttons already says. Deliberately quiet — it sits beside the
 * user menu and is not something anyone needs twice.
 *
 * The choice is written to `localStorage` by `changeLanguage`, so it survives a
 * reload. Nothing else in the application reads the current language; every
 * screen goes through `t()`.
 */
export function LanguageSwitcher({ className }) {
  const { t, i18n } = useTranslation();
  const active = i18n.resolvedLanguage;

  return (
    <div
      role="group"
      aria-label={t('common.language.change')}
      className={cn('inline-flex overflow-hidden rounded-md border border-border', className)}
    >
      {LANGUAGES.map((language) => {
        const selected = language.code === active;

        return (
          <button
            key={language.code}
            type="button"
            // `aria-pressed` and not a radio group: these are two buttons that
            // act immediately, and only one is ever pressed.
            aria-pressed={selected}
            // The short form is what is visible; the full name is what is read.
            aria-label={language.label}
            title={language.label}
            onClick={() => changeLanguage(language.code)}
            className={cn(
              'px-2 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              selected
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {language.short}
          </button>
        );
      })}
    </div>
  );
}
