import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';

import { attachmentsApi } from '@/api/assetCore';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';

/**
 * Looking at an attachment without leaving the page — `07-ui.md` §4.2/§5.3,
 * REQ-FILE-001/005.
 *
 * Until now the only thing that could be done with an attachment was to download
 * it, so checking whether the right photograph was uploaded meant saving a file
 * and opening it from the file manager.
 *
 * TWO CONSTRAINTS SHAPE THIS, and neither is negotiable:
 *
 *   1. A plain `<img src>` cannot work. The endpoint requires the bearer token
 *      like every other route (`06-api.md` §1.2) and the browser would omit it,
 *      and the API sets `Cross-Origin-Resource-Policy: same-site`, which blocks
 *      the load a second time. So the bytes are fetched by the API client and
 *      turned into an object URL — the same approach as the floor plan
 *      (`useFloorPlan.js`), for the same reasons.
 *
 *   2. The server's `Content-Disposition: attachment` stays as it is. It exists
 *      because an uploaded file rendered in the API's own origin is how a stored
 *      HTML or SVG payload would execute. A blob URL built here is same-origin
 *      to the WEB app and carries no such header, so previewing costs nothing in
 *      that protection — the header still governs anyone who reaches the
 *      endpoint directly.
 */

/**
 * What can be shown, and as what.
 *
 * A subset of the upload allowlist (`05-infrastructure.md` §5.3) — DOCX and
 * XLSX have no in-browser renderer, and offering a broken frame for them would
 * be worse than offering nothing. Note what is absent: `text/html` and
 * `image/svg+xml` are not uploadable and are not renderable here, which is what
 * keeps a preview from ever becoming a script execution.
 */
const PREVIEWABLE = Object.freeze({
  'image/jpeg': 'image',
  'image/png': 'image',
  'application/pdf': 'pdf',
});

/** @returns {'image'|'pdf'|null} */
export function previewKind(fileType) {
  return PREVIEWABLE[String(fileType ?? '').toLowerCase()] ?? null;
}

export const isPreviewable = (fileType) => previewKind(fileType) !== null;

/**
 * The attachment's bytes as an object URL, fetched only once asked for.
 *
 * `enabled` is what keeps this honest: an asset's attachment list may hold a
 * dozen 10 MB photographs, and eagerly resolving all of them to show the list
 * would download every one. Nothing is fetched until a preview is opened.
 *
 * The URL is revoked when the dialog closes or the file changes — an
 * un-revoked object URL pins the whole file in memory for the life of the tab.
 */
export function useAttachmentPreview(attachment, { enabled = true } = {}) {
  const [url, setUrl] = useState(null);

  const id = attachment?.id ?? null;
  // Normalized here so the effect below depends on a primitive, not on the
  // attachment object's identity — which changes on every list refetch.
  const mimeType = String(attachment?.fileType ?? '').toLowerCase();
  const active = enabled && Boolean(id) && Boolean(PREVIEWABLE[mimeType]);

  const query = useQuery({
    queryKey: queryKeys.attachments.sub(id ?? 'none', 'file'),
    queryFn: () => attachmentsApi.download(id),
    enabled: active,
    staleTime: 5 * 60_000,
    // Re-opening the same preview should not re-download the file.
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!query.data || !PREVIEWABLE[mimeType]) return undefined;

    // Re-wrapped with a type from the allowlist above rather than served with
    // whatever the response claimed. It is the same value today — the API
    // validates uploads against the same list — but this is the line that
    // decides what the browser will RENDER, and it should read from a constant
    // in this file rather than from a header.
    const objectUrl = URL.createObjectURL(new Blob([query.data], { type: mimeType }));
    setUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [query.data, mimeType]);

  return {
    url,
    isLoading: active && query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

function PreviewBody({ attachment, url, isLoading, error, refetch }) {
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !url) return <LoadingState variant="card" label="Loading the file" />;

  const kind = previewKind(attachment?.fileType);

  if (kind === 'image') {
    return (
      <img
        src={url}
        // The file name is the only description this system has of what the
        // image shows, so it is the only honest alt text available.
        alt={attachment.fileName}
        className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md bg-neutral-50 object-contain"
      />
    );
  }

  return (
    <iframe
      src={url}
      title={attachment.fileName}
      className="h-[70vh] w-full rounded-md border border-border bg-neutral-50"
    />
  );
}

/**
 * @param {object} props
 * @param {{id: string, fileName: string, fileType: string}|null} props.attachment
 * @param {(attachment: object) => void} [props.onDownload]
 *   Offered inside the dialog too: having looked at a file is the moment someone
 *   decides they want a copy of it.
 */
export function AttachmentPreviewDialog({ attachment, open, onOpenChange, onDownload }) {
  const preview = useAttachmentPreview(attachment, { enabled: open });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{attachment?.fileName}</DialogTitle>
          <DialogDescription>{attachment?.fileType}</DialogDescription>
        </DialogHeader>

        {attachment ? <PreviewBody attachment={attachment} {...preview} /> : null}

        {onDownload ? (
          <DialogFooter>
            <Button variant="secondary" onClick={() => onDownload(attachment)}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Download
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
