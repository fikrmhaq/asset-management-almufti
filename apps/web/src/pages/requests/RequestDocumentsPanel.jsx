import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, FileText, Trash2 } from 'lucide-react';

import { documentFormData, requestsApi } from '@/api/requests';
import { usePermission } from '@/auth/useSession';
import { formatDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { SectionCard } from '@/components/patterns/page';
import {
  ALLOWED_EXTENSIONS,
  MAX_SIZE_MB,
  rejectionReason,
} from '@/components/asset/AttachmentsPanel';

/**
 * Request documents — Phase 39 (`CR-014` §9), `07-ui.md` §5.10, REQ-REQUEST-014.
 *
 * Upload with a type, list and download. NO TYPE IS MARKED REQUIRED — whether a
 * proposal is ever mandatory is undecided (`CR-014` §17.2), so nothing here
 * suggests it. `RECEIPT` is a payment receipt ("kuitansi"), never receipt of
 * goods: recording receipt is Phase 41 (`BR-031`).
 *
 * The server decides who may upload (`actions.uploadDocument`) and delete
 * (`canDelete` on each document), so the panel never offers what the API
 * refuses. Files download through the API with the bearer token, as asset
 * attachments do. There is no preview: the attachment preview is bound to
 * asset attachments and is not reused here.
 */

const DOCUMENT_TYPES = ['PROPOSAL', 'SUPPORTING', 'INVOICE', 'RECEIPT', 'BAST', 'OTHER'];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT = ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(',');

const personName = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : '');

/** A type picker with no default: the uploader always chooses. */
export function DocumentTypeSelect({ value, onChange, ...props }) {
  const { t } = useTranslation();
  return (
    <NativeSelect value={value} onChange={(event) => onChange(event.target.value)} {...props}>
      <option value="">{t('requests.documents.chooseType')}</option>
      {DOCUMENT_TYPES.map((type) => (
        <option key={type} value={type}>
          {t(`requests.documents.types.${type}`)}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Saves a downloaded blob under the document's name (the `AttachmentsPanel` sequence). */
async function saveDocument(document) {
  const blob = await requestsApi.downloadDocument(document.id);
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = document.fileName;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function RequestDocumentsPanel({ request }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canRead = usePermission('request-document:read');
  const canUpload = Boolean(request.actions?.uploadDocument);
  const inputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState('');
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);

  const queryKey = ['request', request.id, 'documents'];
  const query = useQuery({
    queryKey,
    queryFn: () => requestsApi.listDocuments(request.id),
    enabled: canRead,
  });

  const upload = useMutation({
    mutationFn: () =>
      requestsApi.uploadDocument(request.id, documentFormData({ file, documentType, title })),
    onSuccess: async () => {
      setFile(null);
      setDocumentType('');
      setTitle('');
      setErrors({});
      await queryClient.invalidateQueries({ queryKey });
      toast.success(t('requests.documents.uploaded'));
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const remove = useMutation({
    mutationFn: (id) => requestsApi.removeDocument(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast.success(t('requests.documents.removed'));
    },
    onError: (error) => toast.fromError(error),
  });

  if (!canRead) return null;

  const pick = (event) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    const reason = rejectionReason(chosen);
    if (reason) {
      toast.error(reason);
      return;
    }
    setFile(chosen);
    setErrors((current) => ({ ...current, file: null }));
  };

  const submit = (event) => {
    event.preventDefault();
    const next = {
      type: documentType ? null : t('requests.documents.typeRequired'),
      file: file ? null : t('requests.documents.fileRequired'),
    };
    setErrors(next);
    if (next.type || next.file) return;
    upload.mutate();
  };

  const download = async (document) => {
    try {
      await saveDocument(document);
    } catch (error) {
      toast.fromError(error);
    }
  };

  const documents = query.data ?? [];

  return (
    <SectionCard
      title={t('requests.documents.title')}
      description={t('requests.documents.description')}
    >
      <div className="space-y-4">
        {canUpload ? (
          <form
            onSubmit={submit}
            className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3"
            aria-label={t('requests.documents.uploadForm')}
          >
            <Field label={t('requests.documents.type')} error={errors.type}>
              {(fieldProps) => (
                <DocumentTypeSelect
                  {...fieldProps}
                  value={documentType}
                  onChange={setDocumentType}
                />
              )}
            </Field>
            <Field label={t('requests.documents.titleLabel')}>
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  value={title}
                  maxLength={255}
                  onChange={(event) => setTitle(event.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('requests.documents.file')}
              error={errors.file}
              hint={t('requests.documents.limits', {
                size: MAX_SIZE_MB,
                types: ALLOWED_EXTENSIONS.join(', '),
              })}
            >
              {() => (
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPT}
                    onChange={pick}
                    className="hidden"
                    aria-label={t('requests.documents.chooseFile')}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => inputRef.current?.click()}
                  >
                    {t('requests.documents.chooseFile')}
                  </Button>
                  <span className="truncate text-xs text-muted-foreground">
                    {file ? file.name : t('requests.documents.noFile')}
                  </span>
                </div>
              )}
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" loading={upload.isPending}>
                {t('requests.documents.upload')}
              </Button>
            </div>
          </form>
        ) : null}

        {query.isLoading ? <LoadingState variant="list" rows={2} /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : null}

        {query.isSuccess && documents.length === 0 ? (
          <EmptyState
            title={t('requests.documents.empty')}
            description={t('requests.documents.emptyDescription')}
            icon={FileText}
          />
        ) : null}

        {documents.length > 0 ? (
          <ul className="space-y-2">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant="neutral">
                        {t(`requests.documents.types.${document.documentType}`)}
                      </Badge>
                      <span className="truncate text-sm font-medium">
                        {document.title || document.fileName}
                      </span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t('requests.documents.meta', {
                        file: document.fileName,
                        size: formatSize(document.fileSize),
                        name: personName(document.uploadedBy),
                        date: formatDate(String(document.createdAt).slice(0, 10)),
                      })}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('requests.documents.download', { name: document.fileName })}
                    onClick={() => download(document)}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  {document.canDelete ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('requests.documents.delete', { name: document.fileName })}
                      onClick={() => setPendingDelete(document)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('requests.documents.deleteTitle')}
        description={t('requests.documents.deleteDescription', {
          name: pendingDelete?.fileName ?? '',
        })}
        confirmLabel={t('requests.documents.deleteConfirm')}
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync(pendingDelete.id).catch(() => undefined);
          setPendingDelete(null);
        }}
      />
    </SectionCard>
  );
}
