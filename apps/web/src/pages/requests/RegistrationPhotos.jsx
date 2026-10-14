import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileImage } from 'lucide-react';

import { assetsApi, attachmentsApi } from '@/api/assetCore';
import { normalizeError } from '@/api/errors';
import { usePermission } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';
import { formatDate } from '@/lib/dates';
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
import { MAX_SIZE_MB } from '@/components/asset/AttachmentsPanel';
import { AttachmentPreviewDialog } from '@/components/asset/AttachmentPreview';
import { assets } from '@/pages/assets/resources';
import { REGISTRATION_PHOTO, photoRejection } from './registrationPhotoRules';

/**
 * Registration photos — REQ-REQUEST-020 (`IMPLEMENTATION_PLAN.md` §67).
 *
 * Evidence of WHAT WAS REGISTERED: ordinary attachments of the asset or of one
 * unit, marked `REGISTRATION_PHOTO`, uploaded after the registration and apart
 * from it — a refused photo never undoes a registration. NOT proof of receipt:
 * receipt photos belong to the requester's receipt confirmation.
 *
 * What is offered follows the server: the unit section for a unit the caller
 * reaches; the asset section only when a change to the whole asset is theirs
 * (`scope.wholeAssetChange`, P3). Upload needs `attachment:create`, the list
 * `attachment:read` — the existing codes.
 */

function PhotoSection({ title, hint, photos, canUpload, onUpload, uploading, error, testId }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [previewing, setPreviewing] = useState(null);

  const pick = (event) => {
    const [file] = event.target.files ?? [];
    event.target.value = '';
    if (file) onUpload(file);
  };

  const download = async (attachment) => {
    try {
      const blob = await attachmentsApi.download(attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (failure) {
      toast.fromError(failure);
    }
  };

  return (
    <section className="space-y-2 rounded-md border border-border p-3" data-testid={testId}>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('requests.registration.photos.none')}</p>
      ) : (
        <ul className="space-y-1">
          {photos.map((photo) => (
            <li key={photo.id} className="flex items-center gap-2 text-sm">
              <FileImage className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <button
                type="button"
                className="truncate font-medium hover:underline"
                aria-label={t('requests.registration.photos.open', { name: photo.fileName })}
                onClick={() => setPreviewing(photo)}
              >
                {photo.fileName}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDate(photo.createdAt?.slice(0, 10))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            className="hidden"
            aria-label={t('requests.registration.photos.choose', { section: title })}
            onChange={pick}
          />
          <Button
            size="sm"
            variant="outline"
            loading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {t('requests.registration.photos.add')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('requests.registration.photos.rules', { max: MAX_SIZE_MB })}
          </span>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <AttachmentPreviewDialog
        attachment={previewing}
        open={Boolean(previewing)}
        onOpenChange={(open) => (open ? null : setPreviewing(null))}
        onDownload={download}
      />
    </section>
  );
}

/**
 * @param {object} props
 * @param {{id: string, inventoryCode?: string, asset: {id: string, name: string}}} props.unit
 *   a registered unit, as `GET /request-items/:id/units` returns it
 */
export function RegistrationPhotosDialog({ unit, open, onOpenChange }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canRead = usePermission('attachment:read');
  const canUpload = usePermission('attachment:create');
  const canReadAsset = usePermission('asset:read');
  const [errors, setErrors] = useState({});
  const assetId = unit.asset.id;
  const code = unit.inventoryCode ?? unit.id.slice(0, 8);
  const key = queryKeys.assets.sub(assetId, 'attachments');

  const list = useQuery({
    queryKey: key,
    queryFn: () => assetsApi.listAttachments(assetId),
    enabled: open && canRead,
  });
  // Whether a photo of the whole asset is the caller's to add (P3).
  const asset = assets.useDetail(assetId, { enabled: open && canReadAsset });
  const wholeAsset = asset.data?.scope?.wholeAssetChange === true;

  const upload = useMutation({
    mutationFn: ({ file, section }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (section === 'unit') formData.append('assetUnitId', unit.id);
      formData.append('purpose', REGISTRATION_PHOTO);
      return assetsApi.uploadAttachment(assetId, formData);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      toast.success(t('requests.registration.photos.added'));
    },
    onError: (error, { section }) => {
      const fieldErrors = normalizeError(error).fieldErrors ?? {};
      const message =
        fieldErrors.file ?? fieldErrors.purpose ?? fieldErrors['body.purpose'] ?? null;
      if (message) setErrors((current) => ({ ...current, [section]: message }));
      toast.fromError(error);
    },
  });

  const add = (section) => (file) => {
    const reason = photoRejection(file);
    if (reason) {
      setErrors((current) => ({
        ...current,
        [section]: t(`requests.registration.photos.errors.${reason}`, { max: MAX_SIZE_MB }),
      }));
      return;
    }
    setErrors((current) => ({ ...current, [section]: null }));
    upload.mutate({ file, section });
  };

  const photos = (list.data ?? []).filter((row) => row.purpose === REGISTRATION_PHOTO);
  const uploadingFor = (section) => upload.isPending && upload.variables?.section === section;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('requests.registration.photos.title', { code })}</DialogTitle>
          <DialogDescription>{t('requests.registration.photos.description')}</DialogDescription>
        </DialogHeader>

        {list.isLoading ? <LoadingState variant="list" rows={2} /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : null}

        <div className="space-y-3">
          <PhotoSection
            testId="registration-photos-unit"
            title={t('requests.registration.photos.unitSection')}
            hint={t('requests.registration.photos.unitHint', { code })}
            photos={photos.filter((row) => row.assetUnitId === unit.id)}
            canUpload={canUpload}
            onUpload={add('unit')}
            uploading={uploadingFor('unit')}
            error={errors.unit}
          />
          {wholeAsset ? (
            <PhotoSection
              testId="registration-photos-asset"
              title={t('requests.registration.photos.assetSection')}
              hint={t('requests.registration.photos.assetHint', { name: unit.asset.name })}
              photos={photos.filter((row) => !row.assetUnitId)}
              canUpload={canUpload}
              onUpload={add('asset')}
              uploading={uploadingFor('asset')}
              error={errors.asset}
            />
          ) : asset.data ? (
            <p className="text-xs text-muted-foreground" data-testid="registration-photos-no-asset">
              {t('requests.registration.photos.assetNotOpen')}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
