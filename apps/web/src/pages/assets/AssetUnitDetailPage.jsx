import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Map } from 'lucide-react';

import { assetUnitsApi } from '@/api/assetCore';
import { Can } from '@/auth/guards';
import { usePermission, usePicScope } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';
import { formatDate } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import {
  DetailField,
  DetailFieldList,
  DetailPage,
  DetailTabs,
  SectionCard,
} from '@/components/patterns/page';
import { AttachmentsPanel } from '@/components/asset/AttachmentsPanel';
import { LocationPathFor, useLocationContext } from '@/components/location/LocationPath';
import { LocationSelector } from '@/components/location/LocationSelector';
import { useContractItemOptions } from '../procurement/referenceOptions';
import { formatDepartment, useDepartmentOptions } from './referenceOptions';
import { AttributeValuesTab } from './AssetDetailPage';
import { CONDITIONS } from './AssetsPage';
import { assets } from './resources';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';

/**
 * Asset unit detail — `07-ui.md` §5.3, `IMPLEMENTATION_PLAN.md` §18.4;
 * REQ-UNIT-006, REQ-LIFE-002/003, REQ-BORROW-013, REQ-TXN-006.
 *
 * Overview / Attribute Values / History / Borrowings / Transactions tabs.
 *
 * Recording a state change is ONE form, not three. Condition, location and
 * lifecycle state are a single longitudinal row (`03-domain.md` §4.12), so
 * moving a unit and re-assessing its condition are the same write; omitted
 * fields carry forward. Splitting it into three forms would invent three
 * different writes for one row.
 */

const LIFECYCLE_STATES = [
  'REGISTERED',
  'ACTIVE',
  'IN_STORAGE',
  'BORROWED',
  'UNDER_MAINTENANCE',
  'DISPOSED',
  'DEACTIVATED',
];

function HistoryTab({ unitId, canRecord }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [entry, setEntry] = useState({
    condition: '',
    locationId: '',
    lifecycleState: '',
    description: '',
  });

  const query = useQuery({
    queryKey: queryKeys.assetUnits.sub(unitId, 'history'),
    queryFn: () => assetUnitsApi.history(unitId),
  });

  const record = useMutation({
    mutationFn: (body) => assetUnitsApi.recordHistory(unitId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.assetUnits.all });
      setRecording(false);
      setEntry({ condition: '', locationId: '', lifecycleState: '', description: '' });
      toast.success(t('units.history.recorded'));
    },
    // A `CONFLICT` here is the lifecycle state machine refusing the transition
    // (REQ-LIFE-002) — the message names the states that are allowed.
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const rows = query.data?.data ?? [];

  return (
    <SectionCard
      title={t('units.history.title')}
      description={t('units.history.description')}
      actions={
        canRecord ? (
          <Button size="sm" onClick={() => setRecording(true)}>
            {t('units.history.record')}
          </Button>
        ) : null
      }
    >
      {query.isLoading ? (
        <LoadingState variant="list" rows={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('units.history.empty')}
          description={t('units.history.emptyDescription')}
        />
      ) : (
        <ol className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {row.lifecycleState ? <StatusBadge value={row.lifecycleState} /> : null}
                {row.condition ? <StatusBadge value={row.condition} /> : null}
                {/* REQ-REQUEST-024: written by receipt placement — a location,
                    never an assessment, so it carries no condition. */}
                {row.entryType === 'SYSTEM' ? (
                  <Badge variant="neutral">{t('units.history.systemPlacement')}</Badge>
                ) : null}
                {/* REQ-REQUEST-025: a Room PIC's report, confirmed by a reviewer. */}
                {row.entryType === 'REPORT' ? (
                  <Badge variant="neutral">{t('units.history.fromReport')}</Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {formatDate(row.effectiveFrom?.slice(0, 10))}
                  {row.effectiveTo
                    ? ` → ${formatDate(row.effectiveTo.slice(0, 10))}`
                    : ` → ${t('units.history.now')}`}
                </span>
              </div>
              {/* The location belongs on the entry: `LongitudinalHistory` records
                  condition, location and lifecycle state as one fact, and a
                  timeline that drops the location cannot answer where the unit
                  was last month. */}
              {row.locationId ? (
                <p className="mt-1">
                  <LocationPathFor locationId={row.locationId} linkLast />
                </p>
              ) : null}
              {row.description ? <p className="mt-1 text-sm">{row.description}</p> : null}
            </li>
          ))}
        </ol>
      )}

      <FormDialog
        open={recording}
        onOpenChange={setRecording}
        title={t('units.history.recordTitle')}
        description={t('units.history.recordDescription')}
        submitLabel={t('units.history.submit')}
        loading={record.isPending}
        className="max-w-lg"
        onSubmit={(event) => {
          event.preventDefault();
          record.mutate({
            condition: entry.condition || undefined,
            locationId: entry.locationId || undefined,
            lifecycleState: entry.lifecycleState || undefined,
            description: entry.description || undefined,
          });
        }}
      >
        <Field label={t('units.columns.condition')}>
          {({ invalid, ...fieldProps }) => (
            <select
              {...fieldProps}
              aria-invalid={invalid || undefined}
              value={entry.condition}
              onChange={(event) => setEntry((e) => ({ ...e, condition: event.target.value }))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors hover:border-border-strong focus-visible:border-brand-500 disabled:cursor-not-allowed disabled:bg-neutral-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive"
            >
              <option value="">{t('units.history.unchanged')}</option>
              {CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {t(`enums.condition.${condition}`)}
                </option>
              ))}
            </select>
          )}
        </Field>

        {/*
          Where the item has moved to, chosen by drilling the hierarchy.

          This is the case the location picker was built for. A flat dropdown of
          the first hundred locations could not say WHERE any of them was — two
          rooms called "Lab 2" were indistinguishable — and it silently omitted
          everything past the page cap, so a unit could not be recorded into a
          location the list had not reached. The picker asks the server level by
          level instead, at whatever depth the hierarchy actually has.

          Clearing it means "unchanged", the same as leaving the old select on
          its blank option: the API only records the fields that are sent.
        */}
        <Field label={t('units.columns.location')} hint={t('units.history.locationHint')}>
          {({ invalid, id }) => (
            <LocationSelector
              id={id}
              invalid={invalid}
              allowClear
              value={entry.locationId || null}
              onChange={(next) => setEntry((e) => ({ ...e, locationId: next ?? '' }))}
              placeholder={t('units.history.unchanged')}
            />
          )}
        </Field>

        <Field label={t('units.fields.lifecycleState')} hint={t('units.history.lifecycleHint')}>
          {({ invalid, ...fieldProps }) => (
            <select
              {...fieldProps}
              aria-invalid={invalid || undefined}
              value={entry.lifecycleState}
              onChange={(event) => setEntry((e) => ({ ...e, lifecycleState: event.target.value }))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors hover:border-border-strong focus-visible:border-brand-500 disabled:cursor-not-allowed disabled:bg-neutral-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive"
            >
              <option value="">{t('units.history.unchanged')}</option>
              {LIFECYCLE_STATES.map((state) => (
                <option key={state} value={state}>
                  {t(`enums.lifecycle.${state}`)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label={t('common.fields.description')}>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={2}
              value={entry.description}
              onChange={(event) => setEntry((e) => ({ ...e, description: event.target.value }))}
            />
          )}
        </Field>
      </FormDialog>
    </SectionCard>
  );
}

/**
 * Where this physical item currently is — REQ-LOC-002/005, and the way through
 * to the floor plans that show it.
 *
 * A plan is drawn for whatever level of the hierarchy someone chose to
 * photograph, so the plans that place a unit usually belong to locations ABOVE
 * it. `GET /locations/:id/context` returns every one of them along the chain,
 * root-first, each with the area marking the next step down — so this renders a
 * TRAIL, not one link: open the site plan to see which building, the building
 * plan to see which room, as far in as the plans go.
 *
 * Each link carries ITS OWN highlight, which is the whole point. One link
 * carrying the unit's own location was only ever right for the nearest plan;
 * every level above drew an ancestor instead, found no match for that id, and
 * reported "not marked out" while it was in fact marking the way in.
 *
 * NOTHING HERE COUNTS LEVELS. The trail is as long as the data says.
 */
function UnitLocation({ locationId }) {
  const { t } = useTranslation();
  const context = useLocationContext(locationId);

  if (!locationId) {
    return <span className="text-sm text-muted-foreground">{t('units.location.unrecorded')}</span>;
  }

  const plans = context.data?.floorPlans ?? [];
  const plan = context.data?.floorPlan;
  const path = context.data?.path ?? [];
  const nameOf = (id) => path.find((node) => node.id === id)?.name;
  const planOwner = plan ? path.find((node) => node.id === plan.locationId) : undefined;
  const planIsHere = plan?.locationId === locationId;

  return (
    <div className="space-y-1.5">
      <LocationPathFor locationId={locationId} />

      {context.isLoading ? null : plans.length > 0 ? (
        <div className="space-y-1.5">
          <ul
            aria-label={t('units.location.planTrail')}
            className="flex flex-wrap items-center gap-1.5"
          >
            {plans.map((entry, index) => {
              const name = nameOf(entry.locationId) ?? t('units.location.planUnknownOwner');

              return (
                <li key={entry.floorPlanId} className="flex items-center gap-1.5">
                  {index > 0 ? (
                    <ChevronRight className="h-3.5 w-3.5 text-neutral-300" aria-hidden="true" />
                  ) : null}
                  <Button asChild size="sm" variant="outline" className="h-7 gap-1.5">
                    {/* A level that draws nothing on the way down still falls
                        back to the unit's own location, so the viewer says
                        "somewhere in here" rather than highlighting nothing at
                        all. The visible name is inside the accessible one. */}
                    <Link
                      aria-label={t('units.location.viewPlanOf', { name })}
                      to={`/locations/${entry.locationId}/floor-plan?highlight=${entry.areaLocationId ?? locationId}`}
                    >
                      <Map className="h-3.5 w-3.5" aria-hidden="true" />
                      {name}
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-muted-foreground">
            {/* The trail says which plans exist; this says how precise the
                innermost one actually is about this unit. */}
            {plans.length > 1 ? `${t('units.location.planTrailHint')} ` : ''}
            {planIsHere
              ? t('units.location.planHere')
              : t('units.location.planAbove', {
                  name: planOwner?.name ?? t('units.location.planUnknownOwner'),
                }) +
                t(
                  plan?.areaId
                    ? 'units.location.planAboveMapped'
                    : 'units.location.planAboveUnmapped'
                )}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('units.location.noPlan')}</p>
      )}
    </div>
  );
}

function OperationalTab({ unitId, kind }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.assetUnits.sub(unitId, kind),
    queryFn: () =>
      kind === 'borrowings' ? assetUnitsApi.borrowings(unitId) : assetUnitsApi.transactions(unitId),
  });

  const columns =
    kind === 'borrowings'
      ? [
          {
            id: 'borrower',
            header: t('units.columns.borrower'),
            cell: ({ row }) => (
              <Link to={`/operations/borrowings/${row.original.id}`} className="hover:underline">
                {row.original.borrowerName}
              </Link>
            ),
          },
          {
            id: 'dates',
            header: t('units.columns.dates'),
            cell: ({ row }) =>
              `${formatDate(row.original.borrowDate)} → ${formatDate(row.original.expectedReturnDate)}`,
          },
          {
            id: 'status',
            header: t('common.fields.status'),
            cell: ({ row }) => <StatusBadge value={row.original.status} />,
          },
        ]
      : [
          {
            id: 'date',
            header: t('common.fields.date'),
            cell: ({ row }) => (
              <Link to={`/operations/transactions/${row.original.id}`} className="hover:underline">
                {formatDate(row.original.transactionDate)}
              </Link>
            ),
          },
          {
            id: 'type',
            header: t('units.columns.type'),
            cell: ({ row }) => row.original.transactionType?.name ?? row.original.transactionTypeId,
          },
          { accessorKey: 'description', header: t('common.fields.description') },
        ];

  return (
    <SectionCard
      title={t(kind === 'borrowings' ? 'units.tabs.borrowings' : 'units.tabs.transactions')}
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t(kind === 'borrowings' ? 'units.emptyBorrowings' : 'units.emptyTransactions')}
      />
    </SectionCard>
  );
}

/**
 * The line item this unit arrived on — REQ-PROC-006.
 *
 * `GET /asset-units/:id` carries the raw `contractItemId` and nothing else, so
 * the name comes from the parent asset's contract items and the contract number
 * from the asset itself. Without `contract-item:read` there is no name to show,
 * and the id is better than a blank that would read as "not procured".
 */
function ProcurementItem({ contractItemId, contract, label }) {
  const { t } = useTranslation();

  if (!contractItemId) {
    return <span className="text-muted-foreground">{t('units.fields.noProcurementItem')}</span>;
  }

  return (
    <>
      <span>{label ?? <span className="font-mono text-xs">{contractItemId}</span>}</span>
      {contract ? (
        <Link
          to={`/procurement/contracts/${contract.id}`}
          className="block text-xs text-muted-foreground hover:underline"
        >
          {contract.contractNumber}
        </Link>
      ) : null}
    </>
  );
}

export function AssetUnitDetailPage() {
  const { t } = useTranslation();
  const { id: assetId, unitId } = useParams();
  const queryClient = useQueryClient();
  const canRecord = usePermission('asset-unit:record-history');
  const canEditAttributes = usePermission('asset-attribute-value:update');
  const canReadBorrowings = usePermission('borrowing:read');
  const canReadTransactions = usePermission('transaction:read');
  const canReadAttachments = usePermission('attachment:read');
  const { isPicScoped } = usePicScope();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState('');
  const [contractItemId, setContractItemId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const query = useQuery({
    queryKey: queryKeys.assetUnits.detail(unitId),
    queryFn: () => assetUnitsApi.get(unitId),
  });

  /**
   * The parent asset, for its contract (REQ-ASSET-011): a unit's procurement
   * item may only belong to the contract the asset was established under, which
   * the unit response alone cannot say. Cached under the asset's own key, so
   * arriving here from the asset page costs no extra request.
   *
   * Skipped entirely without `asset:read` — `CR-005` §6. A Department PIC
   * legitimately reaches this screen through `asset-unit:read` and cannot open
   * the asset, so the request could only ever answer 403. It failed safely (403
   * is terminal in `shouldRetry`, and nothing here reads `asset.isError`), but
   * firing a forbidden request on every unit view is noise in the network log
   * and in the server's own audit of refused calls. The two controls that depend
   * on it are already hidden when it is absent.
   */
  const canReadAsset = usePermission('asset:read');
  // `enabled` replaces the hook's own `Boolean(id)` default rather than adding
  // to it, so the id check is restated here.
  const asset = assets.useDetail(assetId, { enabled: canReadAsset && Boolean(assetId) });
  const contractItems = useContractItemOptions(asset.data?.contractId);
  const canPickItem = Boolean(asset.data?.contractId) && contractItems.allowed;

  // The department a unit may take is bounded by its asset's institution
  // (`BR-007`), so the picker is fed from there rather than the caller's scope.
  const departments = useDepartmentOptions(asset.data?.institutionId);
  /**
   * Hidden entirely for a PIC-scoped caller — Phase 22 (`CR-003` §6).
   *
   * They may not change a unit's department in any direction, so the control is
   * absent rather than present-and-rejected. The server refuses it regardless;
   * this is so the screen does not offer something that cannot succeed.
   */
  const canPickDepartment =
    Boolean(asset.data?.institutionId) && departments.allowed && !isPicScoped;

  const update = useMutation({
    mutationFn: (body) => assetUnitsApi.update(unitId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.assetUnits.all });
      setEditing(false);
      toast.success(t('units.edit.updated'));
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const unit = query.data;

  if (query.isLoading) return <LoadingState variant="detail" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const tabs = [
    {
      value: 'overview',
      label: t('units.tabs.overview'),
      content: (
        <SectionCard
          title={t('units.information')}
          actions={
            <>
              {/* Only when there is something to print. A unit whose asset has
                  no institution has no code, and a print button that always
                  fails is worse than none. */}
              {unit.inventoryCode ? (
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/assets/${unit.assetId}/units/${unit.id}/label`}>
                    <Printer className="h-4 w-4" aria-hidden="true" />
                    {t('assets.label.printLabel')}
                  </Link>
                </Button>
              ) : null}
              <Can code="asset-unit:update">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDescription(unit.description ?? '');
                    setContractItemId(unit.contractItemId ?? '');
                    setDepartmentId(unit.departmentId ?? '');
                    setEditing(true);
                  }}
                >
                  {t('common.actions.edit')}
                </Button>
              </Can>
            </>
          }
        >
          <DetailFieldList>
            {/* First, because it is what a person reads off the physical item
                and quotes when asking about it. */}
            <DetailField label={t('assets.label.inventoryCode')}>
              {unit.inventoryCode ? (
                <span className="font-mono">{unit.inventoryCode}</span>
              ) : (
                <span className="text-muted-foreground" title={t('assets.label.noCodeHint')}>
                  {t('assets.label.noCode')}
                </span>
              )}
            </DetailField>
            <DetailField label={t('units.fields.lifecycleState')}>
              <StatusBadge value={unit.lifecycleState} />
            </DetailField>
            <DetailField label={t('units.fields.currentCondition')}>
              {unit.currentCondition ? <StatusBadge value={unit.currentCondition} /> : null}
            </DetailField>
            <DetailField label={t('units.fields.currentLocation')}>
              <UnitLocation locationId={unit.currentLocationId} />
            </DetailField>
            {/*
              The resolved name, not the id — Phase 20 (`CR-003` §1.4). This
              field printed a raw UUID because the detail endpoint returned
              nothing else; "not assigned" is a real state (REQ-ORG-004), so it
              is said outright rather than left blank.
            */}
            <DetailField label={t('common.fields.department')}>
              {unit.department ? (
                formatDepartment(unit.department)
              ) : (
                <span className="text-muted-foreground">{t('units.fields.noDepartment')}</span>
              )}
            </DetailField>
            {/*
              REQ-UNIT-012: the unit's OWN funding source, when it recorded one.
              A unit bought under a contract without recording one shows
              nothing here — its funding is the contract's, read there.
            */}
            {unit.fundingSource ? (
              <DetailField label={t('units.fields.fundingSource')}>
                {unit.fundingSource.code
                  ? `${unit.fundingSource.name} (${unit.fundingSource.code})`
                  : unit.fundingSource.name}
              </DetailField>
            ) : null}
            <DetailField label={t('common.fields.description')}>{unit.description}</DetailField>
            {/*
              Phase 40 (`CR-014` D7): the Request this unit was registered
              against — present only when the viewer can see that Request.
            */}
            {unit.requestItem ? (
              <DetailField label={t('units.fields.requestedVia')}>
                <Link
                  to={`/requests/${unit.requestItem.requestId}`}
                  className="text-brand-600 hover:underline"
                >
                  {unit.requestItem.requestNumber}
                </Link>{' '}
                <span className="text-muted-foreground">— {unit.requestItem.description}</span>
              </DetailField>
            ) : null}
            <DetailField label={t('units.fields.procurementItem')}>
              <ProcurementItem
                contractItemId={unit.contractItemId}
                contract={unit.contractItemId ? asset.data?.contract : null}
                label={contractItems.labels.get(unit.contractItemId)}
              />
            </DetailField>
          </DetailFieldList>
        </SectionCard>
      ),
    },
    {
      value: 'attributes',
      label: t('units.tabs.attributes'),
      content: (
        <AttributeValuesTab
          ownerId={unitId}
          canEdit={canEditAttributes}
          load={{
            key: queryKeys.assetUnits.sub(unitId, 'attribute-values'),
            fn: () => assetUnitsApi.attributeValues(unitId),
          }}
          save={{ fn: (values) => assetUnitsApi.replaceAttributeValues(unitId, values) }}
        />
      ),
    },
    {
      value: 'history',
      label: t('units.tabs.history'),
      content: <HistoryTab unitId={unitId} canRecord={canRecord} />,
    },
  ];

  // REQ-REQUEST-020: this unit's own files, registration photos among them —
  // the asset's list narrowed to the unit. Asset-level files stay on the asset.
  if (canReadAttachments) {
    tabs.push({
      value: 'attachments',
      label: t('units.tabs.attachments'),
      content: (
        <SectionCard title={t('units.tabs.attachments')}>
          <AttachmentsPanel assetId={assetId} assetUnitId={unitId} />
        </SectionCard>
      ),
    });
  }

  // Only offered when the caller can actually read them — the tab would 403.
  if (canReadBorrowings) {
    tabs.push({
      value: 'borrowings',
      label: t('units.tabs.borrowings'),
      content: <OperationalTab unitId={unitId} kind="borrowings" />,
    });
  }
  if (canReadTransactions) {
    tabs.push({
      value: 'transactions',
      label: t('units.tabs.transactions'),
      content: <OperationalTab unitId={unitId} kind="transactions" />,
    });
  }

  return (
    <DetailPage
      title={t('units.heading', { id: unit.id.slice(0, 8) })}
      description={unit.description ?? t('units.noDescription')}
      badge={<StatusBadge value={unit.lifecycleState} />}
      actions={
        <Button asChild variant="outline">
          <Link to={`/assets/${assetId}`}>{t('units.backToAsset')}</Link>
        </Button>
      }
    >
      <DetailTabs tabs={tabs} />

      <FormDialog
        open={editing}
        onOpenChange={setEditing}
        title={t('units.edit.title')}
        description={t('units.edit.description')}
        submitLabel={t('common.actions.save')}
        loading={update.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({
            description: description || null,
            // Only when the field was actually offered: sending `null` for a
            // control the caller never saw would clear a procurement line they
            // had no way to see, let alone intend to remove.
            ...(canPickItem ? { contractItemId: contractItemId || null } : {}),
            // Same conditional spread, same reason: a department control the
            // caller never saw must not clear the unit's department.
            ...(canPickDepartment ? { departmentId: departmentId || null } : {}),
          });
        }}
      >
        <Field label={t('common.fields.description')}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>

        {canPickItem ? (
          <Field label={t('units.fields.procurementItem')} hint={t('units.edit.itemHint')}>
            {({ invalid, ...fieldProps }) => (
              <select
                {...fieldProps}
                aria-invalid={invalid || undefined}
                value={contractItemId}
                onChange={(event) => setContractItemId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('units.edit.noItem')}</option>
                {contractItems.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}

        {canPickDepartment ? (
          <Field label={t('common.fields.department')} hint={t('units.fields.departmentHint')}>
            {({ invalid, ...fieldProps }) => (
              <select
                {...fieldProps}
                aria-invalid={invalid || undefined}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('units.fields.noDepartment')}</option>
                {departments.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </FormDialog>
    </DetailPage>
  );
}

export { LIFECYCLE_STATES };
