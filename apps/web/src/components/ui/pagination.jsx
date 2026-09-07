import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * Pagination footer — `IMPLEMENTATION_PLAN.md` §15.4, `06-api.md` §1.5.
 *
 * Driven entirely by the API's `meta` block; it derives nothing itself. If the
 * server says there are 7 pages, this shows 7 pages — a client that recomputed
 * the total from the row count would disagree with the server the moment a
 * filter is applied.
 */
export function Pagination({ meta, onPageChange, className }) {
  const { t } = useTranslation();
  const { page = 1, pageSize = 20, total = 0, totalPages = 0 } = meta ?? {};

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const canGoBack = page > 1;
  const canGoForward = page < totalPages;

  return (
    <nav
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm',
        className
      )}
      aria-label={t('common.pagination.label')}
    >
      {/* Which records these are. Announced on change, because after pressing
          "next" the only thing that moved for a screen-reader user is this. */}
      <p className="text-muted-foreground" aria-live="polite">
        {total === 0
          ? t('common.states.noResults')
          : t('common.pagination.range', { first, last, total })}
      </p>

      <div className="flex items-center gap-2">
        {/* Where in the set they are. One text node, not composed from parts:
            "Page {{page}} of {{totalPages}}" has to survive translation into a
            language that orders it differently. */}
        <span className="font-medium text-foreground tabular-nums">
          {totalPages === 0
            ? t('common.pagination.pageEmpty')
            : t('common.pagination.page', { page, totalPages })}
        </span>

        {/* Joined into one control group: two adjacent buttons that do opposite
            halves of the same job, so they read as a pair rather than as two
            unrelated actions that happen to be next to each other. */}
        <div className="flex items-center">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-r-none"
            onClick={() => onPageChange?.(page - 1)}
            disabled={!canGoBack}
            aria-label={t('common.pagination.previous')}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="-ml-px h-8 w-8 rounded-l-none"
            onClick={() => onPageChange?.(page + 1)}
            disabled={!canGoForward}
            aria-label={t('common.pagination.next')}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
