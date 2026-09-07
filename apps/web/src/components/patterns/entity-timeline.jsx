import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatDateTime } from '@/lib/dates';

/**
 * A chronological list of things that happened to one record.
 *
 * PRESENTATION ONLY, and deliberately so. This component invents no events,
 * names no lifecycle states, and knows nothing about what the domain considers
 * a transition. It renders whatever items it is handed, in the order it is
 * handed them.
 *
 * That restraint is not laziness. The one real consumer in the domain today is
 * `LongitudinalHistory` (`GET /asset-units/:id/history`), which stores condition,
 * location and lifecycle state TOGETHER in a single row rather than as separate
 * event types (`03-domain.md` §4.12). A timeline that assumed a vocabulary of
 * event kinds would have to invent one, and `07-ui.md` §5.3 is explicit that the
 * history tab renders those combined rows as they are. So the shape here is the
 * generic one — title, time, actor, detail — and the Asset Unit module maps its
 * own rows onto it when it migrates.
 *
 * Ordering is the CALLER'S responsibility: `07-ui.md` §5.3 wants newest first,
 * but that is a property of the query, and re-sorting here would silently
 * disagree with a server that had been asked for something else.
 *
 * @param {object} props
 * @param {{id: string, title: React.ReactNode, timestamp?: string,
 *          actor?: React.ReactNode, description?: React.ReactNode,
 *          badge?: React.ReactNode, meta?: React.ReactNode}[]} props.items
 */
export function EntityTimeline({
  items = [],
  isLoading = false,
  error = null,
  onRetry,
  emptyTitle,
  emptyDescription,
  className,
}) {
  const { t } = useTranslation();

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isLoading) return <LoadingState variant="list" label={t('common.states.loading')} />;
  if (items.length === 0) {
    return (
      <EmptyState
        title={emptyTitle ?? t('patterns.timeline.empty')}
        description={emptyDescription}
      />
    );
  }

  return (
    <ol className={cn('relative space-y-0', className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* The rail and its node. Both decorative: the ordered list is what
                actually communicates sequence to a screen reader. */}
            <div className="flex flex-col items-center" aria-hidden="true">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500 ring-4 ring-brand-50" />
              {isLast ? null : <span className="mt-1 w-px grow bg-border" />}
            </div>

            <div className="min-w-0 flex-1 space-y-1 pb-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-foreground">{item.title}</span>
                {item.badge}
              </div>

              {item.description ? (
                <p className="text-sm break-words text-muted-foreground">{item.description}</p>
              ) : null}

              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {item.timestamp ? (
                  // A machine-readable time as well as a formatted one, so the
                  // value is not only available as prose.
                  <time dateTime={item.timestamp}>{formatDateTime(item.timestamp)}</time>
                ) : null}
                {item.actor ? (
                  <>
                    {item.timestamp ? <span aria-hidden="true">·</span> : null}
                    <span>{item.actor}</span>
                  </>
                ) : null}
              </p>

              {item.meta}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
