import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';

import { requestsApi } from '@/api/requests';
import { consumablesApi } from '@/api/consumables';
import { lookupApis } from '@/api/reference';
import { usePermission } from '@/auth/useSession';
import { formatMoney } from '@/lib/numbers';
import {
  REFERENCE_URL_MAX_LENGTH,
  normalizeReferenceUrl,
  safeReferenceLink,
} from '@/lib/referenceUrl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Radio } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';
import { SectionCard } from '@/components/patterns/page';
import { ClassificationField } from '@/components/reference/ClassificationPicker';
import { itemRevisionNotes } from './revisionNotes';

/**
 * The lines of a DRAFT request — Phase 37 (`CR-014` §5.2), REQ-REQUEST-006.
 *
 * A quantity is a whole number of Asset Units (`CR-014` Q1, working
 * assumption): the field accepts integers only, and there is no unit-of-measure
 * quantity model. The measurement unit is an optional label, not a second way
 * of counting.
 *
 * Each item shows requested, cancelled and required — nothing registered or
 * received exists before Phases 40–41 (decision E5).
 *
 * REQ-REQUEST-019: an optional reference link per item, edited like any other
 * field (in a draft and during a revision). Shown as its host, opening in a new
 * tab — never fetched or previewed, and plain text if it fails the rules.
 *
 * §73: a line is an ASSET line (registered as Asset Units) or a CONSUMABLE line
 * (issued from stock). A consumable line names an active consumable of the
 * institution; its description and unit are the consumable's, its quantity is
 * in that unit, and it takes no classification. Revised like any other line.
 */

const EMPTY = {
  kind: 'asset',
  consumableId: '',
  description: '',
  specification: '',
  referenceUrl: '',
  quantityRequested: '1',
  measurementUnitId: '',
  estimatedUnitPrice: '',
  classification: null,
};

function toForm(item) {
  return {
    kind: item.consumableId ? 'consumable' : 'asset',
    consumableId: item.consumableId ?? '',
    description: item.description,
    specification: item.specification ?? '',
    referenceUrl: item.referenceUrl ?? '',
    quantityRequested: String(item.quantityRequested),
    measurementUnitId: item.measurementUnitId ?? '',
    estimatedUnitPrice:
      item.estimatedUnitPrice === null || item.estimatedUnitPrice === undefined
        ? ''
        : String(item.estimatedUnitPrice),
    classification: item.classification ?? null,
  };
}

function toBody(form, previous) {
  if (form.kind === 'consumable') {
    // The server takes the name and unit from the consumable.
    return {
      consumableId: form.consumableId,
      specification: form.specification.trim() || null,
      referenceUrl: form.referenceUrl.trim() || null,
      quantityRequested: Number(form.quantityRequested),
      estimatedUnitPrice: form.estimatedUnitPrice === '' ? null : Number(form.estimatedUnitPrice),
      classificationId: null,
    };
  }
  return {
    // Cleared only when a consumable line becomes an asset line.
    ...(previous?.consumableId ? { consumableId: null } : {}),
    description: form.description.trim(),
    specification: form.specification.trim() || null,
    referenceUrl: form.referenceUrl.trim() || null,
    quantityRequested: Number(form.quantityRequested),
    measurementUnitId: form.measurementUnitId || null,
    estimatedUnitPrice: form.estimatedUnitPrice === '' ? null : Number(form.estimatedUnitPrice),
    classificationId: form.classification?.id ?? null,
  };
}

const fieldError = (error, name) =>
  error?.fieldErrors?.[name] ?? error?.fieldErrors?.[`body.${name}`] ?? null;

/** The item's reference link — a link only when it passes the rules. */
function ReferenceLink({ value, lineNo }) {
  const { t } = useTranslation();
  const link = safeReferenceLink(value);
  if (!link) {
    return (
      <span
        className="block break-all text-xs text-muted-foreground"
        data-testid={`item-reference-${lineNo}`}
      >
        {t('requests.item.referenceUrlUnsafe', { value })}
      </span>
    );
  }
  return (
    <span className="block text-xs">
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        title={link.href}
        aria-label={t('requests.item.referenceUrlOpen', { host: link.host })}
        className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
        data-testid={`item-reference-${lineNo}`}
      >
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{link.host}</span>
      </a>
    </span>
  );
}

export function RequestItemsEditor({ request, editable }) {
  // Phase 40: registered = linked units (D4), shown once registration has
  // opened. Registration is not receipt — no received figure until Phase 41.
  const showRegistered =
    !editable &&
    (request.steps ?? []).some((step) => step.stepType === 'REGISTER' && step.state !== 'PENDING');
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canCreate = usePermission('request-item:create');
  const canUpdate = usePermission('request-item:update');
  const canDelete = usePermission('request-item:delete');
  const canReadUnits = usePermission('measurement-unit:read');
  const canReadClassifications = usePermission('classification:read');
  const canNameConsumables = usePermission('request:create');

  const [editing, setEditing] = useState(null); // null | 'new' | item
  const [form, setForm] = useState(EMPTY);
  const [clientError, setClientError] = useState(null);
  const [removing, setRemoving] = useState(null);

  const units = useQuery({
    queryKey: ['measurement-units', 'options'],
    queryFn: () => lookupApis['measurement-units'].list({ pageSize: 100 }),
    enabled: editable && canReadUnits && Boolean(editing),
    staleTime: 60_000,
  });

  // §73: the active consumables a line may name — no stock figures.
  const consumables = useQuery({
    queryKey: ['consumables', 'options'],
    queryFn: () => consumablesApi.options(),
    enabled: editable && canNameConsumables && Boolean(editing),
    staleTime: 60_000,
  });
  const consumableOptions = consumables.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['request', request.id] });

  const save = useMutation({
    mutationFn: (body) =>
      editing === 'new'
        ? requestsApi.addItem(request.id, body)
        : requestsApi.updateItem(editing.id, body),
    onSuccess: async () => {
      await refresh();
      setEditing(null);
      toast.success(t('requests.itemSaved'));
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const remove = useMutation({
    mutationFn: (itemId) => requestsApi.removeItem(itemId),
    onSuccess: async () => {
      await refresh();
      setRemoving(null);
      toast.success(t('requests.itemRemoved'));
    },
    onError: (error) => toast.fromError(error),
  });

  const open = (target) => {
    setForm(target === 'new' ? EMPTY : toForm(target));
    setClientError(null);
    save.reset();
    setEditing(target);
  };

  const submit = (event) => {
    event.preventDefault();
    const quantity = Number(form.quantityRequested);
    if (form.kind === 'consumable' && !form.consumableId) {
      setClientError({ consumableId: t('requests.errors.consumableRequired') });
      return;
    }
    if (form.kind === 'asset' && !form.description.trim()) {
      setClientError({ description: t('requests.errors.descriptionRequired') });
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setClientError({ quantityRequested: t('requests.errors.wholeQuantity') });
      return;
    }
    const reference = normalizeReferenceUrl(form.referenceUrl);
    if (!reference.ok) {
      setClientError({
        referenceUrl: t(`requests.errors.referenceUrl.${reference.reason}`, {
          max: REFERENCE_URL_MAX_LENGTH,
        }),
      });
      return;
    }
    setClientError(null);
    save.mutate(toBody(form, editing === 'new' ? null : editing));
  };

  const errorFor = (name) => clientError?.[name] ?? fieldError(save.error, name);
  const consumableLine = form.kind === 'consumable';
  const chosenConsumable = consumableOptions.find((option) => option.id === form.consumableId);
  // A consumable line being edited keeps showing its unit until options load.
  const consumableUnit =
    chosenConsumable?.measurementUnit?.name ??
    (editing && editing !== 'new' ? editing.measurementUnit?.name : null);
  const items = request.items ?? [];

  return (
    <SectionCard
      title={t('requests.itemsTitle')}
      description={t('requests.itemsDescription')}
      actions={
        editable && canCreate ? (
          <Button size="sm" onClick={() => open('new')}>
            {t('requests.addItem')}
          </Button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <EmptyState title={t('requests.noItems')} description={t('requests.noItemsDescription')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>{t('requests.item.description')}</TableHead>
              <TableHead>{t('requests.item.requested')}</TableHead>
              <TableHead>{t('requests.item.cancelled')}</TableHead>
              <TableHead>{t('requests.item.required')}</TableHead>
              {showRegistered ? (
                <>
                  <TableHead>{t('requests.item.registered')}</TableHead>
                  <TableHead>{t('requests.item.receiptRecorded')}</TableHead>
                  <TableHead>{t('requests.item.notYetReceived')}</TableHead>
                </>
              ) : null}
              <TableHead>{t('requests.item.unit')}</TableHead>
              <TableHead>{t('requests.item.estimatedPrice')}</TableHead>
              {editable ? (
                <TableHead className="sr-only">{t('common.actions.edit')}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-testid={`item-${item.lineNo}`}>
                <TableCell>{item.lineNo}</TableCell>
                <TableCell>
                  <span className="font-medium">{item.description}</span>
                  {item.consumableId ? (
                    <Badge
                      variant="neutral"
                      className="ml-2"
                      data-testid={`item-consumable-${item.lineNo}`}
                    >
                      {t('requests.item.consumableBadge')}
                    </Badge>
                  ) : null}
                  {item.specification ? (
                    <span className="block text-xs text-muted-foreground">
                      {item.specification}
                    </span>
                  ) : null}
                  {item.referenceUrl ? (
                    <ReferenceLink value={item.referenceUrl} lineNo={item.lineNo} />
                  ) : null}
                  {item.classification ? (
                    <span className="block text-xs text-muted-foreground">
                      {t('requests.item.classificationHint', { name: item.classification.name })}
                    </span>
                  ) : null}
                  {/* REQ-REQUEST-018: what the approver asked to change on this line. */}
                  {itemRevisionNotes(request, item.id).map((note) => (
                    <span
                      key={note.id}
                      className="mt-1 block rounded bg-warning-50 px-1.5 py-0.5 text-xs text-warning-foreground"
                      data-testid={`item-revision-note-${item.lineNo}`}
                    >
                      {t('requests.revision.itemNote', { note: note.note })}
                    </span>
                  ))}
                </TableCell>
                <TableCell>{item.quantityRequested}</TableCell>
                <TableCell>{item.quantityCancelled}</TableCell>
                <TableCell>{item.quantityRequired}</TableCell>
                {showRegistered ? (
                  item.consumableId ? (
                    // §73: issued from stock — nothing is registered.
                    <>
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <TableCell data-testid={`item-issued-${item.lineNo}`}>
                        {t('requests.item.issued', { count: item.quantityIssued ?? 0 })}
                      </TableCell>
                      <TableCell>{item.quantityNotYetIssued ?? 0}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>{item.quantityRegistered ?? 0}</TableCell>
                      <TableCell>{item.quantityReceived ?? 0}</TableCell>
                      <TableCell>{item.quantityNotYetReceived ?? 0}</TableCell>
                    </>
                  )
                ) : null}
                <TableCell>{item.measurementUnit?.name ?? '—'}</TableCell>
                <TableCell>
                  {item.estimatedUnitPrice === null || item.estimatedUnitPrice === undefined
                    ? '—'
                    : formatMoney(item.estimatedUnitPrice)}
                </TableCell>
                {editable ? (
                  <TableCell className="whitespace-nowrap text-right">
                    {canUpdate ? (
                      <Button size="sm" variant="ghost" onClick={() => open(item)}>
                        {t('common.actions.edit')}
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(item)}>
                        {t('common.actions.remove')}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <FormDialog
        open={Boolean(editing)}
        onOpenChange={(isOpen) => (isOpen ? null : setEditing(null))}
        title={editing === 'new' ? t('requests.addItem') : t('requests.editItem')}
        description={t('requests.itemDialogDescription')}
        submitLabel={t('common.actions.save')}
        loading={save.isPending}
        onSubmit={submit}
      >
        {canNameConsumables && (consumableOptions.length > 0 || consumableLine) ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('requests.item.kind')}</legend>
            {['asset', 'consumable'].map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <Radio
                  name="item-kind"
                  value={kind}
                  checked={form.kind === kind}
                  onChange={() => setForm((f) => ({ ...f, kind }))}
                />
                {t(`requests.item.kinds.${kind}`)}
              </label>
            ))}
          </fieldset>
        ) : null}
        {consumableLine ? (
          <Field
            label={t('requests.item.consumable')}
            hint={t('requests.item.consumableHint')}
            error={errorFor('consumableId')}
            required
          >
            {(fieldProps) => (
              <NativeSelect
                {...fieldProps}
                value={form.consumableId}
                onChange={(event) => setForm((f) => ({ ...f, consumableId: event.target.value }))}
              >
                <option value="">{t('requests.item.chooseConsumable')}</option>
                {/* A line keeps a consumable deactivated since it was chosen. */}
                {form.consumableId && !chosenConsumable && editing !== 'new' ? (
                  <option value={form.consumableId}>{editing.description}</option>
                ) : null}
                {consumableOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.measurementUnit?.name})
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : (
          <Field label={t('requests.item.description')} error={errorFor('description')} required>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                value={form.description}
                maxLength={255}
                onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
              />
            )}
          </Field>
        )}
        <Field label={t('requests.item.specification')} error={errorFor('specification')}>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={3}
              value={form.specification}
              onChange={(event) => setForm((f) => ({ ...f, specification: event.target.value }))}
            />
          )}
        </Field>
        <Field
          label={t('requests.item.referenceUrl')}
          hint={t('requests.item.referenceUrlHint')}
          error={errorFor('referenceUrl')}
        >
          {(fieldProps) => (
            // Plain text, not type="url": the browser's own check would refuse
            // before ours could explain why, and in English only.
            <Input
              {...fieldProps}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              value={form.referenceUrl}
              onChange={(event) => setForm((f) => ({ ...f, referenceUrl: event.target.value }))}
            />
          )}
        </Field>
        <Field
          label={
            consumableLine && consumableUnit
              ? t('requests.item.quantityIn', { unit: consumableUnit })
              : t('requests.item.quantity')
          }
          hint={t(
            consumableLine ? 'requests.item.consumableQuantityHint' : 'requests.item.quantityHint'
          )}
          error={errorFor('quantityRequested')}
          required
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={form.quantityRequested}
              onChange={(event) =>
                setForm((f) => ({ ...f, quantityRequested: event.target.value }))
              }
            />
          )}
        </Field>
        {canReadUnits && !consumableLine ? (
          <Field label={t('requests.item.unit')} error={errorFor('measurementUnitId')}>
            {(fieldProps) => (
              <NativeSelect
                {...fieldProps}
                value={form.measurementUnitId}
                onChange={(event) =>
                  setForm((f) => ({ ...f, measurementUnitId: event.target.value }))
                }
              >
                <option value="">{t('requests.item.noUnit')}</option>
                {(units.data?.data ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}
        <Field label={t('requests.item.estimatedPrice')} error={errorFor('estimatedUnitPrice')}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="number"
              min={0}
              step="0.01"
              value={form.estimatedUnitPrice}
              onChange={(event) =>
                setForm((f) => ({ ...f, estimatedUnitPrice: event.target.value }))
              }
            />
          )}
        </Field>
        {canReadClassifications && !consumableLine ? (
          <Field
            label={t('requests.item.classification')}
            hint={t('requests.item.classificationFieldHint')}
            error={errorFor('classificationId')}
          >
            {({ id, invalid }) => (
              <ClassificationField
                id={id}
                invalid={invalid}
                value={form.classification}
                institutionId={request.institutionId}
                onChange={(node) =>
                  setForm((f) => ({
                    ...f,
                    classification: node ? { id: node.id, name: node.name } : null,
                  }))
                }
              />
            )}
          </Field>
        ) : null}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(isOpen) => (isOpen ? null : setRemoving(null))}
        title={t('requests.removeItemTitle')}
        description={t('requests.removeItemDescription')}
        confirmLabel={t('common.actions.remove')}
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </SectionCard>
  );
}
