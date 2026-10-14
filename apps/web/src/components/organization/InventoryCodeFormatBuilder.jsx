import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RotateCcw, X } from 'lucide-react';

import { usePermission } from '@/auth/useSession';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/select';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { SectionCard } from '@/components/patterns/page';
import { FormErrorSummary } from '@/components/form/field';
import {
  useInventoryCodeFormat,
  useSetInventoryCodeFormat,
} from '@/hooks/useInventoryCodeFormat';

/**
 * The inventory code format builder — Phase 25 (`CR-006`), REQ-ORG-007,
 * `07-ui.md` §5.1.
 *
 * A STRUCTURED BUILDER, NOT A TEXT BOX. The user arranges chips; they never type
 * a field name, a path or an expression. That is not only a usability choice —
 * it is what makes the malformed states unconstructible rather than merely
 * rejected: the sequence cannot be duplicated, cannot be moved off the end, and
 * the separator control offers only the characters a code may contain.
 *
 * THE SEQUENCE IS CONDITIONAL, NOT FIXED (`CR-007`). Phase 25 pinned it in
 * place because every format had to end in one. It is now one of two ways to
 * distinguish one unit from another — an allocated number or a manually
 * supplied composition — and the builder has to let an institution numbering by
 * composition take it off. What stays unconstructible is a format with NEITHER,
 * which would give every unit registered the same code.
 *
 * Refusing the last distinguishing chip SAYS WHY rather than hiding the control
 * (`07-ui.md` §5.1). A remove button that silently does nothing reads as a bug;
 * the message names the chip to add first.
 *
 * `/` IS OFFERED AS OF `CR-008`, having been absent since Phase 25. It is a
 * SEPARATOR only: the values the tokens resolve to — institution code,
 * department code, funding source code, the typed composition — still cannot
 * contain one, and the server refuses a format that puts one anywhere else.
 * Admitting it is what moved the scanned-label address off a URL path segment
 * and into `/u?c=…` (REQ-UNIT-011).
 *
 * The token list, the samples and the length ceiling all come from the server
 * (`06-api.md` §3.1) — this file defines none of them. The server validates
 * every save regardless of what was constructible here (`BR-026`).
 *
 * One entry point serves both tiers: a system-wide user reaches it as a tab on
 * an institution, a scoped administrator through their own institution's
 * screen. It takes an id and nothing else.
 */

/** The only literal characters a code may carry (REQ-ORG-002, REQ-UNIT-011). */
const SEPARATORS = ['-', '_', '.', '/'];

const SEQUENCE = 'SEQUENCE';

/** The manually supplied number — the other way to distinguish units (`CR-007`). */
const COMPOSITION = 'NUMBER_COMPOSITION';

/**
 * The tokens that make one unit's code differ from another's. A format needs at
 * least one; the server enforces the same rule (`BR-026`), and this is the half
 * that stops the user constructing the state in the first place.
 */
const DISTINGUISHING = [SEQUENCE, COMPOSITION];

/**
 * Splits a stored format into chips.
 *
 * A reader, not a validator: the grammar's RULES live on the server and are
 * enforced there. This turns `{A}-{B}` into something renderable, and nothing
 * that reaches here has failed server validation.
 */
function toSegments(format) {
  const segments = [];
  const pattern = /\{([A-Z_]+)\}|([^{]+)/g;

  for (const [, token, literal] of format.matchAll(pattern)) {
    if (token) segments.push({ type: 'token', value: token });
    else if (literal) segments.push({ type: 'literal', value: literal });
  }

  return segments;
}

const toFormat = (segments) =>
  segments.map((segment) => (segment.type === 'token' ? `{${segment.value}}` : segment.value)).join('');

/** Where the sequence sits — last when present, `-1` when the format has none. */
const sequenceIndex = (segments) =>
  segments.findIndex((segment) => segment.type === 'token' && segment.value === SEQUENCE);

/**
 * Where the arrangeable region ends.
 *
 * Everything sits before the sequence when there is one, and the sequence is
 * pinned last. With no sequence there is nothing to sit before, so the region
 * runs to the end — `sequenceIndex`'s -1 would otherwise read as a position and
 * freeze every control on the row.
 */
const arrangeableEnd = (segments) => {
  const at = sequenceIndex(segments);
  return at === -1 ? segments.length : at;
};

const isToken = (segment, id) => segment.type === 'token' && segment.value === id;

const distinguishing = (segments) =>
  segments.filter((segment) => DISTINGUISHING.some((id) => isToken(segment, id)));

/**
 * A part's name in the reader's language — P4 (`IMPLEMENTATION_PLAN.md` §64.4).
 * The registration screens use the same names (`units.unitNumber.parts`), so an
 * administrator and a registrar call the typed part the same thing: the Unit
 * number. The server's name is the fallback for a token this client predates.
 */
const tokenLabel = (t, token, id) =>
  t(`units.unitNumber.parts.${id}`, { defaultValue: token?.name ?? id });

/** What the example shows a registrar typing. Free-form, like the real thing. */
const EXAMPLE_UNIT_NUMBER = '1.6';

export function InventoryCodeFormatBuilder({ institutionId }) {
  const { t } = useTranslation();
  const query = useInventoryCodeFormat(institutionId);
  const save = useSetInventoryCodeFormat(institutionId);
  const canUpdate = usePermission('inventory-code-format:update');

  const [segments, setSegments] = useState([]);
  const [pendingToken, setPendingToken] = useState('');

  /**
   * The chip whose removal was refused, held so the reason can be shown against
   * the row. Cleared by the next edit rather than by a timer — the user fixes it
   * by adding a chip, and the message should survive until they do.
   */
  const [refused, setRefused] = useState(null);

  const config = query.data;

  // Repopulated after a save as well as on load, so `isDirty` returns to false
  // rather than staying stuck on — the same reason the institution form resets.
  useEffect(() => {
    if (config) {
      setSegments(toSegments(config.format));
      setRefused(null);
    }
  }, [config]);

  const tokensById = useMemo(
    () => new Map((config?.tokens ?? []).map((token) => [token.id, token])),
    [config]
  );

  const format = toFormat(segments);
  const isDirty = Boolean(config) && format !== config.format;

  /**
   * The live preview, rendered from the server's samples.
   *
   * Local so it tracks every edit without a request per keystroke. The server
   * computes the same thing for the stored format, and the two agree because
   * both are built from the samples in this response — the client invents no
   * values of its own. A token the server could not resolve stays visible as
   * `{TOKEN}` rather than being replaced with something plausible.
   */
  const { preview, unresolved } = useMemo(() => {
    const missing = [];

    const text = segments
      .map((segment) => {
        if (segment.type === 'literal') return segment.value;

        const token = tokensById.get(segment.value);
        if (!token) return `{${segment.value}}`;
        if (!token.resolvable) {
          missing.push(token);
          return `{${token.id}}`;
        }
        return token.sample;
      })
      .join('');

    return { preview: text, unresolved: missing };
  }, [segments, tokensById]);

  const optionalInUse = segments
    .filter((segment) => segment.type === 'token')
    .map((segment) => tokensById.get(segment.value))
    .filter((token) => token && !token.alwaysAvailable);

  const usesInstitution = segments.some((segment) => isToken(segment, 'INSTITUTION_CODE'));

  const hasSequence = sequenceIndex(segments) !== -1;
  const usesComposition = segments.some((segment) => isToken(segment, COMPOSITION));

  if (query.isLoading) return <LoadingState variant="form" rows={4} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const appendBeforeSequence = (segment) => {
    setRefused(null);
    setSegments((current) => {
      const index = arrangeableEnd(current);
      return [...current.slice(0, index), segment, ...current.slice(index)];
    });
  };

  /**
   * Removes a chip, unless it is the last thing telling two units apart.
   *
   * Checked before the update rather than inside it: the updater must stay pure,
   * and the reason has to be recorded whether or not the arrangement changes.
   */
  const removeAt = (index) => {
    const segment = segments[index];
    const isLastDistinguishing =
      DISTINGUISHING.some((id) => isToken(segment, id)) && distinguishing(segments).length === 1;

    if (isLastDistinguishing) {
      setRefused(segment.value);
      return;
    }

    setRefused(null);
    setSegments((current) => current.filter((_, position) => position !== index));
  };

  const moveBy = (index, offset) =>
    setSegments((current) => {
      const target = index + offset;
      // Never past the sequence, which is pinned last when there is one.
      if (target < 0 || target >= arrangeableEnd(current)) return current;

      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const addToken = (id) => {
    if (!id) return;

    /**
     * The sequence goes last, everything else before it — so an added sequence
     * lands at the end of the row, which is where `arrangeableEnd` already puts
     * it once there is none to insert before.
     */
    appendBeforeSequence({ type: 'token', value: id });
    setPendingToken('');
  };

  const isSequence = (segment) => isToken(segment, SEQUENCE);

  return (
    <SectionCard
      title={t('organization.inventoryCodeFormat.title')}
      description={t('organization.inventoryCodeFormat.description')}
    >
      <div className="space-y-5">
        {/*
          The server's reasons, shown against the builder rather than toasted
          (`07-ui.md` §4.3). `message` alone says only that the format is
          invalid; `details[].issue` is the half that names the position and the
          rule, which is what a user needs in order to fix the chip.
        */}
        <FormErrorSummary error={save.error} />
        {save.error?.details?.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {save.error.details.map((detail) => (
              <li key={detail.issue}>{detail.issue}</li>
            ))}
          </ul>
        ) : null}

        {/* --- The format itself ------------------------------------------ */}
        <div>
          <p className="mb-2 text-sm font-medium">
            {t('organization.inventoryCodeFormat.formatLabel')}
          </p>

          <ul
            data-testid="inventory-code-segments"
            className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/30 p-3"
          >
            {segments.map((segment, index) => (
              <li
                // Position is the identity here: the same token may legitimately
                // appear twice, so its id would not be unique.
                key={`${segment.type}-${segment.value}-${index}`}
                className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-sm shadow-xs"
              >
                {segment.type === 'token' ? (
                  <span className="font-medium">
                    {tokenLabel(t, tokensById.get(segment.value), segment.value)}
                  </span>
                ) : (
                  <span className="font-mono text-muted-foreground">{segment.value}</span>
                )}

                {canUpdate ? (
                  <span className="ml-1 flex items-center">
                    {/*
                      Reordering is for everything but the sequence, which is
                      pinned last. Removal is for everything INCLUDING it
                      (`CR-007`) — whether it may actually go is decided in
                      `removeAt`, which explains itself when the answer is no.
                    */}
                    {!isSequence(segment) ? (
                      <>
                        <button
                          type="button"
                          className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={index === 0}
                          onClick={() => moveBy(index, -1)}
                          aria-label={t('organization.inventoryCodeFormat.moveLeft')}
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={index >= arrangeableEnd(segments) - 1}
                          onClick={() => moveBy(index, 1)}
                          aria-label={t('organization.inventoryCodeFormat.moveRight')}
                        >
                          →
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="px-1 text-muted-foreground hover:text-destructive"
                      onClick={() => removeAt(index)}
                      aria-label={t('organization.inventoryCodeFormat.remove')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          {/*
            Shown against the row the button is on, not toasted: the user is
            looking at the chip they just tried to remove, and the fix — add the
            other distinguishing token — is one control away.
          */}
          {refused ? (
            <Alert variant="warning" size="sm" className="mt-2">
              {t('organization.inventoryCodeFormat.cannotRemoveLast', {
                token: tokenLabel(t, tokensById.get(refused), refused),
              })}
            </Alert>
          ) : null}
        </div>

        {/* --- Adding ------------------------------------------------------ */}
        {canUpdate ? (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                className="mb-1 block text-sm font-medium"
                htmlFor="inventory-code-format-token"
              >
                {t('organization.inventoryCodeFormat.addToken')}
              </label>
              <NativeSelect
                id="inventory-code-format-token"
                className="w-64"
                value={pendingToken}
                onChange={(event) => addToken(event.target.value)}
              >
                <option value="">{t('organization.inventoryCodeFormat.choose')}</option>
                {(config.tokens ?? [])
                  // At most one sequence, so it is offered only when the format
                  // has none — which, since `CR-007`, it may not.
                  .filter((token) => token.id !== SEQUENCE || !hasSequence)
                  .map((token) => (
                    <option key={token.id} value={token.id}>
                      {tokenLabel(t, token, token.id)}
                    </option>
                  ))}
              </NativeSelect>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">
                {t('organization.inventoryCodeFormat.addSeparator')}
              </p>
              <div className="flex gap-1">
                {SEPARATORS.map((separator) => (
                  <Button
                    key={separator}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendBeforeSequence({ type: 'literal', value: separator })}
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    <span className="font-mono">{separator}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* --- Preview ----------------------------------------------------- */}
        <div>
          <p className="mb-1 text-sm font-medium">
            {t('organization.inventoryCodeFormat.previewLabel')}
          </p>
          <p className="font-mono text-lg" data-testid="inventory-code-preview">
            {preview}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('organization.inventoryCodeFormat.previewNote', { max: config.maxLength })}
          </p>
        </div>

        {/*
          --- Who provides each part — P4 (§64.4) ---------------------------
          The one place the format's parts are explained in the terms a
          registrar meets them: the Unit number is typed, per unit; everything
          else is filled in or assigned. Registrars never see this format.
        */}
        <div className="rounded-md border border-border p-3" data-testid="inventory-code-roles">
          <p className="mb-2 text-sm font-medium">
            {t('organization.inventoryCodeFormat.howTitle')}
          </p>
          <ul className="space-y-1 text-sm">
            {segments
              .filter((segment) => segment.type === 'token')
              .map((segment, index) => {
                const token = tokensById.get(segment.value);
                const role =
                  segment.value === COMPOSITION
                    ? t('organization.inventoryCodeFormat.roleTyped')
                    : segment.value === SEQUENCE
                      ? t('organization.inventoryCodeFormat.roleAllocated')
                      : t('organization.inventoryCodeFormat.roleGenerated', {
                          source: t(`organization.inventoryCodeFormat.sources.${segment.value}`, {
                            defaultValue: token?.source ?? segment.value,
                          }),
                        });
                return (
                  <li key={`${segment.value}-${index}`} className="flex flex-wrap gap-x-2">
                    <span
                      className={
                        segment.value === COMPOSITION
                          ? 'rounded bg-primary px-1 font-medium text-primary-foreground'
                          : 'font-medium'
                      }
                    >
                      {tokenLabel(t, token, segment.value)}
                    </span>
                    <span className="text-muted-foreground">{role}</span>
                  </li>
                );
              })}
          </ul>

          {usesComposition ? (
            <p className="mt-3 text-sm" data-testid="inventory-code-example">
              <span className="text-muted-foreground">
                {t('organization.inventoryCodeFormat.exampleLabel')}:{' '}
                {t('organization.inventoryCodeFormat.exampleTyped')}{' '}
              </span>
              <span className="rounded bg-primary px-1 font-mono font-semibold text-primary-foreground">
                {EXAMPLE_UNIT_NUMBER}
              </span>{' '}
              <span className="text-muted-foreground">
                {t('organization.inventoryCodeFormat.exampleResult')}{' '}
              </span>
              <span className="font-mono">
                {segments.map((segment, index) => {
                  if (segment.type === 'literal') return <span key={index}>{segment.value}</span>;
                  if (segment.value === COMPOSITION) {
                    return (
                      <span
                        key={index}
                        className="rounded bg-primary px-1 font-semibold text-primary-foreground"
                      >
                        {EXAMPLE_UNIT_NUMBER}
                      </span>
                    );
                  }
                  const token = tokensById.get(segment.value);
                  return (
                    <span key={index} className="text-muted-foreground">
                      {token?.resolvable ? token.sample : `{${segment.value}}`}
                    </span>
                  );
                })}
              </span>
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('organization.inventoryCodeFormat.noTyped')}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {t('organization.inventoryCodeFormat.registrarNote')}
          </p>
        </div>

        {/* --- Consequences, stated where the decision is made -------------- */}
        {unresolved.length > 0 ? (
          <Alert variant="warning" size="sm">
            {t('organization.inventoryCodeFormat.unresolved', {
              tokens: unresolved.map((token) => tokenLabel(t, token, token.id)).join(', '),
            })}
          </Alert>
        ) : null}

        {optionalInUse.length > 0 ? (
          <Alert variant="warning" size="sm">
            {t('organization.inventoryCodeFormat.requiresValue', {
              tokens: optionalInUse.map((token) => tokenLabel(t, token, token.id)).join(', '),
            })}
          </Alert>
        ) : null}

        {!usesInstitution ? (
          <Alert variant="warning" size="sm">
            {t('organization.inventoryCodeFormat.sharedNumbering')}
          </Alert>
        ) : null}

        {/*
          The consequence of dropping the sequence, stated where it is dropped
          (`CR-007`, `07-ui.md` §5.1). With one, a batch shares a single typed
          value and the allocator separates the units; without one, the typed
          value IS the separation, so a batch of forty needs forty of them.
        */}
        {usesComposition && !hasSequence ? (
          <Alert variant="warning" size="sm">
            {t('organization.inventoryCodeFormat.compositionPerUnit')}
          </Alert>
        ) : null}

        <Alert variant="info" size="sm">
          {t('organization.inventoryCodeFormat.futureOnly')}
        </Alert>

        {/* --- Saving ------------------------------------------------------ */}
        {canUpdate ? (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={config.isDefault || save.isPending}
              onClick={() => save.mutateAsync(null).catch(() => undefined)}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('organization.inventoryCodeFormat.reset')}
            </Button>
            <Button
              type="button"
              loading={save.isPending}
              disabled={!isDirty}
              onClick={() => save.mutateAsync(format).catch(() => undefined)}
            >
              {t('common.actions.saveChanges')}
            </Button>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
