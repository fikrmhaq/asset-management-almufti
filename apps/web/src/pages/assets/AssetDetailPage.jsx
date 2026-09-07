import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { assetsApi } from '@/api/assetCore';
import { normalizeError } from '@/api/errors';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { AttributeValueForm, toValueMap } from '@/components/asset/AttributeValueForm';
import { useContractItemOptions } from '../procurement/referenceOptions';
import { useDepartmentOptions } from './referenceOptions';
import { assets } from './resources';
import { useTranslation } from 'react-i18next';

/**
 * Asset detail — `07-ui.md` §5.3, `IMPLEMENTATION_PLAN.md` §18.3;
 * REQ-ASSET-006/011.
 *
 * Overview / Units / Attribute Values / Attachments tabs, each loading its own
 * data. A caller may hold `asset:read` without `attachment:read`, so one
 * combined payload would fail for someone who can legitimately see most of the
 * page (§4.2).
 */

function OverviewTab({ asset }) {
  const { t } = useTranslation();
  return (
    <SectionCard title={t('assets.detail.information')}>
      <DetailFieldList>
        <DetailField label={t('common.fields.name')}>{asset.name}</DetailField>
        <DetailField label={t('common.fields.classification')}>
          <span className="font-mono text-xs">{asset.classificationId}</span>
          {asset.classification?.name ? (
            <span className="block text-xs text-muted-foreground">{asset.classification.name}</span>
          ) : null}
        </DetailField>
        <DetailField label={t('common.fields.institution')}>{asset.institution?.name}</DetailField>
        <DetailField label={t('assets.detail.vendor')}>{asset.vendor?.name}</DetailField>
        <DetailField label={t('common.fields.description')}>{asset.description}</DetailField>

        {/*
          Procurement line — REQ-ASSET-011. An asset with no contract is a
          documented case (donated, self-constructed, migrated), not missing
          data, so it says so explicitly rather than showing an empty field.
        */}
        <DetailField label={t('assets.detail.procurement')}>
          {asset.contractId ? (
            <Link to={`/procurement/contracts/${asset.contractId}`} className="hover:underline">
              {asset.contract?.contractNumber ?? asset.contractId}
            </Link>
          ) : (
            <span className="text-muted-foreground">No procurement record</span>
          )}
        </DetailField>
      </DetailFieldList>
    </SectionCard>
  );
}

/**
 * The asset's units — REQ-UNIT-001.
 *
 * Takes the whole asset rather than its id because creating a unit now offers
 * the procurement line item it arrived on (REQ-PROC-006), and the only items
 * that may be offered are those of the asset's own contract — the server rejects
 * an item belonging to any other (REQ-ASSET-011).
 */
function UnitsTab({ asset }) {
  const assetId = asset.id;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [contractItemId, setContractItemId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [numberComposition, setNumberComposition] = useState('');

  /**
   * Whether this institution's format asks the registrar to type part of the
   * code — `CR-007`, `06-api.md` §5.2.
   *
   * Read from the asset's `unitRegistration` hint, never from the format
   * itself: the format sits behind `inventory-code-format:read`, an
   * administration permission the person registering a unit has no reason to
   * hold. The hint carries the one bit this form needs and no format string,
   * so the field can appear without widening anybody's permissions.
   */
  const composition = asset.unitRegistration?.numberComposition;
  const needsComposition = Boolean(composition?.required);

  const contractItems = useContractItemOptions(asset.contractId);
  // Department is an ASSET UNIT property, never an Asset one (`CR-003` §15), so
  // the picker lives here and not on the asset form. An asset with no
  // institution cannot take one at all.
  const departments = useDepartmentOptions(asset.institutionId);
  const canPickDepartment = Boolean(asset.institutionId) && departments.allowed;
  // Nothing to trace to on an asset with no procurement record, so the field is
  // absent rather than empty.
  const canPickItem = Boolean(asset.contractId) && contractItems.allowed;

  const query = useQuery({
    queryKey: queryKeys.assets.sub(assetId, 'units'),
    queryFn: () => assetsApi.listUnits(assetId),
  });

  const create = useMutation({
    mutationFn: (body) => assetsApi.createUnit(assetId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.assets.sub(assetId, 'units') });
      setCreating(false);
      setDescription('');
      setContractItemId('');
      setDepartmentId('');
      setNumberComposition('');
      toast.success('Unit created');
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const columns = [
    {
      id: 'id',
      header: 'Asset unit',
      cell: ({ row }) => (
        <Link
          to={`/assets/${assetId}/units/${row.original.id}`}
          className="font-mono text-xs hover:underline"
        >
          {row.original.id.slice(0, 8)}
        </Link>
      ),
    },
    { accessorKey: 'description', header: 'Description' },
    {
      id: 'lifecycle',
      header: 'Lifecycle',
      cell: ({ row }) => <StatusBadge value={row.original.lifecycleState} />,
    },
    {
      id: 'condition',
      header: 'Condition',
      cell: ({ row }) =>
        row.original.currentCondition ? (
          <StatusBadge value={row.original.currentCondition} />
        ) : (
          <span className="text-muted-foreground">Not recorded</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge value={row.original.isActive ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <SectionCard
      title={t('assets.units.title')}
      description="The individually tracked physical items belonging to this asset."
      actions={
        <>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/assets/${assetId}/labels`}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              {t('assets.label.printAllLabels')}
            </Link>
          </Button>
          <Can code="asset-unit:create">
            <Button size="sm" onClick={() => setCreating(true)}>
              Add unit
            </Button>
          </Can>
        </>
      }
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('assets.units.empty')}
        emptyDescription="An asset with no units is a record of something not yet received."
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('assets.units.addTitle')}
        description="A new unit starts as REGISTERED with no condition or location recorded."
        submitLabel={t('common.actions.create')}
        loading={create.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({
            description: description || undefined,
            contractItemId: contractItemId || undefined,
            // Only when the control was actually offered, as with the
            // procurement item: sending a field the caller never saw would
            // assign — or refuse — on their behalf.
            ...(canPickDepartment ? { departmentId: departmentId || undefined } : {}),
            // Same rule: the write body is strict, so a value this institution
            // never asked for would be refused as an unknown field rather than
            // ignored (`06-api.md` §5.2).
            ...(needsComposition ? { numberComposition: numberComposition || undefined } : {}),
          });
        }}
      >
        {/*
          First, because it is the only field here that becomes permanent. The
          composition is an input to the inventory code, and the code is frozen
          the moment the unit is registered (`BR-020`) — `PATCH` rejects both.
        */}
        {needsComposition ? (
          <Field
            label={t('units.fields.numberComposition')}
            hint={t('units.fields.numberCompositionHint', { max: composition.maxLength })}
            required
            error={create.error ? normalizeError(create.error).fieldErrors.numberComposition : null}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                value={numberComposition}
                maxLength={composition.maxLength}
                onChange={(event) => setNumberComposition(event.target.value)}
              />
            )}
          </Field>
        ) : null}

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
          <Field label={t('units.fields.procurementItem')} hint={t('assets.units.itemHint')}>
            {({ invalid, ...fieldProps }) => (
              <select
                {...fieldProps}
                aria-invalid={invalid || undefined}
                value={contractItemId}
                onChange={(event) => setContractItemId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('assets.units.noItem')}</option>
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
    </SectionCard>
  );
}

/**
 * Attribute values — REQ-ATTR-006/008.
 *
 * The response carries every applicable definition, so it is both the schema and
 * the data. `PUT` replaces the whole set.
 */
export function AttributeValuesTab({ ownerId, load, save, canEdit }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(null);

  const query = useQuery({ queryKey: load.key, queryFn: load.fn });

  const mutation = useMutation({
    mutationFn: (next) => save.fn(next),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: load.key });
      setValues(null);
      toast.success('Attributes saved');
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const definitions = query.data ?? [];
  const serverValues = toValueMap(definitions);
  const current = values ?? serverValues;
  const dirty = values !== null && JSON.stringify(values) !== JSON.stringify(serverValues);

  useEffect(() => {
    setValues(null);
  }, [ownerId]);

  if (query.isLoading) return <LoadingState variant="form" rows={4} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <SectionCard
      title={t('assets.detail.attributes')}
      description={t('assets.detail.attributesDescription')}
      actions={
        canEdit && definitions.length > 0 ? (
          <Button
            size="sm"
            loading={mutation.isPending}
            disabled={!dirty}
            onClick={() => mutation.mutate(current)}
          >
            Save attributes
          </Button>
        ) : null
      }
    >
      <AttributeValueForm
        definitions={definitions}
        values={current}
        onChange={setValues}
        disabled={!canEdit}
      />
    </SectionCard>
  );
}

export function AssetDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = assets.useDetail(id);
  const setActive = assets.useSetActive();
  const canEditAttributes = usePermission('asset-attribute-value:update');
  const [confirming, setConfirming] = useState(false);

  const asset = query.data;

  if (query.isLoading) return <LoadingState variant="detail" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <DetailPage
      title={asset.name}
      description={asset.classification?.name}
      badge={<StatusBadge value={asset.isActive ? 'active' : 'inactive'} />}
      actions={
        <>
          <Can code="asset:update">
            <Button asChild variant="outline">
              <Link to={`/assets/${id}/edit`}>Edit</Link>
            </Button>
          </Can>
          <Can code="asset:deactivate">
            <Button
              variant={asset.isActive ? 'outline' : 'default'}
              onClick={() => setConfirming(true)}
            >
              {asset.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </Can>
        </>
      }
    >
      <DetailTabs
        tabs={[
          { value: 'overview', label: 'Overview', content: <OverviewTab asset={asset} /> },
          { value: 'units', label: 'Units', content: <UnitsTab asset={asset} /> },
          {
            value: 'attributes',
            label: 'Attribute values',
            content: (
              <AttributeValuesTab
                ownerId={id}
                canEdit={canEditAttributes}
                load={{
                  key: queryKeys.assets.sub(id, 'attribute-values'),
                  fn: () => assetsApi.attributeValues(id),
                }}
                save={{ fn: (values) => assetsApi.replaceAttributeValues(id, values) }}
              />
            ),
          },
          {
            value: 'attachments',
            label: 'Attachments',
            content: (
              <SectionCard title={t('assets.detail.attachments')}>
                <AttachmentsPanel assetId={id} />
              </SectionCard>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={asset.isActive ? 'Deactivate this asset?' : 'Reactivate this asset?'}
        description={
          asset.isActive
            ? 'Its units and their history are preserved, so traceability survives.'
            : 'It becomes active again along with its existing units.'
        }
        confirmLabel={asset.isActive ? 'Deactivate' : 'Reactivate'}
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive.mutateAsync({ id, active: !asset.isActive }).catch(() => undefined);
          setConfirming(false);
        }}
      />
    </DetailPage>
  );
}
