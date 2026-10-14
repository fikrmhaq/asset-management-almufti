import { useRef, useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ImagePlus, X } from 'lucide-react';

import { receiptFormData, requestsApi } from '@/api/requests';
import { consumablesApi } from '@/api/consumables';
import { usePermission } from '@/auth/useSession';
import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Radio } from '@/components/ui/checkbox';
import { MAX_SIZE_MB } from '@/components/asset/AttachmentsPanel';
import { DatePicker } from '@/components/ui/date-picker';
import { Input, Textarea } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';

/**
 * Receipt and closing the remainder — Phase 41 (`CR-014` §5.5, §7.4;
 * `IMPLEMENTATION_PLAN.md` §60), `07-ui.md` §5.10.
 *
 * RECEIPT is the requester's explicit statement that they received specific
 * registered units, on a date they give. It is never inferred, and it never
 * moves a unit. Units that can no longer be received (inactive, DISPOSED,
 * DEACTIVATED) are shown, disabled, with the reason. Offered only when the
 * server says `actions.receive`.
 *
 * CLOSING THE REMAINDER cancels what can no longer or will no longer be
 * received — never-registered requirements and units that cannot be received —
 * and keeps units that still can. The dialog shows exactly that per item before
 * anything happens. Offered only when the server says `actions.close`.
 */

const today = () => format(new Date(), 'yyyy-MM-dd');

/** Receipt-confirmation photos (migration 057) — the server holds the same rule. */
const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png'];
const MAX_PHOTOS = 5;
const PHOTO_ACCEPT = PHOTO_EXTENSIONS.map((extension) => `.${extension}`).join(',');

function photoRejection(t, file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !PHOTO_EXTENSIONS.includes(extension)) {
    return t('requests.receipt.photoType', { name: file.name });
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return t('requests.receipt.photoSize', { name: file.name, size: MAX_SIZE_MB });
  }
  return null;
}

/** Chosen photos, each removable — the whole receipt's or one unit's. */
function ChosenPhotos({ files, onRemove, testId }) {
  const { t } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm" data-testid={testId}>
      {files.map((file, index) => (
        <li key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-2">
          <span className="truncate">{file.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemove(index)}
            aria-label={t('requests.receipt.removePhoto', { name: file.name })}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * REQ-REQUEST-024: what receiving does to one selected unit's location — the
 * server's rule, stated before submit. A located unit stays where it is; with
 * `AT_INTENDED_PLACE` and an active intended location an unplaced one is placed
 * there; otherwise it will need placement. Nothing until a placement is chosen.
 */
function PlacementOutcome({ unit, destination, placement, testId }) {
  const { t } = useTranslation();
  let text = null;
  if (unit.currentLocation) {
    text = t('requests.receipt.outcome.stays', { name: unit.currentLocation.name });
  } else if (destination && !placement) {
    return null;
  } else if (destination && placement === 'AT_INTENDED_PLACE' && destination.isActive !== false) {
    text = t('requests.receipt.outcome.placed', { name: destination.name });
  } else {
    text = t('requests.receipt.outcome.needsPlacement');
  }
  return (
    <p className="ml-6 text-xs text-muted-foreground" data-testid={testId}>
      {text}
    </p>
  );
}

/**
 * RECEIPT CONFIRMATION (migration 057): with the units and the date, the
 * requester says where the units are relative to the request's intended place
 * (asked only when there is one), describes it, and adds 1–5 photos. It is the
 * requester's statement and evidence — nothing is verified. With
 * `AT_INTENDED_PLACE` the server places each unplaced unit at the intended place
 * (REQ-REQUEST-024); each selected unit says what will happen to it.
 * One submit sends all of it; the server records all of it or none.
 *
 * REQ-REQUEST-022: each selected unit may have photos of ITS OWN, chosen beside
 * it — evidence of that unit's receipt; the rest are photos of the whole
 * receipt. 1–5 in total across all of them. Deselecting a unit drops its photos,
 * so a photo is never sent for a unit not being received.
 */
export function ReceiptDialog({ request, open, onOpenChange, onDone }) {
  const { t } = useTranslation();
  const items = request.items ?? [];
  const destination = request.destination ?? null;
  const inputRef = useRef(null);
  const [selected, setSelected] = useState([]);
  const [receivedOn, setReceivedOn] = useState(today());
  const [placement, setPlacement] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState([]);
  // REQ-REQUEST-022: asset unit id → its own photos.
  const [unitPhotos, setUnitPhotos] = useState({});
  const unitInputs = useRef({});
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});

  const units = useQueries({
    queries: items.map((item) => ({
      queryKey: ['request-item', item.id, 'units'],
      queryFn: () => requestsApi.listItemUnits(item.id),
      enabled: open,
    })),
  });
  const loading = units.some((query) => query.isLoading);
  const rows = items.map((item, index) => ({ item, links: units[index]?.data ?? [] }));
  const pendingIds = rows.flatMap(({ links }) =>
    links.filter((link) => link.receivable).map((link) => link.assetUnit.id)
  );
  const total =
    photos.length + Object.values(unitPhotos).reduce((count, files) => count + files.length, 0);

  const save = useMutation({
    mutationFn: () =>
      requestsApi.receive(
        request.id,
        receiptFormData({
          assetUnitIds: selected,
          receivedOn,
          placement: destination ? placement : null,
          description,
          photos,
          unitPhotos: selected.flatMap((assetUnitId) =>
            (unitPhotos[assetUnitId] ?? []).map((file) => ({ assetUnitId, file }))
          ),
        })
      ),
    onSuccess: async (next) => {
      toast.success(t('requests.receipt.recorded', { count: selected.length }));
      await onDone(next);
      onOpenChange(false);
    },
    onError: (err) => toast.fromError(err, { includeValidation: true }),
  });

  /**
   * A required-field message goes as soon as its field is satisfied, rather
   * than waiting for the next submit (UAT, 2026-09-28). The rules themselves
   * are `validate` below, unchanged; nothing new is reported while typing.
   */
  const clearError = (key) =>
    setErrors((current) => (current[key] ? { ...current, [key]: null } : current));

  const choose = (next) => {
    setSelected(next);
    // A unit no longer being received takes its photos with it.
    setUnitPhotos((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => next.includes(id)))
    );
    if (next.length > 0) setError(null);
  };

  const toggle = (id) =>
    choose(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);

  /**
   * Adds picked photos to one list — the whole receipt's (`errorKey` `photos`)
   * or a unit's — within the room left of the 1–5 TOTAL.
   */
  const pickInto = (current, set, errorKey) => (event) => {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    const rejected = picked.map((file) => photoRejection(t, file)).filter(Boolean);
    const accepted = picked.filter((file) => !photoRejection(t, file));
    const room = MAX_PHOTOS - total;
    set([...current, ...accepted.slice(0, Math.max(room, 0))]);
    const issues = [
      ...rejected,
      ...(accepted.length > room ? [t('requests.receipt.photosMax', { count: MAX_PHOTOS })] : []),
    ];
    setErrors((existing) => ({
      ...existing,
      photos: null,
      [errorKey]: issues.length ? issues.join(' ') : null,
    }));
  };
  const setUnitFiles = (id) => (files) => setUnitPhotos((current) => ({ ...current, [id]: files }));

  const validate = () => {
    const next = {};
    if (destination && !placement) next.placement = t('requests.receipt.placementRequired');
    if (!description.trim()) next.description = t('requests.receipt.descriptionRequired');
    if (total === 0) next.photos = t('requests.receipt.photosRequired');
    setErrors(next);
    setError(selected.length === 0 ? t('requests.receipt.chooseUnits') : null);
    return selected.length > 0 && Object.keys(next).length === 0;
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('requests.receipt.title')}
      description={t('requests.receipt.description')}
      submitLabel={t('requests.receipt.submit')}
      loading={save.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        if (validate()) save.mutate();
      }}
    >
      {loading ? <LoadingState variant="list" rows={2} /> : null}
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={pendingIds.length > 0 && selected.length === pendingIds.length}
            onChange={(event) => choose(event.target.checked ? pendingIds : [])}
            disabled={pendingIds.length === 0}
          />
          {t('requests.receipt.selectAll', { count: pendingIds.length })}
        </label>
        {rows.map(({ item, links }) =>
          links.length === 0 ? null : (
            <fieldset key={item.id} className="space-y-1">
              <legend className="text-sm font-medium">
                {item.lineNo}. {item.description}
              </legend>
              {links
                .filter((link) => !link.receipt)
                .map((link) => {
                  const unitId = link.assetUnit.id;
                  const code = link.assetUnit.inventoryCode ?? unitId.slice(0, 8);
                  const own = unitPhotos[unitId] ?? [];
                  return (
                    <div key={link.id} className="space-y-1">
                      <label
                        className="flex flex-wrap items-center gap-2 text-sm"
                        data-testid={`receipt-unit-${link.assetUnit.inventoryCode}`}
                      >
                        <Checkbox
                          checked={selected.includes(link.assetUnit.id)}
                          onChange={() => toggle(link.assetUnit.id)}
                          disabled={!link.receivable}
                          aria-label={link.assetUnit.inventoryCode ?? link.assetUnit.id}
                        />
                        <span className="font-mono">{link.assetUnit.inventoryCode ?? '—'}</span>
                        {link.receivable ? null : (
                          <>
                            <span className="text-xs text-muted-foreground">
                              {t('requests.receipt.cannotReceive')}
                            </span>
                            <StatusBadge value={link.assetUnit.lifecycleState} kind="lifecycle" />
                            {link.assetUnit.isActive ? null : <StatusBadge value="inactive" />}
                          </>
                        )}
                      </label>
                      {selected.includes(unitId) ? (
                        <PlacementOutcome
                          unit={link.assetUnit}
                          destination={destination}
                          placement={placement}
                          testId={`receipt-unit-placement-${code}`}
                        />
                      ) : null}
                      {/* REQ-REQUEST-022: this unit's own photos, chosen beside it. */}
                      {selected.includes(unitId) ? (
                        <div className="ml-6 space-y-1" data-testid={`receipt-unit-photos-${code}`}>
                          <input
                            ref={(node) => {
                              unitInputs.current[unitId] = node;
                            }}
                            type="file"
                            accept={PHOTO_ACCEPT}
                            multiple
                            className="hidden"
                            aria-label={t('requests.receipt.addUnitPhotos', { code })}
                            onChange={pickInto(own, setUnitFiles(unitId), `unit:${unitId}`)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => unitInputs.current[unitId]?.click()}
                            disabled={total >= MAX_PHOTOS}
                          >
                            <ImagePlus className="h-4 w-4" aria-hidden="true" />
                            {t('requests.receipt.addUnitPhotos', { code })}
                          </Button>
                          <ChosenPhotos
                            files={own}
                            onRemove={(index) =>
                              setUnitFiles(unitId)(own.filter((_, i) => i !== index))
                            }
                            testId={`receipt-unit-photo-list-${code}`}
                          />
                          {errors[`unit:${unitId}`] ? (
                            <p role="alert" className="text-xs text-destructive">
                              {errors[`unit:${unitId}`]}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
            </fieldset>
          )
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      <Field
        label={t('requests.receipt.receivedOn')}
        hint={t('requests.receipt.receivedOnHint')}
        required
      >
        {(fieldProps) => (
          <DatePicker
            {...fieldProps}
            value={receivedOn}
            onChange={(value) => setReceivedOn(value ?? today())}
            // The request's creation as a local calendar date — the server holds
            // the same bound as a business date (Asia/Jakarta).
            min={format(new Date(request.createdAt), 'yyyy-MM-dd')}
            max={today()}
          />
        )}
      </Field>
      {/*
        The intended place is the request's destination — intent only. With
        none recorded, placement is not asked (migration 057).
      */}
      {destination ? (
        <fieldset className="space-y-2" data-testid="receipt-placement">
          <legend className="text-sm font-medium">
            {t('requests.receipt.placement')}
            <span className="text-destructive"> *</span>
          </legend>
          <p className="text-xs text-muted-foreground">
            {t('requests.receipt.intendedPlace', { name: destination.name })}
          </p>
          {['AT_INTENDED_PLACE', 'NOT_AT_INTENDED_PLACE'].map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <Radio
                name="receipt-placement"
                value={value}
                checked={placement === value}
                onChange={() => {
                  setPlacement(value);
                  clearError('placement');
                }}
                invalid={Boolean(errors.placement)}
              />
              {t(`requests.receipt.placements.${value}`)}
            </label>
          ))}
          {errors.placement ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.placement}
            </p>
          ) : null}
          {/* REQ-REQUEST-024: a deactivated intended location places nothing. */}
          {destination.isActive === false ? (
            <Alert variant="warning" size="sm" data-testid="receipt-destination-inactive">
              {t('requests.receipt.destinationInactive', { name: destination.name })}
            </Alert>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-xs text-muted-foreground">{t('requests.receipt.noIntendedPlace')}</p>
      )}

      <Field
        label={t('requests.receipt.descriptionLabel')}
        hint={t(
          placement === 'NOT_AT_INTENDED_PLACE'
            ? 'requests.receipt.descriptionHintElsewhere'
            : 'requests.receipt.descriptionHint'
        )}
        error={errors.description}
        required
      >
        {(fieldProps) => (
          <Textarea
            {...fieldProps}
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (e.target.value.trim()) clearError('description');
            }}
          />
        )}
      </Field>

      <Field
        label={t('requests.receipt.photos')}
        hint={t('requests.receipt.photosHint', {
          count: MAX_PHOTOS,
          size: MAX_SIZE_MB,
          types: PHOTO_EXTENSIONS.join(', '),
        })}
        error={errors.photos}
      >
        {() => (
          <div className="space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept={PHOTO_ACCEPT}
              multiple
              onChange={pickInto(photos, setPhotos, 'photos')}
              className="hidden"
              aria-label={t('requests.receipt.addPhotos')}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={total >= MAX_PHOTOS}
            >
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              {t('requests.receipt.addPhotos')}
            </Button>
            <ChosenPhotos
              files={photos}
              onRemove={(index) => setPhotos((current) => current.filter((_, i) => i !== index))}
              testId="receipt-photos"
            />
          </div>
        )}
      </Field>
      <p className="text-xs text-muted-foreground">{t('requests.receipt.notMoved')}</p>
    </FormDialog>
  );
}

/** What closing would lead to: ended now (CLOSED / CANCELLED), or later. */
function closeOutcome(items) {
  const pending = items.reduce((sum, item) => sum + (item.quantityPending ?? 0), 0);
  const registered = items.reduce((sum, item) => sum + (item.quantityRegistered ?? 0), 0);
  if (pending > 0) return { key: 'later', count: pending };
  return { key: registered > 0 ? 'closedNow' : 'cancelledNow', count: 0 };
}

export function CloseRemainderDialog({ request, open, onOpenChange, onDone }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const items = request.items ?? [];
  const outcome = closeOutcome(items);

  const save = useMutation({
    mutationFn: () => requestsApi.closeRemainder(request.id, reason.trim()),
    onSuccess: async (next) => {
      toast.success(t('requests.close.done'));
      await queryClient.invalidateQueries({ queryKey: ['request-item'] });
      await onDone(next);
      onOpenChange(false);
    },
    onError: (err) => toast.fromError(err, { includeValidation: true }),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('requests.close.title')}
      description={t('requests.close.description')}
      submitLabel={t('requests.close.submit')}
      loading={save.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        if (!reason.trim()) {
          setError(t('requests.close.reasonRequired'));
          return;
        }
        save.mutate();
      }}
    >
      <ul className="space-y-1 text-sm" data-testid="close-preview">
        {items.map((item) => (
          <li key={item.id}>
            <span className="font-medium">
              {item.lineNo}. {item.description}
            </span>{' '}
            <span className="text-muted-foreground">
              {item.quantityCancellableByClose > 0
                ? t('requests.close.cancels', {
                    count: item.quantityCancellableByClose,
                    unregistered: item.quantityCancellableUnregistered,
                    blocked: item.quantityCancellableBlocked,
                  })
                : t('requests.close.nothing')}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm" data-testid="close-outcome">
        {t(`requests.close.outcome.${outcome.key}`, { count: outcome.count })}
      </p>
      <Field label={t('requests.close.reason')} error={error} required>
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
  );
}

/**
 * ISSUING consumables (§73) — what is actually handed over now, per consumable
 * line, never more than the line still needs. Stock falls by exactly this; the
 * server checks it again under lock and refuses the whole issue if any line
 * would take more than is on hand. Offered only when the server says
 * `actions.issue` (`consumable:manage-stock`, the request approved).
 */
export function IssueDialog({ request, open, onOpenChange, onDone }) {
  const { t } = useTranslation();
  const canReadStock = usePermission('consumable:read');
  const lines = (request.items ?? []).filter(
    (item) => item.consumableId && (item.quantityNotYetIssued ?? 0) > 0
  );
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(lines.map((item) => [item.id, String(item.quantityNotYetIssued)]))
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  const stock = useQueries({
    queries: lines.map((item) => ({
      queryKey: ['consumables', item.consumableId],
      queryFn: () => consumablesApi.get(item.consumableId),
      enabled: open && canReadStock,
    })),
  });

  const save = useMutation({
    mutationFn: (body) => requestsApi.issue(request.id, body),
    onSuccess: async (next) => {
      toast.success(t('requests.issue.done'));
      await onDone(next);
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('requests.issue.title')}
      description={t('requests.issue.description')}
      submitLabel={t('requests.issue.submit')}
      loading={save.isPending}
      error={save.error}
      onSubmit={(event) => {
        event.preventDefault();
        const items = [];
        for (const item of lines) {
          const raw = quantities[item.id] ?? '';
          if (raw === '' || raw === '0') continue;
          const quantity = Number(raw);
          if (!Number.isInteger(quantity) || quantity < 0) {
            setError(t('requests.issue.wholeNumber'));
            return;
          }
          if (quantity > item.quantityNotYetIssued) {
            setError(
              t('requests.issue.tooMuch', { line: item.lineNo, count: item.quantityNotYetIssued })
            );
            return;
          }
          items.push({ requestItemId: item.id, quantity });
        }
        if (items.length === 0) {
          setError(t('requests.issue.nothing'));
          return;
        }
        setError(null);
        save.mutate({ items, note: note.trim() || null });
      }}
    >
      <ul className="space-y-3" data-testid="issue-lines">
        {lines.map((item, index) => {
          const onHand = stock[index]?.data?.quantityOnHand;
          const unit = item.measurementUnit?.name ?? '';
          return (
            <li key={item.id} className="space-y-1">
              <Field
                label={`${item.lineNo}. ${item.description}`}
                hint={[
                  t('requests.issue.remaining', { count: item.quantityNotYetIssued, unit }),
                  onHand !== undefined ? t('requests.issue.onHand', { count: onHand, unit }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type="number"
                    min={0}
                    max={item.quantityNotYetIssued}
                    step={1}
                    inputMode="numeric"
                    value={quantities[item.id] ?? ''}
                    onChange={(event) =>
                      setQuantities((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                )}
              </Field>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="text-sm text-danger-700" role="alert">
          {error}
        </p>
      ) : null}
      {/* Which consumable is short, and by how much — the server's own words. */}
      {save.error?.details?.length ? (
        <ul className="space-y-1 text-sm text-danger-700" data-testid="issue-refusal">
          {save.error.details.map((detail, index) => (
            <li key={index}>{detail.issue}</li>
          ))}
        </ul>
      ) : null}
      <Field label={t('requests.issue.note')}>
        {(fieldProps) => (
          <Textarea
            {...fieldProps}
            rows={2}
            maxLength={5000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}
