import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Search, X } from 'lucide-react';

import { classificationsApi } from '@/api/reference';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
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

/**
 * Classification picker — `07-ui.md` §4.5, `IMPLEMENTATION_PLAN.md` §17.6.
 *
 * `ref.asset_classifications` is five levels deep with thousands of leaves, so a
 * flat `<select>` is unusable and REQ-CLASS-010 rules it out. Two ways in:
 *
 *   DRILL-DOWN  root nodes (`GET /classifications` with no `parentId`), then
 *               `GET /classifications/:id/children` per step, until a response
 *               comes back empty — that node is the selection. The breadcrumb
 *               above is clickable to re-narrow from any level.
 *   SEARCH      typing calls `GET /classifications/leaf?q=`, which returns leaf
 *               matches only; picking one closes the picker exactly as reaching
 *               a leaf by drilling does.
 *
 * One component, used by the Asset form, the Location form and the Assets list
 * filter (all Phase 12), plus the classification browser here — `07-ui.md` §4.5
 * is explicit that it is one implementation, not three.
 */

/**
 * One column of choices, plus the request that fills it.
 *
 * `scope` carries `institutionId` when the record being classified belongs to an
 * institution other than the caller's — the offered set follows the record, not
 * the user (`BR-019`). It is part of the query key so switching institutions on a
 * form refetches rather than showing the previous one's nodes.
 */
function useChildren(parentId, scope, { enabled }) {
  return useQuery({
    queryKey: parentId
      ? queryKeys.classifications.sub(parentId, 'children', scope)
      : queryKeys.classifications.list({ root: true, ...scope }),
    queryFn: () =>
      parentId ? classificationsApi.children(parentId, scope) : classificationsApi.list(scope),
    enabled,
  });
}

function useLeafSearch(term, scope) {
  return useQuery({
    queryKey: queryKeys.classifications.list({ leaf: term, ...scope }),
    queryFn: () => classificationsApi.searchLeaves(term, scope),
    // Two characters is the point where results stop being the whole table.
    enabled: term.trim().length >= 2,
  });
}

export function ClassificationPicker({
  open,
  onOpenChange,
  onSelect,
  title,
  institutionId,
  allowBranchSelect = false,
}) {
  const { t } = useTranslation();
  /** The drill-down path so far; the last entry's children are on screen. */
  const [path, setPath] = useState([]);
  const [term, setTerm] = useState('');

  const searching = term.trim().length >= 2;
  const parent = path.at(-1) ?? null;

  // Undefined rather than null when absent: the API treats an omitted
  // `institutionId` as "the caller's own", which is the right default.
  const scope = institutionId ? { institutionId } : {};

  const children = useChildren(parent?.id ?? null, scope, { enabled: open && !searching });
  const leaves = useLeafSearch(term, scope);

  const close = () => {
    onOpenChange?.(false);
    // Reset so the next open starts at the root rather than mid-path.
    setPath([]);
    setTerm('');
  };

  const choose = (node) => {
    onSelect?.(node);
    close();
  };

  /**
   * A node with no children IS the selection.
   *
   * The server is the authority on leafness — `GET /:id/children` returning
   * nothing is the definition (REQ-CLASS-009), and the leaf search marks its
   * results `isLeaf`.
   */
  const step = async (node) => {
    if (node.isLeaf) {
      choose(node);
      return;
    }
    setPath((current) => [...current, node]);
  };

  /**
   * Choosing a branch, not a leaf.
   *
   * Off by default, because assigning a classification must land on a leaf
   * (REQ-CLASS-009). The management screen turns it on: to add beneath a node
   * you have to be able to arrive at that node, and it is never a leaf.
   */
  const canChooseCurrent = allowBranchSelect && !searching && parent;

  const rows = searching ? (leaves.data?.data ?? []) : (children.data?.data ?? []);
  const query = searching ? leaves : children;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange?.(true) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title ?? t('reference.picker.title')}</DialogTitle>
          <DialogDescription>{t('reference.picker.description')}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t('reference.picker.searchPlaceholder')}
            aria-label={t('reference.picker.searchLabel')}
            className="pl-8"
          />
          {term ? (
            <button
              type="button"
              onClick={() => setTerm('')}
              aria-label={t('reference.picker.clearSearch')}
              className="absolute top-2.5 right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* The trail of what has been narrowed so far. Any segment jumps back. */}
        {!searching ? (
          <nav
            aria-label={t('reference.picker.trail')}
            className="flex flex-wrap items-center gap-1 text-sm"
          >
            <button
              type="button"
              onClick={() => setPath([])}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              {t('reference.picker.top')}
            </button>
            {path.map((node, index) => (
              <span key={node.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => setPath((current) => current.slice(0, index + 1))}
                  className={cn(
                    'hover:underline',
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

        {canChooseCurrent ? (
          <Button type="button" variant="outline" size="sm" onClick={() => choose(parent)}>
            {t('reference.picker.useThis', { name: parent.name })}
          </Button>
        ) : null}

        <div className="max-h-80 min-h-40 overflow-y-auto rounded-md border border-border">
          {query.isError ? (
            <ErrorState error={query.error} onRetry={query.refetch} className="border-0" />
          ) : query.isLoading ? (
            /* A stack of single-line entries is what will replace it, so the
               list skeleton is the shape that does not re-flow on arrival. */
            <LoadingState
              variant="list"
              rows={5}
              label={t('reference.picker.loading')}
              className="p-3"
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title={
                searching ? t('reference.picker.noMatches') : t('reference.picker.nothingHere')
              }
              description={searching ? t('reference.picker.noMatchesHint') : undefined}
              className="border-0"
            />
          ) : (
            <ul>
              {rows.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => (searching ? choose(node) : step(node))}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate">{node.name}</span>
                        {/* A locally-registered entry looks the same as a
                            government one otherwise, and the difference decides
                            whether it can be renamed or removed (`BR-016`). */}
                        {node.isAppDefined ? (
                          <Badge variant="info" className="shrink-0">
                            {t('reference.picker.local')}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {node.id}
                      </span>
                    </span>
                    {node.isLeaf ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('reference.picker.select')}
                      </span>
                    ) : (
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </button>
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
 * The form field wrapper: a button that opens the picker and shows the chosen
 * leaf.
 *
 * `07-ui.md` §4.5 requires the full path as a subtitle, never the bare leaf name
 * — "Komputer" alone is meaningless without knowing it sits under
 * "Alat/Bahan Kegiatan Kantor".
 */
export function ClassificationField({
  value,
  path,
  onChange,
  disabled = false,
  invalid = false,
  placeholder,
  className,
  id,
  institutionId,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        id={id}
        variant="outline"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen(true)}
        className={cn(
          'h-auto w-full justify-start py-2 font-normal aria-[invalid=true]:border-destructive',
          className
        )}
      >
        {value ? (
          <span className="min-w-0 text-left">
            <span className="block truncate">{value.name ?? value.id}</span>
            {path ? (
              <span className="block truncate text-xs text-muted-foreground">{path}</span>
            ) : null}
          </span>
        ) : (
          <span className="truncate text-muted-foreground">
            {placeholder ?? t('reference.picker.placeholder')}
          </span>
        )}
      </Button>

      <ClassificationPicker
        open={open}
        onOpenChange={setOpen}
        onSelect={onChange}
        institutionId={institutionId}
      />
    </>
  );
}
