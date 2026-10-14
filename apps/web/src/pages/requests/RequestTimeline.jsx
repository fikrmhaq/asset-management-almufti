import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import { documentFormData, requestsApi } from '@/api/requests';
import { formatDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SectionCard } from '@/components/patterns/page';
import { ALLOWED_EXTENSIONS, rejectionReason } from '@/components/asset/AttachmentsPanel';
import { DocumentTypeSelect } from './RequestDocumentsPanel';

/**
 * The request's workflow — Phase 38 (`CR-014` §6), `07-ui.md` §5.10.
 *
 * One entry per copied step: its position, its state, who can act now (or
 * "position vacant"), who acted and in which capacity, and the comment.
 *
 * ACTIONS ARE SHOWN ONLY WHEN THE SERVER SAYS `canAct`: the caller is the step's
 * current actor AND holds the step's permission. Oversight never makes a
 * decision or acquisition button appear (`DEC-J`).
 *
 * PROCURE is labelled by its mode — "Procurement completed" (INTERNAL) or
 * "Acquisition completed" (EXTERNAL) — and completing it never implies the
 * request is fulfilled (`BR-031`). REGISTER is shown as open; registering units
 * arrives with Phase 40.
 *
 * The acquisition declaration may carry documents (Phase 39, H2) — an invoice,
 * a payment receipt, a BAST. They are ordinary request documents: uploaded
 * FIRST, while the caller is still the PROCURE actor, then the declaration is
 * made. If an upload fails, nothing is declared; what was already uploaded
 * stays on the request. Declaring still completes PROCURE only.
 *
 * A decision's actor may also RETURN the request for revision (REQ-REQUEST-018):
 * a required reason, and an optional note per item. The steps shown are the
 * current approval round only; earlier rounds are `EarlierRounds`.
 */

const STATE_VARIANT = {
  PENDING: 'neutral',
  ACTIVE: 'default',
  APPROVED: 'success',
  REJECTED: 'destructive',
  RETURNED: 'warning',
  DONE: 'success',
  SKIPPED: 'neutral',
  CLOSED: 'neutral',
};

/** Which "… by {{name}}" phrase a finished step takes. */
function actedByKey(step) {
  if (step.stepType === 'PROCURE') return 'DONE';
  if (step.stepType === 'REGISTER') return 'COMPLETED';
  return step.state;
}

const personName = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : '');

function positionLabel(t, positionCode, department) {
  return t(`positions.codes.${positionCode}`, {
    department: department?.name ?? department?.code ?? '',
  });
}

export function RequestTimeline({ request }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // {step, kind: 'APPROVE'|'REJECT'|'REQUEST_REVISION'|'COMPLETE'}
  const [dialog, setDialog] = useState(null);
  const [text, setText] = useState('');
  // REQUEST_REVISION: item id → note; empty notes are not sent.
  const [notes, setNotes] = useState({});
  const [error, setError] = useState(null);
  // Documents to file with the acquisition declaration: {key, file, documentType}.
  const [attached, setAttached] = useState([]);
  const [attachedError, setAttachedError] = useState(null);
  const fileRef = useRef(null);
  const canAttach = Boolean(request.actions?.uploadDocument);

  const refreshDocuments = () =>
    queryClient.invalidateQueries({ queryKey: ['request', request.id, 'documents'] });

  const act = useMutation({
    mutationFn: async ({ step, kind }) => {
      if (kind !== 'COMPLETE') {
        const itemNotes =
          kind === 'REQUEST_REVISION'
            ? Object.entries(notes)
                .filter(([, note]) => note.trim())
                .map(([requestItemId, note]) => ({ requestItemId, note: note.trim() }))
            : [];
        return requestsApi.decide(step.id, kind, text.trim() || null, itemNotes);
      }

      for (const entry of attached) {
        await requestsApi.uploadDocument(request.id, documentFormData(entry));
        // Uploaded: never sent twice if the declaration is retried.
        setAttached((current) => current.filter((item) => item.key !== entry.key));
      }
      return requestsApi.complete(step.id, text.trim() || null);
    },
    onSettled: (_data, _error, { kind }) => (kind === 'COMPLETE' ? refreshDocuments() : null),
    onSuccess: async (next, { kind, step }) => {
      queryClient.setQueryData(['request', request.id], next);
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      setDialog(null);
      toast.success(
        kind === 'COMPLETE'
          ? t(`requests.workflow.completedToast.${step.procurementMode}`)
          : t(`requests.workflow.decidedToast.${kind}`)
      );
    },
    onError: (err) => toast.fromError(err, { includeValidation: true }),
  });

  const open = (step, kind) => {
    setText('');
    setNotes({});
    setError(null);
    setAttached([]);
    setAttachedError(null);
    setDialog({ step, kind });
  };

  const attach = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reason = rejectionReason(file);
    if (reason) {
      toast.error(reason);
      return;
    }
    setAttached((current) => [
      ...current,
      { key: `${Date.now()}-${current.length}`, file, documentType: '' },
    ]);
  };

  const steps = request.steps ?? [];
  if (steps.length === 0) return null;
  const returnedRound = steps.some((step) => step.state === 'RETURNED');

  // A neutral name for the step. "Procurement completed" / "Acquisition
  // completed" is the ACTION's label only — as a title it would read as done
  // while the step is still open (`BR-031`).
  const stepTitle = (step) => {
    const type =
      step.stepType === 'PROCURE'
        ? t(`requests.workflow.acquisition.${step.procurementMode}`)
        : t(`requests.workflow.types.${step.stepType}`);
    return `${type} — ${positionLabel(t, step.actorPositionCode, request.department)}`;
  };

  const describe = (step) => {
    switch (step.state) {
      case 'ACTIVE':
        if (step.vacant) return t('requests.workflow.vacant');
        return t('requests.workflow.waitingFor', {
          names: step.resolvedActors.map((actor) => actor.name).join(', '),
        });
      case 'PENDING':
        return t('requests.workflow.pending');
      case 'SKIPPED':
        return t('requests.workflow.skippedSelf');
      case 'CLOSED':
        // REQ-REQUEST-018: a round returned for revision closes its later steps.
        if (returnedRound) return t('requests.workflow.closedByRevision');
        // Phase 41 (D41-3): closing the remainder closes REGISTER while the
        // request is still open — it has not ended, so say what did happen.
        return ['APPROVED', 'PARTIALLY_FULFILLED'].includes(request.status)
          ? t('requests.workflow.closedByRemainder')
          : t('requests.workflow.closed');
      default:
        // PROCURE is a declaration; a finished REGISTER is a completed
        // registration — never worded as a procurement declaration.
        return t(`requests.workflow.actedBy.${actedByKey(step)}`, {
          name: personName(step.actedBy),
          position: step.actedAs
            ? positionLabel(t, step.actedAs.positionCode, step.actedAs.department)
            : '',
          date: step.completedAt ? formatDate(String(step.completedAt).slice(0, 10)) : '',
        });
    }
  };

  const kind = dialog?.kind;
  const revising = kind === 'REQUEST_REVISION';
  const requiresComment = kind === 'REJECT' || revising;
  const submitLabel = {
    COMPLETE: t('requests.workflow.confirmComplete'),
    REJECT: t('requests.workflow.reject'),
    REQUEST_REVISION: t('requests.workflow.requestRevision'),
  };

  return (
    <SectionCard
      title={
        request.cycle > 1
          ? `${t('requests.workflow.title')} — ${t('requests.revision.round', { number: request.cycle })}`
          : t('requests.workflow.title')
      }
      description={t('requests.workflow.description')}
    >
      <ol className="space-y-3">
        {steps.map((step) => (
          <li
            key={step.id}
            // P5 (§64.5): the Action Needed banner jumps here.
            id={`request-step-${step.id}`}
            data-testid={`step-${step.sequence}`}
            className="rounded-md border border-border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {t('requests.workflow.stepNumber', { number: step.sequence })}
              </span>
              <span className="text-sm">{stepTitle(step)}</span>
              <Badge variant={step.vacant ? 'warning' : STATE_VARIANT[step.state]}>
                {step.vacant
                  ? t('requests.workflow.vacantBadge')
                  : t(`requests.workflow.states.${step.state}`)}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{describe(step)}</p>
            {step.comment ? (
              <p className="mt-1 text-sm">
                <span className="text-muted-foreground">{t('requests.workflow.comment')}: </span>
                {step.comment}
              </p>
            ) : null}

            {step.canAct && step.stepType === 'DECIDE' ? (
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => open(step, 'APPROVE')}>
                  {t('requests.workflow.approve')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => open(step, 'REQUEST_REVISION')}>
                  {t('requests.workflow.requestRevision')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => open(step, 'REJECT')}>
                  {t('requests.workflow.reject')}
                </Button>
              </div>
            ) : null}
            {step.canAct && step.stepType === 'PROCURE' ? (
              <div className="mt-2">
                <Button size="sm" onClick={() => open(step, 'COMPLETE')}>
                  {t(`requests.workflow.procure.${step.procurementMode}`)}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      <FormDialog
        open={Boolean(dialog)}
        onOpenChange={(isOpen) => (isOpen ? null : setDialog(null))}
        title={
          kind === 'COMPLETE'
            ? t(`requests.workflow.procure.${dialog?.step.procurementMode}`)
            : t(`requests.workflow.decisionTitle.${kind ?? 'APPROVE'}`)
        }
        description={
          kind === 'COMPLETE'
            ? t('requests.workflow.completeDescription')
            : t(`requests.workflow.decisionDescription.${kind ?? 'APPROVE'}`)
        }
        submitLabel={submitLabel[kind] ?? t('requests.workflow.approve')}
        loading={act.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (requiresComment && !text.trim()) {
            setError(
              t(
                revising
                  ? 'requests.workflow.revisionReasonRequired'
                  : 'requests.workflow.commentRequired'
              )
            );
            return;
          }
          if (kind === 'COMPLETE' && attached.some((entry) => !entry.documentType)) {
            setAttachedError(t('requests.documents.typeRequired'));
            return;
          }
          act.mutate(dialog);
        }}
      >
        <Field
          label={
            kind === 'COMPLETE'
              ? t('requests.workflow.note')
              : revising
                ? t('requests.workflow.revisionReason')
                : t('requests.workflow.comment')
          }
          required={requiresComment}
          error={error}
        >
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>

        {revising && (request.items ?? []).length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('requests.workflow.itemNotesTitle')}</legend>
            <p className="text-xs text-muted-foreground">{t('requests.workflow.itemNotesHint')}</p>
            {request.items.map((item) => (
              <Field
                key={item.id}
                label={t('requests.revision.line', {
                  line: item.lineNo,
                  description: item.description,
                })}
              >
                {(fieldProps) => (
                  <Textarea
                    {...fieldProps}
                    rows={2}
                    value={notes[item.id] ?? ''}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                )}
              </Field>
            ))}
          </fieldset>
        ) : null}

        {kind === 'COMPLETE' && canAttach ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t('requests.documents.withDeclaration')}
            </legend>
            <p className="text-xs text-muted-foreground">
              {t('requests.documents.withDeclarationHint')}
            </p>
            {attached.map((entry) => (
              <div key={entry.key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{entry.file.name}</span>
                <DocumentTypeSelect
                  className="w-44"
                  aria-label={t('requests.documents.typeFor', { name: entry.file.name })}
                  invalid={Boolean(attachedError) && !entry.documentType}
                  value={entry.documentType}
                  onChange={(value) =>
                    setAttached((current) =>
                      current.map((item) =>
                        item.key === entry.key ? { ...item, documentType: value } : item
                      )
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('requests.documents.removeAttached', { name: entry.file.name })}
                  onClick={() =>
                    setAttached((current) => current.filter((item) => item.key !== entry.key))
                  }
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            {attachedError ? <p className="text-xs text-destructive">{attachedError}</p> : null}
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(',')}
              onChange={attach}
              className="hidden"
              aria-label={t('requests.documents.addDocument')}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              {t('requests.documents.addDocument')}
            </Button>
          </fieldset>
        ) : null}
      </FormDialog>
    </SectionCard>
  );
}
