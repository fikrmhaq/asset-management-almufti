import { cva } from 'class-variance-authority';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * Badge — `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * Carries status on list rows and detail headers (`07-ui.md` §4.1, §4.2).
 *
 * COLOUR IS NEVER THE ONLY CHANNEL. Every badge contains a TEXT LABEL naming the
 * state — "Overdue", "On loan", "Damaged" — and `StatusBadge` is what turns the
 * stored enum into exactly that. The colour is a scanning aid layered on top; a
 * reader who cannot separate the hues still reads the state, which is what
 * WCAG 1.4.1 asks for. It is also why there is no icon-only variant.
 *
 * SHAPE, NOT PILL. A rounded rectangle rather than a full pill: these sit in
 * dense table cells beside other rectangular controls, and a row of pills reads
 * as tags the user could add or remove rather than as a state the system
 * reports.
 *
 * Each variant carries a real border rather than a transparent one — on a
 * hovered or tinted table row a borderless tint loses its edge and the badge
 * dissolves into the row.
 *
 * The palette stays deliberately narrow: six variants for every state in the
 * domain. Giving each lifecycle value its own hue would turn a list into a
 * colour chart and stop any single colour from meaning anything.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-brand-200 bg-brand-50 text-brand-700',
        neutral: 'border-neutral-200 bg-neutral-100 text-neutral-700',
        success: 'border-success-200 bg-success-50 text-success-700',
        warning: 'border-warning-200 bg-warning-50 text-warning-foreground',
        destructive: 'border-danger-200 bg-danger-50 text-danger-700',
        outline: 'border-border bg-background text-neutral-700',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * The shared status→variant mapping.
 *
 * Defined once so an `ACTIVE` borrowing and an active asset never end up
 * different colours on different screens. Values are the enums from
 * `04-data-model.md` §4.
 */
const STATUS_VARIANTS = {
  // is_active
  active: 'success',
  inactive: 'neutral',
  // borrowing_status
  DRAFT: 'neutral',
  ACTIVE: 'success',
  RETURNED: 'default',
  OVERDUE: 'destructive',
  CANCELLED: 'neutral',
  // lifecycle_state
  REGISTERED: 'neutral',
  IN_STORAGE: 'default',
  BORROWED: 'warning',
  UNDER_MAINTENANCE: 'warning',
  DISPOSED: 'destructive',
  DEACTIVATED: 'neutral',
  // condition_enum
  GOOD: 'success',
  FAIR: 'default',
  POOR: 'warning',
  DAMAGED: 'destructive',
  UNSERVICEABLE: 'destructive',
};

export function statusVariant(value) {
  return STATUS_VARIANTS[value] ?? 'neutral';
}

/**
 * Which enum a stored value belongs to, so it can be translated.
 *
 * The values are distinct across the three enums except for `ACTIVE`, which is
 * both a lifecycle state ("in use") and a borrowing status ("running"). Callers
 * that know which one they hold pass `kind`; the default order below resolves
 * the rest, and an unknown value falls through to itself rather than vanishing.
 */
const ENUM_GROUPS = ['lifecycle', 'condition', 'borrowing'];

export function statusLabel(t, value, kind) {
  if (value === 'active' || value === 'inactive') return t(`enums.${value}`);
  if (!value) return '';

  const groups = kind ? [kind, ...ENUM_GROUPS] : ENUM_GROUPS;

  for (const group of groups) {
    const key = `enums.${group}.${value}`;
    const translated = t(key);
    if (translated !== key && translated !== value) return translated;
  }

  return value;
}

/**
 * @param {object} props
 * @param {string} props.value the stored enum value — never displayed raw
 * @param {'lifecycle'|'condition'|'borrowing'} [props.kind]
 *   Disambiguates `ACTIVE`, which two enums share.
 */
export function StatusBadge({ value, kind, className }) {
  const { t } = useTranslation();

  return (
    <Badge variant={statusVariant(value)} className={className}>
      {statusLabel(t, value, kind)}
    </Badge>
  );
}

export { badgeVariants, STATUS_VARIANTS };
