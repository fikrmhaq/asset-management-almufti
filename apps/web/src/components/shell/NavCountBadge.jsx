import { useActionsNeededCount, useUpdatesCount } from '@/hooks/useActionsNeededCount';
import { cn } from '@/lib/utils';

/**
 * A count on a navigation entry — P5 + P6 (`IMPLEMENTATION_PLAN.md` §64.5,
 * §64.6). Two sources, deliberately styled apart and never merged:
 *
 *   actionsNeeded  "Needs my action (3)" — a solid pill: it asks something of you.
 *   updates        "Updates • 2" — quiet muted text: it only tells you something.
 *
 * Nothing at zero. The number is spoken as "(3)" after the label, so the link's
 * accessible name carries it in both rail widths.
 */
const useNoCount = () => 0;
const SOURCES = {
  actionsNeeded: { useCount: useActionsNeededCount, quiet: false },
  updates: { useCount: useUpdatesCount, quiet: true },
};

export function NavCountBadge({ source, collapsed = false }) {
  // One source per entry, fixed for its lifetime, so the hook order is stable.
  const { useCount = useNoCount, quiet = false } = SOURCES[source] ?? {};
  const count = useCount();
  if (!count) return null;

  return (
    <>
      <span className="sr-only"> ({count})</span>
      <span
        aria-hidden="true"
        data-testid={`nav-count-${source}`}
        className={cn(
          'text-[0.6875rem] font-semibold leading-none',
          quiet
            ? cn(
                'text-muted-foreground',
                collapsed
                  ? 'absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-neutral-400 text-[0px]'
                  : 'ml-auto'
              )
            : cn(
                'rounded-full bg-primary text-primary-foreground',
                collapsed
                  ? 'absolute top-1 right-1 min-w-4 px-1 py-0.5 text-center'
                  : 'ml-auto px-1.5 py-0.5'
              )
        )}
      >
        {quiet ? `• ${count}` : count}
      </span>
    </>
  );
}
