import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { requestsApi } from '@/api/requests';
import { normalizeError } from '@/api/errors';
import { assetsApi, assetUnitsApi } from '@/api/assetCore';
import { usePermission } from '@/auth/useSession';
import { formatDate } from '@/lib/dates';
import { StatusBadge, statusLabel } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SectionCard } from '@/components/patterns/page';
import { ClassificationField } from '@/components/reference/ClassificationPicker';
import { formatDepartment, useDepartmentOptions } from '@/pages/assets/referenceOptions';
import { useFundingSourceOptions } from '@/pages/procurement/referenceOptions';
import { UnitNumberFields } from '@/components/asset/UnitNumberFields';
import { unitNumbersReady } from '@/components/asset/unitNumbers';
import { RegistrationPhotosDialog } from './RegistrationPhotos';
import { RegistrationSpecificationsDialog } from './RegistrationSpecifications';

/**
 * Registration against request items — Phase 40 (`CR-014` §7.1 – §7.3),
 * `07-ui.md` §5.10, REQ-REQUEST-010.
 *
 * REGISTRATION IS NOT RECEIPT. A registered unit is linked to an item — nothing
 * here says the requester received it, and nothing offers to record that
 * (`BR-031`, decision D10). Receipt and fulfilment are Phase 41.
 *
 * What is offered follows the server: register and link only when the REGISTER
 * step's `canAct` is set (its current actor holding the code); unlink per link
 * from `canUnlink`. Registered is the number of links (D4): an inactive or
 * disposed unit keeps its link and still counts, its current state shown beside
 * it. Registration never moves a unit (D1), so there is no location field.
 *
 * REQ-REQUEST-020: each registered unit the caller reaches offers its
 * registration photos to a holder of `attachment:create` — whatever the state of
 * the REGISTER step, since registering the last unit closes it.
 *
 * REQ-REQUEST-021: likewise its specifications, to a holder of
 * `asset-attribute-value:read` — saved apart from registration, never part of it.
 */

const MAX_UNITS = 500;

/**
 * Per item: its registered units, with unlink where the server allows it, and
 * (Phase 41) each unit's receipt, its reversal history, and "reverse" where the
 * server allows it.
 */
function ItemUnits({ item, onChanged }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [unlinking, setUnlinking] = useState(null);
  // Phase 41: reversing a receipt — oversight only, with a required reason.
  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(null);
  // REQ-REQUEST-020: the unit whose registration photos are open.
  const [photographing, setPhotographing] = useState(null);
  const canAttach = usePermission('attachment:create');
  // REQ-REQUEST-021: the unit whose specifications are open.
  const [specifying, setSpecifying] = useState(null);
  const canSpecify = usePermission('asset-attribute-value:read');
  const key = ['request-item', item.id, 'units'];

  const query = useQuery({ queryKey: key, queryFn: () => requestsApi.listItemUnits(item.id) });

  const unlink = useMutation({
    mutationFn: (linkId) => requestsApi.unlinkUnit(linkId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      await onChanged();
      toast.success(t('requests.registration.unlinked'));
    },
    onError: (error) => toast.fromError(error),
  });

  const reverse = useMutation({
    mutationFn: () => requestsApi.reverseReceipt(reversing.receipt.id, reason.trim()),
    onSuccess: async (next) => {
      setReversing(null);
      await queryClient.invalidateQueries({ queryKey: key });
      await onChanged(next);
      toast.success(t('requests.receipt.reversed'));
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  if (query.isLoading) return <LoadingState variant="list" rows={1} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  const links = query.data ?? [];
  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('requests.registration.none')}</p>;
  }

  return (
    <>
      <ul className="space-y-1">
        {links.map((row) => {
          const unit = row.assetUnit;
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                {/*
                  The unit's own detail page, which enforces its own reach. A
                  unit outside the caller's department (P3, §64.3 — a link made
                  before the rule) stays on the request, read-only, unlinked.
                */}
                {unit.accessible === false ? (
                  <span className="font-mono" data-testid={`unit-outside-${unit.id}`}>
                    {unit.inventoryCode ?? unit.id.slice(0, 8)}
                  </span>
                ) : (
                  <Link
                    to={`/assets/${unit.asset?.id}/units/${unit.id}`}
                    className="font-mono text-brand-600 hover:underline"
                  >
                    {unit.inventoryCode ?? unit.id.slice(0, 8)}
                  </Link>
                )}{' '}
                {unit.accessible === false ? (
                  <span className="text-xs text-muted-foreground">
                    {t('requests.registration.outsideDepartment')}{' '}
                  </span>
                ) : null}
                <span className="text-muted-foreground">
                  {unit.asset?.name}
                  {unit.department ? ` · ${formatDepartment(unit.department)}` : ''}
                  {unit.currentLocation ? ` · ${unit.currentLocation.name}` : ''}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t('requests.registration.linkedBy', {
                    name: `${row.linkedBy?.firstName ?? ''} ${row.linkedBy?.lastName ?? ''}`.trim(),
                    date: formatDate(String(row.linkedAt).slice(0, 10)),
                  })}
                </span>
                {/*
                  Phase 41 — receipt is its own fact. "Receipt not yet recorded"
                  never means "not arrived" (BR-031).
                */}
                <span className="block text-xs" data-testid={`receipt-${row.id}`}>
                  {row.receipt
                    ? t('requests.receipt.recordedLine', {
                        receivedOn: formatDate(String(row.receipt.receivedOn)),
                        name: `${row.receipt.recordedBy?.firstName ?? ''} ${row.receipt.recordedBy?.lastName ?? ''}`.trim(),
                        date: formatDate(String(row.receipt.recordedAt).slice(0, 10)),
                      })
                    : row.receivable
                      ? t('requests.receipt.notRecorded')
                      : t('requests.receipt.cannotReceive')}
                </span>
                {(row.receipts ?? [])
                  .filter((receipt) => receipt.reversedAt)
                  .map((receipt) => (
                    <span key={receipt.id} className="block text-xs text-muted-foreground">
                      {t('requests.receipt.reversedLine', {
                        receivedOn: formatDate(String(receipt.receivedOn)),
                        name: `${receipt.reversedBy?.firstName ?? ''} ${receipt.reversedBy?.lastName ?? ''}`.trim(),
                        date: formatDate(String(receipt.reversedAt).slice(0, 10)),
                        reason: receipt.reversalReason,
                      })}
                    </span>
                  ))}
              </span>
              <span className="flex items-center gap-2">
                {/*
                  The unit's CURRENT state, always, with the existing translated
                  labels — shown apart from the link, which counts regardless (D4).
                */}
                <StatusBadge value={unit.lifecycleState} kind="lifecycle" />
                {unit.isActive ? null : <StatusBadge value="inactive" />}
                {canSpecify && unit.accessible !== false && unit.asset?.id ? (
                  <Button size="sm" variant="ghost" onClick={() => setSpecifying(unit)}>
                    {t('requests.registration.specifications.action')}
                  </Button>
                ) : null}
                {canAttach && unit.accessible !== false && unit.asset?.id ? (
                  <Button size="sm" variant="ghost" onClick={() => setPhotographing(unit)}>
                    {t('requests.registration.photos.action')}
                  </Button>
                ) : null}
                {row.canUnlink ? (
                  <Button size="sm" variant="ghost" onClick={() => setUnlinking(row)}>
                    {t('requests.registration.unlink')}
                  </Button>
                ) : null}
                {row.canReverse ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setReason('');
                      setReasonError(null);
                      setReversing(row);
                    }}
                  >
                    {t('requests.receipt.reverse')}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {specifying ? (
        <RegistrationSpecificationsDialog
          unit={specifying}
          open
          onOpenChange={(open) => !open && setSpecifying(null)}
        />
      ) : null}
      {photographing ? (
        <RegistrationPhotosDialog
          unit={photographing}
          open
          onOpenChange={(open) => !open && setPhotographing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(unlinking)}
        onOpenChange={(open) => !open && setUnlinking(null)}
        title={t('requests.registration.unlinkTitle')}
        description={t('requests.registration.unlinkDescription', {
          code: unlinking?.assetUnit.inventoryCode ?? '',
        })}
        confirmLabel={t('requests.registration.unlink')}
        destructive
        loading={unlink.isPending}
        onConfirm={async () => {
          await unlink.mutateAsync(unlinking.id).catch(() => undefined);
          setUnlinking(null);
        }}
      />
      <FormDialog
        open={Boolean(reversing)}
        onOpenChange={(open) => !open && setReversing(null)}
        title={t('requests.receipt.reverseTitle', {
          code: reversing?.assetUnit.inventoryCode ?? '',
        })}
        description={t('requests.receipt.reverseDescription')}
        submitLabel={t('requests.receipt.reverse')}
        loading={reverse.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (!reason.trim()) {
            setReasonError(t('requests.receipt.reasonRequired'));
            return;
          }
          reverse.mutate();
        }}
      >
        <Field label={t('requests.receipt.reason')} error={reasonError} required>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </FormDialog>
    </>
  );
}

/** Register new units against one item — under an existing asset or a new one. */
function RegisterUnitsDialog({ request, item, open, onOpenChange, onDone }) {
  const { t } = useTranslation();
  const canPickAsset = usePermission('asset:read');
  const canCreateAsset = usePermission('asset:create');
  const departments = useDepartmentOptions(request.institutionId);
  const composition = request.unitRegistration?.numberComposition;
  const needsComposition = Boolean(composition?.required);
  const perUnit = needsComposition && composition.perUnit;
  const remaining = item?.quantityNotYetRegistered ?? 0;
  // REQ-UNIT-012: offered where the institution's inventory code carries the
  // funding source. Required only when the asset has no contract naming one —
  // the server decides, and says so on this field.
  const fundingInCode = Boolean(request.unitRegistration?.fundingSource?.inCode);
  const fundingSources = useFundingSourceOptions();
  // P3 (§64.3): a department-bound REGISTER step registers for the request's
  // department only — shown, not chosen. The server refuses any other.
  const departmentFixed = Boolean(request.unitRegistration?.departmentFixed);

  const [mode, setMode] = useState(canCreateAsset ? 'new' : 'existing');
  const [assetId, setAssetId] = useState('');
  const [term, setTerm] = useState('');
  const [name, setName] = useState(item?.description ?? '');
  const [classification, setClassification] = useState(
    item?.classification ? { id: item.classification.id, name: item.classification.name } : null
  );
  const [unitCount, setUnitCount] = useState(String(Math.min(remaining, MAX_UNITS) || 1));
  const [departmentId, setDepartmentId] = useState(request.departmentId ?? '');
  // P4 (§64.4): one Unit number per unit — or one for the batch where the
  // format's sequence separates the units — each with its live inventory code.
  const [unitNumbers, setUnitNumbers] = useState([]);
  const [fundingSourceId, setFundingSourceId] = useState('');
  const [errors, setErrors] = useState({});
  const [triedSubmit, setTriedSubmit] = useState(false);

  const requestedCount = Number(unitCount);
  const fieldCount = !perUnit
    ? 1
    : Number.isInteger(requestedCount) && requestedCount >= 1
      ? Math.min(requestedCount, Math.max(remaining, 1), MAX_UNITS)
      : 1;
  const unitNumberValues = Array.from({ length: fieldCount }, (_, at) => unitNumbers[at] ?? '');
  // What reaches the code besides the unit number, exactly as the save below
  // sends it; `null` until the asset (or a new one's classification) is known.
  const previewTarget =
    mode === 'existing'
      ? assetId
        ? { assetId }
        : null
      : classification
        ? { classificationId: classification.id, institutionId: request.institutionId }
        : null;
  const previewRequest =
    needsComposition && previewTarget
      ? {
          ...previewTarget,
          departmentId: departmentFixed ? (request.departmentId ?? null) : departmentId || null,
          ...(fundingSourceId ? { fundingSourceId: Number(fundingSourceId) } : {}),
        }
      : null;

  const assetParams = {
    pageSize: 20,
    status: 'active',
    ...(term.trim() ? { q: term.trim() } : {}),
  };
  const assets = useQuery({
    queryKey: ['assets', 'register-picker', assetParams],
    queryFn: () => assetsApi.list(assetParams),
    enabled: open && mode === 'existing' && canPickAsset,
  });
  const assetOptions = (assets.data?.data ?? [])
    .filter((asset) => asset.institutionId === request.institutionId)
    .map((asset) => ({ value: asset.id, label: asset.name }));

  const save = useMutation({
    mutationFn: () =>
      requestsApi.registerUnits(item.id, {
        ...(mode === 'existing'
          ? { assetId }
          : { name: name.trim(), classificationId: classification.id }),
        unitCount: Number(unitCount),
        ...(departmentFixed ? {} : { departmentId: departmentId || null }),
        ...(needsComposition
          ? perUnit
            ? { numberCompositions: unitNumberValues.map((value) => value.trim()) }
            : { numberComposition: unitNumberValues[0].trim() }
          : {}),
        ...(fundingSourceId ? { fundingSourceId: Number(fundingSourceId) } : {}),
      }),
    onSuccess: async (result) => {
      toast.success(t('requests.registration.registered', { count: result.units.length }));
      await onDone(result.request);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.fromError(error, { includeValidation: true });
      // The funding source refusal belongs beside its field, not only in a toast.
      const fieldErrors = normalizeError(error).fieldErrors ?? {};
      const funding = fieldErrors.fundingSourceId ?? fieldErrors['body.fundingSourceId'];
      if (funding) setErrors((current) => ({ ...current, fundingSource: funding }));
      // The server's word on the unit numbers (a code issued meanwhile — `409`)
      // stays beside them: the preview only advised.
      const unitNumber = fieldErrors.numberCompositions ?? fieldErrors.numberComposition;
      if (unitNumber) setErrors((current) => ({ ...current, unitNumbers: unitNumber }));
    },
  });

  const submit = (event) => {
    event.preventDefault();
    const count = Number(unitCount);
    const next = {};
    if (mode === 'existing' && !assetId) next.asset = t('requests.registration.assetRequired');
    if (mode === 'new' && !name.trim()) next.name = t('requests.registration.nameRequired');
    if (mode === 'new' && !classification) {
      next.classification = t('requests.registration.classificationRequired');
    }
    if (!Number.isInteger(count) || count < 1 || count > remaining) {
      next.unitCount = t('requests.registration.countRange', { max: remaining });
    }
    // Empty and repeated unit numbers are known here; everything else is the
    // server's to decide, and registration decides it again regardless.
    if (needsComposition && !unitNumbersReady(unitNumberValues, { perUnit })) {
      next.unitNumbers = t('units.unitNumber.fixBeforeRegistering');
    }
    setTriedSubmit(true);
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('requests.registration.registerTitle', { item: item?.description ?? '' })}
      description={t('requests.registration.registerDescription', { remaining })}
      submitLabel={t('requests.registration.register')}
      loading={save.isPending}
      onSubmit={submit}
    >
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">{t('requests.registration.assetChoice')}</legend>
        {canCreateAsset ? (
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="asset-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            {t('requests.registration.newAsset')}
          </label>
        ) : null}
        {canPickAsset ? (
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="asset-mode"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
            />
            {t('requests.registration.existingAsset')}
          </label>
        ) : null}
      </fieldset>

      {mode === 'existing' ? (
        <Field label={t('requests.registration.asset')} error={errors.asset}>
          {(fieldProps) => (
            <Combobox
              {...fieldProps}
              options={assetOptions}
              value={assetId}
              onChange={setAssetId}
              onSearchChange={setTerm}
              loading={assets.isFetching}
              placeholder={t('requests.registration.assetPlaceholder')}
            />
          )}
        </Field>
      ) : (
        <>
          <Field label={t('requests.registration.name')} error={errors.name} required>
            {(fieldProps) => (
              <Input {...fieldProps} value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field
            label={t('requests.registration.classification')}
            error={errors.classification}
            required
          >
            {(fieldProps) => (
              <ClassificationField
                {...fieldProps}
                value={classification}
                onChange={setClassification}
                institutionId={request.institutionId}
              />
            )}
          </Field>
        </>
      )}

      <Field
        label={t('requests.registration.unitCount')}
        error={errors.unitCount}
        hint={t('requests.registration.remaining', { remaining })}
        required
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="number"
            min={1}
            max={remaining}
            value={unitCount}
            onChange={(e) => setUnitCount(e.target.value)}
          />
        )}
      </Field>

      {departmentFixed ? (
        <Field
          label={t('requests.registration.department')}
          hint={t('requests.registration.departmentFixedHint')}
        >
          {() => (
            <p className="text-sm font-medium" data-testid="register-department-fixed">
              {request.department ? formatDepartment(request.department) : '—'}
            </p>
          )}
        </Field>
      ) : departments.allowed ? (
        <Field label={t('requests.registration.department')}>
          {(fieldProps) => (
            <NativeSelect
              {...fieldProps}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t('requests.registration.noDepartment')}</option>
              {departments.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}

      {fundingInCode ? (
        <Field
          label={t('requests.registration.fundingSource')}
          hint={
            fundingSources.allowed
              ? t('requests.registration.fundingSourceHint')
              : t('requests.registration.fundingSourceNoAccess')
          }
          error={errors.fundingSource}
        >
          {(fieldProps) => (
            <NativeSelect
              {...fieldProps}
              value={fundingSourceId}
              disabled={!fundingSources.allowed}
              onChange={(e) => {
                setFundingSourceId(e.target.value);
                setErrors((current) => ({ ...current, fundingSource: undefined }));
              }}
            >
              <option value="">{t('requests.registration.noFundingSource')}</option>
              {fundingSources.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}

      {needsComposition ? (
        <UnitNumberFields
          values={unitNumberValues}
          onChange={(next) => {
            setUnitNumbers(next);
            setErrors((current) => ({ ...current, unitNumbers: undefined }));
          }}
          perUnit={perUnit}
          maxLength={composition.maxLength}
          unitCount={Number.isInteger(requestedCount) ? requestedCount : 1}
          previewRequest={previewRequest}
          waitingFor={
            previewTarget
              ? undefined
              : mode === 'existing'
                ? t('units.unitNumber.waitingForAsset')
                : t('units.unitNumber.waitingForClassification')
          }
          showErrors={triedSubmit}
          error={errors.unitNumbers}
        />
      ) : null}

      <p className="text-xs text-muted-foreground">{t('requests.registration.notReceipt')}</p>
    </FormDialog>
  );
}

/** Link one existing unit, found by inventory code (D11). The server decides. */
function LinkUnitDialog({ item, open, onOpenChange, onDone }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [found, setFound] = useState(null);
  const [lookupError, setLookupError] = useState(null);

  const lookup = useMutation({
    mutationFn: () => assetUnitsApi.byCode(code.trim()),
    onSuccess: (unit) => {
      setFound(unit);
      setLookupError(null);
    },
    onError: () => {
      setFound(null);
      setLookupError(t('requests.registration.notFound'));
    },
  });

  const save = useMutation({
    mutationFn: () => requestsApi.linkUnit(item.id, found.id),
    onSuccess: async (result) => {
      toast.success(t('requests.registration.linked'));
      await onDone(result.request);
      onOpenChange(false);
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const blocked =
    found &&
    (!found.isActive ||
      ['DISPOSED', 'DEACTIVATED'].includes(found.lifecycleState) ||
      Boolean(found.requestItem));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('requests.registration.linkTitle', { item: item?.description ?? '' })}
      description={t('requests.registration.linkDescription')}
      submitLabel={t('requests.registration.link')}
      loading={save.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        if (found && !blocked) save.mutate();
      }}
    >
      <Field label={t('requests.registration.inventoryCode')} error={lookupError}>
        {(fieldProps) => (
          <div className="flex gap-2">
            <Input {...fieldProps} value={code} onChange={(e) => setCode(e.target.value)} />
            <Button
              type="button"
              variant="outline"
              disabled={!code.trim()}
              loading={lookup.isPending}
              onClick={() => lookup.mutate()}
            >
              {t('requests.registration.find')}
            </Button>
          </div>
        )}
      </Field>
      {found ? (
        <div className="rounded-md border border-border p-3 text-sm" data-testid="found-unit">
          <p className="font-mono">{found.inventoryCode}</p>
          <p className="text-muted-foreground">{found.asset?.name ?? ''}</p>
          {!found.isActive ? (
            <p className="text-destructive">{t('requests.registration.unitInactive')}</p>
          ) : null}
          {['DISPOSED', 'DEACTIVATED'].includes(found.lifecycleState) ? (
            <p className="text-destructive">
              {t('requests.registration.unitEnded', {
                state: statusLabel(t, found.lifecycleState, 'lifecycle'),
              })}
            </p>
          ) : null}
          {found.requestItem ? (
            <p className="text-destructive">
              {t('requests.registration.alreadyLinked', {
                number: found.requestItem.requestNumber,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </FormDialog>
  );
}

export function RequestRegistrationPanel({ request }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canRead = usePermission('request-item-unit:read');
  const canLookup = usePermission('asset-unit:read');
  const [registering, setRegistering] = useState(null);
  const [linking, setLinking] = useState(null);

  const step = (request.steps ?? []).find((entry) => entry.stepType === 'REGISTER');
  // §73: consumable lines are issued from stock, never registered as units.
  const assetLines = (request.items ?? []).filter((item) => !item.consumableId);
  if (!canRead || !step || step.state === 'PENDING' || assetLines.length === 0) return null;
  const canAct = step.state === 'ACTIVE' && step.canAct;

  const onChanged = async (next) => {
    if (next) queryClient.setQueryData(['request', request.id], next);
    else await queryClient.invalidateQueries({ queryKey: ['request', request.id] });
    await queryClient.invalidateQueries({ queryKey: ['request-item'] });
    await queryClient.invalidateQueries({ queryKey: ['requests'] });
  };

  return (
    <SectionCard
      title={t('requests.registration.title')}
      description={t('requests.registration.description')}
    >
      <ul className="space-y-4">
        {assetLines.map((item) => (
          <li key={item.id} data-testid={`registration-${item.lineNo}`} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {item.lineNo}. {item.description}{' '}
                <span className="font-normal text-muted-foreground">
                  {t('requests.registration.progress', {
                    registered: item.quantityRegistered ?? 0,
                    required: item.quantityRequired,
                  })}
                </span>
              </span>
              {canAct && (item.quantityNotYetRegistered ?? 0) > 0 ? (
                <span className="flex gap-2">
                  <Button size="sm" onClick={() => setRegistering(item)}>
                    {t('requests.registration.registerUnits')}
                  </Button>
                  {canLookup ? (
                    <Button size="sm" variant="outline" onClick={() => setLinking(item)}>
                      {t('requests.registration.linkExisting')}
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </div>
            <ItemUnits item={item} onChanged={() => onChanged()} />
          </li>
        ))}
      </ul>

      {registering ? (
        <RegisterUnitsDialog
          request={request}
          item={registering}
          open
          onOpenChange={(open) => !open && setRegistering(null)}
          onDone={onChanged}
        />
      ) : null}
      {linking ? (
        <LinkUnitDialog
          item={linking}
          open
          onOpenChange={(open) => !open && setLinking(null)}
          onDone={onChanged}
        />
      ) : null}
      {step.state === 'DONE' ? (
        <p className="mt-3 text-xs text-muted-foreground">{t('requests.registration.doneNote')}</p>
      ) : null}
    </SectionCard>
  );
}
