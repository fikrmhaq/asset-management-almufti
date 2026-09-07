import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useListParams } from '@/hooks/useListParams';
import { queryKeys } from '@/lib/queryKeys';
import { toCsv, downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { DataTable } from '@/components/patterns/data-table';
import { SearchFilter, SelectFilter, StatusFilter } from '@/components/patterns/filters';
import {
  DetailField,
  DetailFieldList,
  ListPage,
  PageHeader,
  SectionCard,
} from '@/components/patterns/page';
import { ClassificationPicker } from '@/components/reference/ClassificationPicker';
import { BarChart } from '@/components/reports/BarChart';
import { useInstitutionOptions } from '../procurement/referenceOptions';
import { findReport } from './registry';

/**
 * One report — `07-ui.md` §5.7.
 *
 * Generic by design: the slug selects a registry entry, and that
 * entry supplies the title, the endpoint, the filters, the columns and whether a
 * chart makes sense. Eight bespoke screens would drift; one screen and eight
 * declarations cannot.
 *
 * Filters are URL-synced like every other list (§4.1) and map 1:1 onto
 * parameters the endpoint actually accepts. Two controls §5.7 asks
 * for are deliberately absent — a department filter and a location filter —
 * because no report has a parameter for either, and a filter that quietly did
 * nothing would be worse than its absence.
 *
 * Export is client-side CSV of what is on screen, which for a paginated report
 * is this page; the note under the table says so. A report declaring `exportAll`
 * is exported by the SERVER over everything matching instead (`CR-009`).
 */

const BORROWING_STATUSES = ['DRAFT', 'ACTIVE', 'OVERDUE', 'RETURNED', 'CANCELLED'];

/**
 * A date filter bound straight to the report's own `dateFrom`/`dateTo`.
 *
 * The caption is a `<span>`, not a `<Label htmlFor>`: the button carries its own
 * accessible name through the placeholder, which is why the two are worded
 * distinctly — associating a label would replace that name with "From".
 *
 * `clearable`, because a filter is optional by definition.
 */
function DateFilter({ label, placeholder, value, onChange, clearLabel }) {
  return (
    <div className="w-44 space-y-1.5">
      <span className="block text-sm leading-none font-medium">{label}</span>
      <DatePicker
        value={value}
        onChange={(next) => onChange(next ?? '')}
        placeholder={placeholder}
        clearable
        clearLabel={clearLabel}
      />
    </div>
  );
}

/** Which query parameter each grouped-report filter name carries. */
const GROUPED_FILTER_PARAMS = {
  institution: 'institutionId',
  month: 'month',
  rollUp: 'rollUp',
  department: 'departmentId',
};

export function ReportPage() {
  const { t } = useTranslation();
  const { report: slug } = useParams();
  const { params, setParams, setPage, setSort } = useListParams();
  const [picking, setPicking] = useState(false);
  const [classification, setClassification] = useState(null);
  const [exporting, setExporting] = useState(false);

  const report = findReport(slug);
  const institutions = useInstitutionOptions();

  /**
   * A grouped report takes no page, and only the filters it declares; sending
   * the list params would add noise to the cache key and the request.
   *
   * Until `CR-012` every grouped report took exactly one filter, so this was
   * `{ institutionId }`. Three of them now take a month, a department or a
   * roll-up, so the set is read off the registry — which keeps the rule that
   * nothing is sent that the endpoint does not accept (`DEC-051`).
   */
  const requestParams =
    report?.kind === 'groups'
      ? Object.fromEntries(
          report.filters
            .map((name) => GROUPED_FILTER_PARAMS[name])
            .filter(Boolean)
            .map((key) => [key, params[key]])
            .filter(([, value]) => value !== undefined && value !== '')
        )
      : params;

  const query = useQuery({
    queryKey: queryKeys.reports.list({ slug, ...requestParams }),
    queryFn: () => report.fetch(requestParams),
    enabled: Boolean(report),
  });

  if (!report) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('reports.notFound')} />
        <EmptyState
          title={t('reports.noReport', { slug })}
          description={t('reports.noReportHint')}
          action={
            <Button asChild variant="outline">
              <Link to="/reports">{t('reports.back')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const grouped = report.kind === 'groups';
  const rows = grouped ? (query.data?.groups ?? []) : (query.data?.data ?? []);
  const totals = grouped ? query.data?.totals : undefined;

  // The registry holds key paths, not words — see its own note.
  const columns = report.columns.map((column) => ({
    id: column.key,
    header: t(column.header),
    meta: {
      ...(column.sortField ? { sortField: column.sortField } : {}),
      ...(column.align === 'right'
        ? { headerClassName: 'text-right', cellClassName: 'text-right tabular-nums' }
        : {}),
    },
    cell: ({ row }) =>
      column.cell ? column.cell(row.original, t) : (row.original[column.key] ?? '—'),
  }));

  const exportCsv = () => {
    const text = toCsv(
      report.columns.map(({ key, header, value }) => ({
        key,
        header: t(header),
        // The exported value is resolved in the reader's language too, so the
        // file and the screen never disagree about what a row said.
        value: value ? (row) => value(row, t) : undefined,
      })),
      rows
    );
    downloadCsv(`${report.slug}-${new Date().toISOString().slice(0, 10)}.csv`, text);
  };

  /**
   * The server-side export — `CR-009` `DEC-D`.
   *
   * A report declaring `exportAll` is exported by the SERVER, over the whole
   * filtered set, because the client-side path above can only see the page it
   * fetched. An inventory list that stops at row 100 is not an inventory list.
   *
   * The same filters go with it, minus the page: the export is defined as
   * everything matching, and sending a page would reintroduce the defect.
   */
  const exportFromServer = async () => {
    setExporting(true);
    try {
      // eslint-disable-next-line no-unused-vars
      const { page, pageSize, ...filterParams } = params;
      const { blob, filename } = await report.exportAll(filterParams);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      // Includes the refusal when the set is too large to export, which names
      // the filter to narrow — worth showing rather than swallowing.
      toast.fromError(error, { includeValidation: true });
    } finally {
      setExporting(false);
    }
  };

  const filters = (
    <>
      {report.filters.includes('q') ? (
        <SearchFilter
          value={params.q ?? ''}
          onChange={(q) => setParams({ q })}
          placeholder={
            report.searchPlaceholder
              ? t(report.searchPlaceholder)
              : t('common.filters.searchPlaceholder')
          }
        />
      ) : null}

      {report.filters.includes('classification') ? (
        <div className="space-y-1.5">
          <span className="block text-sm leading-none font-medium">
            {t('common.fields.classification')}
          </span>
          <Button
            variant="outline"
            onClick={() => setPicking(true)}
            className="w-56 justify-start font-normal"
          >
            {classification ? classification.name : t('reports.anyClassification')}
          </Button>
        </div>
      ) : null}

      {report.filters.includes('institution') && institutions.allowed ? (
        <SelectFilter
          id="filter-institution"
          label={t('common.fields.institution')}
          value={params.institutionId ?? 'all'}
          options={institutions.options}
          onChange={(institutionId) => setParams({ institutionId })}
        />
      ) : null}

      {report.filters.includes('status') ? (
        <StatusFilter value={params.status ?? 'all'} onChange={(status) => setParams({ status })} />
      ) : null}

      {/*
        `CR-012`. `<input type="month">` rather than a custom control: its value
        is exactly the `YYYY-MM` the API takes, so there is no format to
        translate between the two and nothing to get wrong. Left empty it sends
        nothing, and the server answers for the current business month.
      */}
      {report.filters.includes('month') ? (
        <div className="space-y-1.5">
          <label
            htmlFor="filter-month"
            className="block text-sm leading-none font-medium"
          >
            {t('dashboard.assessment.month')}
          </label>
          <input
            id="filter-month"
            type="month"
            value={params.month ?? ''}
            onChange={(event) => setParams({ month: event.target.value })}
            className="h-9 w-44 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      ) : null}

      {report.filters.includes('rollUp') ? (
        <SelectFilter
          id="filter-roll-up"
          label={t('dashboard.locationCondition.scopeLabel')}
          value={params.rollUp ?? 'false'}
          options={[
            { value: 'false', label: t('dashboard.locationCondition.scopeDirect') },
            { value: 'true', label: t('dashboard.locationCondition.scopeAll') },
          ]}
          onChange={(rollUp) => setParams({ rollUp })}
          width="w-56"
        />
      ) : null}

      {report.filters.includes('borrowingStatus') ? (
        <SelectFilter
          id="filter-borrowing-status"
          label={t('common.fields.status')}
          value={params.status ?? 'all'}
          options={BORROWING_STATUSES.map((status) => ({
            value: status,
            label: t(`enums.borrowing.${status}`),
          }))}
          onChange={(status) => setParams({ status })}
          width="w-44"
        />
      ) : null}

      {report.filters.includes('overdue') ? (
        <SelectFilter
          id="filter-overdue"
          label={t('reports.overdue')}
          value={params.overdue ?? 'all'}
          options={[{ value: 'true', label: t('reports.pastDueOnly') }]}
          onChange={(overdue) => setParams({ overdue })}
          width="w-44"
        />
      ) : null}

      {report.filters.includes('traced') ? (
        <SelectFilter
          id="filter-traced"
          label={t('reports.procurement')}
          value={params.traced ?? 'all'}
          options={[
            { value: 'true', label: t('reports.tracedToContract') },
            { value: 'false', label: t('reports.values.noProcurement') },
          ]}
          onChange={(traced) => setParams({ traced })}
          width="w-52"
        />
      ) : null}

      {report.filters.includes('dateRange') ? (
        <>
          <DateFilter
            label={t('common.fields.from')}
            placeholder={t('reports.anyStartDate')}
            clearLabel={t('reports.clearStartDate')}
            value={params.dateFrom ?? ''}
            onChange={(dateFrom) => setParams({ dateFrom })}
          />
          <DateFilter
            label={t('common.fields.to')}
            placeholder={t('reports.anyEndDate')}
            clearLabel={t('reports.clearEndDate')}
            value={params.dateTo ?? ''}
            onChange={(dateTo) => setParams({ dateTo })}
          />
        </>
      ) : null}

      {classification ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setClassification(null);
            setParams({ classificationId: '' });
          }}
        >
          {t('reports.clearClassification')}
        </Button>
      ) : null}
    </>
  );

  const table = (
    <DataTable
      columns={columns}
      data={rows}
      isLoading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      getRowId={report.groupKey ?? report.rowId}
      sort={params.sort}
      order={params.order}
      onSortChange={grouped ? undefined : setSort}
      emptyTitle={t('reports.empty')}
      emptyDescription={t('reports.emptyDescription')}
    />
  );

  return (
    <>
      <ListPage
        title={t(`reports.items.${report.key}.title`)}
        description={t(`reports.items.${report.key}.description`)}
        actions={
          <Button
            variant="outline"
            onClick={report.exportAll ? exportFromServer : exportCsv}
            loading={exporting}
            disabled={rows.length === 0}
          >
            {t(report.exportAll ? 'reports.exportWorkbook' : 'reports.export')}
          </Button>
        }
        filters={filters}
        // A grouped report is a complete answer, so there is no pagination
        // footer to render (`DEC-053`).
        meta={grouped ? undefined : query.data?.meta}
        onPageChange={setPage}
      >
        <div className="space-y-6">
          {totals ? (
            <SectionCard title={t('reports.totals')}>
              <DetailFieldList>
                {report.totals.map((total) => (
                  <DetailField key={total.key} label={t(total.label)}>
                    <span className="text-lg font-semibold tabular-nums">
                      {totals[total.key] ?? 0}
                    </span>
                  </DetailField>
                ))}
              </DetailFieldList>
            </SectionCard>
          ) : null}

          {report.chart && !query.isLoading && !query.isError ? (
            <SectionCard title={t('reports.breakdown')}>
              <BarChart groups={rows} emptyLabel={report.emptyLabel && t(report.emptyLabel)} />
            </SectionCard>
          ) : null}

          {table}

          <p className="text-xs text-muted-foreground">
            {report.exportAll
              ? t('reports.exportNoteWhole')
              : grouped
                ? t('reports.exportNote')
                : t('reports.exportNotePaged')}
          </p>
        </div>
      </ListPage>

      {report.filters.includes('classification') ? (
        <ClassificationPicker
          open={picking}
          onOpenChange={setPicking}
          title={t('reports.filterByClassification')}
          onSelect={(node) => {
            setClassification(node);
            setParams({ classificationId: node.id });
          }}
        />
      ) : null}
    </>
  );
}
