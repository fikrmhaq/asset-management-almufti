import { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * Combobox — `IMPLEMENTATION_PLAN.md` §15.4.
 *
 * A searchable single-select, for lists too long to scan in a `Select` but flat
 * enough not to need drilling: institutions, departments, suppliers, vendors,
 * users.
 *
 * NOT the classification picker. `ref.asset_classifications` is a 5-level
 * hierarchy of thousands of leaves, and `07-ui.md` §4.5 (with REQ-CLASS-010)
 * rules out any flat list for it. That picker is its own component, built in
 * Phase 11 on top of this dialog/popover foundation.
 *
 * `onSearchChange` exists so a caller can drive the option list from the server
 * instead of filtering in the browser (`IMPLEMENTATION_PLAN.md` §33 forbids
 * loading a whole table to filter client-side).
 *
 * THE THREE PANEL STATES — results, searching, nothing found — are given the
 * same shape and the same vertical space here, so the panel does not jump as a
 * user types. This component is the foundation the later dependent-select,
 * permission-restricted-select and create-related-entity patterns build on, so
 * its states are worth settling once.
 *
 * `footer` is a render prop receiving `{ close }`, drawn beneath the list and
 * OUTSIDE it. Outside is the point: anything inside `Command.List` is a cmdk
 * item and would be filtered away by the very search that makes a user realise
 * the record they want does not exist — which is exactly when the footer needs
 * to be visible. See `patterns/create-related-entity.jsx`.
 */
export function Combobox({
  options = [],
  value,
  onChange,
  onSearchChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  invalid = false,
  loading = false,
  footer,
  className,
  ...triggerProps
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            'aria-[invalid=true]:border-destructive aria-[invalid=true]:outline-destructive',
            !selected && 'text-neutral-400',
            className
          )}
          {...triggerProps}
        >
          <span className="truncate">
            {selected?.label ?? placeholder ?? t('common.select.placeholder')}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-(--radix-popover-trigger-width) overflow-hidden rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-md"
        >
          {/* Server-driven searching must not be filtered a second time here. */}
          <Command shouldFilter={!onSearchChange}>
            <div className="relative border-b border-border">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Command.Input
                placeholder={searchPlaceholder ?? t('common.select.search')}
                onValueChange={onSearchChange}
                className="h-9 w-full bg-transparent pr-3 pl-9 text-sm outline-hidden placeholder:text-neutral-400"
              />
            </div>
            <Command.List className="scrollbar-subtle max-h-64 overflow-y-auto p-1">
              {loading ? (
                // Same height and alignment as the empty state, so the panel
                // does not resize between "looking" and "nothing".
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('common.states.loading')}
                </div>
              ) : (
                <>
                  <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                    {emptyMessage ?? t('common.states.noResults')}
                  </Command.Empty>
                  {options.map((option) => (
                    <Command.Item
                      key={option.value}
                      value={option.label}
                      onSelect={() => {
                        onChange?.(option.value === value ? null : option.value);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                        'data-[selected=true]:bg-neutral-100 data-[selected=true]:text-foreground'
                      )}
                    >
                      {/* The tick is the report of what is chosen; the row
                          highlight only says where the keyboard is. */}
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0 text-brand-600',
                          option.value === value ? 'opacity-100' : 'opacity-0'
                        )}
                        aria-hidden="true"
                      />
                      <span
                        className={cn(
                          'truncate',
                          option.value === value && 'font-medium text-brand-700'
                        )}
                      >
                        {option.label}
                      </span>
                    </Command.Item>
                  ))}
                </>
              )}
            </Command.List>

            {footer ? (
              <div className="border-t border-border p-1">
                {footer({ close: () => setOpen(false) })}
              </div>
            ) : null}
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
