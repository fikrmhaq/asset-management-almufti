import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { borrowingsApi } from '@/api/operations';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { formatDate, toIsoDate } from '@/lib/dates';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateResources } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field, FormErrorSummary } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';
import {
  DetailField,
  DetailFieldList,
  DetailPage,
  DetailTabs,
  SectionCard,
} from '@/components/patterns/page';
import { availableActions, isEditable } from './borrowingActions';
import {
  BorrowingFields,
  borrowingSchema,
  emptyBorrowing,
  toBorrowingBody,
} from './BorrowingFields';
import { BorrowingItemsPanel } from './BorrowingItemsPanel';
import { borrowings } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Borrowing detail — `07-ui.md` §5.6, `IMPLEMENTATION_PLAN.md` §20.3, §20.4;
 * REQ-BORROW-006–015.
 *
 * Which actions appear is decided by the state machine mirror (`DEC-046`), so a
 * `RETURNED` or `CANCELLED` record offers none — §20.4 requires that invalid
 * actions are not displayed at all. Each action is a separate endpoint with its
 * own permission, and each is confirmed first: all four are one-way edges, and
 * activate and return additionally move every unit the borrowing holds
 * (`DEC-013`).
 *
 * There is no "mark overdue" action. `OVERDUE` is written by the Phase 8 sweep
 * (§14.3), never by a user.
 *
 * The header is edited in place while `DRAFT` (`DEC-042`); afterwards the same
 * values are shown read-only, because `06-api.md` §7.2 rejects the `PATCH`.
 */

/** The dates ARE the history — a borrowing has no history resource (`DEC-044`). */
function Timeline({ borrowing }) {
  const { t } = useTranslation();
  const overdue =
    ['ACTIVE', 'OVERDUE'].includes(borrowing.status) &&
    borrowing.expectedReturnDate < new Date().toISOString().slice(0, 10);

  return (
    <SectionCard
      title={t('operations.borrowings.timeline')}
      description={t('operations.borrowings.timelineDescription')}
    >
      <DetailFieldList>
        <DetailField label={t('operations.borrowings.borrowed')}>
          {formatDate(borrowing.borrowDate)}
        </DetailField>
        <DetailField label={t('operations.borrowings.expectedReturn')}>
          {formatDate(borrowing.expectedReturnDate)}
          {overdue ? (
            <span className="block text-xs text-destructive">
              {t('operations.borrowings.pastDue')}
            </span>
          ) : null}
        </DetailField>
        <DetailField label={t('operations.borrowings.actualReturn')}>
          {borrowing.actualReturnDate ? formatDate(borrowing.actualReturnDate) : null}
        </DetailField>
        <DetailField label={t('common.fields.status')}>
          <StatusBadge value={borrowing.status} />
        </DetailField>
      </DetailFieldList>
    </SectionCard>
  );
}

function ReadOnlyHeader({ borrowing }) {
  const { t } = useTranslation();
  const person = borrowing.responsiblePerson;

  return (
    <DetailFieldList>
      <DetailField label={t('operations.borrowings.borrower')}>
        {borrowing.borrowerName}
      </DetailField>
      <DetailField label={t('operations.borrowings.borrowerContact')}>
        {borrowing.borrowerContact}
      </DetailField>
      <DetailField label={t('operations.borrowings.responsiblePerson')}>
        {person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : null}
      </DetailField>
      <DetailField label={t('common.fields.institution')}>
        {borrowing.institution?.name}
      </DetailField>
      <DetailField label={t('common.fields.description')} className="sm:col-span-2">
        {borrowing.description}
      </DetailField>
    </DetailFieldList>
  );
}

export function BorrowingDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = borrowings.useDetail(id);
  const update = borrowings.useUpdate();
  const canUpdate = usePermission('borrowing:update');
  const canReadItems = usePermission('borrowing-item:read');

  const [pending, setPending] = useState(null);
  const [returnForm, setReturnForm] = useState({ actualReturnDate: '', description: '' });
  const [extendForm, setExtendForm] = useState({
    expectedReturnDate: '',
    actualReturnDate: '',
    description: '',
  });

  const borrowing = query.data;
  const editable = Boolean(borrowing && isEditable(borrowing.status) && canUpdate);

  const { form, submit } = useZodForm({
    schema: borrowingSchema,
    defaultValues: emptyBorrowing,
    onSubmit: (values) => update.mutateAsync({ id, ...toBorrowingBody(values) }),
  });

  const { reset, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  useEffect(() => {
    if (!borrowing) return;

    reset({
      borrowerName: borrowing.borrowerName,
      borrowerContact: borrowing.borrowerContact,
      borrowDate: borrowing.borrowDate,
      expectedReturnDate: borrowing.expectedReturnDate,
      responsiblePersonId: borrowing.responsiblePersonId ?? '',
      institutionId: borrowing.institutionId ?? '',
      description: borrowing.description ?? '',
    });
  }, [borrowing, reset]);

  /**
   * One mutation for all four transitions: they differ only in which endpoint
   * they call and what they do afterwards, and every one of them invalidates the
   * same caches — activation and return change the LIFECYCLE STATE of every unit
   * held, so the asset and unit caches are stale too, not just this record.
   */
  const runAction = useMutation({
    mutationFn: ({ kind, body }) => {
      if (kind === 'activate') return borrowingsApi.activate(id);
      if (kind === 'cancel') return borrowingsApi.cancel(id);
      if (kind === 'return') return borrowingsApi.return(id, body);
      return borrowingsApi.extend(id, body);
    },
    onSuccess: async (data, variables) => {
      await invalidateResources(
        queryClient,
        queryKeys.borrowings,
        queryKeys.assets,
        queryKeys.assetUnits
      );

      setPending(null);

      if (variables.kind === 'extend') {
        // The current record is now RETURNED and a new DRAFT holds the same
        // units (`DEC-015`). The user's intent is to continue the loan, and that
        // DRAFT still needs activating — so go there (`DEC-047`).
        toast.success('Borrowing extended — continue on the new draft');
        navigate(`/operations/borrowings/${data.borrowing.id}`);
        return;
      }

      toast.success(
        {
          activate: 'Borrowing activated',
          cancel: 'Borrowing cancelled',
          return: 'Return recorded',
        }[variables.kind]
      );
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  if (query.isLoading) return <LoadingState variant="detail" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const actions = availableActions(borrowing.status);
  const today = toIsoDate(new Date());

  const detailsTab = (
    <div className="space-y-6">
      <SectionCard
        title={t('operations.borrowings.section')}
        description={editable ? 'Editable while the borrowing is a draft.' : undefined}
      >
        {editable ? (
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormErrorSummary error={errors.root?.server} />
            <BorrowingFields form={form} />
            <div className="flex justify-end">
              <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                Save changes
              </Button>
            </div>
          </form>
        ) : (
          <ReadOnlyHeader borrowing={borrowing} />
        )}
      </SectionCard>

      <Timeline borrowing={borrowing} />
    </div>
  );

  return (
    <DetailPage
      title={borrowing.borrowerName}
      description={borrowing.borrowerContact}
      badge={<StatusBadge value={borrowing.status} />}
      actions={
        actions.length > 0 ? (
          <>
            {actions.map((action) => (
              <Can key={action.key} code={action.permission}>
                <Button
                  variant={action.key === 'activate' ? 'default' : 'outline'}
                  onClick={() => {
                    if (action.key === 'return') {
                      setReturnForm({ actualReturnDate: today, description: '' });
                    }
                    if (action.key === 'extend') {
                      setExtendForm({
                        expectedReturnDate: '',
                        actualReturnDate: today,
                        description: '',
                      });
                    }
                    setPending(action.key);
                  }}
                >
                  {action.label}
                </Button>
              </Can>
            ))}
          </>
        ) : null
      }
    >
      <DetailTabs
        tabs={[
          { value: 'details', label: 'Details', content: detailsTab },
          ...(canReadItems
            ? [
                {
                  value: 'items',
                  label: 'Units',
                  content: <BorrowingItemsPanel borrowingId={id} editable={editable} />,
                },
              ]
            : []),
        ]}
      />

      <ConfirmDialog
        open={pending === 'activate'}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('operations.borrowings.activateTitle')}
        description="Every unit it covers moves to BORROWED. A unit that is not ACTIVE, or that another borrowing is holding, will be refused."
        confirmLabel={t('operations.borrowings.activate')}
        loading={runAction.isPending}
        onConfirm={() => runAction.mutate({ kind: 'activate' })}
      />

      <ConfirmDialog
        open={pending === 'cancel'}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('operations.borrowings.cancelTitle')}
        description={t('operations.borrowings.cancelDescription')}
        confirmLabel={t('operations.borrowings.cancelConfirm')}
        destructive
        loading={runAction.isPending}
        onConfirm={() => runAction.mutate({ kind: 'cancel' })}
      />

      <FormDialog
        open={pending === 'return'}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('operations.borrowings.returnTitle')}
        description={t('operations.borrowings.returnDescription')}
        submitLabel={t('operations.borrowings.returnSubmit')}
        loading={runAction.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          runAction.mutate({
            kind: 'return',
            body: {
              actualReturnDate: returnForm.actualReturnDate || undefined,
              description: returnForm.description || undefined,
            },
          });
        }}
      >
        <Field
          label={t('operations.borrowings.actualReturnDate')}
          hint={t('operations.borrowings.defaultsToday')}
        >
          {(fieldProps) => (
            <DatePicker
              {...fieldProps}
              value={returnForm.actualReturnDate}
              onChange={(value) =>
                setReturnForm((current) => ({ ...current, actualReturnDate: value ?? '' }))
              }
            />
          )}
        </Field>
        <Field label={t('operations.borrowings.note')}>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={2}
              value={returnForm.description}
              onChange={(event) =>
                setReturnForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          )}
        </Field>
      </FormDialog>

      <FormDialog
        open={pending === 'extend'}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('operations.borrowings.extendTitle')}
        description={t('operations.borrowings.extendDescription')}
        submitLabel={t('operations.borrowings.extend')}
        loading={runAction.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          runAction.mutate({
            kind: 'extend',
            body: {
              expectedReturnDate: extendForm.expectedReturnDate,
              actualReturnDate: extendForm.actualReturnDate || undefined,
              description: extendForm.description || undefined,
            },
          });
        }}
      >
        <Field
          label={t('operations.borrowings.newExpectedReturn')}
          hint={t('operations.borrowings.newExpectedReturnHint')}
          required
        >
          {(fieldProps) => (
            <DatePicker
              {...fieldProps}
              value={extendForm.expectedReturnDate}
              onChange={(value) =>
                setExtendForm((current) => ({ ...current, expectedReturnDate: value ?? '' }))
              }
              placeholder={t('operations.borrowings.newExpectedReturn')}
            />
          )}
        </Field>
        <Field
          label={t('operations.borrowings.closingDate')}
          hint={t('operations.borrowings.defaultsToday')}
        >
          {(fieldProps) => (
            <DatePicker
              {...fieldProps}
              value={extendForm.actualReturnDate}
              onChange={(value) =>
                setExtendForm((current) => ({ ...current, actualReturnDate: value ?? '' }))
              }
            />
          )}
        </Field>
        <Field label={t('operations.borrowings.note')}>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={2}
              value={extendForm.description}
              onChange={(event) =>
                setExtendForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          )}
        </Field>
      </FormDialog>
    </DetailPage>
  );
}
