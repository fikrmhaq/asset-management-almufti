import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { auditLogsApi } from '@/api/reporting';
import { useListParams } from '@/hooks/useListParams';
import { queryKeys } from '@/lib/queryKeys';
import { Badge } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { DataTable } from '@/components/patterns/data-table';
import { SelectFilter } from '@/components/patterns/filters';
import { DetailField, DetailFieldList, ListPage } from '@/components/patterns/page';
import { useUserOptions } from '../operations/referenceOptions';

/**
 * Audit log — `07-ui.md` §5.8; REQ-AUDIT-001/002/003.
 *
 * READ-ONLY throughout, with no action menu and no edit affordance anywhere —
 * §5.8 says "ever", and the server backs that up by exposing no write verb.
 *
 * NOT organization-scoped: `audit.audit_logs` has no institution and no join
 * path to one, so a holder of `audit-log:read` sees the whole trail. The page
 * says so rather than implying a filtered view.
 *
 * Actors are resolved client-side with two deliberate fallbacks: a `NULL` actor
 * is **the system**, which is what `04-data-model.md` §5.6.1 defines it to mean,
 * and an id that does not resolve shows as the raw id — a deleted user must not
 * silently become nobody.
 *
 * WHAT IS NOT TRANSLATED: `entityType` (`Asset`, `Borrowing`) and the entity ids.
 * They are the server's own record names and keys, they are what the free-text
 * filters match on, and translating them would make those filters unusable. The
 * ACTION is translated, because `STATUS_CHANGE` is a stored column value and a
 * reader wants to know what happened.
 */

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'];

const ACTION_VARIANTS = {
  CREATE: 'success',
  UPDATE: 'default',
  DELETE: 'destructive',
  STATUS_CHANGE: 'warning',
};

/** A free-text filter — `entityType` matches the record name the server stores. */
function TextFilter({ id, label, value, onChange, placeholder, width = 'w-48' }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={width}
      />
    </div>
  );
}

/**
 * The caption is a `<span>` rather than a `<Label htmlFor>`: `DatePicker`
 * renders a button whose accessible name is its own content, and the
 * placeholder names the field more precisely than "From" would. Associating a
 * label would replace that name rather than add to it.
 *
 * `clearable`, because a filter is optional by definition.
 */
function DateFilter({ label, placeholder, value, onChange, clearLabel }) {
  return (
    <div className="w-44 space-y-1.5">
      <span className="block text-sm leading-none font-medium">{label}</span>
      <DatePicker
        value={value}
        onChange={(next) => onChange(next ?? '')}
        placeholder={placeholder}
        clearable
        clearLabel={clearLabel}
      />
    </div>
  );
}

const isObject = (value) => value !== null && typeof value === 'object';

/** A stored JSONB value, rendered so a reader can compare two of them. */
function renderValue(value, t) {
  if (value === undefined) return <span className="text-muted-foreground">—</span>;
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === 'boolean') return String(value);
  if (isObject(value)) return JSON.stringify(value);
  if (value === '') return <span className="text-muted-foreground">{t('audit.emptyValue')}</span>;

  return String(value);
}

/**
 * The old/new comparison — REQ-AUDIT-002, `07-ui.md` §5.8.
 *
 * Keys are the UNION of both sides, so a field that only one side has is still
 * shown: a field added by an update, or removed by a delete, is exactly the kind
 * of change an audit reader is looking for. Rows that actually differ are marked,
 * because on a wide record the two columns otherwise look identical.
 */
function ValueDiff({ oldValues, newValues }) {
  const { t } = useTranslation();
  const keys = [...new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})])];

  if (keys.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('audit.noValues')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">{t('audit.field')}</th>
            <th className="px-3 py-2 font-medium">{t('audit.before')}</th>
            <th className="px-3 py-2 font-medium">{t('audit.after')}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const before = oldValues?.[key];
            const after = newValues?.[key];
            const changed = JSON.stringify(before) !== JSON.stringify(after);

            return (
              <tr key={key} className="border-b border-border last:border-0">
                <td className="px-3 py-2 align-top font-mono text-xs">
                  {key}
                  {changed ? (
                    <span className="ml-1 text-xs text-warning-foreground">
                      {t('audit.changed')}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 align-top break-all">{renderValue(before, t)}</td>
                <td className={`px-3 py-2 align-top break-all ${changed ? 'font-medium' : ''}`}>
                  {renderValue(after, t)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AuditDetailDialog({ entryId, open, onOpenChange, actorLabel }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.auditLogs.detail(entryId),
    queryFn: () => auditLogsApi.get(entryId),
    enabled: open && Boolean(entryId),
  });

  const entry = query.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {entry
              ? `${t(`enums.auditAction.${entry.action}`)} · ${entry.entityType}`
              : t('audit.entryTitle')}
          </DialogTitle>
          <DialogDescription>{t('audit.entryDescription')}</DialogDescription>
        </DialogHeader>

        {query.isLoading ? <LoadingState variant="detail" rows={4} /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={query.refetch} /> : null}

        {entry ? (
          <div className="space-y-4">
            <DetailFieldList>
              <DetailField label={t('audit.when')}>
                {new Date(entry.timestamp).toLocaleString()}
              </DetailField>
              <DetailField label={t('audit.actor')}>{actorLabel(entry.actorId)}</DetailField>
              <DetailField label={t('audit.action')}>
                {t(`enums.auditAction.${entry.action}`)}
              </DetailField>
              <DetailField label={t('audit.entity')}>{entry.entityType}</DetailField>
              <DetailField label={t('audit.entityId')}>
                <span className="font-mono text-xs break-all">{entry.entityId}</span>
              </DetailField>
              <DetailField label={t('audit.ipAddress')}>{entry.ipAddress}</DetailField>
              <DetailField label={t('audit.request')}>
                {entry.metadata?.requestId ? (
                  <span className="font-mono text-xs">{entry.metadata.requestId}</span>
                ) : null}
              </DetailField>
            </DetailFieldList>

            <ValueDiff oldValues={entry.oldValues} newValues={entry.newValues} />
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AuditPage() {
  const { t } = useTranslation();
  const { params, setParams, setPage, setSort } = useListParams();
  const [viewing, setViewing] = useState(null);

  const users = useUserOptions();

  const query = useQuery({
    queryKey: queryKeys.auditLogs.list(params),
    queryFn: () => auditLogsApi.list(params),
  });

  /** The system itself for NULL, the raw id when a user cannot be resolved. */
  const actorLabel = (actorId) => {
    if (!actorId) return t('audit.system');
    return users.labels.get(actorId) ?? <span className="font-mono text-xs">{actorId}</span>;
  };

  const columns = [
    {
      id: 'timestamp',
      header: t('audit.when'),
      meta: { sortField: 'timestamp' },
      cell: ({ row }) => (
        <button
          type="button"
          className="text-left hover:underline"
          onClick={() => setViewing(row.original.id)}
        >
          {new Date(row.original.timestamp).toLocaleString()}
        </button>
      ),
    },
    {
      id: 'actor',
      header: t('audit.actor'),
      cell: ({ row }) => actorLabel(row.original.actorId),
    },
    {
      id: 'action',
      header: t('audit.action'),
      cell: ({ row }) => (
        <Badge variant={ACTION_VARIANTS[row.original.action] ?? 'neutral'}>
          {t(`enums.auditAction.${row.original.action}`)}
        </Badge>
      ),
    },
    { accessorKey: 'entityType', header: t('audit.entity') },
    {
      id: 'entityId',
      header: t('audit.entityId'),
      cell: ({ row }) => (
        <span className="font-mono text-xs break-all">{row.original.entityId}</span>
      ),
    },
  ];

  return (
    <ListPage
      title={t('audit.title')}
      description={t('audit.description')}
      filters={
        <>
          <TextFilter
            id="filter-entity-type"
            label={t('audit.entityType')}
            value={params.entityType ?? ''}
            onChange={(entityType) => setParams({ entityType })}
            placeholder={t('audit.entityTypePlaceholder')}
          />

          <TextFilter
            id="filter-entity-id"
            label={t('audit.entityId')}
            value={params.entityId ?? ''}
            onChange={(entityId) => setParams({ entityId })}
            placeholder={t('audit.entityIdPlaceholder')}
            width="w-64"
          />

          {users.allowed ? (
            <SelectFilter
              id="filter-actor"
              label={t('audit.actor')}
              value={params.actorId ?? 'all'}
              options={users.options}
              onChange={(actorId) => setParams({ actorId })}
            />
          ) : null}

          <SelectFilter
            id="filter-action"
            label={t('audit.action')}
            value={params.action ?? 'all'}
            options={ACTIONS.map((action) => ({
              value: action,
              label: t(`enums.auditAction.${action}`),
            }))}
            onChange={(action) => setParams({ action })}
            width="w-44"
          />

          <DateFilter
            label={t('common.fields.from')}
            placeholder={t('audit.anyStartDate')}
            clearLabel={t('audit.clearStartDate')}
            value={params.dateFrom ?? ''}
            onChange={(dateFrom) => setParams({ dateFrom })}
          />
          <DateFilter
            label={t('common.fields.to')}
            placeholder={t('audit.anyEndDate')}
            clearLabel={t('audit.clearEndDate')}
            value={params.dateTo ?? ''}
            onChange={(dateTo) => setParams({ dateTo })}
          />
        </>
      }
      meta={query.data?.meta}
      onPageChange={setPage}
    >
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        sort={params.sort}
        order={params.order}
        onSortChange={setSort}
        emptyTitle={t('audit.empty')}
        emptyDescription={t('common.states.noMatches')}
      />

      <AuditDetailDialog
        entryId={viewing}
        open={Boolean(viewing)}
        onOpenChange={(open) => !open && setViewing(null)}
        actorLabel={actorLabel}
      />
    </ListPage>
  );
}
