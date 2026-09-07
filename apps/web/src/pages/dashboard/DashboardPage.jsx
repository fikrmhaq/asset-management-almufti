import { useTranslation } from 'react-i18next';

import { usePermission, usePicScope } from '@/auth/useSession';
import { PageHeader } from '@/components/patterns/page';

import { DASHBOARD_CARDS } from './cards';
import { CoverageCard, ActivityCard, UnassignedUnitsCard } from './AssessmentCards';
import { LocationConditionCard } from './LocationConditionCard';
import { InstitutionMetrics } from './InstitutionMetrics';

/**
 * Dashboard — `07-ui.md` §5.9.
 *
 * ── This screen finally has a specification ────────────────────────────────
 *
 * Until `CR-012` the dashboard appeared only in the §2 navigation list: no route
 * row, no requirement, no spec. The implementation deliberately confined itself
 * to figures the report endpoints already answered rather than inventing a
 * product surface, and said so in a comment. §5.9 is that missing
 * specification, so the restraint is now a rule rather than a holding position:
 * every card presents a report, and a card that cannot be opened has no business
 * being a number on a screen.
 *
 * ── A set of cards, not a page ─────────────────────────────────────────────
 *
 * Each card declares the permission that opens it (`cards.js`), and this renders
 * only the ones the caller holds. A Department PIC sees three cards about their
 * own departments; an institution administrator sees those plus the
 * institution-wide metrics.
 *
 * Cards the caller cannot open are ABSENT, not present-and-refusing — the rule
 * §5.7 already states for report cards, and the reason the page issues no query
 * it knows will answer `403`. The previous version fired five unconditional
 * report queries, which is exactly what a PIC-scoped caller could not do.
 *
 * Scope is never enforced here. The server narrows every request to the caller's
 * own departments; this decides what to ASK for, not what may be answered.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { isPicScoped } = usePicScope();

  /**
   * One `usePermission` call per card, at the top level.
   *
   * Hooks cannot run in a loop over a filtered list without risking a different
   * count between renders, and the card set is a small fixed constant — so the
   * calls are written out and the filtering happens on their results.
   */
  const canAssessment = usePermission('asset-unit:read');
  const canInstitution = usePermission('report:read');

  const held = { 'asset-unit:read': canAssessment, 'report:read': canInstitution };
  const shows = (id) => {
    const card = DASHBOARD_CARDS.find((entry) => entry.id === id);
    return held[card.permission] && !(isPicScoped && card.scoped === false);
  };

  const nothing = !canAssessment && !canInstitution;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        description={isPicScoped ? t('dashboard.descriptionScoped') : t('dashboard.description')}
      />

      {/*
        Reachable only by a caller who holds a dashboard permission — the route
        and the nav entry both gate on the derived set — so this is the
        vanishingly rare case of a permission revoked mid-session. It says so
        plainly rather than rendering an empty page that looks broken.
      */}
      {nothing ? <p className="text-sm text-muted-foreground">{t('dashboard.noCards')}</p> : null}

      {shows('assessment-coverage') ? <CoverageCard /> : null}

      {shows('assessment-activity') || shows('unassigned-units') ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {shows('assessment-activity') ? <ActivityCard /> : null}
          {shows('unassigned-units') ? <UnassignedUnitsCard /> : null}
        </div>
      ) : null}

      {shows('location-condition') ? <LocationConditionCard /> : null}

      {shows('institution-metrics') ? <InstitutionMetrics /> : null}
    </div>
  );
}
