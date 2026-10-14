import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { workflowsApi } from '@/api/workflows';
import { usePermission, useSession } from '@/auth/useSession';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { Field } from '@/components/form/field';
import { FormDialog } from '@/components/patterns/form-dialog';
import { DetailPage, SectionCard } from '@/components/patterns/page';
import { useInstitutionOptions } from '../../procurement/referenceOptions';
import { POSITION_CODES, REQUEST_CATEGORIES, STATUS_VARIANT } from './constants';

/**
 * Workflow configuration — Phase 36 (`CR-014` §6.3, §6.5), `07-ui.md` §5.10,
 * REQ-WF-001.
 *
 * One cell per category × requester context, showing its ACTIVE version and any
 * DRAFT. A cell with neither says "Not configured": that context cannot submit
 * that category, because selection is an exact match with no fallback
 * (`BR-030`) — so the grid says so plainly rather than implying a default.
 *
 * WHICH INSTITUTION. An institution-scoped administrator configures their own,
 * and is offered no choice. A system-wide user picks one (decision D4); the
 * server refuses a definition with no institution for them.
 *
 * Templates are offered only when asked for, and only the confirmed flows. Each
 * creates a DRAFT — nothing is ever published or seeded automatically.
 */

const keyOf = (category, requesterPositionCode) => `${category}/${requesterPositionCode}`;

const LAST_INSTITUTION_KEY = 'workflows.lastInstitution';

function readLastInstitution() {
  try {
    return window.sessionStorage.getItem(LAST_INSTITUTION_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberInstitution(value) {
  try {
    if (value) window.sessionStorage.setItem(LAST_INSTITUTION_KEY, value);
    else window.sessionStorage.removeItem(LAST_INSTITUTION_KEY);
  } catch {
    // Storage unavailable: the URL still carries the choice.
  }
}

export function WorkflowConfigurationPage() {
  const { t } = useTranslation();
  const { user } = useSession();
  const institutions = useInstitutionOptions();

  const ownInstitutionId = user?.institutionId ?? null;
  const canChooseInstitution = Boolean(user?.isSystemWide) && institutions.allowed;
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * The choice lives in the URL (`07-ui.md` §4.1), so back/forward and a shared
   * link keep it. Returning through the breadcrumb carries no query, so the
   * last choice is also remembered for the browser session — a convenience
   * only; the page works without storage.
   */
  const chosenInstitutionId = searchParams.get('institution') || readLastInstitution();
  const setChosenInstitutionId = (value) => {
    rememberInstitution(value);
    setSearchParams(value ? { institution: value } : {}, { replace: true });
  };

  const institutionId = canChooseInstitution
    ? chosenInstitutionId || ownInstitutionId || ''
    : ownInstitutionId;

  return (
    <DetailPage title={t('workflows.title')} description={t('workflows.description')}>
      {canChooseInstitution ? (
        <SectionCard>
          <Field label={t('workflows.institution')} hint={t('workflows.institutionHint')}>
            {(fieldProps) => (
              <NativeSelect
                {...fieldProps}
                value={institutionId}
                onChange={(event) => setChosenInstitutionId(event.target.value)}
              >
                <option value="">{t('workflows.selectInstitution')}</option>
                {institutions.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </SectionCard>
      ) : null}

      {institutionId ? (
        <InstitutionWorkflows institutionId={institutionId} />
      ) : (
        <EmptyState
          title={t('workflows.noInstitutionTitle')}
          description={t(
            canChooseInstitution
              ? 'workflows.chooseInstitutionDescription'
              : 'workflows.noInstitutionDescription'
          )}
        />
      )}
    </DetailPage>
  );
}

function InstitutionWorkflows({ institutionId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCreate = usePermission('workflow-definition:create');
  const [creating, setCreating] = useState(null);
  const [source, setSource] = useState('empty');

  const active = useQuery({
    queryKey: ['workflow-definitions', institutionId, 'ACTIVE'],
    queryFn: () => workflowsApi.list({ institutionId, status: 'ACTIVE', pageSize: 100 }),
  });
  const drafts = useQuery({
    queryKey: ['workflow-definitions', institutionId, 'DRAFT'],
    queryFn: () => workflowsApi.list({ institutionId, status: 'DRAFT', pageSize: 100 }),
  });
  const templates = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: () => workflowsApi.templates(),
    staleTime: Infinity,
  });
  // P2 (§64.2): a combination no request may ever have is not offered — the
  // server refuses it anyway. Until the answer arrives, nothing is hidden.
  const eligibility = useQuery({
    queryKey: ['workflow-eligibility'],
    queryFn: () => workflowsApi.eligibility(),
    staleTime: Infinity,
  });
  const isEligible = (category, position) =>
    eligibility.data?.categoriesByPosition?.[position]?.includes(category) ?? true;

  const cells = useMemo(() => {
    const map = new Map();
    for (const row of active.data?.data ?? []) {
      const key = keyOf(row.category, row.requesterPositionCode);
      map.set(key, { ...map.get(key), active: row });
    }
    for (const row of drafts.data?.data ?? []) {
      const key = keyOf(row.category, row.requesterPositionCode);
      map.set(key, { ...map.get(key), draft: row });
    }
    return map;
  }, [active.data, drafts.data]);

  const templateFor = useMemo(
    () =>
      new Map(
        (templates.data ?? []).map((template) => [
          keyOf(template.category, template.requesterPositionCode),
          template,
        ])
      ),
    [templates.data]
  );

  const open = (definition) => navigate(`/organization/workflows/${definition.id}`);

  const create = useMutation({
    mutationFn: ({ category, requesterPositionCode, from }) =>
      from === 'active'
        ? workflowsApi.newVersion(cells.get(keyOf(category, requesterPositionCode)).active.id)
        : workflowsApi.create({
            category,
            requesterPositionCode,
            institutionId,
            ...(from === 'template'
              ? { templateKey: templateFor.get(keyOf(category, requesterPositionCode)).key }
              : {}),
          }),
    onSuccess: async (definition) => {
      await queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] });
      setCreating(null);
      toast.success(t('workflows.draftCreated'));
      open(definition);
    },
    onError: (error) => toast.fromError(error, { includeValidation: true }),
  });

  const startCreating = (category, requesterPositionCode) => {
    const key = keyOf(category, requesterPositionCode);
    setSource(cells.get(key)?.active ? 'active' : templateFor.has(key) ? 'template' : 'empty');
    setCreating({ category, requesterPositionCode });
  };

  if (active.isLoading || drafts.isLoading) return <LoadingState variant="table" rows={8} />;
  if (active.isError) return <ErrorState error={active.error} onRetry={active.refetch} />;
  if (drafts.isError) return <ErrorState error={drafts.error} onRetry={drafts.refetch} />;

  const creatingKey = creating ? keyOf(creating.category, creating.requesterPositionCode) : null;

  return (
    <>
      <SectionCard title={t('workflows.gridTitle')} description={t('workflows.gridDescription')}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('workflows.requesterContext')}</TableHead>
                {REQUEST_CATEGORIES.map((category) => (
                  <TableHead key={category}>{t(`workflows.categories.${category}`)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {POSITION_CODES.map((position) => (
                <TableRow key={position}>
                  <TableCell className="font-medium">
                    {t(`positions.options.${position}`)}
                  </TableCell>
                  {REQUEST_CATEGORIES.map((category) => {
                    const cell = cells.get(keyOf(category, position)) ?? {};
                    return (
                      <TableCell
                        key={category}
                        data-testid={`cell-${category}-${position}`}
                        className="align-top"
                      >
                        <div className="flex flex-col items-start gap-1.5">
                          {cell.active ? (
                            <Link
                              to={`/organization/workflows/${cell.active.id}`}
                              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {t('workflows.activeVersion', { version: cell.active.version })}
                            </Link>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {t(
                                isEligible(category, position)
                                  ? 'workflows.notConfigured'
                                  : 'workflows.notEligible'
                              )}
                            </span>
                          )}
                          {cell.draft ? (
                            <Link to={`/organization/workflows/${cell.draft.id}`}>
                              <Badge variant={STATUS_VARIANT.DRAFT}>
                                {t('workflows.draftVersion', { version: cell.draft.version })}
                              </Badge>
                            </Link>
                          ) : canCreate && isEligible(category, position) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startCreating(category, position)}
                              aria-label={t('workflows.createDraftFor', {
                                category: t(`workflows.categories.${category}`),
                                context: t(`positions.options.${position}`),
                              })}
                            >
                              {t('workflows.createDraft')}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      <SectionCard
        title={t('workflows.templatesTitle')}
        description={t('workflows.templatesDescription')}
      >
        {templates.isLoading ? (
          <LoadingState variant="list" rows={2} />
        ) : (
          <ul className="space-y-2">
            {(templates.data ?? []).map((template) => {
              const key = keyOf(template.category, template.requesterPositionCode);
              const draft = cells.get(key)?.draft;
              return (
                <li
                  key={template.key}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3"
                >
                  <span className="font-medium">
                    {t(`workflows.categories.${template.category}`)} ·{' '}
                    {t(`positions.options.${template.requesterPositionCode}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {template.steps
                      .map((s) =>
                        s.actorPositionCode
                          ? t(`positions.options.${s.actorPositionCode}`)
                          : t('workflows.actorUndecided', { question: s.unresolvedQuestion })
                      )
                      .join(' → ')}
                  </span>
                  {canCreate ? (
                    draft ? (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {t('workflows.draftExists')}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        loading={create.isPending}
                        onClick={() =>
                          create.mutate({
                            category: template.category,
                            requesterPositionCode: template.requesterPositionCode,
                            from: 'template',
                          })
                        }
                      >
                        {t('workflows.useTemplate')}
                      </Button>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <FormDialog
        open={Boolean(creating)}
        onOpenChange={(isOpen) => (isOpen ? null : setCreating(null))}
        title={t('workflows.createTitle')}
        description={
          creating
            ? t('workflows.createDescription', {
                category: t(`workflows.categories.${creating.category}`),
                context: t(`positions.options.${creating.requesterPositionCode}`),
              })
            : null
        }
        submitLabel={t('workflows.createDraft')}
        loading={create.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (creating) create.mutate({ ...creating, from: source });
        }}
      >
        <Field label={t('workflows.startFrom')}>
          {(fieldProps) => (
            <NativeSelect
              {...fieldProps}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="empty">{t('workflows.sources.empty')}</option>
              {creatingKey && templateFor.has(creatingKey) ? (
                <option value="template">{t('workflows.sources.template')}</option>
              ) : null}
              {creatingKey && cells.get(creatingKey)?.active ? (
                <option value="active">
                  {t('workflows.sources.active', {
                    version: cells.get(creatingKey).active.version,
                  })}
                </option>
              ) : null}
            </NativeSelect>
          )}
        </Field>
      </FormDialog>
    </>
  );
}
