import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { assetsApi, assetUnitsApi } from '@/api/assetCore';
import { normalizeError } from '@/api/errors';
import { usePermission } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { AttributeValueForm, toValueMap } from '@/components/asset/AttributeValueForm';
import { assets } from '@/pages/assets/resources';

/**
 * Specifications during registration — REQ-REQUEST-021 (`IMPLEMENTATION_PLAN.md`
 * §68).
 *
 * After a unit is registered or linked, its specifications are recorded with the
 * EXISTING attribute system: the definitions of its asset's classification, each
 * at its own scope — ASSET (the asset as a whole) or ASSET_UNIT (this physical
 * unit) — through the existing `GET/PUT …/attribute-values`. Saved apart from the
 * registration: a refused save never undoes one, and REGISTER never waits for it.
 *
 * FILL BLANKS, NEVER OVERWRITE: a value already recorded is shown read-only, with
 * the way to the asset or unit page, where it is edited as always. Blanks may be
 * filled. The save still sends the whole set (the API replaces it), carrying the
 * recorded values unchanged. A rule of this dialog only — the API is not changed.
 *
 * The asset section only when a change to the whole asset is the caller's
 * (`scope.wholeAssetChange`, P3) — as with registration photos.
 */

const blank = (value) => value === null || value === undefined || value === '';

function SpecificationSection({ testId, title, hint, queryKey, load, save, canEdit, open }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(null);
  const [errors, setErrors] = useState({});

  const query = useQuery({ queryKey, queryFn: load });
  const definitions = query.data ?? [];
  const serverValues = toValueMap(definitions);
  const current = values ?? serverValues;
  // Recorded on the server — read-only here, however they got there.
  const recordedIds = definitions
    .filter((definition) => !blank(definition.value))
    .map((definition) => definition.attributeDefinitionId);
  const fillable = definitions.length > recordedIds.length;
  const dirty = values !== null && JSON.stringify(values) !== JSON.stringify(serverValues);

  const mutation = useMutation({
    mutationFn: (next) => save(next),
    onSuccess: async () => {
      setErrors({});
      setValues(null);
      await queryClient.invalidateQueries({ queryKey });
      toast.success(t('requests.registration.specifications.saved'));
    },
    onError: (error) => {
      const fieldErrors = normalizeError(error).fieldErrors ?? {};
      const byDefinition = {};
      for (const [field, issue] of Object.entries(fieldErrors)) {
        const id = field.replace(/^(body\.)?values\./, '');
        if (id !== field) byDefinition[id] = issue;
      }
      setErrors(byDefinition);
      toast.fromError(error);
    },
  });

  return (
    <section className="space-y-3 rounded-md border border-border p-3" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Link to={open.to} className="text-xs text-brand-600 hover:underline">
          {open.label}
        </Link>
      </div>

      {query.isLoading ? <LoadingState variant="form" rows={2} /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : null}
      {query.isSuccess ? (
        <AttributeValueForm
          definitions={definitions}
          values={current}
          onChange={setValues}
          errors={errors}
          disabled={!canEdit}
          lockedIds={recordedIds}
          lockedHint={t('requests.registration.specifications.recorded')}
        />
      ) : null}

      {query.isSuccess && canEdit && fillable ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            loading={mutation.isPending}
            disabled={!dirty}
            onClick={() => mutation.mutate(current)}
          >
            {t('requests.registration.specifications.save')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * @param {object} props
 * @param {{id: string, inventoryCode?: string, asset: {id: string, name: string}}} props.unit
 *   a registered unit, as `GET /request-items/:id/units` returns it
 */
export function RegistrationSpecificationsDialog({ unit, open, onOpenChange }) {
  const { t } = useTranslation();
  const canEdit = usePermission('asset-attribute-value:update');
  const canReadAsset = usePermission('asset:read');
  const assetId = unit.asset.id;
  const code = unit.inventoryCode ?? unit.id.slice(0, 8);

  // Whether a change to the whole asset is the caller's (P3).
  const asset = assets.useDetail(assetId, { enabled: open && canReadAsset });
  const wholeAsset = asset.data?.scope?.wholeAssetChange === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('requests.registration.specifications.title', { code })}</DialogTitle>
          <DialogDescription>
            {t('requests.registration.specifications.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {wholeAsset ? (
            <SpecificationSection
              testId="registration-specifications-asset"
              title={t('requests.registration.specifications.assetSection')}
              hint={t('requests.registration.specifications.assetHint', { name: unit.asset.name })}
              queryKey={queryKeys.assets.sub(assetId, 'attribute-values')}
              load={() => assetsApi.attributeValues(assetId)}
              save={(values) => assetsApi.replaceAttributeValues(assetId, values)}
              canEdit={canEdit}
              open={{
                to: `/assets/${assetId}`,
                label: t('requests.registration.specifications.openAsset'),
              }}
            />
          ) : asset.data ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="registration-specifications-no-asset"
            >
              {t('requests.registration.specifications.assetNotOpen')}
            </p>
          ) : null}

          <SpecificationSection
            testId="registration-specifications-unit"
            title={t('requests.registration.specifications.unitSection')}
            hint={t('requests.registration.specifications.unitHint', { code })}
            queryKey={queryKeys.assetUnits.sub(unit.id, 'attribute-values')}
            load={() => assetUnitsApi.attributeValues(unit.id)}
            save={(values) => assetUnitsApi.replaceAttributeValues(unit.id, values)}
            canEdit={canEdit}
            open={{
              to: `/assets/${assetId}/units/${unit.id}`,
              label: t('requests.registration.specifications.openUnit'),
            }}
          />

          <p className="text-xs text-muted-foreground">
            {t('requests.registration.specifications.requiredNote')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
