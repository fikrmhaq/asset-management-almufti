import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { requestsApi } from '@/api/requests';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';

/**
 * Submitting a draft — P1 (`IMPLEMENTATION_PLAN.md` §64). Shared by the edit
 * page and the request page; the blockers themselves are the server's
 * (`submitBlockers`, shown by `RequestSubmitPanel.jsx`).
 */

/**
 * Whether the draft may be submitted — or the request returned for revision
 * resubmitted (REQ-REQUEST-018) — now, as far as the server has said.
 */
export const isSubmittable = (request) =>
  Boolean(request?.actions?.submit || request?.actions?.resubmit) &&
  (request.submitBlockers ?? []).length === 0;

/** Whether submitting is a resubmission after revision (the same call, D2). */
export const isResubmission = (request) => Boolean(request?.actions?.resubmit);

/**
 * The submit mutation and its confirmation, shared by the edit page and the
 * request page — called before the request has loaded, so it takes the id.
 * `onSubmitted(next)` receives the submitted request. `resubmit` words the
 * confirmation for a request returned for revision.
 */
export function useSubmitRequest(requestId, { onSubmitted, resubmit = false } = {}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  const mutation = useMutation({
    mutationFn: () => requestsApi.submit(requestId),
    onSuccess: async (next) => {
      setConfirming(false);
      setError(null);
      queryClient.setQueryData(['request', requestId], next);
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      toast.success(t(resubmit ? 'requests.workflow.resubmitted' : 'requests.workflow.submitted'));
      await onSubmitted?.(next);
    },
    onError: (err) => {
      setConfirming(false);
      // Shown on the page, in the server's words: the draft may have changed
      // since the blockers were listed.
      setError(err);
      queryClient.invalidateQueries({ queryKey: ['request', requestId] });
    },
  });

  const dialog = (
    <ConfirmDialog
      open={confirming}
      onOpenChange={(isOpen) => (isOpen ? null : setConfirming(false))}
      title={t(resubmit ? 'requests.workflow.resubmitTitle' : 'requests.workflow.submitTitle')}
      description={t(
        resubmit ? 'requests.workflow.resubmitDescription' : 'requests.workflow.submitDescription'
      )}
      confirmLabel={t(resubmit ? 'requests.workflow.resubmit' : 'requests.workflow.submit')}
      loading={mutation.isPending}
      onConfirm={() => mutation.mutate()}
    />
  );

  return { open: () => setConfirming(true), error, pending: mutation.isPending, dialog };
}
