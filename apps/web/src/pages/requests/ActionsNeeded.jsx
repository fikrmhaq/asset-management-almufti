import { useTranslation } from 'react-i18next';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Action Needed on screen — P5 (`IMPLEMENTATION_PLAN.md` §64.5),
 * REQ-REQUEST-016. What the server says the caller needs to do (`actionsNeeded`
 * on every list row and on the detail); this file decides nothing.
 *
 * Kept apart from informational updates (P6): these name an action, never a
 * change.
 */

const STEP_KINDS = ['DECIDE', 'PROCURE', 'REGISTER'];

/** The kinds that can be blocked by what submission would refuse (REQ-REQUEST-018). */
const SUBMIT_KINDS = ['SUBMIT', 'RESUBMIT'];

/** The chips of one list row — "Record receipt", "Approve"… or a dash. */
export function ActionChips({ needed = [] }) {
  const { t } = useTranslation();
  if (needed.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {needed.map((entry) => (
        <span key={entry.kind} className="inline-flex flex-wrap items-center gap-1">
          <Badge className="border-transparent bg-primary text-primary-foreground">
            {t(`requests.actionsNeeded.kinds.${entry.kind}`)}
          </Badge>
          {SUBMIT_KINDS.includes(entry.kind) && entry.blocked ? (
            <Badge variant="warning">{t('requests.actionsNeeded.blocked')}</Badge>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/**
 * The top-of-page banner on a request: each needed action, with the button that
 * does it — the page's own button (`onAct`) or a jump to the section holding it.
 *
 * @param {{request: object, onAct: Record<string, () => void>}} props
 */
export function ActionNeededBanner({ request, onAct }) {
  const { t } = useTranslation();
  const needed = request.actionsNeeded ?? [];
  if (needed.length === 0) return null;

  return (
    <Alert variant="info" title={t('requests.actionsNeeded.bannerTitle')}>
      <p>{t('requests.actionsNeeded.bannerDescription')}</p>
      <ul className="mt-2 space-y-2" data-testid="action-needed-banner">
        {needed.map((entry) => {
          const blocked = SUBMIT_KINDS.includes(entry.kind) && entry.blocked;
          const act = onAct[entry.kind];
          const label = t(`requests.actionsNeeded.kinds.${entry.kind}`);
          // A step's action has its own controls (Approve / Reject, the
          // declaration, the register dialog): the banner takes you there
          // rather than acting on your behalf.
          const jumps = STEP_KINDS.includes(entry.kind);
          return (
            <li key={entry.kind} className="flex flex-wrap items-center gap-2">
              {jumps ? (
                <>
                  <span className="font-medium">{label}</span>
                  <Button size="sm" variant="outline" disabled={!act} onClick={act}>
                    {t('requests.actionsNeeded.goTo')}
                  </Button>
                </>
              ) : (
                <Button size="sm" disabled={blocked || !act} onClick={act}>
                  {label}
                </Button>
              )}
              {blocked ? (
                <span className="text-xs">{t('requests.actionsNeeded.submitBlocked')}</span>
              ) : null}
              {entry.kind === 'CLOSE' ? (
                <span className="text-xs">{t('requests.actionsNeeded.closeHint')}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Alert>
  );
}
