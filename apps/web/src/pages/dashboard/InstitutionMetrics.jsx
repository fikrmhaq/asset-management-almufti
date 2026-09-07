import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { reportsApi } from '@/api/reporting';
import { queryKeys } from '@/lib/queryKeys';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { SectionCard } from '@/components/patterns/page';
import { BarChart } from '@/components/reports/BarChart';

/**
 * The institution-wide figures — everything the dashboard carried before
 * `CR-012`, moved into one card and gated on `report:read`.
 *
 * NOTHING HERE CHANGED except where it lives. These are aggregates over the
 * whole registry, which is exactly why `report:read` sits outside the `CR-004`
 * ceiling: a Department PIC has no business reading them, and after the gate
 * change they are simply the card such a caller does not receive.
 *
 * Every number still comes from a REPORT endpoint. That restraint was the
 * original decision when the dashboard had no specification, and `07-ui.md`
 * §5.9 now says the same thing as a rule: a card presents a report, and one
 * that cannot be opened has no business being a number on a screen.
 */

/** How many classification bars to show. The catalogue runs to thousands. */
const TOP_CLASSIFICATIONS = 10;

function Metric({ label, value, to, hint }) {
  const body = (
    <>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="mt-1 block text-3xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </>
  );

  return (
    <li className="rounded-lg border border-border p-4">
      {to ? (
        <Link to={to} className="block transition-colors hover:text-primary">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

export function InstitutionMetrics() {
  const { t } = useTranslation();

  const status = useQuery({
    queryKey: queryKeys.reports.list({ slug: 'status' }),
    queryFn: () => reportsApi.status({}),
  });

  const condition = useQuery({
    queryKey: queryKeys.reports.list({ slug: 'by-condition' }),
    queryFn: () => reportsApi.byCondition({}),
  });

  const classification = useQuery({
    queryKey: queryKeys.reports.list({ slug: 'by-classification' }),
    queryFn: () => reportsApi.byClassification({}),
  });

  // The borrowing figures come from the borrowing REPORT rather than from
  // `GET /borrowings`: one page of one row is enough, because the count lives
  // in `meta` and nothing here renders the rows.
  const activeLoans = useQuery({
    queryKey: queryKeys.reports.list({ slug: 'borrowings', status: 'ACTIVE', pageSize: 1 }),
    queryFn: () => reportsApi.borrowings({ status: 'ACTIVE', pageSize: 1 }),
  });

  const overdueLoans = useQuery({
    queryKey: queryKeys.reports.list({ slug: 'borrowings', overdue: 'true', pageSize: 1 }),
    queryFn: () => reportsApi.borrowings({ overdue: 'true', pageSize: 1 }),
  });

  if (status.isLoading) return <LoadingState variant="detail" rows={4} />;
  if (status.isError) return <ErrorState error={status.error} onRetry={status.refetch} />;

  const totals = status.data?.totals ?? {};

  // Sorted here rather than relying on the endpoint's order: `by-classification`
  // groups by code, which is the useful order in the full report and the wrong
  // one for "the ten largest".
  const topClassifications = [...(classification.data?.groups ?? [])]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_CLASSIFICATIONS);

  return (
    <div className="space-y-6">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label={t('dashboard.assets')}
          value={totals.assets ?? 0}
          to="/reports/inventory"
          hint={t('dashboard.activeCount', { n: totals.activeAssets ?? 0 })}
        />
        <Metric label={t('dashboard.assetUnits')} value={totals.units ?? 0} to="/reports/status" />
        <Metric
          label={t('dashboard.loansOut')}
          value={activeLoans.data?.meta?.total ?? 0}
          to="/reports/borrowings?status=ACTIVE"
        />
        <Metric
          label={t('dashboard.pastDue')}
          value={overdueLoans.data?.meta?.total ?? 0}
          to="/reports/borrowings?overdue=true"
          hint={t('dashboard.pastDueHint')}
        />
      </ul>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title={t('dashboard.byLifecycle')}
          actions={
            <Link to="/reports/status" className="text-sm hover:underline">
              {t('dashboard.fullReport')}
            </Link>
          }
        >
          <BarChart groups={status.data?.groups ?? []} />
        </SectionCard>

        <SectionCard
          title={t('dashboard.byCondition')}
          actions={
            <Link to="/reports/by-condition" className="text-sm hover:underline">
              {t('dashboard.fullReport')}
            </Link>
          }
        >
          {condition.isError ? (
            <ErrorState error={condition.error} onRetry={condition.refetch} />
          ) : (
            <BarChart
              groups={condition.data?.groups ?? []}
              emptyLabel={t('reports.values.notRecorded')}
            />
          )}
        </SectionCard>
      </div>

      {/*
        Full width rather than a third of the row above: a classification label
        is a sentence where a lifecycle state is a word, and a two-column grid
        would truncate every bar. Capped at ten — the catalogue runs to
        thousands of leaves, and a hundred bars is a table nobody reads.
      */}
      <SectionCard
        title={t('dashboard.byClassification')}
        description={t('dashboard.byClassificationHint', { n: TOP_CLASSIFICATIONS })}
        actions={
          <Link to="/reports/by-classification" className="text-sm hover:underline">
            {t('dashboard.fullReport')}
          </Link>
        }
      >
        {classification.isError ? (
          <ErrorState error={classification.error} onRetry={classification.refetch} />
        ) : (
          <BarChart groups={topClassifications} />
        )}
      </SectionCard>
    </div>
  );
}
