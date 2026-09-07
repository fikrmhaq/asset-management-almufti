import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MapPin, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { locationsApi } from '@/api/assetCore';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { LocationPath, useLocationContext } from './LocationPath';

/**
 * Choose a location from a hierarchy of unknown depth.
 *
 * DEPTH IS NEVER COUNTED. Not here, not anywhere below. The picker drills one
 * level at a time by asking the server for a node's children and stops when the
 * user selects something — which they may do at ANY level. That is the crucial
 * difference from `ClassificationPicker`, which this otherwise mirrors: a
 * classification must be a leaf (`BR-011`), whereas a building, a floor and a
 * cupboard are all perfectly good locations to put a unit in. So every row
 * offers BOTH actions — select this one, or look inside it.
 *
 * `Site → Building → Floor → Wing → Room → Cabinet` and `Campus → Room` are the
 * same code path. No level has a name, a meaning, or a maximum here.
 *
 * TWO WAYS IN, matching the picker users already know:
 *
 *   BROWSE   drill down from the top, with a clickable trail back up
 *   SEARCH   `GET /locations?q=` by name, each hit shown with its full ancestor
 *            path so two rooms called "Lab 2" are told apart
 *
 * `rootId` restricts the whole picker to one subtree. That is what a floor-plan
 * area needs: `REQ-LOC-012` allows an area to represent only a DESCENDANT of the
 * location owning the plan, and offering anything else would only produce a
 * server rejection the user could not have predicted.
 *
 * Built on `GET /locations` (with `rootsOnly`, `q` and `descendantsOf`),
 * `/locations/:id/children` and `/locations/:id/context`. `rootsOnly` was added
 * for this: the hierarchy has no fixed depth and therefore no fixed entry point,
 * and there was previously no way to ask the server where the tree starts.
 */

/** The API's own page cap (`06-api.md` §1.5), matching `useFloorPlan.js`. */
const MAX_ROWS = 100;

/**
 * One column of the drill-down: a node's children, or the top level.
 *
 * The top level is `?rootsOnly=true` — a real server-side filter, so the roots
 * are the roots however many locations exist. This used to fetch a page of
 * everything and filter it client-side for want of that filter, which silently
 * missed any root past the page cap.
 *
 * ONE ENVELOPE FOR BOTH. `GET /locations` and `GET /locations/:id/children` are
 * both collections and both answer `{ data, meta }`, so this reads them the same
 * way whichever level it is on. The children endpoint used to answer in the ITEM
 * envelope instead, and reading it as a list produced `undefined` — every node
 * below the top level came back empty, and no location except a root could be
 * chosen. The endpoint was the thing that was wrong, and it was fixed there
 * rather than papered over here.
 */
function useLevel(parentId, { enabled }) {
  return useQuery({
    queryKey: parentId
      ? queryKeys.locations.sub(parentId, 'children')
      : queryKeys.locations.list({ rootsOnly: true }),
    queryFn: () =>
      parentId
        ? locationsApi.children(parentId)
        : locationsApi.list({ rootsOnly: true, status: 'active', pageSize: MAX_ROWS }),
    enabled,
  });
}

function useLocationSearch(term, rootId) {
  const trimmed = term.trim();

  return useQuery({
    queryKey: queryKeys.locations.list({ q: trimmed, within: rootId ?? null }),
    queryFn: () =>
      locationsApi.list({
        q: trimmed,
        status: 'active',
        pageSize: MAX_ROWS,
        // Searching inside a restricted subtree must not escape it.
        ...(rootId ? { descendantsOf: rootId } : {}),
      }),
    // Two characters is where results stop being the whole table.
    enabled: trimmed.length >= 2,
  });
}

/** The ancestor trail for one search hit — "Lab 2" alone identifies nothing. */
function SearchResultPath({ locationId }) {
  const query = useLocationContext(locationId);
  if (!query.data?.path) return null;

  return (
    <LocationPath
      path={query.data.path.slice(0, -1)}
      linkLast={false}
      className="text-xs text-muted-foreground [&_a]:pointer-events-none"
    />
  );
}

export function LocationPicker({ open, onOpenChange, onSelect, rootId, title }) {
  const { t } = useTranslation();
  /** The trail drilled so far; the last entry's children are on screen. */
  const [path, setPath] = useState([]);
  const [term, setTerm] = useState('');

  const searching = term.trim().length >= 2;
  const parent = path.at(-1) ?? null;
  const levelParentId = parent?.id ?? rootId ?? null;

  const level = useLevel(levelParentId, { enabled: open && !searching });
  const results = useLocationSearch(term, rootId);

  const close = () => {
    onOpenChange?.(false);
    // Next open starts where it started last time, not mid-drill.
    setPath([]);
    setTerm('');
  };

  const choose = (node) => {
    onSelect?.(node);
    close();
  };

  const rows = searching ? (results.data?.data ?? []) : (level.data?.data ?? []);
  const query = searching ? results : level;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange?.(true) : close())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title ?? t('patterns.locationSelector.title')}</DialogTitle>
          <DialogDescription>{t('patterns.locationSelector.description')}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t('patterns.locationSelector.searchPlaceholder')}
            aria-label={t('patterns.locationSelector.searchLabel')}
            className="pl-8"
          />
          {term ? (
            <button
              type="button"
              onClick={() => setTerm('')}
              aria-label={t('patterns.locationSelector.clearSearch')}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* How far in we are. Any segment jumps back to that level. */}
        {!searching ? (
          <nav
            aria-label={t('patterns.locationSelector.trail')}
            className="flex flex-wrap items-center gap-1 text-sm"
          >
            <button
              type="button"
              onClick={() => setPath([])}
              className="rounded-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t('patterns.locationSelector.top')}
            </button>
            {path.map((node, index) => (
              <span key={node.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-neutral-300" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => setPath((current) => current.slice(0, index + 1))}
                  className={cn(
                    'rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    index === path.length - 1
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {node.name}
                </button>
              </span>
            ))}
          </nav>
        ) : null}

        <div className="max-h-80 min-h-40 overflow-y-auto rounded-md border border-border">
          {query.isError ? (
            <ErrorState error={query.error} onRetry={query.refetch} className="border-0" />
          ) : query.isLoading ? (
            <LoadingState variant="list" label={t('patterns.locationSelector.loading')} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={
                searching
                  ? t('patterns.locationSelector.noMatches')
                  : t('patterns.locationSelector.nothingHere')
              }
              description={searching ? t('patterns.locationSelector.noMatchesHint') : undefined}
              icon={MapPin}
              className="rounded-none border-0"
            />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((node) => (
                <li key={node.id} className="flex items-stretch">
                  {/* SELECT. Any node is a valid answer, at any depth. */}
                  <button
                    type="button"
                    onClick={() => choose(node)}
                    className="min-w-0 flex-1 px-3 py-2 text-left text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="block truncate font-medium">{node.name}</span>
                    {searching ? <SearchResultPath locationId={node.id} /> : null}
                  </button>

                  {/* LOOK INSIDE. A separate control, because "choose this" and
                      "show me what is in this" are different intentions and a
                      single row that guessed would get one of them wrong. */}
                  {searching ? null : (
                    <button
                      type="button"
                      onClick={() => setPath((current) => [...current, node])}
                      aria-label={t('patterns.locationSelector.openInside', { name: node.name })}
                      className="flex shrink-0 items-center border-l border-border px-3 text-muted-foreground hover:bg-neutral-50 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The form field: a trigger showing the chosen location IN CONTEXT, plus the
 * picker.
 *
 * The trigger shows the full ancestor path, never the bare name, for the same
 * reason `07-ui.md` §4.5 demands it of classifications: "Lab 2" is not an answer
 * to "where is it". The path is loaded through the existing
 * `GET /locations/:id/context`, whose `path` is however long the hierarchy is.
 *
 * `value` is a location id and `onChange` receives an id or `null`, so this
 * drops into React Hook Form through the same `Controller`-free pattern the rest
 * of the application uses: the caller holds the id in form state.
 */
export function LocationSelector({
  value,
  onChange,
  rootId,
  disabled = false,
  invalid = false,
  allowClear = false,
  placeholder,
  id,
  className,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const context = useLocationContext(value, { enabled: Boolean(value) });

  return (
    <div className={cn('relative', className)}>
      <Button
        type="button"
        id={id}
        variant="outline"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          'h-auto w-full justify-start py-2 font-normal',
          'aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive',
          allowClear && value && !disabled && 'pr-9'
        )}
      >
        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {value ? (
          <span className="min-w-0 text-left">
            <span className="block truncate">
              {context.data?.path?.at(-1)?.name ?? t('common.states.loading')}
            </span>
            {context.data?.path?.length > 1 ? (
              <span className="block truncate text-xs text-muted-foreground">
                {context.data.path
                  .slice(0, -1)
                  .map((node) => node.name)
                  .join(' › ')}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-neutral-400">
            {placeholder ?? t('patterns.locationSelector.placeholder')}
          </span>
        )}
      </Button>

      {/* Outside the trigger: a button inside a button is invalid markup and the
          inner one would never receive the click. */}
      {allowClear && value && !disabled ? (
        <button
          type="button"
          onClick={() => onChange?.(null)}
          aria-label={t('patterns.locationSelector.clear')}
          className="absolute top-1/2 right-1 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-neutral-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}

      <LocationPicker
        open={open}
        onOpenChange={setOpen}
        rootId={rootId}
        onSelect={(node) => onChange?.(node.id)}
      />
    </div>
  );
}
