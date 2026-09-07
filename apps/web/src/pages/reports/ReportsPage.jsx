import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/patterns/page';
import { hasPermission, useSessionStore } from '@/stores/session';
import { REPORTS, permissionFor } from './registry';

/**
 * Reports landing — `07-ui.md` §5.7.
 *
 * A card per report, generated from the same registry that drives the screens
 * themselves, so a report cannot exist without being reachable or be listed here
 * without existing.
 *
 * CARDS ARE FILTERED BY PERMISSION (`CR-010`). One code no longer covers them
 * all: the unit inventory requires `asset-unit:read` because its rows are Asset
 * Units, which is what lets a Department PIC open it while the eight
 * institution-wide aggregates stay closed to them. A card linking to a `403` is
 * worse than no card, so the list shows only what the caller can actually open.
 *
 * The requirement id each card used to print is gone: it is an engineering
 * reference, and the person choosing a report has no way to look one up.
 */
export function ReportsPage() {
  const { t } = useTranslation();
  const permissions = useSessionStore((state) => state.permissions);

  const visible = REPORTS.filter((report) => hasPermission(permissions, permissionFor(report)));

  return (
    <div className="space-y-6">
      <PageHeader title={t('reports.title')} description={t('reports.description')} />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((report) => (
          <li key={report.slug}>
            <Link
              to={`/reports/${report.slug}`}
              className="block h-full rounded-lg border border-border p-4 transition-colors hover:bg-accent"
            >
              <span className="font-medium">{t(`reports.items.${report.key}.title`)}</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {t(`reports.items.${report.key}.description`)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
