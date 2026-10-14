import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';

import { assetImportApi } from '@/api/assetCore';
import { useSession } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';
import { Alert } from '@/components/ui/alert';
import { Badge, statusLabel } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader, SectionCard } from '@/components/patterns/page';
import { useInstitutionOptions } from '../procurement/referenceOptions';

/**
 * Asset import from Excel / CSV — an ADDITION beside "New asset", which is
 * unchanged.
 *
 * Three steps on one page: download the template, choose a filled file (which
 * is previewed at once — the server runs the whole import and rolls it back),
 * and import. Import is offered only for a preview with no problems, and the
 * server checks the file again, all or nothing.
 */

const SHOWN_CODES = 3;

function codesSummary(codes) {
  if (codes.length === 0) return '—';
  if (codes.length <= SHOWN_CODES) return codes.join(', ');
  return `${codes[0]} … ${codes[codes.length - 1]}`;
}

function IssueTable({ issues, t, i18n }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">{t('assets.import.row')}</TableHead>
          <TableHead className="w-40">{t('assets.import.column')}</TableHead>
          <TableHead>{t('assets.import.problem')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((problem, index) => (
          <TableRow key={`${problem.row}-${problem.column}-${index}`}>
            <TableCell className="font-mono">{problem.row}</TableCell>
            <TableCell>{problem.column ?? '—'}</TableCell>
            <TableCell>{issueText(t, i18n, problem)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Translated when the code is known; the server's own wording otherwise — a
 * shared registration rule (`RULE`) carries its explanation in the message.
 */
function issueText(t, i18n, problem) {
  const key = `assets.import.issues.${problem.code}`;
  return i18n.exists(key) ? t(key, problem.params) : problem.message;
}

export function AssetImportPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const institutionRequired = !user?.institutionId;
  const institutions = useInstitutionOptions();

  const fileInput = useRef(null);
  const [institutionId, setInstitutionId] = useState('');
  const [file, setFile] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const preview = useMutation({
    mutationFn: ({ chosen, institution }) => assetImportApi.preview(chosen, institution),
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const commit = useMutation({
    mutationFn: () => assetImportApi.import(file, institutionId || undefined),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });
      toast.success(
        t('assets.import.imported', {
          assets: result.summary.assets,
          units: result.summary.units,
        })
      );
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const report = commit.data ?? preview.data;
  const imported = Boolean(commit.data?.imported);

  const choose = (chosen) => {
    setFile(chosen ?? null);
    commit.reset();
    preview.reset();
    if (chosen) preview.mutate({ chosen, institution: institutionId || undefined });
  };

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await assetImportApi.template(institutionId || undefined);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.fromError(error);
    } finally {
      setDownloading(false);
    }
  };

  const startOver = () => {
    if (fileInput.current) fileInput.current.value = '';
    choose(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('assets.import.title')}
        description={t('assets.import.description')}
        actions={
          <Button variant="outline" asChild>
            <Link to="/assets/new">{t('assets.import.manualInstead')}</Link>
          </Button>
        }
      />

      {institutionRequired ? (
        <SectionCard title={t('assets.import.institutionTitle')}>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{t('common.fields.institution')}</span>
            <select
              aria-label={t('common.fields.institution')}
              value={institutionId}
              onChange={(event) => {
                setInstitutionId(event.target.value);
                startOver();
              }}
              className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm shadow-xs"
            >
              <option value="">{t('assets.import.chooseInstitution')}</option>
              {institutions.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </SectionCard>
      ) : null}

      <SectionCard
        title={t('assets.import.step1Title')}
        description={t('assets.import.step1Description')}
      >
        <Button
          variant="outline"
          onClick={downloadTemplate}
          loading={downloading}
          disabled={institutionRequired && !institutionId}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {t('assets.import.downloadTemplate')}
        </Button>
      </SectionCard>

      <SectionCard
        title={t('assets.import.step2Title')}
        description={t('assets.import.step2Description')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            aria-label={t('assets.import.chooseFile')}
            className="sr-only"
            id="asset-import-file"
            onChange={(event) => choose(event.target.files?.[0])}
            disabled={(institutionRequired && !institutionId) || commit.isPending}
          />
          <Button
            asChild
            variant={file ? 'outline' : 'default'}
            disabled={institutionRequired && !institutionId}
          >
            <label htmlFor="asset-import-file" className="cursor-pointer">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              {file ? t('assets.import.chooseAnother') : t('assets.import.chooseFile')}
            </label>
          </Button>
          {file ? <span className="text-sm text-muted-foreground">{file.name}</span> : null}
          {preview.isPending ? (
            <span className="text-sm text-muted-foreground">{t('assets.import.checking')}</span>
          ) : null}
        </div>
      </SectionCard>

      {report ? (
        <SectionCard
          title={imported ? t('assets.import.doneTitle') : t('assets.import.step3Title')}
          description={
            imported
              ? t('assets.import.doneDescription')
              : report.valid
                ? t('assets.import.readyDescription')
                : t('assets.import.problemsDescription')
          }
          actions={
            imported ? (
              <Button onClick={() => navigate('/assets')}>{t('assets.import.toAssets')}</Button>
            ) : (
              <Button
                onClick={() => commit.mutate()}
                loading={commit.isPending}
                disabled={!report.valid || preview.isPending}
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                {t('assets.import.importButton', {
                  assets: report.summary.assets,
                  units: report.summary.units,
                })}
              </Button>
            )
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">
                {t('assets.import.summaryRows', { count: report.summary.rows })}
              </Badge>
              <Badge variant="outline">
                {t('assets.import.summaryAssets', { count: report.summary.assets })}
              </Badge>
              <Badge variant="outline">
                {t('assets.import.summaryUnits', { count: report.summary.units })}
              </Badge>
            </div>

            {report.fileIssues.map((problem) => (
              <Alert key={problem.code} variant="error">
                {issueText(t, i18n, problem)}
              </Alert>
            ))}

            {report.issues.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {t('assets.import.issuesTitle', { count: report.issues.length })}
                </h3>
                <IssueTable issues={report.issues} t={t} i18n={i18n} />
              </div>
            ) : null}

            {report.warnings.length > 0 ? (
              <Alert variant="warning" title={t('assets.import.warningsTitle')}>
                <ul className="list-disc space-y-1 pl-4">
                  {report.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`}>
                      {warning.row > 1 ? `${t('assets.import.row')} ${warning.row}: ` : ''}
                      {issueText(t, i18n, warning)}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            {report.assets.length > 0 && report.valid ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.fields.name')}</TableHead>
                    <TableHead>{t('common.fields.classification')}</TableHead>
                    <TableHead className="w-20 text-right">{t('assets.import.units')}</TableHead>
                    <TableHead>{t('assets.import.placement')}</TableHead>
                    <TableHead>{t('assets.import.codes')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.assets.map((asset) => (
                    <TableRow key={`${asset.name}-${asset.classificationId}`}>
                      <TableCell>
                        {asset.id ? (
                          <Link to={`/assets/${asset.id}`} className="hover:underline">
                            {asset.name}
                          </Link>
                        ) : (
                          asset.name
                        )}
                        {asset.existing ? (
                          <Badge variant="warning" className="ml-2">
                            {t('assets.import.nameExists')}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{asset.classificationId}</span>{' '}
                        <span className="text-muted-foreground">{asset.classificationName}</span>
                      </TableCell>
                      <TableCell className="text-right">{asset.unitCount}</TableCell>
                      <TableCell>
                        <ul className="space-y-0.5">
                          {asset.rows.map((row) => (
                            <li key={row.row} className="text-sm">
                              {row.quantity} ×{' '}
                              {row.location
                                ? `${row.location} · ${statusLabel(t, row.condition, 'condition')}`
                                : t('assets.import.notPlaced')}
                              {row.department ? ` · ${row.department}` : ''}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {codesSummary(asset.rows.flatMap((row) => row.inventoryCodes))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}

            {!imported ? (
              <Button variant="ghost" size="sm" onClick={startOver}>
                {t('assets.import.startOver')}
              </Button>
            ) : null}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
