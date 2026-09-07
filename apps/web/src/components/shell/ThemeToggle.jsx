import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useTheme } from '@/theme/theme';

/**
 * Light / dark / system as a three-way segmented control rather than a cycling
 * button. All three states are visible at once, so the user can see which is
 * active — a single icon that cycles never tells you what pressing it will do,
 * and "system" is impossible to represent that way at all.
 *
 * `radiogroup`, because these are three mutually exclusive choices; a group of
 * plain buttons would announce as three unrelated actions.
 */

const OPTIONS = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

export function ThemeToggle({ className }) {
  const { choice, setChoice } = useTheme();
  const { t } = useTranslation();

  return (
    <div
      role="radiogroup"
      aria-label={t('common.theme.label')}
      className={cn('flex items-center gap-0.5 rounded-md border border-border p-0.5', className)}
    >
      {OPTIONS.map((option) => {
        const { value } = option;
        const Glyph = option.icon;
        const isActive = choice === value;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={t(`common.theme.${value}`)}
            title={t(`common.theme.${value}`)}
            onClick={() => setChoice(value)}
            className={cn(
              'rounded p-1.5 transition-colors',
              isActive
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Glyph aria-hidden="true" className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
