import { cn } from '@/lib/utils';
import { Pagination } from '@/components/ui/pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Page templates — `IMPLEMENTATION_PLAN.md` §15.5, `07-ui.md` §4.
 *
 * Every module screen in `07-ui.md` §5 is an instance of one of these. The
 * templates carry the layout decisions so an individual screen supplies only
 * what is specific to it — which is what keeps forty screens looking like one
 * application.
 *
 * WHERE HIERARCHY COMES FROM, now that there is a canvas ground: the page title
 * is the largest type on the screen and sits directly on the grey; everything
 * below it is white surfaces on that grey. The surface change is the structure.
 * A 2px rule under the page header would say the same thing a second time — and
 * on a detail page it would land a few pixels above the tab strip's own rule, so
 * the two would read as a mistake rather than as structure. The 2px weight is
 * therefore spent where it is the ONLY available signal: between a table header
 * and its data (`ui/table.jsx`), and between a form and the action that commits
 * it (`FormPage` below).
 */

/**
 * Title, optional badge and description, plus the page's own actions.
 *
 * `breadcrumb` is a slot rather than a fixed element: the shell already renders
 * the route trail in the top bar, so this is for a page that needs a second,
 * page-local trail — an arbitrary-depth location path, say. Nothing here counts
 * or caps its levels.
 */
export function PageHeader({ title, description, actions, badge, breadcrumb, className }) {
  return (
    <header className={cn('space-y-2', className)}>
      {breadcrumb}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* 20px, not 24px. This is a working screen a user is on all day,
                not a landing page; the title needs to be unmistakably the
                title, which the weight and the surface behind it already do. */}
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            {badge}
          </div>
          {description ? (
            <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {/* Actions are permission-gated by the caller: `07-ui.md` §6 hides them
            rather than disabling them. */}
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * §4.1 — filter bar, table, pagination footer.
 *
 * `surface` wraps the content and its pagination in a white panel. It defaults
 * to true because the overwhelmingly common child is a `DataTable`, and a table
 * on the bare canvas has no ground of its own to sit on.
 *
 * A screen that already supplies its own `SectionCard`s should pass
 * `surface={false}` rather than nest one panel inside another. Two screens
 * currently do that (`ClassificationsPage`, `ReportPage`); they are left alone
 * here because this step does not touch module pages, and the overlap is a
 * doubled border rather than a broken layout.
 */
export function ListPage({
  title,
  description,
  actions,
  breadcrumb,
  filters,
  meta,
  onPageChange,
  surface = true,
  children,
  className,
}) {
  const content = (
    <>
      {children}
      {meta ? (
        <Pagination
          meta={meta}
          onPageChange={onPageChange}
          // Inside the panel the footer is already separated by the table's own
          // last rule, so it needs no second one of its own.
          className={surface ? 'border-t-0 px-4 pt-0 pb-3' : undefined}
        />
      ) : null}
    </>
  );

  return (
    <div className={cn('space-y-5', className)}>
      <PageHeader
        title={title}
        description={description}
        actions={actions}
        breadcrumb={breadcrumb}
      />
      {filters ? <FilterToolbar>{filters}</FilterToolbar> : null}
      {surface ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
          {content}
        </div>
      ) : (
        <div className="space-y-5">{content}</div>
      )}
    </div>
  );
}

/**
 * §4.1 — filters map 1:1 onto the resource's API query params (`06-api.md` §1.6).
 *
 * Its own white panel, matching `SectionCard`: the filter bar is a control
 * surface and the results below are a data surface, and they should not look
 * like one continuous region. `items-end` keeps controls of different heights
 * sitting on a common baseline, which is what stops a filter row from looking
 * ragged when one control has a label and its neighbour does not.
 */
export function FilterToolbar({ children, actions, className }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3 shadow-xs',
        className
      )}
    >
      {children}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** §4.2 — header plus tabs or stacked sections. */
export function DetailPage({
  title,
  description,
  badge,
  actions,
  breadcrumb,
  children,
  className,
}) {
  return (
    <div className={cn('space-y-5', className)}>
      <PageHeader
        title={title}
        description={description}
        badge={badge}
        actions={actions}
        breadcrumb={breadcrumb}
      />
      <div className="space-y-5">{children}</div>
    </div>
  );
}

/**
 * §4.2 — detail tabs.
 *
 * Each panel renders only while selected, so a sub-collection the user cannot
 * read is never fetched: a caller may hold `asset:read` without
 * `attachment:read`, and one combined payload would fail for them entirely.
 */
export function DetailTabs({ tabs, value, onValueChange, defaultValue, className }) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      defaultValue={defaultValue ?? tabs[0]?.value}
      className={className}
    >
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} disabled={tab.disabled}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/**
 * A titled region of a page.
 *
 * A card here marks a MEANINGFUL SECTION — "Asset information", "Units",
 * "Attachments" — not every individual fact. A detail page where each field sits
 * in its own card has no hierarchy left to give the sections that matter.
 *
 * White on the canvas grey, one hairline border, one hairline shadow. The
 * separation comes from the surface change rather than from elevation; a real
 * drop shadow on six stacked sections makes a page of floating slabs, which is
 * the template aesthetic this design direction explicitly rejects.
 *
 * The header row is present only when there is a title or an action to put in
 * it, so a bare `SectionCard` is still just a padded surface.
 */
export function SectionCard({ title, description, actions, children, className }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card shadow-xs', className)}>
      {title || actions ? (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            {title ? (
              <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
            ) : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * §4.3 — full-page create/edit form.
 *
 * A full page rather than a modal for anything beyond about four fields, which
 * is every business form in `07-ui.md` §5.
 *
 * The measure is capped so a text field never runs the full width of a wide
 * monitor: a 1600px-wide input is harder to scan back along than a short one,
 * and every one of these forms is a column of single-line fields.
 *
 * The footer carries the 2px STRUCTURAL rule. The boundary between "what I am
 * describing" and "the button that commits it" is the one division on a form
 * page that has to survive a fast scroll to the bottom.
 */
export function FormPage({
  title,
  description,
  breadcrumb,
  onSubmit,
  children,
  footer,
  className,
}) {
  return (
    <div className={cn('mx-auto max-w-3xl space-y-5', className)}>
      <PageHeader title={title} description={description} breadcrumb={breadcrumb} />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {children}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t-2 border-border-strong pt-4">
          {footer}
        </div>
      </form>
    </div>
  );
}

/**
 * A label/value row, for the read-only half of a detail page.
 *
 * The label is set in the same micro-caps as a table's column header, because it
 * is doing the same job: naming a field whose VALUE is what the reader came for.
 * Making the two match means a detail page and a list read as one system.
 *
 * Must be rendered inside a `DetailFieldList` — `dt`/`dd` are only valid within
 * a `dl`, and every current caller does so.
 */
export function DetailField({ label, children, className }) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <dt className="text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </dt>
      {/* An em dash for a genuinely absent value, in muted grey so it reads as
          "nothing recorded" rather than as content. */}
      <dd className="text-sm break-words text-foreground">
        {children ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

/**
 * The grid those fields sit in.
 *
 * Wider horizontal gap than vertical: columns need more air between them than
 * rows do, or a three-column list reads as one run-on line.
 */
export function DetailFieldList({ children, className }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {children}
    </dl>
  );
}
