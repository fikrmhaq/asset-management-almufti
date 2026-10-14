import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { requestsApi } from '@/api/requests';
import { usePermission } from '@/auth/useSession';
import { formatDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { SectionCard } from '@/components/patterns/page';

/**
 * Receipt confirmations — migration 057 (`IMPLEMENTATION_PLAN.md` §63).
 *
 * The requester's own statement with each Record Receipt: where the units are
 * relative to the intended place AS IT WAS THEN (a snapshot), a description,
 * and photos. It is evidence the requester provided — not a verified fact. With
 * `AT_INTENDED_PLACE` the server places each unplaced unit at the snapshot
 * (REQ-REQUEST-024); each unit says where it is now, or that it still needs
 * placement. A confirmation whose every receipt was reversed stays, shown
 * as superseded; its photos stay too. Nothing here can be edited or deleted.
 *
 * REQ-REQUEST-022: photos are shown in context — of the whole receipt, or
 * under the received unit each one shows.
 *
 * Photo bytes come through the API with the bearer token and the request's
 * visibility (`request-document:read`); without that code the names are shown.
 */

/** Rendered only as one of these types — never from a response header. */
const IMAGE_TYPES = { 'image/jpeg': 'image/jpeg', 'image/png': 'image/png' };

const personName = (user) => `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();

function usePhotoUrl(photo) {
  const [url, setUrl] = useState(null);
  const type = IMAGE_TYPES[photo.fileType];
  const query = useQuery({
    queryKey: ['request-document', photo.id, 'bytes'],
    queryFn: () => requestsApi.downloadDocument(photo.id),
    enabled: Boolean(type),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!query.data || !type) return undefined;
    const objectUrl = URL.createObjectURL(new Blob([query.data], { type }));
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [query.data, type]);

  return { url, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

function PhotoThumbnail({ photo, onOpen }) {
  const { url, isLoading, error, refetch } = usePhotoUrl(photo);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <button
      type="button"
      onClick={() => url && onOpen({ photo, url })}
      className="h-24 w-24 overflow-hidden rounded-md border border-border bg-neutral-50"
      title={photo.fileName}
    >
      {isLoading || !url ? (
        <span className="sr-only">{photo.fileName}</span>
      ) : (
        <img src={url} alt={photo.fileName} className="h-full w-full object-cover" />
      )}
    </button>
  );
}

/**
 * REQ-REQUEST-022: a confirmation's photos in context — those of the whole
 * receipt, then each received unit's own, in the order of its units.
 */
function photoGroups(confirmation) {
  const groups = [];
  const general = confirmation.photos.filter((photo) => !photo.receiptId);
  if (general.length > 0) groups.push({ key: 'whole', unit: null, photos: general });
  for (const unit of confirmation.units) {
    const own = confirmation.photos.filter((photo) => photo.receiptId === unit.receiptId);
    if (own.length > 0) groups.push({ key: unit.receiptId, unit, photos: own });
  }
  return groups;
}

function placementText(t, confirmation) {
  if (!confirmation.destination) return t('requests.confirmations.noIntendedPlace');
  return t(`requests.confirmations.placements.${confirmation.placement}`, {
    name: confirmation.destination.name,
  });
}

export function RequestReceiptConfirmations({ request }) {
  const { t } = useTranslation();
  const canReadPhotos = usePermission('request-document:read');
  const [viewing, setViewing] = useState(null);
  const confirmations = request.receiptConfirmations ?? [];

  if (confirmations.length === 0) return null;

  return (
    <SectionCard
      title={t('requests.confirmations.title')}
      description={t('requests.confirmations.description')}
    >
      <ul className="space-y-4" data-testid="receipt-confirmations">
        {confirmations.map((confirmation) => {
          const superseded = confirmation.state === 'SUPERSEDED';
          return (
            <li
              key={confirmation.id}
              className="space-y-2 rounded-md border border-border p-3"
              data-testid={`confirmation-${confirmation.id}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={superseded ? 'neutral' : 'success'}>
                  {t(`requests.confirmations.states.${confirmation.state}`)}
                </Badge>
                <span className="text-muted-foreground">
                  {t('requests.confirmations.confirmedLine', {
                    name: personName(confirmation.confirmedBy),
                    date: formatDate(String(confirmation.confirmedAt).slice(0, 10)),
                    receivedOn: confirmation.receivedOn
                      ? formatDate(String(confirmation.receivedOn))
                      : '—',
                  })}
                </span>
              </div>
              <p className="text-sm font-medium">{placementText(t, confirmation)}</p>
              <p className="whitespace-pre-wrap text-sm">{confirmation.description}</p>
              <p className="text-xs text-muted-foreground">
                {t('requests.confirmations.units')}{' '}
                {confirmation.units.map((unit, index) => (
                  <span
                    key={unit.receiptId}
                    data-testid={`confirmation-unit-${unit.inventoryCode}`}
                  >
                    {index > 0 ? ', ' : ''}
                    <span className={unit.reversed ? 'font-mono line-through' : 'font-mono'}>
                      {unit.inventoryCode ?? '—'}
                    </span>
                    {unit.reversed ? ` (${t('requests.confirmations.reversed')})` : ''}
                    {/* REQ-REQUEST-024: where the unit is now, or that it still
                        needs placing — derived by the server, never stored. */}
                    {unit.reversed ? null : unit.needsPlacement ? (
                      <span className="text-warning-foreground">
                        {' '}
                        ({t('requests.confirmations.needsPlacement')})
                      </span>
                    ) : unit.currentLocation ? (
                      <span>
                        {' '}
                        ({t('requests.confirmations.placedAt', { name: unit.currentLocation.name })}
                        )
                      </span>
                    ) : null}
                  </span>
                ))}
              </p>
              <div className="space-y-2" data-testid="confirmation-photos">
                {photoGroups(confirmation).map(({ key, unit, photos }) => (
                  <div
                    key={key}
                    className="space-y-1"
                    data-testid={
                      unit
                        ? `confirmation-unit-photos-${unit.inventoryCode ?? unit.receiptId}`
                        : 'confirmation-whole-photos'
                    }
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {unit ? (
                        <>
                          {t('requests.confirmations.unitPhotos')}{' '}
                          <span className="font-mono">{unit.inventoryCode ?? '—'}</span>
                          {unit.reversed ? ` (${t('requests.confirmations.reversed')})` : ''}
                        </>
                      ) : (
                        t('requests.confirmations.wholePhotos')
                      )}
                    </p>
                    {canReadPhotos ? (
                      <div className="flex flex-wrap gap-2">
                        {photos.map((photo) => (
                          <PhotoThumbnail key={photo.id} photo={photo} onOpen={setViewing} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {photos.map((photo) => photo.fileName).join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={Boolean(viewing)} onOpenChange={(open) => (open ? null : setViewing(null))}>
        <DialogContent size="xl">
          <DialogTitle>{viewing?.photo.fileName}</DialogTitle>
          {viewing ? (
            <img
              src={viewing.url}
              alt={viewing.photo.fileName}
              className="max-h-[70vh] w-full object-contain"
            />
          ) : (
            <LoadingState variant="card" />
          )}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
