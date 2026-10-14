import { useTranslation } from 'react-i18next';

import { formatDate } from '@/lib/dates';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { SectionCard } from '@/components/patterns/page';
import { contextLabel } from './requestLabels';

/**
 * Request Revision on screen — REQ-REQUEST-018 (`IMPLEMENTATION_PLAN.md` §65).
 *
 * The server says everything: `revision` (the decision that returned the
 * current cycle), `previousCycles` (every earlier cycle, as decided) and
 * `actions.resubmit`. This file only words it. Nothing here is actionable.
 */

const personName = (user) =>
  (user && `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()) || user?.username || '';

const day = (value) => (value ? formatDate(String(value).slice(0, 10)) : '');

/** One revision decision: who returned it, as what, when, why — and per item. */
function RevisionBody({ revision, department }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {t('requests.revision.by', {
          name: personName(revision.requestedBy),
          position: contextLabel(
            t,
            revision.actedAs?.positionCode ?? revision.actorPositionCode,
            revision.actedAs?.department ?? department
          ),
          date: day(revision.requestedAt),
        })}
      </p>
      <p className="text-sm">
        <span className="font-medium">{t('requests.revision.reason')}: </span>
        <span className="whitespace-pre-line">{revision.reason}</span>
      </p>
      {revision.itemNotes.length > 0 ? (
        <div>
          <p className="text-sm font-medium">{t('requests.revision.itemNotes')}</p>
          <ul className="mt-1 space-y-1 text-sm" data-testid="revision-item-notes">
            {revision.itemNotes.map((note) => (
              <li key={note.id}>
                <span className="text-muted-foreground">
                  {t('requests.revision.line', {
                    line: note.lineNo,
                    description: note.itemDescription,
                  })}
                  {note.requestItemId ? '' : ` ${t('requests.revision.removedItem')}`}
                  {': '}
                </span>
                <span className="whitespace-pre-line">{note.note}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The banner of a request returned for revision — on its page and on the edit
 * page. Shown while it is returned; after it ends that way the timeline keeps
 * the record.
 */
export function RevisionBanner({ request, editing = false }) {
  const { t } = useTranslation();
  if (request.status !== 'REVISION_REQUESTED' || !request.revision) return null;
  return (
    <Alert variant="warning" title={t('requests.revision.title')} data-testid="revision-banner">
      <RevisionBody revision={request.revision} department={request.department} />
      {request.actions?.resubmit ? (
        <p className="mt-2 text-sm">
          {t(editing ? 'requests.revision.editHint' : 'requests.revision.reviseHint')}
        </p>
      ) : null}
    </Alert>
  );
}

const STATE_VARIANT = {
  APPROVED: 'success',
  REJECTED: 'destructive',
  RETURNED: 'warning',
  SKIPPED: 'neutral',
  CLOSED: 'neutral',
};

/**
 * Every earlier approval round, oldest first, exactly as decided: each step's
 * outcome and the revision that ended the round. History only.
 */
export function EarlierRounds({ request }) {
  const { t } = useTranslation();
  const rounds = request.previousCycles ?? [];
  if (rounds.length === 0) return null;

  return (
    <SectionCard
      title={t('requests.revision.earlierRounds')}
      description={t('requests.revision.earlierRoundsDescription')}
    >
      <div className="space-y-3" data-testid="earlier-rounds">
        {rounds.map((round) => (
          <details key={round.cycle} className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              {t('requests.revision.round', { number: round.cycle })}
              <span className="ml-2 font-normal text-muted-foreground">
                {t('requests.revision.roundStarted', { date: day(round.startedAt) })}
              </span>
            </summary>
            <ol className="mt-2 space-y-1 text-sm">
              {round.steps.map((step) => (
                <li key={step.id} className="flex flex-wrap items-center gap-2">
                  <span>{t('requests.workflow.stepNumber', { number: step.sequence })}</span>
                  <span>{contextLabel(t, step.actorPositionCode, request.department)}</span>
                  <Badge variant={STATE_VARIANT[step.state] ?? 'neutral'}>
                    {t(`requests.workflow.states.${step.state}`)}
                  </Badge>
                  {step.actedBy && step.state !== 'RETURNED' ? (
                    <span className="text-muted-foreground">
                      {personName(step.actedBy)} · {day(step.completedAt)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            {round.revision ? (
              <div className="mt-3 border-t border-border pt-3">
                <RevisionBody revision={round.revision} department={request.department} />
              </div>
            ) : null}
          </details>
        ))}
      </div>
    </SectionCard>
  );
}
