import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { workflowsApi } from '@/api/workflows';
import { usePermission } from '@/auth/useSession';
import { formatDate } from '@/lib/dates';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { NativeSelect } from '@/components/ui/select';
import { ErrorState, LoadingState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { DetailPage, SectionCard } from '@/components/patterns/page';
import {
  DEPARTMENT_BOUND,
  MAX_STEPS,
  POSITION_CODES,
  PROCUREMENT_MODES,
  STATUS_VARIANT,
  STEP_TYPES,
  stepIssueTarget,
} from './constants';

/**
 * Workflow editor — Phase 36 (`CR-014` §6.1 – §6.3), `07-ui.md` §5.10,
 * REQ-WF-002 – REQ-WF-004, REQ-WF-006.
 *
 * An ordered list of steps, each with exactly three constrained choices — its
 * type, ONE position, and (for an acquisition step only) internal or external —
 * plus a self-skip switch that is off unless turned on. There is no free text,
 * no condition and no branch anywhere on the screen, because there is none in
 * the model (`BR-026`).
 *
 * Only a DRAFT is editable. An ACTIVE or RETIRED version is read-only and offers
 * "Create new version" instead (REQ-WF-003).
 *
 * Publishing first shows the result of the server's own validation per step —
 * the `publishIssues` the definition carries — and asks for confirmation only
 * when there is nothing left to fix. The rules are not re-implemented here, so
 * the screen and the server cannot disagree about what is publishable.
 *
 * A position here is a CODE. Nothing on this screen asks who holds it.
 */

const blankStep = () => ({
  stepType: 'DECIDE',
  actorPositionCode: '',
  procurementMode: '',
  skipIfRequesterIsActor: false,
});

const toDraft = (steps) =>
  steps.map((step) => ({
    stepType: step.stepType,
    actorPositionCode: step.actorPositionCode ?? '',
    procurementMode: step.procurementMode ?? '',
    skipIfRequesterIsActor: Boolean(step.skipIfRequesterIsActor),
  }));

const toBody = (steps) =>
  steps.map((step, index) => ({
    sequence: index + 1,
    stepType: step.stepType,
    actorPositionCode: step.actorPositionCode || null,
    ...(step.stepType === 'PROCURE' ? { procurementMode: step.procurementMode || null } : {}),
    skipIfRequesterIsActor: step.skipIfRequesterIsActor,
  }));

/** Issues grouped by the step they name; the rest concern the whole definition. */
function groupIssues(issues = []) {
  const byStep = new Map();
  const general = [];
  for (const issue of issues) {
    const target = stepIssueTarget(issue.field);
    if (target) {
      byStep.set(target.index, [...(byStep.get(target.index) ?? []), issue]);
    } else {
      general.push(issue);
    }
  }
  return { byStep, general };
}

export function WorkflowEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const canUpdate = usePermission('workflow-definition:update');
  const canPublish = usePermission('workflow-definition:publish');
  const canCreate = usePermission('workflow-definition:create');

  const query = useQuery({
    queryKey: ['workflow-definition', id],
    queryFn: () => workflowsApi.get(id),
  });
  const definition = query.data;

  const versions = useQuery({
    queryKey: [
      'workflow-definitions',
      definition?.institutionId,
      'versions',
      definition?.category,
      definition?.requesterPositionCode,
    ],
    queryFn: () =>
      workflowsApi.list({
        institutionId: definition.institutionId,
        category: definition.category,
        requesterPositionCode: definition.requesterPositionCode,
        pageSize: 100,
        sort: 'version',
        order: 'desc',
      }),
    enabled: Boolean(definition),
  });

  const [steps, setSteps] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [serverIssues, setServerIssues] = useState(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (definition) {
      setSteps(toDraft(definition.steps ?? []));
      setDirty(false);
      setServerIssues(null);
    }
  }, [definition]);

  const isDraft = definition?.status === 'DRAFT';
  const editable = isDraft && canUpdate;

  // Before a save, the saved definition's issues no longer describe the screen.
  const issues = useMemo(
    () => serverIssues ?? (dirty ? [] : (definition?.publishIssues ?? [])),
    [serverIssues, dirty, definition]
  );
  const grouped = useMemo(() => groupIssues(issues), [issues]);

  const refresh = async (next) => {
    queryClient.setQueryData(['workflow-definition', id], next);
    await queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] });
  };

  const save = useMutation({
    mutationFn: () => workflowsApi.replaceSteps(id, toBody(steps)),
    onSuccess: async (next) => {
      await refresh(next);
      toast.success(t('workflows.saved'));
    },
    onError: (error) => {
      if (error.isValidation) setServerIssues(error.details ?? []);
      toast.fromError(error, { includeValidation: true });
    },
  });

  const publish = useMutation({
    mutationFn: () => workflowsApi.publish(id),
    onSuccess: async (next) => {
      setReviewing(false);
      await refresh(next);
      toast.success(t('workflows.published'));
    },
    onError: (error) => {
      setReviewing(false);
      if (error.isValidation) setServerIssues(error.details ?? []);
      toast.fromError(error, { includeValidation: true });
    },
  });

  const newVersion = useMutation({
    mutationFn: () => workflowsApi.newVersion(id),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] });
      toast.success(t('workflows.draftCreated'));
      navigate(`/organization/workflows/${created.id}`);
    },
    onError: (error) => toast.fromError(error),
  });

  if (query.isLoading) return <LoadingState variant="form" rows={4} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const change = (index, patch) => {
    setSteps((current) =>
      current.map((step, i) => {
        if (i !== index) return step;
        const next = { ...step, ...patch };
        // A procurement mode exists only on an acquisition step.
        if (next.stepType !== 'PROCURE') next.procurementMode = '';
        return next;
      })
    );
    setDirty(true);
    setServerIssues(null);
  };

  const move = (index, delta) => {
    setSteps((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + delta, 0, moved);
      return next;
    });
    setDirty(true);
    setServerIssues(null);
  };

  const remove = (index) => {
    setSteps((current) => current.filter((_, i) => i !== index));
    setDirty(true);
    setServerIssues(null);
  };

  const add = () => {
    setSteps((current) => [...current, blankStep()]);
    setDirty(true);
    setServerIssues(null);
  };

  const title = t('workflows.editorTitle', {
    category: t(`workflows.categories.${definition.category}`),
    context: t(`positions.options.${definition.requesterPositionCode}`),
  });

  return (
    <DetailPage
      title={title}
      description={t('workflows.editorDescription', { version: definition.version })}
      badge={
        <Badge variant={STATUS_VARIANT[definition.status]}>
          {t(`workflows.statuses.${definition.status}`)}
        </Badge>
      }
      actions={
        <>
          {isDraft && editable ? (
            <Button
              variant="outline"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!dirty}
            >
              {t('workflows.saveSteps')}
            </Button>
          ) : null}
          {isDraft && canPublish ? (
            <Button onClick={() => setReviewing(true)} disabled={dirty}>
              {t('workflows.publish')}
            </Button>
          ) : null}
          {!isDraft && canCreate ? (
            <Button onClick={() => newVersion.mutate()} loading={newVersion.isPending}>
              {t('workflows.createNewVersion')}
            </Button>
          ) : null}
        </>
      }
    >
      {!isDraft ? (
        <Alert variant="info">
          {t(
            definition.status === 'ACTIVE'
              ? 'workflows.activeReadOnly'
              : 'workflows.retiredReadOnly'
          )}
        </Alert>
      ) : null}

      {isDraft && dirty ? <Alert variant="warning">{t('workflows.unsaved')}</Alert> : null}

      {isDraft && !dirty && issues.length > 0 ? (
        <Alert variant="warning" title={t('workflows.notPublishableTitle')}>
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.map((issue, index) => {
              const target = stepIssueTarget(issue.field);
              return (
                <li key={`${issue.field}-${index}`}>
                  {target ? `${t('workflows.stepNumber', { number: target.index + 1 })}: ` : ''}
                  {issue.issue}
                </li>
              );
            })}
          </ul>
        </Alert>
      ) : null}

      {isDraft && !dirty && issues.length === 0 && steps.length > 0 ? (
        <Alert variant="success">{t('workflows.publishable')}</Alert>
      ) : null}

      <SectionCard title={t('workflows.stepsTitle')} description={t('workflows.stepsDescription')}>
        {editable ? (
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <StepEditor
                key={index}
                index={index}
                step={step}
                count={steps.length}
                issues={grouped.byStep.get(index) ?? []}
                onChange={(patch) => change(index, patch)}
                onMove={(delta) => move(index, delta)}
                onRemove={() => remove(index)}
              />
            ))}
            <li>
              <Button
                variant="outline"
                size="sm"
                onClick={add}
                disabled={steps.length >= MAX_STEPS}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('workflows.addStep')}
              </Button>
            </li>
          </ol>
        ) : (
          <StepTable steps={definition.steps ?? []} />
        )}
      </SectionCard>

      <SectionCard title={t('workflows.versionsTitle')}>
        {versions.isLoading ? (
          <LoadingState variant="list" rows={2} />
        ) : (
          <ul className="space-y-1.5">
            {(versions.data?.data ?? []).map((version) => (
              <li key={version.id} className="flex flex-wrap items-center gap-2 text-sm">
                {version.id === definition.id ? (
                  <span className="font-medium">
                    {t('workflows.versionLabel', { version: version.version })}
                  </span>
                ) : (
                  <Link
                    to={`/organization/workflows/${version.id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {t('workflows.versionLabel', { version: version.version })}
                  </Link>
                )}
                <Badge variant={STATUS_VARIANT[version.status]}>
                  {t(`workflows.statuses.${version.status}`)}
                </Badge>
                {version.publishedAt ? (
                  <span className="text-xs text-muted-foreground">
                    {t('workflows.publishedOn', {
                      date: formatDate(String(version.publishedAt).slice(0, 10)),
                    })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <ConfirmDialog
        open={reviewing}
        onOpenChange={(open) => (open ? null : setReviewing(false))}
        title={issues.length > 0 ? t('workflows.notPublishableTitle') : t('workflows.publishTitle')}
        description={
          issues.length > 0
            ? t('workflows.notPublishableDescription', { count: issues.length })
            : t('workflows.publishDescription', { version: definition.version })
        }
        confirmLabel={issues.length > 0 ? t('common.actions.close') : t('workflows.publish')}
        loading={publish.isPending}
        onConfirm={() => (issues.length > 0 ? setReviewing(false) : publish.mutate())}
      />
    </DetailPage>
  );
}

function StepEditor({ index, step, count, issues, onChange, onMove, onRemove }) {
  const { t } = useTranslation();
  const number = index + 1;
  const issueFor = (name) => issues.filter((issue) => stepIssueTarget(issue.field)?.name === name);
  const other = issues.filter((issue) => {
    const name = stepIssueTarget(issue.field)?.name;
    return !['stepType', 'actorPositionCode', 'procurementMode'].includes(name);
  });

  const describe = (list) =>
    list.length > 0 ? (
      <p role="alert" className="text-xs text-destructive">
        {list.map((issue) => issue.issue).join('; ')}
      </p>
    ) : null;

  const label = (key) => `${t(key)} — ${t('workflows.stepNumber', { number })}`;

  return (
    <li className="rounded-md border border-border p-3" data-testid={`step-${number}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold">{t('workflows.stepNumber', { number })}</span>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={t('workflows.moveUp', { number })}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label={t('workflows.moveDown', { number })}
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            aria-label={t('workflows.removeStep', { number })}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <NativeSelect
            aria-label={label('workflows.stepType')}
            value={step.stepType}
            invalid={issueFor('stepType').length > 0}
            onChange={(event) => onChange({ stepType: event.target.value })}
          >
            {STEP_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`workflows.stepTypes.${type}`)}
              </option>
            ))}
          </NativeSelect>
          {describe(issueFor('stepType'))}
        </div>

        <div className="space-y-1">
          <NativeSelect
            aria-label={label('workflows.actor')}
            value={step.actorPositionCode}
            invalid={issueFor('actorPositionCode').length > 0}
            onChange={(event) => onChange({ actorPositionCode: event.target.value })}
          >
            <option value="">{t('workflows.actorNotChosen')}</option>
            {POSITION_CODES.map((code) => (
              <option key={code} value={code}>
                {t(`positions.options.${code}`)}
              </option>
            ))}
          </NativeSelect>
          {DEPARTMENT_BOUND.has(step.actorPositionCode) ? (
            <p className="text-xs text-muted-foreground">{t('workflows.departmentBoundHint')}</p>
          ) : null}
          {describe(issueFor('actorPositionCode'))}
        </div>

        {step.stepType === 'PROCURE' ? (
          <div className="space-y-1">
            <NativeSelect
              aria-label={label('workflows.procurementMode')}
              value={step.procurementMode}
              invalid={issueFor('procurementMode').length > 0}
              onChange={(event) => onChange({ procurementMode: event.target.value })}
            >
              <option value="">{t('common.select.placeholder')}</option>
              {PROCUREMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`workflows.modes.${mode}`)}
                </option>
              ))}
            </NativeSelect>
            {describe(issueFor('procurementMode'))}
          </div>
        ) : null}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <Checkbox
          checked={step.skipIfRequesterIsActor}
          onChange={(event) => onChange({ skipIfRequesterIsActor: event.target.checked })}
          aria-label={label('workflows.selfSkip')}
        />
        {t('workflows.selfSkip')}
      </label>
      {describe(other)}
    </li>
  );
}

function StepTable({ steps }) {
  const { t } = useTranslation();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>{t('workflows.stepType')}</TableHead>
          <TableHead>{t('workflows.actor')}</TableHead>
          <TableHead>{t('workflows.procurementMode')}</TableHead>
          <TableHead>{t('workflows.selfSkip')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {steps.map((step) => (
          <TableRow key={step.id}>
            <TableCell>{step.sequence}</TableCell>
            <TableCell>{t(`workflows.stepTypes.${step.stepType}`)}</TableCell>
            <TableCell>
              {step.actorPositionCode
                ? t(`positions.options.${step.actorPositionCode}`)
                : t('workflows.actorNotChosen')}
            </TableCell>
            <TableCell>
              {step.procurementMode ? t(`workflows.modes.${step.procurementMode}`) : '—'}
            </TableCell>
            <TableCell>
              {step.skipIfRequesterIsActor ? t('workflows.selfSkipOn') : t('workflows.selfSkipOff')}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
