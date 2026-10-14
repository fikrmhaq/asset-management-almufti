import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { unitReportsApi } from '@/api/unitReports';
import { Button } from '@/components/ui/button';
import { Radio } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { DetailPage, SectionCard } from '@/components/patterns/page';
import { FormDialog } from '@/components/patterns/form-dialog';
import { formatDate } from '@/lib/dates';
import { CONDITIONS } from '@/pages/assets/AssetsPage';
import { REPORT_KINDS, reportWhat } from './reportLabels';
import { ReportStatusBadge } from './ReportStatusBadge';

/**
 * My rooms — REQ-REQUEST-025, `07-ui.md` (unit reports). The person in charge of
 * a room sees the units CURRENTLY in their rooms (exactly — not rooms beneath
 * them) and REPORTS what they observe: a condition, a move, or another
 * observation. A report changes nothing until a reviewer confirms it. Below,
 * their own reports and what became of them.
 */

const REPORTS_KEY = ['unit-reports'];

function ReportDialog({ unit, onOpenChange }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState('CONDITION');
  const [condition, setCondition] = useState('');
  const [destination, setDestination] = useState('');
  const [narrative, setNarrative] = useState('');
  const [errors, setErrors] = useState({});

  const destinations = useQuery({
    queryKey: [...REPORTS_KEY, 'destinations'],
    queryFn: () => unitReportsApi.destinations(),
    enabled: kind === 'MOVEMENT',
  });

  const save = useMutation({
    mutationFn: () =>
      unitReportsApi.create({
        assetUnitId: unit.id,
        kind,
        narrative: narrative.trim(),
        ...(kind === 'CONDITION' ? { reportedCondition: condition } : {}),
        ...(kind === 'MOVEMENT' ? { destinationLocationId: destination } : {}),
      }),
    onSuccess: async () => {
      toast.success(t('unitReports.filed'));
      await queryClient.invalidateQueries({ queryKey: REPORTS_KEY });
      onOpenChange(false);
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const validate = () => {
    const next = {};
    if (kind === 'CONDITION' && !condition) next.condition = t('unitReports.required');
    if (kind === 'MOVEMENT' && !destination) next.destination = t('unitReports.required');
    if (!narrative.trim()) next.narrative = t('unitReports.required');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t('unitReports.reportTitle', { code: unit.inventoryCode ?? unit.id.slice(0, 8) })}
      description={t('unitReports.reportDescription', { room: unit.currentLocation?.name ?? '' })}
      submitLabel={t('unitReports.submit')}
      loading={save.isPending}
      error={save.error}
      onSubmit={(event) => {
        event.preventDefault();
        if (validate()) save.mutate();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('unitReports.kind')}</legend>
        {REPORT_KINDS.map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <Radio
              name="report-kind"
              value={value}
              checked={kind === value}
              onChange={() => setKind(value)}
            />
            {t(`unitReports.kinds.${value}`)}
          </label>
        ))}
      </fieldset>

      {kind === 'CONDITION' ? (
        <Field label={t('unitReports.reportedCondition')} error={errors.condition} required>
          {(fieldProps) => (
            <NativeSelect
              {...fieldProps}
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
            >
              <option value="">{t('unitReports.choose')}</option>
              {CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`enums.condition.${value}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}

      {kind === 'MOVEMENT' ? (
        <Field label={t('unitReports.destination')} error={errors.destination} required>
          {(fieldProps) => (
            <NativeSelect
              {...fieldProps}
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            >
              <option value="">{t('unitReports.choose')}</option>
              {(destinations.data ?? [])
                .filter((location) => location.id !== unit.currentLocation?.id)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}

      <Field
        label={t('unitReports.narrative')}
        hint={t('unitReports.narrativeHint')}
        error={errors.narrative}
        required
      >
        {(fieldProps) => (
          <Textarea
            {...fieldProps}
            rows={3}
            maxLength={5000}
            value={narrative}
            onChange={(event) => setNarrative(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}

export function MyRoomsPage() {
  const { t } = useTranslation();
  const [reporting, setReporting] = useState(null);

  const units = useQuery({
    queryKey: [...REPORTS_KEY, 'my-units'],
    queryFn: () => unitReportsApi.myUnits(),
  });
  const mine = useQuery({
    queryKey: [...REPORTS_KEY, 'mine'],
    queryFn: () => unitReportsApi.list({ mine: 'true', pageSize: 100 }),
  });

  const unitColumns = [
    {
      id: 'code',
      header: t('unitReports.columns.unit'),
      cell: ({ row }) => <span className="font-mono">{row.original.inventoryCode ?? '—'}</span>,
    },
    {
      id: 'asset',
      header: t('unitReports.columns.asset'),
      cell: ({ row }) => row.original.assetName,
    },
    {
      id: 'room',
      header: t('unitReports.columns.room'),
      cell: ({ row }) => row.original.currentLocation?.name,
    },
    {
      id: 'condition',
      header: t('unitReports.columns.condition'),
      cell: ({ row }) =>
        row.original.currentCondition
          ? t(`enums.condition.${row.original.currentCondition}`)
          : t('unitReports.noCondition'),
    },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={() => setReporting(row.original)}>
          {t('unitReports.report')}
        </Button>
      ),
    },
  ];

  const reportColumns = [
    {
      id: 'unit',
      header: t('unitReports.columns.unit'),
      cell: ({ row }) => (
        <span className="font-mono">{row.original.unit?.inventoryCode ?? '—'}</span>
      ),
    },
    {
      id: 'what',
      header: t('unitReports.columns.what'),
      cell: ({ row }) => reportWhat(t, row.original),
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
        <span className="space-y-1">
          <ReportStatusBadge status={row.original.status} />
          {row.original.reviewNote ? (
            <span className="block text-xs text-muted-foreground">{row.original.reviewNote}</span>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <DetailPage
      title={t('unitReports.myRoomsTitle')}
      description={t('unitReports.myRoomsDescription')}
    >
      <SectionCard title={t('unitReports.unitsTitle')}>
        <DataTable
          columns={unitColumns}
          data={units.data ?? []}
          isLoading={units.isLoading}
          error={units.error}
          onRetry={units.refetch}
          emptyTitle={t('unitReports.noUnits')}
          emptyDescription={t('unitReports.noUnitsDescription')}
          getRowId={(row) => row.id}
        />
      </SectionCard>

      <SectionCard title={t('unitReports.mineTitle')}>
        <DataTable
          columns={reportColumns}
          data={mine.data?.data ?? []}
          isLoading={mine.isLoading}
          error={mine.error}
          onRetry={mine.refetch}
          emptyTitle={t('unitReports.noReports')}
          getRowId={(row) => row.id}
        />
      </SectionCard>

      {reporting ? (
        <ReportDialog
          unit={reporting}
          onOpenChange={(open) => (open ? null : setReporting(null))}
        />
      ) : null}
    </DetailPage>
  );
}
