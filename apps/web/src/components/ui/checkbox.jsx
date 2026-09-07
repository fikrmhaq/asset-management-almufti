import { cn } from '@/lib/utils';

/**
 * Checkbox and Radio — `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * DELIBERATELY NATIVE INPUTS, not Radix.
 *
 * Radix's Checkbox renders a `<button role="checkbox">` with a hidden input, and
 * a button cannot be driven by React Hook Form's `register()` — every consumer
 * would need a `Controller`. Eight forms in this application already register a
 * plain checkbox directly (`RolesPage`, `AttributeDefinitionsPage`,
 * `PermissionChecklist`, `UnitPicker`, `AttributeValueForm`, …), and rewriting
 * them to satisfy a styling choice would be a module change wearing a design
 * change's clothes.
 *
 * A native input restyled with `appearance-none` keeps every behaviour that
 * matters — role, checked state, Space to toggle, arrow keys within a radio
 * group, label association, form participation — and gives up nothing except
 * the platform's own glyph, which `checkbox-mark`/`radio-mark` replace
 * (`index.css`).
 *
 * FORCED COLOURS. `appearance-none` opts a control out of Windows High Contrast
 * rendering, which would leave the box invisible there.
 * `forced-colors:appearance-auto` hands it straight back to the platform in
 * exactly that mode.
 *
 * There is no `Switch` here on purpose. Nothing in the application uses one —
 * every boolean is a form field submitted with the rest of the form, and a
 * switch signals an immediate effect that the no-optimistic-update rule
 * (`07-ui.md` §4.3) means these controls do not have.
 *
 * Indeterminate state is not exposed: it can only be set through the DOM
 * property, which would mean owning a ref that `register()` also wants, and no
 * screen currently needs a tri-state parent toggle.
 */

const controlClasses =
  'peer h-4 w-4 shrink-0 appearance-none border border-input bg-background ' +
  'transition-colors checked:border-primary checked:bg-primary ' +
  'hover:border-border-strong checked:hover:border-primary-hover checked:hover:bg-primary-hover ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-neutral-100 ' +
  'disabled:checked:border-neutral-300 disabled:checked:bg-neutral-300 ' +
  'aria-[invalid=true]:border-destructive ' +
  'forced-colors:appearance-auto';

export function Checkbox({ className, invalid = false, ...props }) {
  return (
    <input
      type="checkbox"
      className={cn(controlClasses, 'checkbox-mark rounded-sm', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Radio({ className, invalid = false, ...props }) {
  return (
    <input
      type="radio"
      className={cn(controlClasses, 'radio-mark rounded-full', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

/**
 * A control with its label, aligned and clickable as one target.
 *
 * The label WRAPS the control rather than pointing at it by id: these appear in
 * generated lists — a permission checklist, a unit picker — where inventing a
 * stable unique id per row is friction with no benefit, and a wrapping label
 * associates them without one.
 */
export function CheckboxField({ label, description, className, children }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-sm', className)}>
      <span className="flex h-5 items-center">{children}</span>
      <span className="min-w-0 leading-tight">
        <span className="font-medium text-foreground">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
