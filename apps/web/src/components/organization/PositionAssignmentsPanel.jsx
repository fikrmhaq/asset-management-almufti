import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { departmentsApi, positionsApi, usersApi } from '@/api/organization';
import { usePermission, useSession } from '@/auth/useSession';
import { formatDate } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { NativeSelect } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SectionCard } from '@/components/patterns/page';

/**
 * School positions — Phase 35 (`CR-014` §4), `07-ui.md` §5.10, REQ-POS-001 –
 * REQ-POS-003.
 *
 * Two modes, one component:
 *
 *   user        every position the person holds or held, assigned from here
 *   department  the Kajur, Toolman and Jurusan teachers of one department
 *
 * NOT the person-in-charge panel. A position grants nothing and never touches a
 * PIC record (`BR-028`), so it is a separate section with separate wording and
 * separate permissions — never merged with `PicPanel`.
 *
 * The two teacher codes are ONE concept — a teacher without a Jurusan, and a
 * teacher for Jurusan X — so they are shown together under a single "Teacher"
 * heading and described as request contexts, never as two jobs (`CR-014` §4.2).
 *
 * Nobody assigns or ends their own position (`BR-033`): on your own record the
 * actions are not offered, and you are not offered as a candidate. The server
 * refuses both regardless; this only avoids offering what will be refused.
 */

const TEACHER_CODES = new Set(['COMMON_TEACHER', 'JURUSAN_TEACHER']);

const fullName = (person) => (person ? `${person.firstName} ${person.lastName}`.trim() : null);

export function PositionAssignmentsPanel({ mode, userId, departmentId, institutionId }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user: me } = useSession();

  const canRead = usePermission('position-assignment:read');
  const canAssign = usePermission('position-assignment:create');
  const canEnd = usePermission('position-assignment:end');
  const canReadPositions = usePermission('school-position:read');

  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState(null);
  const [form, setForm] = useState({ positionCode: '', departmentId: '', userId: '' });

  const isUserMode = mode === 'user';
  const recordId = isUserMode ? userId : departmentId;
  const isOwnRecord = isUserMode && me?.id === userId;
  const queryKey = ['position-assignments', mode, recordId];

  const assignments = useQuery({
    queryKey,
    queryFn: () =>
      isUserMode ? positionsApi.forUser(userId) : positionsApi.forDepartment(departmentId),
    enabled: canRead && Boolean(recordId),
  });

  const offerAssign = canAssign && canReadPositions && !isOwnRecord && Boolean(institutionId);

  const positions = useQuery({
    queryKey: ['school-positions'],
    queryFn: () => positionsApi.list(),
    enabled: offerAssign,
    staleTime: Infinity,
  });

  // In department mode only the department-bound posts can be held here.
  const positionOptions = useMemo(
    () => (positions.data ?? []).filter((p) => isUserMode || p.department === 'REQUIRED'),
    [positions.data, isUserMode]
  );

  const selected = positionOptions.find((p) => p.code === form.positionCode);
  const needsDepartment = selected?.department === 'REQUIRED';

  const departments = useQuery({
    queryKey: ['position-departments', institutionId],
    queryFn: () => departmentsApi.list({ institutionId, status: 'active', pageSize: 100 }),
    enabled: assigning && isUserMode && needsDepartment && Boolean(institutionId),
  });

  const candidates = useQuery({
    queryKey: ['position-candidates', institutionId],
    queryFn: () => usersApi.list({ institutionId, status: 'active', pageSize: 100 }),
    enabled: assigning && !isUserMode && Boolean(institutionId),
  });

  const reset = () => setForm({ positionCode: '', departmentId: '', userId: '' });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['position-assignments'] });

  const assign = useMutation({
    mutationFn: ({ targetUserId, body }) => positionsApi.assign(targetUserId, body),
    onSuccess: async () => {
      await invalidate();
      setAssigning(false);
      reset();
      toast.success(t('positions.assigned'));
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const end = useMutation({
    mutationFn: (assignmentId) => positionsApi.end(assignmentId),
    onSuccess: async () => {
      await invalidate();
      setEnding(null);
      toast.success(t('positions.ended'));
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  if (!canRead) return null;

  const rows = assignments.data ?? [];
  const teacherRows = rows.filter((row) => TEACHER_CODES.has(row.positionCode));
  const otherRows = rows.filter((row) => !TEACHER_CODES.has(row.positionCode));

  const label = (row) =>
    t(`positions.codes.${row.positionCode}`, {
      department: row.department?.name ?? row.department?.code ?? '',
    });

  const renderRow = (row) => (
    <li key={row.id} className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {isUserMode ? label(row) : `${fullName(row.user) ?? row.userId} · ${label(row)}`}
        </span>
        {row.isCurrent ? <StatusBadge value="active" /> : null}
        <span className="text-xs text-muted-foreground">
          {formatDate(String(row.assignedAt).slice(0, 10))}
          {row.endedAt
            ? ` → ${formatDate(String(row.endedAt).slice(0, 10))}`
            : ` → ${t('positions.now')}`}
        </span>
        {row.isCurrent && canEnd && row.userId !== me?.id ? (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEnding(row)}>
            {t('positions.end')}
          </Button>
        ) : null}
      </div>
      {row.assigner ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('positions.assignedBy', { name: fullName(row.assigner) })}
        </p>
      ) : null}
    </li>
  );

  const group = (heading, hint, list) =>
    list.length === 0 ? null : (
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{heading}</h4>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        <ol className="space-y-2">{list.map(renderRow)}</ol>
      </div>
    );

  const submitDisabled =
    !form.positionCode ||
    (needsDepartment && isUserMode && !form.departmentId) ||
    (!isUserMode && !form.userId);

  return (
    <SectionCard
      title={isUserMode ? t('positions.title') : t('positions.departmentTitle')}
      description={isUserMode ? t('positions.description') : t('positions.departmentDescription')}
      actions={
        offerAssign ? (
          <Button size="sm" onClick={() => setAssigning(true)}>
            {t('positions.assign')}
          </Button>
        ) : null
      }
    >
      {isOwnRecord ? (
        <p className="mb-4 text-sm text-muted-foreground">{t('positions.selfNote')}</p>
      ) : null}
      {isUserMode && !institutionId ? (
        <p className="mb-4 text-sm text-muted-foreground">{t('positions.noInstitution')}</p>
      ) : null}

      {assignments.isLoading ? (
        <LoadingState variant="list" rows={2} />
      ) : assignments.isError ? (
        <ErrorState error={assignments.error} onRetry={assignments.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('positions.empty')} description={t('positions.emptyDescription')} />
      ) : (
        <div className="space-y-4">
          {group(t('positions.teacherHeading'), t('positions.teacherHint'), teacherRows)}
          {group(t('positions.otherHeading'), null, otherRows)}
        </div>
      )}

      <FormDialog
        open={assigning}
        onOpenChange={(open) => {
          setAssigning(open);
          if (!open) reset();
        }}
        title={t('positions.assignTitle')}
        description={t('positions.assignDescription')}
        submitLabel={t('common.actions.save')}
        loading={assign.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (submitDisabled) return;
          const departmentForBody = isUserMode ? form.departmentId : departmentId;
          assign.mutate({
            targetUserId: isUserMode ? userId : form.userId,
            body: {
              positionCode: form.positionCode,
              ...(needsDepartment ? { departmentId: departmentForBody } : {}),
            },
          });
        }}
      >
        <Field label={t('positions.position')} required>
          {({ invalid, ...fieldProps }) => (
            <NativeSelect
              {...fieldProps}
              invalid={invalid}
              value={form.positionCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  positionCode: event.target.value,
                  departmentId: '',
                }))
              }
            >
              <option value="">{t('common.select.placeholder')}</option>
              {positionOptions.map((position) => (
                <option key={position.code} value={position.code}>
                  {t(`positions.options.${position.code}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        {isUserMode && needsDepartment ? (
          <Field label={t('positions.department')} hint={t('positions.departmentHint')} required>
            {({ invalid, ...fieldProps }) => (
              <NativeSelect
                {...fieldProps}
                invalid={invalid}
                value={form.departmentId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, departmentId: event.target.value }))
                }
              >
                <option value="">{t('common.select.placeholder')}</option>
                {(departments.data?.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name} ({department.code})
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}

        {!isUserMode ? (
          <Field label={t('positions.person')} hint={t('positions.personHint')} required>
            {({ invalid, ...fieldProps }) => (
              <NativeSelect
                {...fieldProps}
                invalid={invalid}
                value={form.userId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, userId: event.target.value }))
                }
              >
                <option value="">{t('common.select.placeholder')}</option>
                {(candidates.data?.data ?? [])
                  .filter((person) => person.id !== me?.id)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {fullName(person)} ({person.username})
                    </option>
                  ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(ending)}
        onOpenChange={(open) => (open ? null : setEnding(null))}
        title={t('positions.endTitle')}
        description={t('positions.endDescription')}
        confirmLabel={t('positions.end')}
        loading={end.isPending}
        onConfirm={() => ending && end.mutate(ending.id)}
      />
    </SectionCard>
  );
}
