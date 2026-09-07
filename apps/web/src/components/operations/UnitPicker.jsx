import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';

import { assetsApi } from '@/api/assetCore';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

/**
 * Asset-unit picker — `DEC-041`, `IMPLEMENTATION_PLAN.md` §20.2, §20.5.
 *
 * Two steps, because there is no third option: `06-api.md` §5.2 exposes a unit
 * only by id, and no endpoint lists units globally (`GAP-008`). So the caller
 * finds the ASSET first — using the same `/assets` search every asset screen
 * uses — and then picks among that asset's units.
 *
 * `borrowable` reflects `DEC-013`: activating a borrowing moves each unit
 * `ACTIVE → BORROWED`, and `03-domain.md` §7.1 draws no edge to `BORROWED` from
 * any other state. So a borrowing's picker defaults to `lifecycleState=ACTIVE`
 * and, when that filter is lifted, shows the other units as unselectable with
 * the reason — the restriction belongs here, where the user is choosing, not as
 * a `CONFLICT` discovered later at activation.
 *
 * A transaction has no such restriction: it records something that happened to a
 * unit, whatever state that unit is in.
 */
export function UnitPicker({
  open,
  onOpenChange,
  onSelect,
  multiple = false,
  excludeUnitIds = [],
  borrowable = false,
  title = 'Select an asset unit',
}) {
  const [asset, setAsset] = useState(null);
  const [term, setTerm] = useState('');
  const [activeOnly, setActiveOnly] = useState(borrowable);
  const [selected, setSelected] = useState([]);

  // Reset on every open, so the next selection does not resume mid-drill with a
  // previous asset's units on screen.
  useEffect(() => {
    if (!open) return;
    setAsset(null);
    setTerm('');
    setActiveOnly(borrowable);
    setSelected([]);
  }, [open, borrowable]);

  const assetParams = {
    pageSize: 20,
    status: 'active',
    ...(term.trim() ? { q: term.trim() } : {}),
  };

  const assets = useQuery({
    queryKey: queryKeys.assets.list(assetParams),
    queryFn: () => assetsApi.list(assetParams),
    enabled: open && !asset,
  });

  const unitParams = { pageSize: 100, ...(activeOnly ? { lifecycleState: 'ACTIVE' } : {}) };

  const units = useQuery({
    queryKey: queryKeys.assets.sub(asset?.id, 'units', unitParams),
    queryFn: () => assetsApi.listUnits(asset.id, unitParams),
    enabled: open && Boolean(asset),
  });

  const excluded = new Set(excludeUnitIds);
  const isBlocked = (unit) => borrowable && unit.lifecycleState !== 'ACTIVE';

  const toggle = (unit) => {
    setSelected((current) =>
      current.some((entry) => entry.id === unit.id)
        ? current.filter((entry) => entry.id !== unit.id)
        : [...current, unit]
    );
  };

  const choose = (unit) => {
    onSelect([{ ...unit, asset }]);
    onOpenChange(false);
  };

  const confirm = () => {
    onSelect(selected.map((unit) => ({ ...unit, asset })));
    onOpenChange(false);
  };

  const query = asset ? units : assets;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {asset
              ? 'Pick the physical unit. Units belong to an asset, so they are found through it.'
              : 'Find the asset first, then choose among its units.'}
          </DialogDescription>
        </DialogHeader>

        {asset ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setAsset(null)}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              All assets
            </button>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">{asset.name}</span>
          </div>
        ) : (
          <div className="relative">
            <Search
              className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search assets…"
              aria-label="Search assets"
              className="pl-8"
            />
          </div>
        )}

        {asset && borrowable ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            Only units that can be borrowed
          </label>
        ) : null}

        <div className="max-h-80 min-h-40 overflow-y-auto rounded-md border border-border">
          {query.isError ? (
            <ErrorState error={query.error} onRetry={query.refetch} className="border-0" />
          ) : query.isLoading ? (
            <LoadingState rows={5} columns={1} label="Loading…" />
          ) : (query.data?.data ?? []).length === 0 ? (
            <EmptyState
              title={asset ? 'No units here' : 'No assets found'}
              description={
                asset
                  ? 'This asset has no units matching the filter.'
                  : 'Try a different search term.'
              }
            />
          ) : asset ? (
            <ul>
              {units.data.data.map((unit) => {
                const blocked = isBlocked(unit);
                const already = excluded.has(unit.id);
                const disabled = blocked || already;
                const picked = selected.some((entry) => entry.id === unit.id);

                return (
                  <li key={unit.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => (multiple ? toggle(unit) : choose(unit))}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent',
                        picked && 'bg-accent'
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs">
                          {unit.id.slice(0, 8)}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {already
                            ? 'Already on this record'
                            : blocked
                              ? `Only an ACTIVE unit can be borrowed (03-domain.md §7.1)`
                              : (unit.description ?? '—')}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <StatusBadge value={unit.lifecycleState} kind="lifecycle" />
                        {multiple && picked ? (
                          <span className="text-xs font-medium">Selected</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul>
              {assets.data.data.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setAsset(row)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{row.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {row.classificationId}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {multiple ? (
            <Button type="button" disabled={selected.length === 0} onClick={confirm}>
              Add {selected.length} unit{selected.length === 1 ? '' : 's'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
