import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { requestsApi } from '@/api/requests';
import { usePermission } from '@/auth/useSession';
import { formatDate } from '@/lib/dates';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';
import { DetailPage, SectionCard } from '@/components/patterns/page';
import { LocationSelector } from '@/components/location/LocationSelector';
import { RequestItemsEditor } from './RequestItemsEditor';
import { RequestTimeline } from './RequestTimeline';
import { RequestDocumentsPanel } from './RequestDocumentsPanel';
import { RequestRegistrationPanel } from './RequestRegistrationPanel';
import { CloseRemainderDialog, IssueDialog, ReceiptDialog } from './RequestFulfilmentDialogs';
import { RequestReceiptConfirmations } from './RequestReceiptConfirmations';
import { SubmitBlockers } from './RequestSubmitPanel';
import { ActionNeededBanner } from './ActionsNeeded';
import { SinceLastView } from './RequestUpdates';
import { isSubmittable, useSubmitRequest } from './useSubmitRequest';
import { EarlierRounds, RevisionBanner } from './RequestRevision';
import { categoryLabel, contextLabel, STATUS_VARIANT } from './requestLabels';

/**
 * Request view — Phases 37–41 (`CR-014`), `07-ui.md` §5.10.
 *
 * Which actions appear is decided by the server (`actions`, and `canAct` on each
 * step), so the screen never offers what the API refuses: submit and discard
 * for the requester's own DRAFT; cancel by the documented rules; the
 * destination change only with oversight; decisions and the acquisition
 * declaration only to a step's current actor.
 *
 * APPROVED is worded as approval, never as fulfilment: acquisition and
 * registration may proceed, and nothing is fulfilled until receipt is recorded
 * (Phase 41). No registered or received figure is shown before Phases 40–41.
 */
export function RequestDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const canReadLocations = usePermission('location:read');

  const query = useQuery({ queryKey: ['request', id], queryFn: () => requestsApi.get(id) });

  /**
   * P6 (§64.6): "Since your last view". The first answer for this request is
   * kept for the visit, then the request — this one only — is marked seen, so
   * the list stays on screen while the counts drop. Reading the detail itself
   * marks nothing; the explicit POST does.
   */
  const [sinceView, setSinceView] = useState(null);
  const markedRef = useRef(null);
  const loaded = query.data?.id === id ? query.data : null;
  useEffect(() => {
    if (!loaded || markedRef.current === id) return;
    markedRef.current = id;
    setSinceView(loaded.unseenUpdates ?? null);
    requestsApi
      .markViewed(id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['requests'] }))
      .catch(() => undefined);
  }, [loaded, id, queryClient]);

  const [ending, setEnding] = useState(null); // 'discard' | 'cancel'
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(null);
  const [changingDestination, setChangingDestination] = useState(false);
  // Phase 41: the receipt and close-remainder dialogs.
  const [receiving, setReceiving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [destination, setDestination] = useState('');

  const settle = async (next) => {
    queryClient.setQueryData(['request', id], next);
    await queryClient.invalidateQueries({ queryKey: ['requests'] });
  };

  // Shared with the edit page (P1, §64). A refusal — the draft may have changed
  // since its blockers were listed — is shown on the page, in the server's words.
  // REQ-REQUEST-018: the same call resubmits a request returned for revision.
  const submit = useSubmitRequest(id, { resubmit: Boolean(query.data?.actions?.resubmit) });

  const end = useMutation({
    mutationFn: () => requestsApi.cancel(id, reason.trim()),
    onSuccess: async (next) => {
      setEnding(null);
      await settle(next);
      toast.success(
        t(ending === 'discard' ? 'requests.workflow.discarded' : 'requests.workflow.cancelled')
      );
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const move = useMutation({
    mutationFn: () => requestsApi.update(id, { destinationLocationId: destination || null }),
    onSuccess: async () => {
      setChangingDestination(false);
      await queryClient.invalidateQueries({ queryKey: ['request', id] });
      toast.success(t('requests.workflow.destinationChanged'));
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  if (query.isLoading) return <LoadingState variant="form" rows={5} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const request = query.data;
  const actions = request.actions ?? {};
  const open = ['APPROVED', 'PARTIALLY_FULFILLED'].includes(request.status);
  const stranded = open
    ? (request.items ?? []).reduce((sum, item) => sum + (item.quantityCancellableBlocked ?? 0), 0)
    : 0;
  const settleFulfilment = async (next) => {
    queryClient.setQueryData(['request', id], next);
    await queryClient.invalidateQueries({ queryKey: ['request-item'] });
    await queryClient.invalidateQueries({ queryKey: ['requests'] });
  };

  const row = (label, value) => (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || '—'}</dd>
    </div>
  );

  const stepAnchor = (kind) => {
    const entry = (request.actionsNeeded ?? []).find((needed) => needed.kind === kind);
    return entry?.stepId ? `request-step-${entry.stepId}` : null;
  };
  const jumpTo = (anchor) => {
    const target = anchor ? document.getElementById(anchor) : null;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const openEnd = (kind) => {
    setReason('');
    setReasonError(null);
    setEnding(kind);
  };

  return (
    <DetailPage
      title={`${request.requestNumber} — ${request.title}`}
      badge={
        <Badge variant={STATUS_VARIANT[request.status]}>
          {t(`requests.statuses.${request.status}`)}
        </Badge>
      }
      actions={
        <>
          {actions.edit ? (
            <Button asChild variant="outline">
              <Link to={`/requests/${request.id}/edit`}>
                {request.status === 'REVISION_REQUESTED'
                  ? t('requests.revision.revise')
                  : t('common.actions.edit')}
              </Link>
            </Button>
          ) : null}
          {actions.discard ? (
            <Button variant="outline" onClick={() => openEnd('discard')}>
              {t('requests.workflow.discard')}
            </Button>
          ) : null}
          {actions.cancel ? (
            <Button variant="outline" onClick={() => openEnd('cancel')}>
              {t('requests.workflow.cancel')}
            </Button>
          ) : null}
          {actions.changeDestination ? (
            <Button
              variant="outline"
              onClick={() => {
                setDestination(request.destinationLocationId ?? '');
                setChangingDestination(true);
              }}
            >
              {t('requests.workflow.changeDestination')}
            </Button>
          ) : null}
          {actions.submit || actions.resubmit ? (
            <Button
              onClick={submit.open}
              disabled={!isSubmittable(request)}
              loading={submit.pending}
            >
              {t(actions.resubmit ? 'requests.workflow.resubmit' : 'requests.workflow.submit')}
            </Button>
          ) : null}
          {actions.close ? (
            <Button variant="outline" onClick={() => setClosing(true)}>
              {t('requests.close.action')}
            </Button>
          ) : null}
          {actions.receive ? (
            <Button onClick={() => setReceiving(true)}>{t('requests.receipt.action')}</Button>
          ) : null}
          {/* §73: consumables handed over from stock. */}
          {actions.issue ? (
            <Button onClick={() => setIssuing(true)}>{t('requests.issue.action')}</Button>
          ) : null}
        </>
      }
    >
      {submit.error ? (
        <Alert variant="error" title={t('requests.workflow.submitRefused')}>
          {submit.error.details?.[0]?.issue ?? submit.error.message}
        </Alert>
      ) : null}

      {/*
        P5 (§64.5): what the server says this caller needs to do here, each
        with the page's own control — the same buttons as above.
      */}
      <ActionNeededBanner
        request={request}
        onAct={{
          SUBMIT: isSubmittable(request) ? submit.open : undefined,
          RESUBMIT: isSubmittable(request) ? submit.open : undefined,
          DECIDE: () => jumpTo(stepAnchor('DECIDE')),
          PROCURE: () => jumpTo(stepAnchor('PROCURE')),
          REGISTER: () => jumpTo('request-registration'),
          RECEIVE: actions.receive ? () => setReceiving(true) : undefined,
          CLOSE: actions.close ? () => setClosing(true) : undefined,
        }}
      />

      {/* P6 (§64.6): what changed since the last view — information only. */}
      <SinceLastView
        unseen={sinceView ?? request.unseenUpdates}
        department={request.department}
      />

      {/* REQ-REQUEST-018: returned for revision — by whom, why, per item. */}
      <RevisionBanner request={request} />

      {/* P1 (§64): what stands between this draft and its submission (or resubmission). */}
      {actions.submit || actions.resubmit ? <SubmitBlockers request={request} /> : null}

      {request.requesterAssignmentCurrent === false && request.status === 'DRAFT' ? (
        <Alert variant="warning">{t('requests.contextEnded')}</Alert>
      ) : null}

      {request.status === 'APPROVED' ? (
        <Alert variant="info">{t('requests.workflow.approvedNote')}</Alert>
      ) : null}

      {/*
        Phase 41: registered units that can no longer be received keep the
        request from finishing until the remainder is closed (D41-1 b).
      */}
      {stranded > 0 ? (
        <Alert variant="warning" title={t('requests.close.strandedTitle')}>
          {t('requests.close.stranded', { count: stranded })}
        </Alert>
      ) : null}

      {['REJECTED', 'CANCELLED', 'CLOSED', 'FULFILLED'].includes(request.status) ? (
        <Alert variant="info" title={t(`requests.statuses.${request.status}`)}>
          {request.closeReason
            ? t('requests.workflow.endedWithReason', {
                date: formatDate(String(request.closedAt).slice(0, 10)),
                reason: request.closeReason,
              })
            : t('requests.workflow.ended', {
                date: formatDate(String(request.closedAt).slice(0, 10)),
              })}
        </Alert>
      ) : null}

      <SectionCard title={t('requests.headerTitle')}>
        <dl className="grid gap-4 sm:grid-cols-3">
          {row(t('requests.category'), categoryLabel(t, request.category))}
          {row(
            t('requests.requestedAs'),
            contextLabel(t, request.requesterPositionCode, request.requesterDepartment)
          )}
          {row(
            t('requests.requester'),
            request.requester
              ? `${request.requester.firstName} ${request.requester.lastName}`.trim()
              : null
          )}
          {row(t('requests.department'), request.department?.name)}
          {row(t('requests.destination'), request.destination?.name)}
          {row(t('requests.neededBy'), request.neededBy ? formatDate(request.neededBy) : null)}
          <div className="sm:col-span-3">
            {row(t('requests.justification'), request.justification)}
          </div>
        </dl>
      </SectionCard>

      <RequestTimeline request={request} />

      {/* REQ-REQUEST-018: every earlier approval round, as decided. */}
      <EarlierRounds request={request} />

      <RequestItemsEditor request={request} editable={false} />

      <div id="request-registration">
        <RequestRegistrationPanel request={request} />
      </div>

      {/* Migration 057: the requester's receipt evidence, superseded ones included. */}
      <RequestReceiptConfirmations request={request} />

      {(request.closeEvents ?? []).length > 0 ? (
        <SectionCard title={t('requests.close.historyTitle')}>
          <ul className="space-y-1 text-sm" data-testid="close-events">
            {request.closeEvents.map((event) => (
              <li key={event.id}>
                {t('requests.close.historyEntry', {
                  name: `${event.closedBy?.firstName ?? ''} ${event.closedBy?.lastName ?? ''}`.trim(),
                  date: formatDate(String(event.closedAt).slice(0, 10)),
                  reason: event.reason,
                })}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {receiving ? (
        <ReceiptDialog
          request={request}
          open
          onOpenChange={(isOpen) => !isOpen && setReceiving(false)}
          onDone={settleFulfilment}
        />
      ) : null}
      {issuing ? (
        <IssueDialog
          request={request}
          open
          onOpenChange={(isOpen) => !isOpen && setIssuing(false)}
          onDone={async (next) => {
            await settleFulfilment(next);
            await queryClient.invalidateQueries({ queryKey: ['consumables'] });
          }}
        />
      ) : null}
      {closing ? (
        <CloseRemainderDialog
          request={request}
          open
          onOpenChange={(isOpen) => !isOpen && setClosing(false)}
          onDone={settleFulfilment}
        />
      ) : null}

      <RequestDocumentsPanel request={request} />

      {submit.dialog}

      <FormDialog
        open={Boolean(ending)}
        onOpenChange={(isOpen) => (isOpen ? null : setEnding(null))}
        title={t(
          ending === 'discard' ? 'requests.workflow.discardTitle' : 'requests.workflow.cancelTitle'
        )}
        description={t(
          ending === 'discard'
            ? 'requests.workflow.discardDescription'
            : 'requests.workflow.cancelDescription'
        )}
        submitLabel={t(
          ending === 'discard' ? 'requests.workflow.discard' : 'requests.workflow.cancel'
        )}
        loading={end.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (!reason.trim()) {
            setReasonError(t('requests.workflow.reasonRequired'));
            return;
          }
          end.mutate();
        }}
      >
        <Field label={t('requests.workflow.reason')} required error={reasonError}>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormDialog>

      <FormDialog
        open={changingDestination}
        onOpenChange={setChangingDestination}
        title={t('requests.workflow.changeDestination')}
        description={t('requests.destinationHint')}
        submitLabel={t('common.actions.save')}
        loading={move.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          move.mutate();
        }}
      >
        <Field label={t('requests.destination')}>
          {(fieldProps) =>
            canReadLocations ? (
              <LocationSelector
                id={fieldProps.id}
                value={destination || null}
                allowClear
                onChange={(locationId) => setDestination(locationId ?? '')}
              />
            ) : (
              <NativeSelect
                {...fieldProps}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="">{t('requests.noDestination')}</option>
                {request.destination ? (
                  <option value={request.destination.id}>{request.destination.name}</option>
                ) : null}
              </NativeSelect>
            )
          }
        </Field>
      </FormDialog>
    </DetailPage>
  );
}
