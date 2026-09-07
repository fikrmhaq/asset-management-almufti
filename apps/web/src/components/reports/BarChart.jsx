import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * Bar chart — `DEC-048`, `07-ui.md` §5.7.
 *
 * No charting dependency. Every chart the specification names is a bar chart of
 * counts over a small categorical set — lifecycle state, condition,
 * classification — and that is a labelled row with a proportional width.
 * Recharts was neither adopted nor ruled out for a future requirement that
 * genuinely needs one (`GAP-003` is closed by that decision, not by this file).
 *
 * ACCESSIBILITY (`07-ui.md` §8): the label and the count are TEXT, always
 * present and always readable. The bar itself is `aria-hidden` decoration — it
 * conveys nothing the two text nodes do not, so a screen reader gets the numbers
 * rather than a description of a rectangle. That is also why this works in a
 * test: the assertion reads a number, not a pixel.
 */
export function BarChart({ groups = [], emptyLabel, className }) {
  const { t } = useTranslation();
  /* A group the server returned with no label — a unit with no condition
     recorded, say. The caller names it where it has a better word; this is the
     fallback, and it is translated like everything else. */
  const unlabelled = emptyLabel ?? t('reports.values.notRecorded');

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('reports.chartEmpty')}</p>;
  }

  // Bars are scaled against the largest group, not the total: with one dominant
  // category every other bar would otherwise be an invisible sliver.
  const largest = Math.max(...groups.map((group) => group.count), 1);

  return (
    <ul className={cn('space-y-2', className)}>
      {groups.map((group) => {
        const label = group.label ?? unlabelled;

        return (
          <li
            key={String(group.key)}
            className="grid grid-cols-[minmax(6rem,12rem)_1fr_auto] items-center gap-3 text-sm"
          >
            <span className="truncate" title={label}>
              {label}
            </span>

            <span aria-hidden="true" className="h-3 rounded-full bg-muted">
              <span
                className="block h-3 rounded-full bg-primary"
                style={{ width: `${Math.round((group.count / largest) * 100)}%` }}
              />
            </span>

            <span className="tabular-nums">{group.count}</span>
          </li>
        );
      })}
    </ul>
  );
}
