import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

/**
 * Tabs — `IMPLEMENTATION_PLAN.md` §15.4, `07-ui.md` §4.2.
 *
 * Detail pages tab their sub-collections, and each tab loads independently — a
 * user may hold `asset:read` but not `attachment:read`, so one payload for the
 * whole page would fail for a caller who can legitimately see most of it.
 */

export const Tabs = TabsPrimitive.Root;

/**
 * The strip and the rule under it are one thing.
 *
 * The list carries a full-width 1px rule; each trigger carries a 2px underline
 * pulled down by `-mb-px` so the active one sits ON that rule rather than above
 * it. That is what makes the selected tab read as connected to the panel below
 * — the mechanism a pill or a button cannot express, and the reason these are
 * not pills.
 *
 * `overflow-x-auto` keeps a long tab set reachable on a narrow screen instead
 * of wrapping it into a second row that would break the rule in half.
 */
export function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'scrollbar-subtle flex w-full items-center gap-1 overflow-x-auto border-b border-border',
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex shrink-0 items-center border-b-2 border-transparent px-3 py-2 ' +
          'text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors ' +
          'hover:border-neutral-300 hover:text-foreground ' +
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ' +
          // Weight changes with state as well as colour, so the current tab is
          // not identified by hue alone.
          'data-[state=active]:border-brand-500 data-[state=active]:font-semibold ' +
          'data-[state=active]:text-brand-700 ' +
          'disabled:pointer-events-none disabled:text-neutral-300 disabled:hover:border-transparent',
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className
      )}
      {...props}
    />
  );
}
