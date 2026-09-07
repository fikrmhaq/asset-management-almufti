import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Combobox } from '@/components/ui/combobox';

/**
 * A select whose valid options come from another field's value.
 *
 * The pattern, not any particular rule: which contract items belong to a
 * contract, which locations sit under a location, which units belong to an
 * asset. This component knows none of that — the caller fetches the options and
 * says what they depend on.
 *
 * THREE PROBLEMS IT EXISTS TO SOLVE, all of which are otherwise re-solved badly
 * on every screen:
 *
 *   1. An enabled-looking control with nothing in it. Until the parent is
 *      chosen there is nothing to choose from, so the control is disabled AND
 *      says why. "Disabled with no explanation" is the failure mode this whole
 *      redesign keeps finding.
 *   2. A stale selection. When the parent changes, a value chosen under the old
 *      parent is usually no longer valid, and submitting it would produce a
 *      combination the server will reject.
 *   3. Clearing an edit form on arrival. A record being edited already has both
 *      values set, and a reset that fires on mount would silently wipe the
 *      second one before the user touched anything.
 *
 * (3) is why the reset is keyed on a CHANGE to `dependsOn` rather than on its
 * emptiness: the first render records the value, and only a genuine change to
 * it clears the dependent field.
 *
 * @param {object} props
 * @param {unknown} props.dependsOn the parent field's current value
 * @param {React.ReactNode} [props.unavailableMessage]
 *   Why the control is not usable yet — shown when `dependsOn` is empty.
 * @param {React.ReactNode} [props.emptyMessage]
 *   The parent IS chosen but has no options of its own; a different situation
 *   and a different sentence.
 */
export function DependentSelect({
  dependsOn,
  options = [],
  value,
  onChange,
  loading = false,
  invalid = false,
  disabled = false,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  unavailableMessage,
  onSearchChange,
  className,
  ...triggerProps
}) {
  const { t } = useTranslation();
  const previous = useRef(dependsOn);
  const hasDependency = dependsOn !== null && dependsOn !== undefined && dependsOn !== '';

  useEffect(() => {
    if (previous.current === dependsOn) return;
    previous.current = dependsOn;

    // Only clear something that is actually set — calling `onChange(null)` on an
    // already-empty field would mark a pristine form dirty for no reason.
    if (value !== null && value !== undefined && value !== '') onChange?.(null);
    // `onChange` and `value` are read, not depended on: re-running this when the
    // caller re-creates its handler would clear the field on an unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependsOn]);

  return (
    <div className={cn('space-y-1.5', className)}>
      <Combobox
        options={hasDependency ? options : []}
        value={value}
        onChange={onChange}
        onSearchChange={onSearchChange}
        loading={loading}
        // Disabled is the honest state: there is genuinely nothing to pick.
        disabled={disabled || !hasDependency}
        invalid={invalid}
        placeholder={hasDependency ? placeholder : t('patterns.dependent.placeholder')}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage ?? t('patterns.dependent.empty')}
        {...triggerProps}
      />

      {/* The explanation sits outside the disabled control, because content
          inside a disabled element is skipped by some screen readers — the one
          audience most in need of the reason. */}
      {!hasDependency ? (
        <Alert variant="info" size="sm">
          {unavailableMessage ?? t('patterns.dependent.unavailable')}
        </Alert>
      ) : null}
    </div>
  );
}
