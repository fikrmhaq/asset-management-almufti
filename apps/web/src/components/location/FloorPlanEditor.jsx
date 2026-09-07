import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Upload } from 'lucide-react';

import { locationsApi } from '@/api/assetCore';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { useDescendantLocations, useFloorPlan, useFloorPlanImage } from './useFloorPlan';
import { useTranslation } from 'react-i18next';

/**
 * Floor plan editor — `07-ui.md` §5.4, `IMPLEMENTATION_PLAN.md` §18.6;
 * REQ-LOC-009–013.
 *
 * The only genuinely custom piece of UI in the specification. Plain SVG
 * `<polygon>` elements over the image — no canvas library, as §5.4 says: the
 * number of areas on one floor is small, so canvas-level rendering performance
 * is not a real concern, and SVG gives focusable, clickable elements for free.
 *
 * COORDINATES ARE NORMALIZED. Points are stored as `{x, y}` in 0..1 relative to
 * the image (`03-domain.md` §4.34, and the server rejects anything outside that
 * range). The overlay uses `viewBox="0 0 1 1"`, so a stored point IS its
 * position — no pixel conversion, and the drawing survives the image being
 * displayed at any size. That is exactly why the points are stored normalized
 * rather than in pixels.
 *
 * ACCESSIBILITY (`07-ui.md` §8): drawing is pointer-driven by nature, so a
 * keyboard alternative is provided explicitly rather than assumed — each area is
 * focusable and activates with Enter or Space, and points can be added by
 * typing coordinates instead of clicking.
 */

const MIN_POINTS = 3;

/** Pointer position → normalized coordinates, clamped to the image. */
export function toNormalizedPoint(event, rect) {
  if (!rect?.width || !rect?.height) return null;

  const clamp = (value) => Math.min(1, Math.max(0, value));

  return {
    x: Number(clamp((event.clientX - rect.left) / rect.width).toFixed(4)),
    y: Number(clamp((event.clientY - rect.top) / rect.height).toFixed(4)),
  };
}

export const pointsToSvg = (polygon) => polygon.map((point) => `${point.x},${point.y}`).join(' ');

function UploadPanel({ locationId, hasPlan, onUploaded }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const queryClient = useQueryClient();

  const upload = useMutation({
    mutationFn: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return locationsApi.uploadFloorPlan(locationId, formData);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
      toast.success(hasPlan ? t('floorPlan.replaced') : t('floorPlan.uploaded'));
      onUploaded?.();
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg"
        className="hidden"
        aria-label={t('floorPlan.chooseImage')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) upload.mutate(file);
        }}
      />
      <Button
        variant={hasPlan ? 'outline' : 'default'}
        loading={upload.isPending}
        onClick={() => inputRef.current?.click()}
        className="gap-2"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {hasPlan ? t('floorPlan.replace') : t('floorPlan.upload')}
      </Button>
    </>
  );
}

/**
 * @param {object} props
 * @param {string} props.locationId the location whose plan this is
 * @param {string} [props.highlightLocationId]
 *   A location to call out on the plan — the one someone actually came here to
 *   find. It is usually NOT `locationId`: the plan belongs to an ancestor.
 * @param {boolean} [props.readOnly]
 *   Viewing rather than editing. Used when the plan is reached from an asset
 *   unit, where offering to redraw someone else's building would be wrong.
 */
export function FloorPlanEditor({ locationId, highlightLocationId, readOnly = false }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const imageRef = useRef(null);

  const plan = useFloorPlan(locationId);
  const image = useFloorPlanImage(locationId, { enabled: Boolean(plan.data) });
  const descendants = useDescendantLocations(locationId);

  const canDraw = usePermission('floor-plan-area:create') && !readOnly;
  const [draft, setDraft] = useState(null);
  const [draftLocationId, setDraftLocationId] = useState('');
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [manualPoint, setManualPoint] = useState({ x: '', y: '' });

  const areas = plan.data?.areas ?? [];
  const descendantOptions = descendants.data ?? [];

  /**
   * The area carries its own location name now (`06-api.md` §5.3), so a shape
   * is labelled without depending on the descendant list having loaded — or on
   * that list reaching far enough down to contain it.
   */
  const locationNameFor = (id, area) =>
    area?.location?.name ?? descendantOptions.find((location) => location.id === id)?.name ?? id;

  const highlightedArea = highlightLocationId
    ? areas.find((area) => area.locationId === highlightLocationId)
    : undefined;

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });

  const createArea = useMutation({
    mutationFn: (body) => locationsApi.createArea(locationId, body),
    onSuccess: async () => {
      await refresh();
      setDraft(null);
      setDraftLocationId('');
      toast.success(t('floorPlan.areaAdded'));
    },
    // A `CONFLICT` here is REQ-LOC-012: the chosen location is not a descendant.
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const deleteArea = useMutation({
    mutationFn: (areaId) => locationsApi.deleteArea(locationId, areaId),
    onSuccess: async () => {
      await refresh();
      setSelectedAreaId(null);
      toast.success(t('floorPlan.areaRemoved'));
    },
    onError: (error) => toast.fromError(error),
  });

  const deletePlan = useMutation({
    mutationFn: () => locationsApi.deleteFloorPlan(locationId),
    onSuccess: async () => {
      await refresh();
      toast.success(t('floorPlan.removed'));
    },
    onError: (error) => toast.fromError(error),
  });

  const addPoint = (point) => {
    if (!point) return;
    setDraft((current) => [...(current ?? []), point]);
  };

  const handleImageClick = (event) => {
    if (draft === null || !imageRef.current) return;
    addPoint(toNormalizedPoint(event, imageRef.current.getBoundingClientRect()));
  };

  if (plan.isLoading) return <LoadingState rows={4} columns={2} />;

  // A 404 means "no plan yet", which is a state, not an error.
  const planMissing = plan.isError && plan.error?.code === 'NOT_FOUND';
  if (plan.isError && !planMissing) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />;
  }

  if (planMissing || !plan.data) {
    return (
      <EmptyState
        title={t('floorPlan.none')}
        description={t('floorPlan.noneDescription')}
        action={
          readOnly ? null : (
            <Can code="floor-plan:update">
              <UploadPanel locationId={locationId} hasPlan={false} onUploaded={plan.refetch} />
            </Can>
          )
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {readOnly ? null : (
          <Can code="floor-plan:update">
            <UploadPanel locationId={locationId} hasPlan onUploaded={plan.refetch} />
          </Can>
        )}

        {canDraw ? (
          draft === null ? (
            <Button variant="outline" onClick={() => setDraft([])}>
              {t('floorPlan.draw')}
            </Button>
          ) : (
            <>
              <Button
                onClick={() => createArea.mutate({ locationId: draftLocationId, polygon: draft })}
                loading={createArea.isPending}
                disabled={draft.length < MIN_POINTS || !draftLocationId}
              >
                {t('floorPlan.saveArea')}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t('common.actions.cancel')}
              </Button>
            </>
          )
        ) : null}

        {readOnly ? null : (
          <Can code="floor-plan:delete">
            <Button
              variant="ghost"
              className="ml-auto gap-2 text-destructive"
              onClick={() => setPendingDelete('plan')}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t('floorPlan.remove')}
            </Button>
          </Can>
        )}
      </div>

      {/* Whether the location someone is looking for is actually drawn on this
          plan. Both branches name the plan's own location, because it is often
          not the location they were looking for. */}
      {highlightLocationId ? (
        highlightedArea ? (
          <p className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            {t('floorPlan.highlighted', {
              name: locationNameFor(highlightLocationId, highlightedArea),
            })}
          </p>
        ) : (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            {t('floorPlan.notMapped')}
          </p>
        )
      ) : null}

      {draft !== null ? (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-sm">
            {t('floorPlan.drawHint', { count: draft.length, min: MIN_POINTS })}
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="area-location">{t('floorPlan.areaLocation')}</Label>
              <select
                id="area-location"
                value={draftLocationId}
                onChange={(event) => setDraftLocationId(event.target.value)}
                className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('floorPlan.selectLocation')}</option>
                {/* Restricted to descendants — REQ-LOC-012, checked again server-side. */}
                {descendantOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {'— '.repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Keyboard alternative to clicking — `07-ui.md` §8. */}
            <div className="space-y-1.5">
              <Label htmlFor="point-x">{t('floorPlan.addByCoordinate')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="point-x"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={manualPoint.x}
                  onChange={(event) => setManualPoint((p) => ({ ...p, x: event.target.value }))}
                  className="w-24"
                  aria-label={t('floorPlan.pointX')}
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={manualPoint.y}
                  onChange={(event) => setManualPoint((p) => ({ ...p, y: event.target.value }))}
                  className="w-24"
                  aria-label={t('floorPlan.pointY')}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const x = Number(manualPoint.x);
                    const y = Number(manualPoint.y);
                    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
                      addPoint({ x, y });
                      setManualPoint({ x: '', y: '' });
                    }
                  }}
                >
                  {t('floorPlan.addPoint')}
                </Button>
                {draft.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraft((current) => current.slice(0, -1))}
                  >
                    {t('floorPlan.undoPoint')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="relative inline-block max-w-full">
        {image.isLoading ? (
          <LoadingState rows={6} columns={1} label={t('floorPlan.loadingImage')} />
        ) : image.url ? (
          <>
            <img
              ref={imageRef}
              src={image.url}
              alt={t('floorPlan.imageAlt', { fileName: plan.data.fileName })}
              className="block h-auto max-w-full rounded-md border border-border"
              onClick={handleImageClick}
            />

            {/* viewBox 0..1 means a stored normalized point is its position. */}
            <svg
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              {areas.map((area) => {
                const isHighlighted = area.id === highlightedArea?.id;

                return (
                  <polygon
                    key={area.id}
                    points={pointsToSvg(area.polygon)}
                    className={cn(
                      'pointer-events-auto cursor-pointer',
                      // The highlight has to beat selection: someone arriving
                      // from an asset unit is here to see one specific room.
                      isHighlighted
                        ? 'fill-warning/50 stroke-warning-foreground'
                        : selectedAreaId === area.id
                          ? 'fill-primary/40 stroke-primary'
                          : 'fill-primary/15 stroke-primary/70'
                    )}
                    strokeWidth={isHighlighted ? '3' : '2'}
                    vectorEffect="non-scaling-stroke"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedAreaId(area.id === selectedAreaId ? null : area.id);
                    }}
                  />
                );
              })}

              {draft && draft.length > 0 ? (
                <polygon
                  points={pointsToSvg(draft)}
                  className="fill-warning/30 stroke-warning-foreground"
                  strokeWidth="2"
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
          </>
        ) : (
          <ErrorState error={image.error} />
        )}
      </div>

      {/* The keyboard-navigable equivalent of clicking a shape (§8). */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('floorPlan.areasHere')}</h3>
        {areas.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('floorPlan.noAreas')}</p>
        ) : (
          <ul className="space-y-1">
            {areas.map((area) => {
              const isHighlighted = area.id === highlightedArea?.id;
              const name = locationNameFor(area.locationId, area);

              return (
                <li key={area.id}>
                  <div
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm',
                      isHighlighted
                        ? 'border-warning-foreground bg-warning/20'
                        : selectedAreaId === area.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedAreaId(area.id === selectedAreaId ? null : area.id)}
                      aria-pressed={selectedAreaId === area.id}
                      className="min-w-0 flex-1 text-left"
                    >
                      {name}
                      {isHighlighted ? (
                        <span className="ml-2 text-xs font-medium">
                          {t('floorPlan.highlightedTag')}
                        </span>
                      ) : null}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('floorPlan.points', { count: area.polygon.length })}
                      </span>
                    </button>

                    {readOnly ? null : (
                      <Can code="floor-plan-area:delete">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('floorPlan.deleteArea', { name })}
                          onClick={() => setPendingDelete(area)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </Can>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={
          pendingDelete === 'plan'
            ? t('floorPlan.confirmRemovePlan')
            : t('floorPlan.confirmRemoveArea')
        }
        description={
          pendingDelete === 'plan'
            ? t('floorPlan.confirmRemovePlanDescription')
            : t('floorPlan.confirmRemoveAreaDescription')
        }
        confirmLabel={t('common.actions.remove')}
        destructive
        loading={deletePlan.isPending || deleteArea.isPending}
        onConfirm={async () => {
          if (pendingDelete === 'plan') {
            await deletePlan.mutateAsync().catch(() => undefined);
          } else {
            await deleteArea.mutateAsync(pendingDelete.id).catch(() => undefined);
          }
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
