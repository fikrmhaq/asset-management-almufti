import { useTranslation } from 'react-i18next';

import { Field } from '@/components/form/field';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Alert } from '@/components/ui/alert';

/**
 * Dynamic attribute values — `07-ui.md` §5.3, `IMPLEMENTATION_PLAN.md` §18.7;
 * REQ-ATTR-006/007/008.
 *
 * The form is rendered from `GET .../attribute-values`, which returns EVERY
 * applicable definition — valued or not — along with its type and unit. One
 * response is therefore both the schema and the data, and the form cannot offer
 * an input the server will refuse (it lists only active definitions for the
 * owner's classification).
 *
 * Submission replaces the whole set (`PUT`, not `PATCH`): replacement is what
 * makes "this attribute was cleared" expressible at all, and it is the only
 * shape that lets the server enforce required attributes.
 *
 * `lockedIds` (REQ-REQUEST-021) shows those values read-only, with `lockedHint`
 * beneath — the registration dialog's "fill blanks, never overwrite". A locked
 * value is still part of `values`, so a whole-set save carries it unchanged.
 *
 * `SELECTION` renders as free text, with the limitation stated. `GAP-001`: the
 * data model has nowhere to store an option list, so there is no set of allowed
 * values to render a dropdown from. Rendering an empty dropdown, or inventing
 * options, would both misrepresent what the server will accept.
 */

/** One input, chosen by the definition's declared type (REQ-ATTR-003). */
function AttributeInput({ definition, value, onChange, fieldProps, disabled }) {
  const { t } = useTranslation();
  const common = { ...fieldProps, disabled };

  switch (definition.attributeType) {
    case 'NUMBER':
      return (
        <div className="flex items-center gap-2">
          <Input
            {...common}
            type="number"
            step="any"
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
          {definition.measurementUnitName ? (
            <span className="shrink-0 text-sm text-muted-foreground">
              {definition.measurementUnitName}
            </span>
          ) : null}
        </div>
      );

    case 'BOOLEAN':
      return (
        // The shared control now, rather than a bare browser checkbox. It is
        // still a native `<input type="checkbox">` underneath — that is the
        // point of `Checkbox` — so `checked`, keyboard toggling and the label
        // association all behave exactly as they did.
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            {...common}
            checked={value === true || value === 'true'}
            onChange={(event) => onChange(event.target.checked)}
          />
          {t('assets.attributes.yes')}
        </label>
      );

    case 'DATE':
      return (
        <DatePicker
          {...common}
          value={value ?? null}
          onChange={onChange}
          invalid={fieldProps.invalid}
        />
      );

    // TEXT, SELECTION and REFERENCE all take free text today. SELECTION says why
    // just below; REFERENCE has no documented target resource to resolve against.
    default:
      return (
        <Input {...common} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
      );
  }
}

export function AttributeValueForm({
  definitions = [],
  values = {},
  onChange,
  errors = {},
  disabled = false,
  lockedIds = [],
  lockedHint,
}) {
  const { t } = useTranslation();

  if (definitions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(`assets.attributes.none`)}</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {definitions.map((definition) => {
        const id = definition.attributeDefinitionId;
        const locked = lockedIds.includes(id);

        return (
          <Field
            key={id}
            label={definition.name}
            required={definition.isRequired}
            error={errors[id]}
            hint={
              locked
                ? lockedHint
                : definition.attributeType === 'SELECTION'
                  ? t('assets.attributes.selectionHint')
                  : undefined
            }
          >
            {(fieldProps) => (
              <AttributeInput
                definition={definition}
                value={values[id]}
                onChange={(next) => onChange({ ...values, [id]: next })}
                fieldProps={fieldProps}
                disabled={disabled || locked}
              />
            )}
          </Field>
        );
      })}

      {/* A workflow constraint the user cannot act on but deserves to
          understand — exactly what `Alert` is for. `role="note"` is kept: this
          is a standing explanation, not something to announce. */}
      {definitions.some((definition) => definition.attributeType === 'SELECTION') ? (
        <Alert role="note" variant="info" className="text-xs sm:col-span-2">
          {t('assets.attributes.selectionNote')}
        </Alert>
      ) : null}
    </div>
  );
}

/** Turns the API's list into the `{ definitionId: value }` map the form edits. */
export function toValueMap(definitions = []) {
  return Object.fromEntries(
    definitions.map((definition) => [definition.attributeDefinitionId, definition.value])
  );
}
