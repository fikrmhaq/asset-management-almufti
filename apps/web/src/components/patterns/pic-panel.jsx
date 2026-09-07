import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { usersApi } from '@/api/organization';
import { usePermission } from '@/auth/useSession';
import { formatDate } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SectionCard } from '@/components/patterns/page';

/**
 * Person in charge — Phase 21 (`CR-003`), REQ-ORG-006, REQ-LOC-009.
 *
 * One component for Departments and Locations, because they answer the same two
 * questions and the only difference is which endpoints to call. Two copies would
 * be two places for the history rendering to drift.
 *
 * THE HISTORY IS THE POINT, so it is shown, not hidden behind a link. A screen
 * that displays only the current holder is the mutable-column design the
 * assignment table exists to replace — the question that matters ("who was
 * responsible when this happened?") would have nowhere to be asked.
 *
 * A Location PIC grants no access at all, and a Department PIC grants none in
 * this phase, so this panel deliberately says nothing about permissions.
 */
export function PicPanel({ resource, recordId, institutionId, currentPic, permissionPrefix }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [userId, setUserId] = useState('');

  const canRead = usePermission(`${permissionPrefix}:read`);
  const canAssign = usePermission(`${permissionPrefix}:create`);
  const canClear = usePermission(`${permissionPrefix}:delete`);

  const history = useQuery({
    queryKey: ['pic-assignments', permissionPrefix, recordId],
    queryFn: () => resource.picAssignments(recordId),
    enabled: canRead,
  });

  /**
   * Candidates are the record's OWN institution's users — the server refuses
   * anyone else (`assertPicAssignable`), so offering a wider list would produce
   * a rejection the user could not have anticipated. Nothing is fetched until
   * the institution is known, because an unfiltered list would be the wrong one
   * rather than an empty one.
   */
  const candidates = useQuery({
    queryKey: ['pic-candidates', institutionId],
    queryFn: () => usersApi.list({ institutionId, status: 'active', pageSize: 100 }),
    enabled: canAssign && Boolean(institutionId),
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pic-assignments', permissionPrefix, recordId] }),
      queryClient.invalidateQueries({ queryKey: [permissionPrefix.split('-')[0] + 's'] }),
    ]);

  const assign = useMutation({
    mutationFn: (nextUserId) => resource.setPic(recordId, nextUserId),
    onSuccess: async () => {
      await invalidate();
      setAssigning(false);
      setUserId('');
      toast.success(t('pic.assigned'));
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const clear = useMutation({
    mutationFn: () => resource.clearPic(recordId),
    onSuccess: async () => {
      await invalidate();
      setClearing(false);
      toast.success(t('pic.cleared'));
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  if (!canRead) return null;

  const rows = history.data ?? [];
  const fullName = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : null);

  return (
    <SectionCard
      title={t('pic.title')}
      description={t('pic.description')}
      actions={
        <>
          {currentPic && canClear ? (
            <Button size="sm" variant="outline" onClick={() => setClearing(true)}>
              {t('pic.clear')}
            </Button>
          ) : null}
          {canAssign ? (
            <Button size="sm" onClick={() => setAssigning(true)} disabled={!institutionId}>
              {currentPic ? t('pic.handOver') : t('pic.assign')}
            </Button>
          ) : null}
        </>
      }
    >
      <p className="mb-4 text-sm">
        <span className="text-muted-foreground">{t('pic.current')}: </span>
        {currentPic ? (
          <span className="font-medium">
            {fullName(currentPic)}{' '}
            <span className="text-muted-foreground">({currentPic.username})</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('pic.none')}</span>
        )}
      </p>

      {/*
        A record with no institution cannot have a PIC — there is no institution
        whose staff could hold the post. Said outright rather than leaving a
        disabled button unexplained.
      */}
      {!institutionId ? (
        <p className="mb-4 text-sm text-muted-foreground">{t('pic.noInstitution')}</p>
      ) : null}

      {history.isLoading ? (
        <LoadingState variant="list" rows={2} />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={history.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('pic.empty')} description={t('pic.emptyDescription')} />
      ) : (
        <ol className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{fullName(row.user) ?? row.userId}</span>
                {row.isCurrent ? <StatusBadge value="active" /> : null}
                <span className="text-xs text-muted-foreground">
                  {formatDate(String(row.assignedAt).slice(0, 10))}
                  {row.endedAt
                    ? ` → ${formatDate(String(row.endedAt).slice(0, 10))}`
                    : ` → ${t('pic.now')}`}
                </span>
              </div>
              {row.assigner ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('pic.assignedBy', { name: fullName(row.assigner) })}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <FormDialog
        open={assigning}
        onOpenChange={setAssigning}
        title={currentPic ? t('pic.handOverTitle') : t('pic.assignTitle')}
        description={currentPic ? t('pic.handOverDescription') : t('pic.assignDescription')}
        submitLabel={t('common.actions.save')}
        loading={assign.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (userId) assign.mutate(userId);
        }}
      >
        <Field label={t('pic.person')} hint={t('pic.personHint')} required>
          {({ invalid, ...fieldProps }) => (
            <select
              {...fieldProps}
              aria-invalid={invalid || undefined}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{t('common.select.placeholder')}</option>
              {(candidates.data?.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {`${user.firstName} ${user.lastName}`.trim()} ({user.username})
                </option>
              ))}
            </select>
          )}
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={t('pic.clearTitle')}
        description={t('pic.clearDescription')}
        confirmLabel={t('pic.clear')}
        loading={clear.isPending}
        onConfirm={() => clear.mutate()}
      />
    </SectionCard>
  );
}
