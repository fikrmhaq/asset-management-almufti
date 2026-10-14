import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Eye, FileImage, FileText, Trash2 } from 'lucide-react';

import { assetsApi, attachmentsApi } from '@/api/assetCore';
import { Can } from '@/auth/guards';
import { usePermission } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';
import { formatDate } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { AttachmentPreviewDialog, isPreviewable, previewKind } from './AttachmentPreview';

/**
 * Attachments — `IMPLEMENTATION_PLAN.md` §18.8, `06-api.md` §5.1/§5.4;
 * REQ-FILE-001–005.
 *
 * Upload is `multipart/form-data` (§1.8) and the browser sets its own boundary.
 * The limits mirror `05-infrastructure.md` §5.3 so an oversized or wrong-typed
 * file is rejected before it is sent — the server enforces the same rules, and
 * remains the authority.
 *
 * Images and PDFs open in place (`AttachmentPreview.jsx`). DOCX and XLSX do not,
 * and are offered as a download only — a preview frame that renders nothing is
 * not a feature.
 */

/** `05-infrastructure.md` §5.3. */
const MAX_SIZE_MB = 10;
const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx'];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** @returns {string|null} a reason to refuse, or null when acceptable */
export function rejectionReason(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
    return `That file type is not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}.`;
  }

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return `That file is larger than ${MAX_SIZE_MB} MB.`;
  }

  return null;
}

/**
 * `wholeAssetChange` (P3, §64.3): false for a Kajur / Toolman on an asset another
 * department also has units of — a file on the asset itself is then neither
 * added nor deleted here (the server refuses both); unit files are unaffected.
 */
export function AttachmentsPanel({ assetId, assetUnitId, wholeAssetChange = true }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const canUpload = usePermission('attachment:create');

  const query = useQuery({
    queryKey: queryKeys.assets.sub(assetId, 'attachments'),
    queryFn: () => assetsApi.listAttachments(assetId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.assets.sub(assetId, 'attachments') });

  const upload = useMutation({
    mutationFn: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      // Narrows the attachment to one unit when the panel is on a unit page.
      if (assetUnitId) formData.append('assetUnitId', assetUnitId);
      return assetsApi.uploadAttachment(assetId, formData);
    },
    onSuccess: async () => {
      await refresh();
      toast.success('File uploaded');
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const remove = useMutation({
    mutationFn: (id) => attachmentsApi.remove(id),
    onSuccess: async () => {
      await refresh();
      toast.success('File removed');
    },
    onError: (error) => toast.fromError(error),
  });

  /**
   * Downloads through the API rather than linking to a URL: the endpoint is
   * authorized per caller (REQ-FILE-005), so the request has to carry the bearer
   * token, which a plain `<a href>` would not.
   *
   * The anchor is put in the document before it is clicked and removed after —
   * the same sequence as `lib/csv.js`. A detached anchor's `click()` is ignored
   * by Firefox, so the download silently did nothing there.
   */
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
    } catch (error) {
      toast.fromError(error);
    }
  };

  const pick = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reason = rejectionReason(file);
    if (reason) {
      toast.error(reason);
      return;
    }

    upload.mutate(file);
  };

  const attachments = (query.data ?? []).filter(
    (attachment) => !assetUnitId || attachment.assetUnitId === assetUnitId
  );

  if (query.isLoading) return <LoadingState variant="list" rows={2} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <div className="space-y-4">
      {canUpload && (assetUnitId || wholeAssetChange) ? (
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            onChange={pick}
            accept={ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(',')}
            className="hidden"
            aria-label="Choose a file to upload"
          />
          <Button onClick={() => inputRef.current?.click()} loading={upload.isPending}>
            Upload a file
          </Button>
          <span className="text-xs text-muted-foreground">
            Up to {MAX_SIZE_MB} MB — {ALLOWED_EXTENSIONS.join(', ')}
          </span>
        </div>
      ) : null}

      {attachments.length === 0 ? (
        <EmptyState
          title="No attachments"
          description="Photos, receipts and documents for this asset appear here."
          icon={FileText}
        />
      ) : (
        <ul className="space-y-2">
          {attachments.map((attachment) => {
            const canPreview = isPreviewable(attachment.fileType);
            const Icon = previewKind(attachment.fileType) === 'image' ? FileImage : FileText;

            return (
              <li
                key={attachment.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    {/* The name opens the preview when there is one to open, so
                        the obvious thing to click does the obvious thing. It
                        stays plain text otherwise rather than becoming a control
                        that reports it cannot help. */}
                    {canPreview ? (
                      <button
                        type="button"
                        onClick={() => setPreviewing(attachment)}
                        className="block max-w-full truncate text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {attachment.fileName}
                      </button>
                    ) : (
                      <span className="block truncate text-sm font-medium">
                        {attachment.fileName}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {formatSize(attachment.fileSize)} ·{' '}
                      {formatDate(attachment.createdAt?.slice(0, 10))}
                      {/* REQ-REQUEST-020: evidence of what was registered. */}
                      {attachment.purpose === 'REGISTRATION_PHOTO' ? (
                        <>
                          {' · '}
                          <span data-testid={`attachment-registration-photo-${attachment.id}`}>
                            {t('requests.registration.photos.badge')}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-1">
                  {canPreview ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Preview ${attachment.fileName}`}
                      onClick={() => setPreviewing(attachment)}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Download ${attachment.fileName}`}
                    onClick={() => download(attachment)}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Can code="attachment:delete">
                    {!attachment.assetUnitId && !wholeAssetChange ? null : (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${attachment.fileName}`}
                        onClick={() => setPendingDelete(attachment)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </Can>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <AttachmentPreviewDialog
        attachment={previewing}
        open={Boolean(previewing)}
        onOpenChange={(open) => !open && setPreviewing(null)}
        onDownload={download}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this file?"
        description={`"${pendingDelete?.fileName}" will be removed permanently.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync(pendingDelete.id).catch(() => undefined);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

export { ALLOWED_EXTENSIONS, MAX_SIZE_MB };
