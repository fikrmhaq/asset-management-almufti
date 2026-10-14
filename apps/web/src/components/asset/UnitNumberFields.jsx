import { useEffect, useId, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { inventoryCodesApi } from '@/api/assetCore';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Input, Label } from '@/components/ui/input';
import { localUnitNumberStatus } from './unitNumbers';

/**
 * Unit numbers, one field per unit, with the inventory code each will become —
 * P4 (`IMPLEMENTATION_PLAN.md` §64.4), REQ-UNIT-007.
 *
 * TWO THINGS, NAMED APART. The UNIT NUMBER is what the registrar types for one
 * unit (`1.6`). The INVENTORY CODE is the permanent code built from it plus what
 * the institution's format fills in (`1.6/LAP_TOP/BOS_REG/2026`). The typed part
 * is shown highlighted inside the code, the filled-in parts muted, so it is
 * plain which part the registrar controls. No format syntax is ever shown here.
 *
 * ADVISORY. The preview is checked as the registrar types
 * (`POST /inventory-codes/preview`), but it reserves nothing: registration makes
 * the final check, and its answer wins. Empty and repeated values are caught
 * here without waiting for the server.
 *
 * NO "NEXT NUMBER". Unit numbers are free-form, so the numbers offered for
 * reference are the most recently REGISTERED ones — never a computed successor.
 */

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** One part of a code. The typed part stands out; the filled-in parts recede. */
function CodePart({ part, t }) {
  const label = t(`units.unitNumber.parts.${part.tokenId}`, { defaultValue: part.label });

  if (part.source === 'SEPARATOR') {
    return (
      <span className="inline-block whitespace-nowrap text-muted-foreground">{part.text}</span>
    );
  }
  if (part.source === 'UNIT_NUMBER') {
    return (
      <span
        data-source="UNIT_NUMBER"
        title={label}
        className={cn(
          'inline-block whitespace-nowrap rounded px-1 font-semibold',
          part.text
            ? 'bg-primary text-primary-foreground'
            : 'border border-dashed border-primary text-primary'
        )}
      >
        {part.text ?? '…'}
      </span>
    );
  }
  if (part.source === 'ALLOCATED') {
    return (
      <span
        data-source="ALLOCATED"
        title={label}
        className="inline-block whitespace-nowrap italic text-muted-foreground"
      >
        [{t('units.unitNumber.allocated')}]
      </span>
    );
  }
  // GENERATED — or, with no value yet, the name of what is missing.
  return part.text ? (
    <span
      data-source="GENERATED"
      title={label}
      className="inline-block whitespace-nowrap text-muted-foreground"
    >
      {part.text}
    </span>
  ) : (
    <span
      data-source="GENERATED"
      title={part.issue ?? label}
      className="rounded border border-dashed border-warning-500 px-1 text-xs text-warning-700"
    >
      {label}
    </span>
  );
}

const STATUS_TONE = {
  OK: 'text-success-700',
  EMPTY: 'text-muted-foreground',
  INCOMPLETE: 'text-muted-foreground',
  INVALID: 'text-destructive',
  DUPLICATE_IN_BATCH: 'text-destructive',
  ALREADY_ISSUED: 'text-destructive',
};

/**
 * @param {object} props
 * @param {string[]} props.values one per unit (a single value when `perUnit` is false)
 * @param {(values: string[]) => void} props.onChange
 * @param {boolean} props.perUnit whether each unit needs its own value
 * @param {number} [props.maxLength]
 * @param {object|null} props.previewRequest the registration's other inputs
 *   (`assetId` or `classificationId` + `institutionId`, `departmentId`,
 *   `fundingSourceId`), or `null` while the code cannot be previewed yet
 * @param {string} [props.waitingFor] why there is no preview yet
 * @param {boolean} [props.showErrors] show empty fields as errors (after a submit)
 * @param {string} [props.error] the server's refusal for these fields
 * @param {number} [props.unitCount] units sharing one value (`perUnit` false)
 */
export function UnitNumberFields({
  values,
  onChange,
  perUnit,
  maxLength,
  previewRequest,
  waitingFor,
  showErrors = false,
  error,
  unitCount = 1,
}) {
  const { t } = useTranslation();
  const baseId = useId();

  const trimmed = values.map((value) => String(value ?? '').trim());
  const debounced = useDebounced(JSON.stringify(trimmed), 250);
  const body = previewRequest ? { ...previewRequest, unitNumbers: JSON.parse(debounced) } : null;

  const preview = useQuery({
    queryKey: ['inventory-codes', 'preview', body],
    queryFn: () => inventoryCodesApi.preview(body),
    enabled: Boolean(body),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  });
  const data = previewRequest ? preview.data : null;

  const local = localUnitNumberStatus(values);
  const single = values.length === 1;

  const setAt = (index, next) => onChange(values.map((value, at) => (at === index ? next : value)));

  /**
   * Pasting a column fills the fields from here down — the values are usually
   * copied from the numbering register the institution already keeps, which is
   * why `07-ui.md` §5.3 once chose a textarea. Lines beyond the last field are
   * dropped rather than silently added as units.
   */
  const pasteAt = (index, event) => {
    const lines = event.clipboardData
      .getData('text')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length < 2 || values.length < 2) return;
    event.preventDefault();
    onChange(
      values.map((value, at) =>
        at >= index && at - index < lines.length ? lines[at - index] : value
      )
    );
  };

  /**
   * The server's answer for one field, only while it is for the value now in
   * it — a stale answer for a value since changed would mislead.
   */
  const statusFor = (index) => {
    const own = local[index];
    if (own === 'EMPTY') return { status: 'EMPTY' };
    if (own === 'DUPLICATE_IN_BATCH' && perUnit) return { status: own };
    const answer = data?.units?.[index];
    if (answer && answer.unitNumber === trimmed[index]) return answer;
    return null;
  };

  const message = (entry) => {
    if (!entry) return previewRequest ? t('units.unitNumber.checking') : null;
    if (entry.status === 'EMPTY') {
      return showErrors
        ? t('units.unitNumber.status.required')
        : t('units.unitNumber.status.EMPTY');
    }
    if (entry.status === 'INVALID') {
      return t('units.unitNumber.status.INVALID', { issue: entry.issue ?? '' });
    }
    if (entry.status === 'OK' && !entry.inventoryCode) return t('units.unitNumber.status.OK_BATCH');
    return t(`units.unitNumber.status.${entry.status}`);
  };

  const templateParts = data?.parts ?? [];

  return (
    <section className="space-y-3" data-testid="unit-number-fields">
      <div>
        <p className="text-sm font-medium">
          {t('units.unitNumber.label')}
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {perUnit
            ? t('units.unitNumber.hint')
            : t('units.unitNumber.batchHint', { total: unitCount })}
        </p>
      </div>

      <ul className="space-y-3">
        {values.map((value, index) => {
          const entry = statusFor(index);
          const parts =
            entry?.parts ??
            templateParts.map((part) =>
              part.source === 'UNIT_NUMBER' ? { ...part, text: trimmed[index] || null } : part
            );
          const inputId = `${baseId}-${index}`;
          const bad =
            entry &&
            (['INVALID', 'DUPLICATE_IN_BATCH', 'ALREADY_ISSUED'].includes(entry.status) ||
              (showErrors && entry.status === 'EMPTY'));

          return (
            <li
              key={index}
              className={cn(!single && 'rounded-md border border-border p-3')}
              data-testid={`unit-number-${index}`}
            >
              {!single ? (
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('units.unitNumber.unitN', { n: index + 1 })}
                </p>
              ) : null}
              <div className="grid gap-1.5 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-start">
                <div className="space-y-1">
                  {/* One field: the section heading already says "Unit number". */}
                  <Label htmlFor={inputId} className={single ? 'sr-only' : undefined}>
                    {t('units.unitNumber.label')}
                    {!single ? <span className="sr-only"> {index + 1}</span> : null}
                  </Label>
                  <Input
                    id={inputId}
                    value={value}
                    maxLength={maxLength ?? 16}
                    autoComplete="off"
                    aria-invalid={bad || undefined}
                    aria-describedby={`${inputId}-status`}
                    onChange={(event) => setAt(index, event.target.value)}
                    onPaste={(event) => pasteAt(index, event)}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('units.unitNumber.inventoryCode')}
                  </p>
                  <p className="font-mono text-sm" data-testid={`inventory-code-${index}`}>
                    {parts.length > 0 ? (
                      parts.map((part, at) => <CodePart key={at} part={part} t={t} />)
                    ) : (
                      <span className="font-sans text-xs text-muted-foreground">
                        {waitingFor ?? (preview.isError ? t('units.unitNumber.unavailable') : '…')}
                      </span>
                    )}
                  </p>
                  <p
                    id={`${inputId}-status`}
                    className={cn(
                      'text-xs',
                      entry ? STATUS_TONE[entry.status] : 'text-muted-foreground'
                    )}
                    role={bad ? 'alert' : undefined}
                  >
                    {message(entry)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {data?.problems?.length ? (
        <Alert variant="warning" size="sm">
          <p>{t('units.unitNumber.problems')}</p>
          <ul className="mt-1 list-disc pl-5">
            {data.problems.map((problem) => (
              <li key={`${problem.field}-${problem.issue}`}>{problem.issue}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {data ? (
        <div className="space-y-1 text-xs" data-testid="recent-unit-numbers">
          <p className="font-medium">{t('units.unitNumber.recent')}</p>
          {(data.recentUnitNumbers ?? []).length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {data.recentUnitNumbers.map((entry) => (
                <li
                  key={entry.unitNumber}
                  title={entry.inventoryCode}
                  className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono"
                >
                  {entry.unitNumber}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t('units.unitNumber.recentNone')}</p>
          )}
          <p className="text-muted-foreground">{t('units.unitNumber.recentNote')}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="rounded bg-primary px-1 font-mono font-semibold text-primary-foreground">
            1.6
          </span>
          {t('units.unitNumber.legendTyped')}
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono">LAP_TOP</span>
          {t('units.unitNumber.legendGenerated')}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t('units.unitNumber.advisory')}</p>
    </section>
  );
}
