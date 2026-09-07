import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Data table — `IMPLEMENTATION_PLAN.md` §15.5, `07-ui.md` §4.1.
 *
 * TanStack Table for column definition and rendering only. Sorting and
 * pagination are SERVER-side (`IMPLEMENTATION_PLAN.md` §33): the table receives
 * one page of rows and reports sort intent upward, rather than holding a dataset
 * and slicing it. A client-side sort would silently reorder only the current
 * page and disagree with the total the API reported.
 *
 * The three shared states (§4) are handled here so no list screen repeats them.
 *
 * COLUMN META, all optional and all additive:
 *
 *   sortField        the API's sort key — its presence is what makes a column
 *                    sortable, because the server decides what it can order by
 *   align            'right' | 'center' — applied to the header AND the cells
 *                    together, so a numeric column cannot drift out of line
 *                    with its own heading
 *   headerClassName  escape hatches, unchanged
 *   cellClassName
 */

/** Numbers and dates read down the column; text reads from the left. */
const ALIGNMENT = {
  right: 'text-right',
  center: 'text-center',
};

export function DataTable({
  columns,
  data = [],
  isLoading = false,
  error = null,
  onRetry,
  sort,
  order = 'asc',
  onSortChange,
  emptyTitle,
  emptyDescription,
  emptyAction,
  getRowId,
  onRowClick,
}) {
  const { t } = useTranslation();

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    getRowId,
  });

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isLoading) return <LoadingState variant="table" columns={columns.length} />;
  if (data.length === 0) {
    return (
      <EmptyState
        title={emptyTitle ?? t('common.states.noResults')}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => {
              const meta = header.column.columnDef.meta ?? {};
              const sortField = meta.sortField;
              const isSorted = sortField && sortField === sort;

              return (
                <TableHead
                  key={header.id}
                  // Announced by screen readers as the column's sort state, and
                  // the only machine-readable record of it — the arrow glyph is
                  // decorative.
                  aria-sort={isSorted ? (order === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(ALIGNMENT[meta.align], meta.headerClassName)}
                >
                  {header.isPlaceholder ? null : sortField && onSortChange ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        '-mx-2 h-7 gap-1.5 px-2 text-[0.6875rem] font-semibold tracking-[0.06em] uppercase',
                        isSorted ? 'text-brand-700' : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() =>
                        onSortChange(sortField, isSorted && order === 'asc' ? 'desc' : 'asc')
                      }
                      aria-label={t('common.table.sortBy', { field: sortField })}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {isSorted ? (
                        order === 'asc' ? (
                          <ArrowUp className="h-3 w-3 text-brand-600" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-brand-600" aria-hidden="true" />
                        )
                      ) : (
                        // Present but quiet: the column is sortable and says so
                        // without competing with the column that IS sorted.
                        <ChevronsUpDown className="h-3 w-3 text-neutral-300" aria-hidden="true" />
                      )}
                    </Button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>

      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            className={cn(onRowClick && 'cursor-pointer')}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
          >
            {row.getVisibleCells().map((cell) => {
              const meta = cell.column.columnDef.meta ?? {};

              return (
                <TableCell key={cell.id} className={cn(ALIGNMENT[meta.align], meta.cellClassName)}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
