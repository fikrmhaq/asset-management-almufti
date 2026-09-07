import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { reportsApi } from '@/api/reporting';
import { queryKeys } from '@/lib/queryKeys';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { SectionCard } from '@/components/patterns/page';
import { DirectVsDescendantToggle } from '@/components/patterns/scope-toggle';

// The same list the asset screens use, so the column set and the condition
// picker can never disagree about what a condition is.
import { CONDITIONS } from '../assets/AssetsPage';

/**
 * Units by location and condition — `07-ui.md` §5.9, REQ-REPORT-010.
 *
 * `/reports/by-location` and `/reports/by-condition` each answer one axis of
 * this. Crossing them answers the question actually asked before a repair round:
 * WHICH ROOM holds the damaged items.
 *
 * ── The columns are conditions, not lifecycle states ───────────────────────
 *
 * `UNDER_MAINTENANCE` is a lifecycle state and belongs to a different axis;
 * putting it in this row would be a category error. The columns are exactly
 * `condition_enum`, plus one for units whose condition has never been recorded —
 * which is a real answer, not a gap to hide.
 *
 * ── Roll-up ────────────────────────────────────────────────────────────────
 *
 * The toggle reuses the vocabulary `GET /locations/:id/units` already uses, so
 * "everything inside" means the same thing on both screens. Rolled up, the rows
 * DELIBERATELY OVERLAP — a unit in a room is also counted in its building — so
 * the total under the table comes from the server's own count over the units,
 * never from summing the rows.
 */
export function LocationConditionCard() {
  const { t } = useTranslation();
  const [scope, setScope] = useState('direct');

  const rollUp = scope === 'all';

  const query = useQuery({
    queryKey: queryKeys.reports.list({ slug: 'by-location-condition', rollUp }),
    queryFn: () => reportsApi.byLocationCondition(rollUp ? { rollUp: 'true' } : {}),
  });

  const data = query.data;

  return (
    <SectionCard
      title={t('dashboard.locationCondition.title')}
      description={t('dashboard.locationCondition.hint')}
      actions={
        <DirectVsDescendantToggle
          value={scope}
          onChange={setScope}
          label={t('dashboard.locationCondition.scopeLabel')}
          labels={{
            direct: t('dashboard.locationCondition.scopeDirect'),
            all: t('dashboard.locationCondition.scopeAll'),
          }}
        />
      }
    >
      {query.isLoading ? <LoadingState variant="detail" rows={4} /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : null}

      {data ? (
        data.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reports.chartEmpty')}</p>
        ) : (
          <>
            {/* Six condition columns will not fit a narrow viewport, so the
                table scrolls inside the card rather than the page sideways. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                    <th className="py-2 pr-3 font-medium">{t('common.fields.location')}</th>
                    {CONDITIONS.map((condition) => (
                      <th key={condition} className="py-2 pr-3 text-right font-medium">
                        {t(`enums.condition.${condition}`)}
                      </th>
                    ))}
                    <th className="py-2 pr-3 text-right font-medium">
                      {t('reports.values.notRecorded')}
                    </th>
                    <th className="py-2 text-right font-medium">
                      {t('reports.totalLabels.units')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((group) => (
                    <tr key={String(group.key)} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        {group.key ? (
                          <Link to={`/locations/${group.key}`} className="hover:underline">
                            {group.label}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {t('reports.values.noLocation')}
                          </span>
                        )}
                      </td>

                      {CONDITIONS.map((condition) => (
                        <td key={condition} className="py-2 pr-3 text-right tabular-nums">
                          {/* Every cell leads somewhere: an aggregate nobody can
                              open is a number nobody can act on. */}
                          {group.counts[condition] > 0 && group.key ? (
                            <Link
                              className="hover:underline"
                              to={`/reports/inventory-units?locationId=${group.key}&condition=${condition}${
                                rollUp ? '&locationScope=all' : ''
                              }`}
                            >
                              {group.counts[condition]}
                            </Link>
                          ) : (
                            <span
                              className={group.counts[condition] ? '' : 'text-muted-foreground'}
                            >
                              {group.counts[condition]}
                            </span>
                          )}
                        </td>
                      ))}

                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {group.unrecorded}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums">{group.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-sm text-muted-foreground">
              {t('dashboard.locationCondition.totals', {
                units: data.totals.units,
                locations: data.totals.locations,
                unlocated: data.totals.unlocated,
              })}
            </p>
          </>
        )
      ) : null}
    </SectionCard>
  );
}
