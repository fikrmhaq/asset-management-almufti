import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { reportsApi } from '@/api/reporting';
import { queryKeys } from '@/lib/queryKeys';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { SectionCard } from '@/components/patterns/page';

/**
 * The assessment cards — `07-ui.md` §5.9, REQ-COND-006, REQ-REPORT-011/012.
 *
 * ── What these must never let a reader confuse ─────────────────────────────
 *
 * COVERAGE counts unique asset units. ACTIVITY counts entries. A person who
 * recorded one unit three times has three entries and one unit, and only the
 * second is what compliance is measured on — so `entries` and `uniqueUnits` are
 * always separate columns here, never one number, and the department's covered
 * total sits beside the contributor list so an overlap reads as an overlap.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 *
 * None of this is enforced here. The server narrows every one of these queries
 * to the caller's own departments (`CR-012` `DEC-N`); a PIC-scoped caller and an
 * institution administrator run the identical request and receive different
 * rows. These components render what they are given.
 */

/** The current business month as `YYYY-MM`, which is also the server's default. */
function currentMonth() {
  // The server answers in Asia/Jakarta; this only seeds the picker, and the
  // response carries the month it actually used (`totals.month`), which is what
  // the heading reads.
  return new Date().toISOString().slice(0, 7);
}

/**
 * A month picker.
 *
 * `<input type="month">` rather than a custom control: the value is exactly the
 * `YYYY-MM` the API takes, so there is no format to translate and nothing to get
 * wrong between the two.
 */
function MonthPicker({ value, onChange, label }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="month"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      />
    </label>
  );
}

/**
 * A coverage bar.
 *
 * Deliberately shows the PROPORTION AND BOTH COUNTS. A percentage alone cannot
 * distinguish 3 of 3 from 300 of 300, and the difference matters when deciding
 * where to spend an afternoon.
 */
function CoverageBar({ assessed, applicable }) {
  const ratio = applicable === 0 ? 0 : assessed / applicable;

  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="h-2 w-24 shrink-0 rounded-full bg-muted">
        <span
          className={cn(
            'block h-2 rounded-full',
            ratio === 1 ? 'bg-primary' : ratio >= 0.5 ? 'bg-amber-500' : 'bg-destructive'
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      <span className="tabular-nums">
        {assessed}/{applicable}
      </span>
      <span className="tabular-nums text-muted-foreground">{Math.round(ratio * 100)}%</span>
    </div>
  );
}

/**
 * A department's state — `CR-012` `DEC-I`.
 *
 * `NO_RESPONSIBLE_USER` shows NO PERCENTAGE. The department has not failed to
 * assess its units; it has nobody to ask, and a red 0% would send someone to
 * chase a person who does not exist. `NO_UNITS` reads "no units" for the same
 * reason.
 */
function StateCell({ group, t }) {
  if (group.state === 'NO_UNITS') {
    return <span className="text-muted-foreground">{t('dashboard.assessment.noUnits')}</span>;
  }

  if (group.state === 'NO_RESPONSIBLE_USER') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t('dashboard.assessment.noResponsibleUser')}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {group.assessed}/{group.applicable}
        </span>
      </span>
    );
  }

  return <CoverageBar assessed={group.assessed} applicable={group.applicable} />;
}

/** REQ-REPORT-011 — each department's progress for a month. */
export function CoverageCard() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(currentMonth);

  const query = useQuery({
    queryKey: queryKeys.reports.list({ slug: 'assessment-coverage', month }),
    queryFn: () => reportsApi.assessmentCoverage({ month }),
  });

  const data = query.data;

  return (
    <SectionCard
      title={t('dashboard.assessment.coverageTitle')}
      description={t('dashboard.assessment.coverageHint')}
      actions={
        <MonthPicker value={month} onChange={setMonth} label={t('dashboard.assessment.month')} />
      }
    >
      {query.isLoading ? <LoadingState variant="detail" rows={3} /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : null}

      {data ? (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2 pr-3 font-medium">{t('common.fields.department')}</th>
                  <th className="py-2 pr-3 font-medium">{t('dashboard.assessment.responsible')}</th>
                  <th className="py-2 pr-3 font-medium">{t('dashboard.assessment.coverage')}</th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {t('dashboard.assessment.unassessed')}
                  </th>
                  <th className="py-2 font-medium">{t('dashboard.assessment.lastActivity')}</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((group) => (
                  <tr key={group.key} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{group.code}</span>{' '}
                      <span className="text-muted-foreground">{group.label}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {group.responsible ? (
                        `${group.responsible.firstName} ${group.responsible.lastName}`
                      ) : (
                        <span className="text-muted-foreground">
                          {t('dashboard.assessment.unassignedPic')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <StateCell group={group} t={t} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {group.unassessed > 0 ? (
                        <Link
                          className="hover:underline"
                          to={`/reports/inventory-units?departmentId=${group.key}&unassessedIn=${month}`}
                        >
                          {group.unassessed}
                        </Link>
                      ) : (
                        group.unassessed
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {group.lastAssessmentAt ? formatDate(group.lastAssessmentAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('dashboard.assessment.noDepartments')}
            </p>
          ) : null}

          {/*
            Units a department assessed but that do not count, because the
            person who recorded them was not responsible for the department
            (`DEC-F`). Shown only when there are some: the figure exists to
            explain a shortfall, and a permanent zero would just be noise.
          */}
          {data.groups.some((group) => group.assessedByOthers > 0) ? (
            <p className="text-sm text-muted-foreground">
              {t('dashboard.assessment.byOthersHint', {
                n: data.groups.reduce((sum, group) => sum + group.assessedByOthers, 0),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

/** REQ-REPORT-012 — who recorded the assessments. */
export function ActivityCard() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(currentMonth);

  const query = useQuery({
    queryKey: queryKeys.reports.list({ slug: 'assessment-activity', month }),
    queryFn: () => reportsApi.assessmentActivity({ month }),
  });

  const data = query.data;

  return (
    <SectionCard
      title={t('dashboard.assessment.activityTitle')}
      // The department's covered total belongs beside the list, so a
      // contribution above 100% reads as two people covering one unit rather
      // than as an error.
      description={
        data
          ? t('dashboard.assessment.activityHint', { n: data.totals.assessed })
          : t('dashboard.assessment.activityTitle')
      }
      actions={
        <MonthPicker value={month} onChange={setMonth} label={t('dashboard.assessment.month')} />
      }
    >
      {query.isLoading ? <LoadingState variant="detail" rows={3} /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : null}

      {data ? (
        data.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('dashboard.assessment.noActivity')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2 pr-3 font-medium">{t('common.fields.user')}</th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {t('dashboard.assessment.entries')}
                  </th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {t('dashboard.assessment.uniqueUnits')}
                  </th>
                  <th className="py-2 font-medium">{t('dashboard.assessment.lastActivity')}</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((group) => (
                  <tr key={group.key} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {group.user ? `${group.user.firstName} ${group.user.lastName}` : group.label}
                      {group.relationship === 'INSTITUTION' ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t('dashboard.assessment.notDepartmentPic')}
                        </span>
                      ) : null}
                    </td>
                    {/* Two columns, never one: activity is not coverage. */}
                    <td className="py-2 pr-3 text-right tabular-nums">{group.entries}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{group.uniqueUnits}</td>
                    <td className="py-2 text-muted-foreground">
                      {group.lastAt ? formatDate(group.lastAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </SectionCard>
  );
}

/**
 * `CR-012` `DEC-K` — units belonging to no department.
 *
 * The message is "these need assigning", not "these need assessing": nobody is
 * responsible for them, so no assessment could discharge an obligation that does
 * not exist. Rendered only for callers who can act on it (`cards.js`).
 */
export function UnassignedUnitsCard() {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: queryKeys.reports.list({ slug: 'assessment-coverage', scope: 'unassigned' }),
    queryFn: () => reportsApi.assessmentCoverage({}),
  });

  const unassigned = query.data?.unassigned;

  if (query.isLoading || query.isError || !unassigned || unassigned.applicable === 0) return null;

  return (
    <SectionCard
      title={t('dashboard.assessment.unassignedTitle')}
      description={t('dashboard.assessment.unassignedHint')}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/asset-units">{t('dashboard.assessment.assignDepartment')}</Link>
        </Button>
      }
    >
      <p className="text-3xl font-semibold tabular-nums">{unassigned.applicable}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('dashboard.assessment.unassignedLooked', { n: unassigned.withManualEntry })}
      </p>
    </SectionCard>
  );
}
