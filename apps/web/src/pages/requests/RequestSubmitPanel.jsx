import { useTranslation } from 'react-i18next';
import { CircleAlert, Square } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/patterns/page';
import { categoryLabel, contextLabel } from './requestLabels';
import { isResubmission, isSubmittable, useSubmitRequest } from './useSubmitRequest';

/**
 * Submitting a draft — P1 (`IMPLEMENTATION_PLAN.md` §64), REQ-REQUEST-007.
 *
 * The blockers are the SERVER's (`submitBlockers` on the detail): the same
 * checks `POST /requests/:id/submit` makes, listed before anyone clicks. This
 * file only words and groups them — what the requester can fix is a checklist,
 * a missing workflow is an administrator's matter. Nothing here decides whether
 * a draft may be submitted; the submission re-checks, and its refusal is shown.
 *
 * Documents and the destination are never blockers (`CR-014` §9, §5.4).
 */

/** The blocker in the user's language; the server's text if the code is new. */
function blockerText(t, blocker, request) {
  const key = `requests.workflow.blockers.${blocker.code}`;
  const text = t(key, {
    category: categoryLabel(t, request.category),
    context: contextLabel(t, request.requesterPositionCode, request.requesterDepartment),
  });
  return text === key ? blocker.message : text;
}

/**
 * What stands between the draft and its submission, in two groups: a
 * checklist for the requester, and a note when an administrator must act.
 * Renders nothing when there is nothing in the way.
 */
export function SubmitBlockers({ request }) {
  const { t } = useTranslation();
  const blockers = request.submitBlockers ?? [];
  if (blockers.length === 0) return null;

  const mine = blockers.filter((blocker) => blocker.fixedBy !== 'ADMINISTRATOR');
  const admin = blockers.filter((blocker) => blocker.fixedBy === 'ADMINISTRATOR');

  return (
    <div className="space-y-3" data-testid="submit-blockers">
      {mine.length > 0 ? (
        <Alert variant="warning" title={t('requests.workflow.submitBlocked')}>
          <ul className="mt-1 space-y-1">
            {mine.map((blocker) => (
              <li key={blocker.code} className="flex items-start gap-2">
                <Square className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{blockerText(t, blocker, request)}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {admin.length > 0 ? (
        <Alert variant="info" title={t('requests.workflow.submitAdmin')}>
          <ul className="mt-1 space-y-1">
            {admin.map((blocker) => (
              <li key={blocker.code} className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{blockerText(t, blocker, request)}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * The edit page's Submit section: the requester completes information, items
 * and documents and submits in one place (UAT, 2026-09-28). `dirty` — the form
 * holds unsaved changes — also holds Submit back, because Submit sends the
 * SAVED draft.
 */
export function RequestSubmitSection({ request, dirty = false, onSubmitted }) {
  const { t } = useTranslation();
  // REQ-REQUEST-018: a request returned for revision is resubmitted here too.
  const resubmit = isResubmission(request);
  const submit = useSubmitRequest(request?.id, { onSubmitted, resubmit });
  if (!request?.actions?.submit && !resubmit) return null;

  const ready = isSubmittable(request);
  const key = (name) => `requests.workflow.${resubmit ? `re${name}` : name}`;

  return (
    <SectionCard title={t(key('submitSection'))}>
      <div className="space-y-3" data-testid="submit-section">
        <SubmitBlockers request={request} />
        {ready && !dirty ? (
          <p className="text-sm text-muted-foreground">{t(key('submitReady'))}</p>
        ) : null}
        {dirty ? (
          <p className="text-sm text-warning-foreground">{t(key('submitSaveFirst'))}</p>
        ) : null}
        {submit.error ? (
          <Alert variant="error" title={t('requests.workflow.submitRefused')}>
            {submit.error.details?.[0]?.issue ?? submit.error.message}
          </Alert>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={submit.open} disabled={!ready || dirty} loading={submit.pending}>
            {t(key('submit'))}
          </Button>
        </div>
      </div>
      {submit.dialog}
    </SectionCard>
  );
}
