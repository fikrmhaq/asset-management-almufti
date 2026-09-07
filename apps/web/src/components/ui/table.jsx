import { cn } from '@/lib/utils';

/**
 * Table primitives — `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * Presentation only; `DataTable` (patterns/) supplies the TanStack Table
 * behaviour. Split so a detail page can lay out a small static table without
 * pulling in sorting and pagination it does not need.
 *
 * The horizontal scroll lives on the wrapper rather than the page, which is what
 * `07-ui.md` §3 means by "no nested scroll regions beyond what's needed for wide
 * tables".
 *
 * TWO WEIGHTS OF RULE, and only two:
 *
 *   2px  structure — the boundary between the header and the data
 *   1px  data      — between one record and the next
 *
 * A table where every line is the same weight has no reading order; a table with
 * a box around every cell is a spreadsheet. There are no vertical rules at all —
 * column alignment already separates the columns, and adding lines to say so
 * doubles the ink for nothing.
 *
 * This is deliberately NOT a card. Tables sit inside a `SectionCard` when they
 * need a container; giving the table its own border and radius as well would
 * frame the frame.
 */

export function Table({ className, ...props }) {
  return (
    <div className="scrollbar-subtle relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }) {
  return (
    <thead className={cn('[&_tr]:border-b-2 [&_tr]:border-border-strong', className)} {...props} />
  );
}

export function TableBody({ className, ...props }) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

/**
 * Hover is `neutral-100`, NOT `neutral-50`.
 *
 * `neutral-50` is the canvas ground (`--color-canvas`), so a table rendered
 * straight onto the page rather than onto a white surface had a hover state
 * exactly the colour of the paper behind it — invisible. `-100` is distinct
 * from both white and the canvas, so the row responds wherever the table sits.
 */
export function TableRow({ className, ...props }) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-neutral-100 ' +
          'data-[state=selected]:bg-brand-50',
        className
      )}
      {...props}
    />
  );
}

/**
 * Column headers are set in small caps rather than given a filled band.
 *
 * The weight and the letter-spacing are what separate the header from the data;
 * a grey fill would do the same job but costs a horizontal band of colour on
 * every table in the application, and these pages already carry a lot.
 */
export function TableHead({ className, ...props }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 px-3 text-left align-middle text-[0.6875rem] font-semibold tracking-[0.06em] ' +
          'text-muted-foreground uppercase whitespace-nowrap',
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}
