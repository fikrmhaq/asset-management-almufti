import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { unitReportsApi } from '@/api/unitReports';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { SelectFilter } from '@/components/patterns/filters';
import { ListPage } from '@/components/patterns/page';
import { FormDialog } from '@/components/patterns/form-dialog';
import { useListParams } from '@/hooks/useListParams';
import { formatDate } from '@/lib/dates';
import { reportWhat } from './reportLabels';
import { ReportStatusBadge } from './ReportStatusBadge';

/**
 * Unit reports — the reviewer's queue, REQ-REQUEST-025. A Room PIC's report is
 * a claim: confirming a CONDITION or MOVEMENT report changes the unit (one
 * `REPORT` history row, never an assessment); confirming an OBSERVATION only
 * records it was seen; rejecting needs a note. A report whose unit changed since
 * it was filed is STALE — it can be confirmed only after saying so.
 */

const REPORTS_KEY = ['unit-reports'];
const STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED'];

const personName = (user) =>
  `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.username || '';

function stateText(t, location, condition) {
  return t('unitReports.state', {
    room: location?.name ?? t('unitReports.noLocation'),
    condition: condition ? t(`enums.condition.${condition}`) : t('unitReports.noCondition'),
  });
}

/**
 * The review of one report. It shows the report as freshly loaded, and a
 * confirmation sends back the unit state it showed (`seenHistoryId`): if the
 * unit changed after the reviewer looked, the server refuses, the report is
 * reloaded with the newer state, and any acknowledgement must be given again.
 */
function ReviewDialog({ row, onOpenChange }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [noteError, setNoteError] = useState(null);

  const detail = useQuery({
    queryKey: [...REPORTS_KEY, 'detail', row.id],
    queryFn: () => unitReportsApi.get(row.id),
  });
  const report = detail.data ?? row;
  const ready = detail.isSuccess && !detail.isFetching;

  const done = async (message) => {
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: REPORTS_KEY });
    onOpenChange(false);
  };
  const confirm = useMutation({
    mutationFn: () =>
      unitReportsApi.confirm(report.id, {
        seenHistoryId: report.currentHistoryId ?? null,
        ...(report.stale ? { acknowledgeStale: acknowledged } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => done(t('unitReports.confirmed')),
    onError: async (error) => {
      if (error?.status === 409) {
        // What was acknowledged is no longer what is there.
        setAcknowledged(false);
        await detail.refetch();
      }
      await queryClient.invalidateQueries({ queryKey: [...REPORTS_KEY, 'queue'] });
    },
  });
  const reject = useMutation({
    mutationFn: () => unitReportsApi.reject(report.id, note.trim()),
    onSuccess: () => done(t('unitReports.rejected')),
  });

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t('unitReports.reviewTitle', { code: report.unit?.inventoryCode ?? '' })}
      description={t('unitReports.reviewDescription')}
      submitLabel={t('unitReports.confirm')}
      loading={confirm.isPending || !ready}
      error={confirm.error ?? reject.error}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) confirm.mutate();
      }}
    >
      <div className="space-y-1 text-sm" data-testid="review-report">
        <p className="font-medium">{reportWhat(t, report)}</p>
        <p className="text-muted-foreground">
          {t('unitReports.reportedBy', {
            name: personName(report.reporter),
            date: formatDate(String(report.reportedAt).slice(0, 10)),
          })}
        </p>
        <p>
          {t('unitReports.whenReported')}{' '}
          {stateText(t, report.reportedState?.location, report.reportedState?.condition)}
        </p>
        <p>
          {t('unitReports.now')}{' '}
          {stateText(t, report.unit?.currentLocation, report.unit?.currentCondition)}
        </p>
      </div>

      {report.stale ? (
        <Alert variant="warning" size="sm" data-testid="review-stale">
          <p>{t('unitReports.staleWarning')}</p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <Checkbox
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            {t('unitReports.acknowledgeStale')}
          </label>
        </Alert>
      ) : null}

      <Field
        label={t('unitReports.reviewNote')}
        hint={t('unitReports.reviewNoteHint')}
        error={noteError}
      >
        {(fieldProps) => (
          <Textarea
            {...fieldProps}
            rows={2}
            maxLength={5000}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              if (event.target.value.trim()) setNoteError(null);
            }}
          />
        )}
      </Field>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          loading={reject.isPending}
          onClick={() => {
            if (!note.trim()) {
              setNoteError(t('unitReports.rejectNeedsNote'));
              return;
            }
            reject.mutate();
          }}
        >
          {t('unitReports.reject')}
        </Button>
      </div>
    </FormDialog>
  );
}

export function UnitReportsPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage } = useListParams();
  const [reviewing, setReviewing] = useState(null);

  const query = useQuery({
    queryKey: [...REPORTS_KEY, 'queue', params],
    queryFn: () => unitReportsApi.list(params),
  });

  const columns = [
    {
      id: 'unit',
      header: t('unitReports.columns.unit'),
      cell: ({ row }) => (
        <span>
          <span className="font-mono">{row.original.unit?.inventoryCode ?? '—'}</span>
          <span className="block text-xs text-muted-foreground">
            {row.original.unit?.assetName}
          </span>
        </span>
      ),
    },
    {
      id: 'what',
      header: t('unitReports.columns.what'),
      cell: ({ row }) => reportWhat(t, row.original),
    },
    {
      id: 'reporter',
      header: t('unitReports.columns.reporter'),
      cell: ({ row }) => personName(row.original.reporter),
    },
    {
      id: 'reportedAt',
      header: t('unitReports.columns.reportedAt'),
      cell: ({ row }) => formatDate(String(row.original.reportedAt).slice(0, 10)),
    },
    {
      id: 'status',
      header: t('unitReports.columns.status'),
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1">
          <ReportStatusBadge status={row.original.status} />
          {row.original.stale ? <Badge variant="warning">{t('unitReports.stale')}</Badge> : null}
        </span>
      ),
    },
    {
      id: 'action',
      header: '',
      cell: ({ row }) =>
        row.original.status === 'PENDING' ? (
          <Button size="sm" variant="outline" onClick={() => setReviewing(row.original)}>
            {t('unitReports.review')}
          </Button>
        ) : null,
    },
  ];

  return (
    <ListPage
      title={t('unitReports.queueTitle')}
      description={t('unitReports.queueDescription')}
      filters={
        <SelectFilter
          id="filter-report-status"
          label={t('unitReports.columns.status')}
          value={params.status ?? 'all'}
          options={STATUSES.map((status) => ({
            value: status,
            label: t(`unitReports.statuses.${status}`),
          }))}
          onChange={(status) => setParams({ status })}
          width="w-44"
        />
      }
      meta={query.data?.meta}
      onPageChange={setPage}
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('unitReports.queueEmpty')}
        getRowId={(row) => row.id}
      />
      {reviewing ? (
        <ReviewDialog row={reviewing} onOpenChange={(open) => (open ? null : setReviewing(null))} />
      ) : null}
    </ListPage>
  );
}
