import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Select — `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * For short, known option lists: status filters, condition, lifecycle state.
 * A long or searchable list is a `Combobox` instead, and a classification is
 * never either of these — it has its own picker (`07-ui.md` §4.5, Phase 11).
 *
 * The trigger is styled to match `Input` exactly — same height, radius, border,
 * shadow, focus and invalid treatment — because on a filter bar the two sit side
 * by side and any difference reads as a difference in kind.
 *
 * Radix owns the behaviour: typeahead, arrow keys, Home/End, Escape, focus
 * return to the trigger, and the `aria-*` wiring between trigger and listbox.
 * Nothing below touches any of it.
 */

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

/**
 * A native `<select>`, styled to match `SelectTrigger` exactly.
 *
 * WHY A SECOND SELECT EXISTS AT ALL. The Radix `Select` above renders a
 * `<button role="combobox">`, which `userEvent.selectOptions` cannot drive and
 * `register()` cannot bind without a `Controller`. Several forms — the asset
 * form's institution and vendor fields, the contract form's account code and
 * institution, and the attribute-definition form's type and scope — were
 * written against a real `<select>` and are tested through it. Those fields are
 * deliberately staying native (see each screen's own note); what was NOT
 * deliberate is that the same forty-character class string had been pasted at
 * every one of them, so the two selects had already begun to drift visually.
 *
 * `invalid` is the `Field` render-prop contract, not a DOM attribute. Taking it
 * as a named prop here is what stops it being spread onto the element, which is
 * what React was warning about ("Received `false` for a non-boolean attribute
 * `invalid`") — a caller can now spread `fieldProps` wholesale and be correct.
 */
export function NativeSelect({ className, invalid = false, children, ...props }) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs ' +
          'transition-colors hover:border-border-strong ' +
          'focus-visible:border-brand-500 ' +
          'disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-muted-foreground ' +
          'aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive',
        className
      )}
      aria-invalid={invalid || undefined}
      {...props}
    >
      {children}
    </select>
  );
}

export function SelectTrigger({ className, invalid = false, children, ...props }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input ' +
          'bg-background px-3 py-2 text-sm shadow-xs transition-colors ' +
          'hover:border-border-strong ' +
          'focus-visible:border-brand-500 ' +
          'data-[placeholder]:text-neutral-400 ' +
          'disabled:cursor-not-allowed disabled:border-border disabled:bg-neutral-50 disabled:text-muted-foreground ' +
          '[&>span]:line-clamp-1 ' +
          'aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive',
        className
      )}
      aria-invalid={invalid || undefined}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = 'popper', ...props }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          'relative z-50 max-h-96 min-w-32 overflow-hidden rounded-lg border border-border ' +
            'bg-popover text-popover-foreground shadow-md',
          className
        )}
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        // Highlight and selection are different things and look different:
        // `focus` is where the keyboard is, `checked` is what is chosen. The
        // tick — not the tint — is what actually reports the selection, so the
        // two never have to be told apart by colour alone.
        'relative flex w-full cursor-default items-center rounded-md py-1.5 pr-8 pl-2 text-sm ' +
          'outline-hidden select-none ' +
          'focus:bg-neutral-100 focus:text-foreground ' +
          'data-[state=checked]:font-medium data-[state=checked]:text-brand-700 ' +
          'data-disabled:pointer-events-none data-disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4 text-brand-600" aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}
