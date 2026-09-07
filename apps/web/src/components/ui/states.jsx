import { AlertCircle, Ban, FileQuestion, Inbox, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ERROR_CODES } from '@/api/errors';
import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * The three non-happy-path states — `07-ui.md` §4 "Shared states",
 * `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * Every list and detail page uses these rather than inventing its own copy, so
 * "loading", "nothing here" and "something failed" never look the same or read
 * differently from screen to screen.
 */

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-neutral-100', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * The shapes a skeleton can take.
 *
 * A skeleton earns its place only when it stands in for something whose SHAPE
 * the page already knows — a table of N columns, a form of N fields. Where the
 * shape is unknown, a generic pulsing block is decoration pretending to be
 * information, and a plain "Loading…" is more honest.
 *
 * Each variant below therefore mirrors the layout that will replace it, so the
 * page does not visibly re-flow when the data lands.
 */
const SKELETONS = {
  /** Rows of equal-width cells — `DataTable` while its first page loads. */
  table: ({ rows, columns }) => (
    <div className="space-y-2 p-1">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton key={columnIndex} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  ),

  /** Stacked single-line entries — a child-location list, a picker's results. */
  list: ({ rows }) => (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-1">
          <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
          <Skeleton className="h-4 flex-1" style={{ maxWidth: `${70 - (index % 3) * 12}%` }} />
        </div>
      ))}
    </div>
  ),

  /** Label/value pairs in the grid `DetailFieldList` will lay them out in. */
  detail: ({ rows }) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  ),

  /** Full-width label-over-control pairs, as a form page stacks them. */
  form: ({ rows }) => (
    <div className="space-y-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  ),

  /** A heading and a few lines — a section whose contents are not yet known. */
  card: ({ rows }) => (
    <div className="space-y-3">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-3.5" style={{ width: `${92 - index * 14}%` }} />
      ))}
    </div>
  ),
};

/** Sensible row counts per shape, so a caller usually passes only `variant`. */
const DEFAULT_ROWS = { table: 5, list: 4, detail: 6, form: 4, card: 3 };

/**
 * @param {object} props
 * @param {'table'|'list'|'detail'|'form'|'card'} [props.variant]
 *   The shape of the content being waited on. Defaults to `table`, which is
 *   what every existing caller means.
 */
export function LoadingState({ variant = 'table', rows, columns = 4, label, className }) {
  const { t } = useTranslation();
  const render = SKELETONS[variant] ?? SKELETONS.table;

  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      {/* The only thing announced. Everything below is `aria-hidden`, because a
          screen reader reading out a dozen empty boxes is worse than silence. */}
      <span className="sr-only">{label ?? t('common.states.loading')}</span>
      {render({ rows: rows ?? DEFAULT_ROWS[variant] ?? 5, columns })}
    </div>
  );
}

/**
 * Nothing to show — distinct copy from "loading", per §4.
 *
 * Compact and institutional: a dashed outline and a small icon. No illustration
 * and no logo. A brand mark on every empty table would make the absence of data
 * look like a marketing surface, and it is not one.
 *
 * `action` is supplied by the caller and is already permission-gated there
 * (`07-ui.md` §6) — this component never invents a way forward, because it
 * cannot know whether the reader is allowed to take it.
 */
export function EmptyState({ title, description, action, icon = Inbox, className }) {
  const { t } = useTranslation();
  const Icon = icon;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed ' +
          'border-border bg-neutral-25 px-6 py-10 text-center',
        className
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title ?? t('common.states.empty')}</p>
        {description ? (
          <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Per-code presentation — `07-ui.md` §4 requires something more specific than
 * "an error occurred" for at least FORBIDDEN, NOT_FOUND and CONFLICT.
 *
 * `retryable` is the interesting column: a 403 does not become a 200 because
 * the user pressed a button, and offering the button anyway teaches them to
 * distrust it.
 */
const PRESENTATION = {
  [ERROR_CODES.FORBIDDEN]: {
    titleKey: 'states.error.forbidden',
    icon: Lock,
    retryable: false,
  },
  [ERROR_CODES.NOT_FOUND]: {
    titleKey: 'states.error.notFound',
    icon: FileQuestion,
    retryable: false,
  },
  [ERROR_CODES.CONFLICT]: {
    titleKey: 'states.error.conflict',
    icon: Ban,
    retryable: false,
  },
  [ERROR_CODES.UNAUTHORIZED]: {
    titleKey: 'states.error.unauthorized',
    icon: Lock,
    retryable: false,
  },
  [ERROR_CODES.NETWORK_ERROR]: {
    titleKey: 'states.error.network',
    icon: AlertCircle,
    retryable: true,
  },
};

const DEFAULT_PRESENTATION = {
  titleKey: 'states.error.default',
  icon: AlertCircle,
  retryable: true,
};

/**
 * A failure, presented from the API's own error code.
 *
 * Solid danger tint and a danger border — deliberately unlike `EmptyState`'s
 * dashed neutral and unlike anything a warning uses, so "there is nothing here"
 * and "this did not work" are never mistaken for each other at a glance.
 */
export function ErrorState({ error, onRetry, className }) {
  const { t } = useTranslation();
  const { titleKey, icon: Icon, retryable } = PRESENTATION[error?.code] ?? DEFAULT_PRESENTATION;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-danger-200 ' +
          'bg-danger-50 px-6 py-10 text-center',
        className
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-100">
        <Icon className="h-5 w-5 text-danger-700" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-danger-700">{t(titleKey)}</p>
        {/* The API's message is written to be shown to users (REQ-VAL-006). It
            is passed through verbatim — never re-worded, never replaced. */}
        {error?.message ? (
          <p className="max-w-md text-sm text-neutral-700">{error.message}</p>
        ) : null}
      </div>
      {retryable && onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.actions.retry')}
        </Button>
      ) : null}
    </div>
  );
}
