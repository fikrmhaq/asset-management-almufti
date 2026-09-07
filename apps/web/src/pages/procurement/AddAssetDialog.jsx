import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { contractItemsApi } from '@/api/procurement';
import { normalizeError } from '@/api/errors';
import { useZodForm } from '@/lib/forms/useZodForm';
import { queryKeys } from '@/lib/queryKeys';
import { formatQuantity } from '@/lib/numbers';
import { invalidateResources } from '@/lib/queryClient';
import { Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';
import { ClassificationField } from '@/components/reference/ClassificationPicker';
import { useVendorOptions } from './referenceOptions';
import { useTranslation } from 'react-i18next';

/**
 * Add asset from a contract item — `07-ui.md` §5.5,
 * `IMPLEMENTATION_PLAN.md` §19.5; REQ-PROC-009.
 *
 * The short form §5.5 describes, deliberately NOT the full `/assets/new` page
 * (`DEC-035`), and labelled in English like every other screen (`DEC-039`).
 *
 * The item supplies the name; the caller supplies the two things it cannot —
 * the classification, since a ContractItem carries none (`DEC-009`), and how
 * many physical units arrived. The server fills in the traceability itself:
 * `Asset.contractId` from the item's parent contract (REQ-ASSET-011) and
 * `AssetUnit.contractItemId` from the item (REQ-PROC-006), neither of which this
 * form sends or could override.
 *
 * `institutionId` is not offered: the contract already names the receiving
 * institution and the server prefers it over the caller's scope (`DEC-011`), so
 * asking again would contradict REQ-PROC-009's "without requiring the user to
 * separately re-select".
 *
 * One call, one transaction: it creates an Asset AND its units, so it needs both
 * `asset:create` and `asset-unit:create` (`DEC-010`) — the caller of this dialog
 * gates on both.
 */

/** The server's own bound (REQ-VAL-001); `DEC-036` explains why `quantity` is not one. */
const MAX_UNITS = 500;

/**
 * The typed values, one per line — `CR-007`, `06-api.md` §6.3.
 *
 * A textarea rather than `unitCount` separate inputs. These values are copied
 * from the numbering register the institution already keeps, so pasting a column
 * is the actual task; forty inputs would be forty paste targets. Blank lines are
 * dropped so a trailing newline is not a missing value.
 */
const toCompositions = (text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Built per item, because two of its rules come from the institution's inventory
 * code format rather than from the API contract: whether a composition is
 * required at all, and whether one value covers the batch or each unit needs its
 * own. The server re-checks every one of them (`BR-026`).
 */
function addAssetSchema(composition) {
  const required = Boolean(composition?.required);
  const perUnit = required && composition.perUnit;
  const maxLength = composition?.maxLength ?? 16;

  const base = z.object({
    name: z.string().trim().min(1, 'is required').max(255),
    classificationId: z.string().trim().length(12, 'select a classification'),
    vendorId: z.string().optional(),
    unitCount: z.coerce
      .number()
      .int('must be a whole number')
      .min(1, 'must be at least 1')
      .max(MAX_UNITS, `must not exceed ${MAX_UNITS}`),
    description: z.string().trim().max(5000).optional(),
    numberComposition: z.string().trim().max(maxLength).optional(),
    numberCompositions: z.string().optional(),
  });

  if (!required) return base;

  if (!perUnit) {
    return base.refine((values) => values.numberComposition?.length > 0, {
      path: ['numberComposition'],
      message: 'is required',
    });
  }

  /**
   * Checked here as well as on the server so a batch of forty is not sent, and
   * rejected, over a miscount the form can see. The duplicate rule is the
   * server's too: without a sequence, two identical values render one code.
   */
  return base
    .refine((values) => toCompositions(values.numberCompositions).length === values.unitCount, {
      path: ['numberCompositions'],
      message: 'needs exactly one value per unit',
    })
    .refine((values) => toCompositions(values.numberCompositions).every((v) => v.length <= maxLength), {
      path: ['numberCompositions'],
      message: `each value must be at most ${maxLength} characters`,
    })
    .refine(
      (values) => {
        const entries = toCompositions(values.numberCompositions);
        return new Set(entries).size === entries.length;
      },
      { path: ['numberCompositions'], message: 'two units cannot share a value' }
    );
}

/** `DEC-036` — prefilled from the ordered quantity, then freely editable. */
export function defaultUnitCount(quantity) {
  return Math.min(Math.max(Number(quantity) || 1, 1), MAX_UNITS);
}

export function AddAssetDialog({ item, open, onOpenChange }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const vendors = useVendorOptions();
  const [classification, setClassification] = useState(null);

  /**
   * Whether this contract's institution asks the registrar to type part of the
   * code — `CR-007`, `06-api.md` §5.2.
   *
   * Fetched here rather than taken from the row this dialog was opened with:
   * the hint rides on `GET /contract-items/:id`, and the panel lists items
   * through the contract. It is a hint, not the format — the format itself sits
   * behind `inventory-code-format:read`, which a registrar has no reason to
   * hold.
   */
  const detail = useQuery({
    queryKey: queryKeys.contractItems.detail(item?.id),
    queryFn: () => contractItemsApi.get(item.id),
    enabled: open && Boolean(item?.id),
  });

  const composition = detail.data?.unitRegistration?.numberComposition;
  const needsComposition = Boolean(composition?.required);
  const perUnit = needsComposition && composition.perUnit;

  const schema = useMemo(() => addAssetSchema(composition), [composition]);

  const { form, submit } = useZodForm({
    schema,
    defaultValues: {
      name: '',
      classificationId: '',
      vendorId: '',
      unitCount: 1,
      description: '',
      numberComposition: '',
      numberCompositions: '',
    },
    onSubmit: async (values) => {
      const created = await contractItemsApi.createAsset(item.id, {
        name: values.name,
        classificationId: values.classificationId,
        vendorId: values.vendorId || undefined,
        description: values.description || undefined,
        unitCount: values.unitCount,
        /**
         * One field or the other, never both, and neither unless this
         * institution asked for it — the server refuses `numberCompositions`
         * where a sequence already distinguishes the units, and refuses either
         * where the format uses no composition at all.
         */
        ...(needsComposition
          ? perUnit
            ? { numberCompositions: toCompositions(values.numberCompositions) }
            : { numberComposition: values.numberComposition }
          : {}),
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contractItems.detail(item.id) }),
        invalidateResources(queryClient, queryKeys.assets),
      ]);

      toast.success(
        `Asset created with ${created.units.length} unit${created.units.length === 1 ? '' : 's'}`
      );
      onOpenChange(false);
    },
    /**
     * A duplicate composition answers `409`, not `400` (`06-api.md` §5.2), so
     * `applyServerErrors` leaves it alone — but the server names the field the
     * caller typed, and that is where it belongs. Anything it does not name
     * still falls back to the toast.
     */
    onError: (error) => {
      const field = perUnit ? 'numberCompositions' : 'numberComposition';
      const issue = normalizeError(error).fieldErrors[field];

      if (issue) form.setError(field, { type: 'server', message: issue });
      else toast.fromError(error);
    },
  });

  const { register, reset, setValue, watch, formState } = form;
  const { errors, isSubmitting } = formState;

  // Watched so the running count below tracks typing. Only read in the per-unit
  // branch, where the two numbers have to be compared before submitting.
  const enteredCount = perUnit ? toCompositions(watch('numberCompositions')).length : 0;
  const expectedCount = perUnit ? Number(watch('unitCount')) || 0 : 0;

  // Re-prefilled every time the dialog opens, so registering a second item does
  // not inherit the first one's name or count.
  useEffect(() => {
    if (open && item) {
      reset({
        name: item.assetName,
        classificationId: '',
        vendorId: '',
        unitCount: defaultUnitCount(item.quantity),
        description: '',
        numberComposition: '',
        numberCompositions: '',
      });
      setClassification(null);
    }
  }, [open, item, reset]);

  if (!item) return null;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('procurement.addAsset.title')}
      description={`Registers "${item.assetName}" on the asset registry, traced to this contract.`}
      submitLabel={t('procurement.addAsset.submit')}
      onSubmit={submit}
      /*
        Held while the registration hint is in flight. Until it arrives the form
        does not know whether this institution asks for a composition, and
        submitting without one would be refused by the server for a field the
        caller was never shown.
      */
      loading={isSubmitting || detail.isLoading}
      error={errors.root?.server}
    >
      <Field label={t('common.fields.name')} error={errors.name?.message} required>
        {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
      </Field>

      <Field
        label={t('common.fields.classification')}
        error={errors.classificationId?.message}
        hint={t('procurement.addAsset.classificationHint')}
        required
      >
        {(fieldProps) => (
          <ClassificationField
            id={fieldProps.id}
            invalid={fieldProps.invalid}
            value={classification}
            onChange={(node) => {
              setClassification(node);
              setValue('classificationId', node?.id ?? '', {
                shouldValidate: true,
                shouldDirty: true,
              });
            }}
          />
        )}
      </Field>

      {vendors.allowed ? (
        <Field label={t('procurement.addAsset.vendor')} error={errors.vendorId?.message}>
          {({ invalid, ...fieldProps }) => (
            <select
              {...fieldProps}
              {...register('vendorId')}
              aria-invalid={invalid || undefined}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">No vendor</option>
              {vendors.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      {/* Not "Unit count": the ordered quantity has its own unit of measure, and
          this is a count of Asset Unit RECORDS to create — 1 box of 10 may be
          either one tracked item or ten. The hint states the order in full so
          the two numbers are visibly different quantities. */}
      <Field
        label={t('procurement.addAsset.unitCount')}
        error={errors.unitCount?.message}
        hint={
          item.quantity
            ? t('procurement.addAsset.unitCountHintOrdered', {
                quantity: formatQuantity(item.quantity, item.unitType),
              })
            : t('procurement.addAsset.unitCountHint')
        }
        required
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register('unitCount')}
            type="number"
            min="1"
            max={MAX_UNITS}
            step="1"
          />
        )}
      </Field>

      {/*
        The typed part of the inventory code (`CR-007`). Placed after the unit
        count because the per-unit form asks for exactly that many values, and a
        field whose requirement is set by a control below it cannot be read.
      */}
      {needsComposition && !perUnit ? (
        <Field
          label={t('units.fields.numberComposition')}
          error={errors.numberComposition?.message}
          hint={t('units.fields.numberCompositionHint', { max: composition.maxLength })}
          required
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              {...register('numberComposition')}
              maxLength={composition.maxLength}
            />
          )}
        </Field>
      ) : null}

      {perUnit ? (
        <Field
          label={t('units.fields.numberCompositions')}
          error={errors.numberCompositions?.message}
          hint={`${t('units.fields.numberCompositionsHint', {
            total: expectedCount,
            max: composition.maxLength,
          })} ${t('units.fields.numberCompositionsCount', {
            entered: enteredCount,
            expected: expectedCount,
          })}`}
          required
        >
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              {...register('numberCompositions')}
              rows={Math.min(Math.max(expectedCount, 3), 10)}
              spellCheck={false}
              className="font-mono text-xs"
            />
          )}
        </Field>
      ) : null}

      <Field label={t('common.fields.description')} error={errors.description?.message}>
        {(fieldProps) => <Textarea {...fieldProps} {...register('description')} rows={2} />}
      </Field>
    </FormDialog>
  );
}
