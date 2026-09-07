import { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { addYears, endOfYear, format, startOfYear, subYears } from 'date-fns';
import { CalendarIcon, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { dateLocale } from '@/i18n';
import { cn } from '@/lib/utils';
import { toDate, toIsoDate } from '@/lib/dates';
import { Button } from './button';

/**
 * Date picker — `IMPLEMENTATION_PLAN.md` §15.4, `07-ui.md` §1.2.
 *
 * The value in and out is a `YYYY-MM-DD` string; `Date` objects exist only
 * inside the calendar itself. See `lib/dates.js` for why.
 *
 * STYLING. `react-day-picker` v10 ships no styles of its own — the library's
 * stylesheet is opt-in, and without one the calendar renders as an unstyled
 * table. Rather than import `react-day-picker/style.css` and then fight it with
 * overrides, every element is styled through `classNames` using the same design
 * tokens as the rest of `components/ui`. Tailwind v4 here is CSS-first (no
 * config file, `@theme` in `index.css`), so a vendored stylesheet would be the
 * only piece of the interface not built from those tokens, and dark mode or a
 * token change would silently pass it by.
 */

/**
 * Element-by-element styling, keyed by `react-day-picker`'s own UI names.
 *
 * Sized in `rem` rather than fixed pixels so the grid keeps its shape when the
 * browser's font size is larger, and every interactive element is at least
 * 2.25rem square — a calendar of 2rem targets is unusable on a touch screen.
 */
const CALENDAR_CLASS_NAMES = {
  root: 'w-fit',
  months: 'relative flex flex-col gap-4',
  month: 'space-y-3',
  month_caption: 'flex h-8 items-center justify-center px-9',
  caption_label: 'text-sm font-medium text-foreground',
  dropdowns: 'flex items-center justify-center gap-1.5 text-sm font-medium',
  dropdown_root: 'relative',
  dropdown:
    'h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-xs ' +
    'transition-colors hover:border-border-strong ' +
    'focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
  button_previous:
    'inline-flex h-8 w-8 items-center justify-center rounded-md border border-input ' +
    'bg-background text-muted-foreground shadow-xs transition-colors ' +
    'hover:border-border-strong hover:bg-neutral-50 hover:text-foreground ' +
    'disabled:pointer-events-none disabled:opacity-40 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  button_next:
    'inline-flex h-8 w-8 items-center justify-center rounded-md border border-input ' +
    'bg-background text-muted-foreground shadow-xs transition-colors ' +
    'hover:border-border-strong hover:bg-neutral-50 hover:text-foreground ' +
    'disabled:pointer-events-none disabled:opacity-40 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  chevron: 'h-4 w-4 fill-current',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  weekday: 'w-9 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase',
  weeks: '',
  week: 'mt-1 flex w-full',
  day: 'h-9 w-9 p-0 text-center text-sm',
  day_button:
    'h-9 w-9 rounded-md font-normal text-foreground transition-colors ' +
    'hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40',
  // Selection has to win over hover, or the chosen day loses its fill on hover.
  selected:
    '[&>button]:bg-primary [&>button]:font-medium [&>button]:text-primary-foreground ' +
    '[&>button]:hover:bg-primary-hover [&>button]:hover:text-primary-foreground',
  // Today is marked with a ring and a weight change, not a fill — a filled
  // "today" competes with the selected day, and on the common case where they
  // are the same date one of the two has to give way.
  today:
    '[&>button]:font-semibold [&>button]:text-brand-700 ' +
    '[&:not([data-selected])>button]:ring-1 [&:not([data-selected])>button]:ring-brand-300 ' +
    '[&:not([data-selected])>button]:ring-inset',
  outside: 'text-neutral-400',
  disabled: 'text-neutral-300',
  hidden: 'invisible',
};

/** The calendar itself, so a range picker could reuse the styling later. */
export function Calendar({ className, ...props }) {
  return (
    <DayPicker className={cn('p-1', className)} classNames={CALENDAR_CLASS_NAMES} {...props} />
  );
}

/**
 * How far the year dropdown reaches when the field declares no bound.
 *
 * These MUST be set explicitly. `captionLayout="dropdown"` otherwise defaults to
 * "100 years back, end of the current year", which would leave a borrowing due
 * back in January unreachable — the calendar would simply refuse to go there.
 * Backwards covers migrated historical procurement; forwards covers expected
 * return dates and future contract periods.
 */
const YEARS_BACK = 50;
const YEARS_FORWARD = 10;

/**
 * The navigable window: the default range, widened if necessary to include the
 * value being edited. A record dated outside the window must still be visible in
 * its own calendar — otherwise editing anything else about it silently cannot
 * show its date.
 */
function navigableRange(selected, minDate, maxDate) {
  const today = new Date();

  let start = minDate ?? startOfYear(subYears(today, YEARS_BACK));
  let end = maxDate ?? endOfYear(addYears(today, YEARS_FORWARD));

  if (selected && selected < start) start = startOfYear(selected);
  if (selected && selected > end) end = endOfYear(selected);

  return { start, end };
}

/**
 * @param {object} props
 * @param {string} [props.value] the current date as `YYYY-MM-DD`
 * @param {(value: string|null) => void} [props.onChange] receives `YYYY-MM-DD` or `null`
 * @param {boolean} [props.clearable]
 *   Offers a clear control. For OPTIONAL fields only — on a required field it
 *   would offer a state the form then rejects.
 * @param {string} [props.min] earliest selectable date, `YYYY-MM-DD`
 * @param {string} [props.max] latest selectable date, `YYYY-MM-DD`
 * @param {object} [props.locale] a date-fns locale, for month and weekday names
 */
export function DatePicker({
  value,
  onChange,
  placeholder,
  disabled = false,
  invalid = false,
  displayFormat = 'd MMM yyyy',
  clearable = false,
  clearLabel,
  min,
  max,
  locale,
  className,
  ...props
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The calendar's month and weekday names follow the interface language unless
  // a caller overrides them.
  const calendarLocale = locale ?? dateLocale();
  const selected = toDate(value);
  const minDate = toDate(min);
  const maxDate = toDate(max);

  // A calendar opening on today when the value is a 2019 contract date is a
  // navigation task; opening on the value itself is not.
  const defaultMonth = selected ?? maxDate ?? undefined;
  const { start, end } = navigableRange(selected, minDate, maxDate);

  // `startMonth`/`endMonth` bound what can be REACHED; these bound what can be
  // CHOSEN. Both are needed: the month containing `min` is reachable, and half
  // of it is still an invalid choice.
  const outOfRange = [
    minDate ? { before: minDate } : null,
    maxDate ? { after: maxDate } : null,
  ].filter(Boolean);

  return (
    <div className={cn('relative', className)}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(
              'w-full justify-start gap-2 font-normal aria-[invalid=true]:border-destructive',
              !selected && 'text-muted-foreground',
              // Room for the clear control, so a long date cannot slide under it.
              clearable && selected && !disabled && 'pr-9'
            )}
            {...props}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
            <span className="truncate">
              {selected
                ? format(selected, displayFormat, { locale: calendarLocale })
                : (placeholder ?? t('common.date.pick'))}
            </span>
          </Button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            // Radix flips and shifts the panel to stay on screen; the padding
            // keeps it off the very edge on a narrow viewport, where a calendar
            // opened from a right-hand field would otherwise be clipped.
            collisionPadding={8}
            className={
              'z-50 max-w-[calc(100vw-1rem)] overflow-auto rounded-md border border-border ' +
              'bg-popover p-2 text-popover-foreground shadow-md'
            }
          >
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={defaultMonth}
              startMonth={start}
              endMonth={end}
              disabled={outOfRange.length > 0 ? outOfRange : undefined}
              locale={calendarLocale}
              // Month and year dropdowns: reaching a date years back is two
              // selections rather than one click per month.
              captionLayout="dropdown"
              autoFocus
              onSelect={(date) => {
                onChange?.(toIsoDate(date));
                setOpen(false);
              }}
            />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      {/* Outside the trigger, not inside it: a button within a button is invalid
          and the inner one would never receive the click. */}
      {clearable && selected && !disabled ? (
        <button
          type="button"
          aria-label={clearLabel ?? t('common.date.clear')}
          onClick={() => onChange?.(null)}
          className={
            'absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center ' +
            'justify-center rounded-md text-muted-foreground transition-colors ' +
            'hover:bg-accent hover:text-foreground focus-visible:outline-2 ' +
            'focus-visible:outline-offset-2 focus-visible:outline-ring'
          }
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
