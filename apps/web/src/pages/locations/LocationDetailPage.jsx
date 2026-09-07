import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { locationsApi } from '@/api/assetCore';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Field, FormErrorSummary } from '@/components/form/field';
import { DataTable } from '@/components/patterns/data-table';
import { DirectVsDescendantToggle } from '@/components/patterns/scope-toggle';
import {
  DetailField,
  DetailFieldList,
  DetailPage,
  DetailTabs,
  SectionCard,
} from '@/components/patterns/page';
import { PicPanel } from '@/components/patterns/pic-panel';
import { FloorPlanEditor } from '@/components/location/FloorPlanEditor';
import {
  LocationPath,
  LocationPathFor,
  useLocationContext,
} from '@/components/location/LocationPath';
import { locations } from '../assets/resources';
import { useTranslation } from 'react-i18next';

/**
 * Location detail — `07-ui.md` §5.3, `IMPLEMENTATION_PLAN.md` §18.5;
 * REQ-LOC-001/005.
 *
 * Info / Units / Floor Plan tabs, as §5.3 describes.
 *
 * The Units tab lists what is at this location AND everything beneath it
 * (`DEC-004`): locations nest to represent containment, so asking what is in a
 * building means everything in its rooms — a strict same-location reading would
 * report an empty building whose rooms are full.
 */

const editSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
});

function InfoTab({ id, location }) {
  const { t } = useTranslation();
  const update = locations.useUpdate();
  const canUpdate = usePermission('location:update');

  const { form, submit } = useZodForm({
    schema: editSchema,
    defaultValues: { name: '' },
    onSubmit: (values) => update.mutateAsync({ id, ...values }),
  });

  const { register, reset, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  useEffect(() => {
    reset({ name: location.name });
  }, [location, reset]);

  return (
    <SectionCard title={t('locations.details')}>
      <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
        <FormErrorSummary error={errors.root?.server} />

        <Field label={t('common.fields.name')} error={errors.name?.message} required>
          {(fieldProps) => <Input {...fieldProps} {...register('name')} disabled={!canUpdate} />}
        </Field>

        <Field label={t('common.fields.classification')} hint={t('locations.classificationHint')}>
          {(fieldProps) => (
            <Input {...fieldProps} value={location.classificationId} readOnly disabled />
          )}
        </Field>

        {/* The full trail, not just the immediate parent and not a raw id: a
            room called "Lab 2" means little without the building above it, and
            the hierarchy can be any number of levels deep. */}
        <Field label={t('locations.columns.inside')}>
          {/* Only the DOM-valid props are taken, rather than spreading the
              whole bag: `Field` also passes `invalid`, and React warns when a
              non-standard boolean prop lands on an element. Nothing here can be
              invalid anyway — it is a read-only display, not a control. */}
          {({ id, 'aria-describedby': describedBy }) =>
            location.parentLocationId ? (
              <div id={id} aria-describedby={describedBy} className="text-sm">
                <LocationPathFor locationId={location.parentLocationId} />
              </div>
            ) : (
              <p id={id} aria-describedby={describedBy} className="text-sm text-muted-foreground">
                {t('locations.topLevel')}
              </p>
            )
          }
        </Field>

        <Can code="location:update">
          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              {t('common.actions.saveChanges')}
            </Button>
          </div>
        </Can>
      </form>
    </SectionCard>
  );
}

/**
 * What is at this location — REQ-LOC-005.
 *
 * "Everything" is the default and includes units in locations beneath this one,
 * at any depth (`DEC-004`). Each row states the location the unit is ACTUALLY
 * at, which may be several levels down: viewing a building's contents must not
 * make its rooms' contents look like they sit in the lobby. "Here only" narrows
 * to units whose current location is exactly this one.
 */
function UnitsTab({ id, locationName }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState('all');

  const query = useQuery({
    queryKey: queryKeys.locations.sub(id, 'units', { scope }),
    queryFn: () => locationsApi.units(id, { scope }),
  });

  const columns = [
    {
      id: 'unit',
      header: t('units.columns.unit'),
      cell: ({ row }) => (
        <Link
          to={`/assets/${row.original.assetId}/units/${row.original.id}`}
          className="font-mono text-xs hover:underline"
        >
          {row.original.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      id: 'asset',
      header: t('units.columns.asset'),
      cell: ({ row }) =>
        row.original.asset ? (
          <Link to={`/assets/${row.original.assetId}`} className="hover:underline">
            {row.original.asset.name}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      id: 'location',
      header: t('units.columns.location'),
      cell: ({ row }) => {
        const here = row.original.currentLocationId === id;
        const name = row.original.currentLocation?.name;

        return (
          <span className="flex flex-wrap items-center gap-2">
            {row.original.currentLocationId ? (
              <Link to={`/locations/${row.original.currentLocationId}`} className="hover:underline">
                {name ?? row.original.currentLocationId}
              </Link>
            ) : (
              <span className="text-muted-foreground">{t('common.states.notAssigned')}</span>
            )}
            <Badge variant={here ? 'default' : 'neutral'}>
              {here ? t('locations.units.here') : t('locations.units.inside')}
            </Badge>
          </span>
        );
      },
    },
    {
      id: 'lifecycle',
      header: t('units.columns.lifecycle'),
      cell: ({ row }) => <StatusBadge value={row.original.lifecycleState} />,
    },
    {
      id: 'condition',
      header: t('units.columns.condition'),
      cell: ({ row }) =>
        row.original.currentCondition ? <StatusBadge value={row.original.currentCondition} /> : '—',
    },
  ];

  return (
    <SectionCard
      title={t('locations.units.title')}
      description={
        scope === 'all'
          ? t('locations.units.descriptionAll')
          : t('locations.units.descriptionDirect', { name: locationName })
      }
      actions={
        // The shared pattern now — same `aria-pressed` semantics as before, but
        // one implementation the Assets and Reports screens can reuse. The
        // module keeps its own words: "Here only" reads better on a location
        // page than the generic label.
        <DirectVsDescendantToggle
          value={scope}
          onChange={setScope}
          label={t('locations.units.scopeLabel')}
          labels={{
            all: t('locations.units.scopeAll'),
            direct: t('locations.units.scopeDirect'),
          }}
        />
      }
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        emptyTitle={t('locations.units.emptyTitle')}
        emptyDescription={
          scope === 'all' ? t('locations.units.emptyAll') : t('locations.units.emptyDirect')
        }
      />
    </SectionCard>
  );
}

/** The locations directly inside this one — REQ-LOC-007. */
function ChildLocations({ id }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.locations.sub(id, 'children'),
    queryFn: () => locationsApi.children(id),
  });

  const children = query.data?.data ?? [];

  return (
    <SectionCard title={t('locations.children.title')}>
      {query.isLoading ? (
        <LoadingState rows={2} columns={1} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : children.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('locations.children.empty')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {children.map((child) => (
            <li key={child.id}>
              <Link
                to={`/locations/${child.id}`}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
              >
                {child.name}
                {!child.isActive ? <StatusBadge value="inactive" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function LocationDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = locations.useDetail(id);
  const setActive = locations.useSetActive();
  const canReadUnits = usePermission('asset-unit:read');
  const canReadFloorPlan = usePermission('floor-plan:read');
  const [confirming, setConfirming] = useState(false);

  const location = query.data;

  if (query.isLoading) return <LoadingState rows={4} columns={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const tabs = [
    {
      value: 'info',
      label: t('locations.tabs.info'),
      content: (
        <div className="space-y-4">
          <InfoTab id={id} location={location} />
          {/*
            Phase 21 (`CR-003`). Who is responsible for this place, and who was
            before. Responsibility ONLY — a location PIC is never granted access
            to the units standing in it (§5.4).
          */}
          <PicPanel
            resource={locationsApi}
            recordId={id}
            institutionId={location.institutionId}
            currentPic={location.currentPic}
            permissionPrefix="location-pic"
          />
          <ChildLocations id={id} />
        </div>
      ),
    },
  ];

  if (canReadUnits) {
    tabs.push({
      value: 'units',
      label: t('locations.tabs.units'),
      content: <UnitsTab id={id} locationName={location.name} />,
    });
  }

  if (canReadFloorPlan) {
    tabs.push({
      value: 'floor-plan',
      label: t('locations.tabs.floorPlan'),
      content: (
        <SectionCard title={t('floorPlan.title')}>
          <FloorPlanEditor locationId={id} />
        </SectionCard>
      ),
    });
  }

  return (
    <DetailPage
      title={location.name}
      description={
        location.parentLocationId ? t('locations.insideAnother') : t('locations.topLevel')
      }
      badge={<StatusBadge value={location.isActive ? 'active' : 'inactive'} />}
      actions={
        <Can code="location:deactivate">
          <Button
            variant={location.isActive ? 'outline' : 'default'}
            onClick={() => setConfirming(true)}
          >
            {location.isActive ? t('common.actions.deactivate') : t('common.actions.reactivate')}
          </Button>
        </Can>
      }
    >
      <DetailTabs tabs={tabs} />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          location.isActive
            ? t('locations.deactivate.title')
            : t('locations.deactivate.reactivateTitle')
        }
        description={
          location.isActive
            ? t('locations.deactivate.description')
            : t('locations.deactivate.reactivateDescription')
        }
        confirmLabel={
          location.isActive ? t('common.actions.deactivate') : t('common.actions.reactivate')
        }
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive.mutateAsync({ id, active: !location.isActive }).catch(() => undefined);
          setConfirming(false);
        }}
      />
    </DetailPage>
  );
}

/**
 * The standalone editor route — `07-ui.md` §5.4.
 *
 * `?highlight=<locationId>` arrives from an asset unit whose location is
 * somewhere inside this one. The plan being shown belongs to THIS location; the
 * highlighted location is a different one, possibly several levels down, and the
 * page says so rather than letting the two be confused.
 */
export function FloorPlanPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const highlightLocationId = searchParams.get('highlight') || undefined;

  const query = locations.useDetail(id);
  const highlighted = useLocationContext(highlightLocationId, {
    enabled: Boolean(highlightLocationId),
  });

  if (query.isLoading) return <LoadingState rows={4} columns={2} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const viewing = Boolean(highlightLocationId);

  return (
    <DetailPage
      title={t('floorPlan.pageTitle', { name: query.data.name })}
      description={
        viewing
          ? t('floorPlan.belongsTo', { name: query.data.name })
          : t('floorPlan.editDescription')
      }
      actions={
        <Button asChild variant="outline">
          <Link to={`/locations/${highlightLocationId ?? id}`}>
            {viewing ? t('floorPlan.goToLocation') : t('floorPlan.backToLocation')}
          </Link>
        </Button>
      }
    >
      {viewing ? (
        <SectionCard title={t('floorPlan.whereUnitIs')}>
          <DetailFieldList>
            <DetailField label={t('floorPlan.unitLocation')}>
              <LocationPath path={highlighted.data?.path} />
            </DetailField>
            <DetailField label={t('floorPlan.planBelongsTo')}>{query.data.name}</DetailField>
          </DetailFieldList>
        </SectionCard>
      ) : null}

      <SectionCard>
        <FloorPlanEditor
          locationId={id}
          highlightLocationId={highlightLocationId}
          readOnly={viewing}
        />
      </SectionCard>
    </DetailPage>
  );
}
